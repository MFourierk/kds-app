import { useState } from 'react'

/**
 * Catégories de modificateurs (§5.2, demandé après coup — structurer
 * Cuisson/Sauce & Garniture/Piquant... au lieu d'une liste plate, et
 * forcer un choix pour certaines avant de valider un plat). Partagé
 * entre les 3 écrans de commande (QR client, Prendre commande, TPE
 * comptoir) : la logique de groupement/validation vit ici une seule
 * fois, seul l'habillage change (`DetailPlatModal` l'embarque directement
 * — déjà son propre point "personnaliser avant d'ajouter", pas un second
 * pop-up empilé — les écrans staff utilisent `SelecteurModificateursPopup`
 * ci-dessous, qui fournit son propre fond/carte).
 *
 * `modifiers` : forme uniforme attendue par l'appelant, quelle que soit
 * la source (déjà imbriquée côté QR via `QrMenuItemSerializer`, ou
 * reconstruite côté staff en croisant `/api/modifiers/` avec la liste
 * d'IDs `plat.modifiers`) — `{ id, libelle, categorie, categorie_nom,
 * categorie_obligatoire, categorie_selection_multiple }`.
 */
export function groupesDepuisModificateurs(modifiers) {
  const parCategorie = new Map()
  for (const m of modifiers) {
    const cle = m.categorie ?? '__sans_categorie__'
    if (!parCategorie.has(cle)) {
      parCategorie.set(cle, {
        categorie: m.categorie,
        nom: m.categorie_nom ?? 'Autres options',
        obligatoire: Boolean(m.categorie_obligatoire),
        selectionMultiple: Boolean(m.categorie_selection_multiple),
        options: [],
      })
    }
    parCategorie.get(cle).options.push(m)
  }
  return [...parCategorie.values()]
}

/** Catégories obligatoires (parmi `groupes`) sans aucune sélection dans `selection` (array d'IDs). */
export function categoriesObligatoiresManquantes(groupes, selection) {
  return groupes.filter((g) => g.obligatoire && !g.options.some((o) => selection.includes(o.id)))
}

/**
 * Reconstruit la forme uniforme attendue par `groupesDepuisModificateurs`
 * côté staff (Prendre commande, TPE comptoir) : `MenuItemSerializer`
 * n'expose `plat.modifiers` que comme une liste d'IDs (pas imbriqué comme
 * `QrMenuItemSerializer` côté client), donc il faut croiser avec le
 * catalogue complet `/api/modifiers/` + `/api/modifier-categories/`
 * (chargés une fois par l'écran) pour retrouver libellé/catégorie/
 * obligatoire.
 */
export function resoudreModificateursDuPlat(plat, catalogueModificateurs, catalogueCategories) {
  const modifierParId = new Map(catalogueModificateurs.map((m) => [m.id, m]))
  const categorieParId = new Map(catalogueCategories.map((c) => [c.id, c]))
  return (plat.modifiers || [])
    .map((id) => modifierParId.get(id))
    .filter(Boolean)
    .map((m) => {
      const categorie = m.categorie ? categorieParId.get(m.categorie) : null
      return {
        id: m.id,
        libelle: m.libelle,
        categorie: m.categorie,
        categorie_nom: m.categorie_nom,
        categorie_obligatoire: categorie?.obligatoire ?? false,
        categorie_selection_multiple: categorie?.selection_multiple ?? false,
      }
    })
}

function toggleSelection(selection, groupe, modificateurId) {
  const dejaChoisi = selection.includes(modificateurId)
  if (groupe.selectionMultiple) {
    return dejaChoisi ? selection.filter((id) => id !== modificateurId) : [...selection, modificateurId]
  }
  // Choix unique : retire les autres options de CE groupe, garde celles des autres groupes.
  const idsDuGroupe = new Set(groupe.options.map((o) => o.id))
  const sansGroupe = selection.filter((id) => !idsDuGroupe.has(id))
  return dejaChoisi ? sansGroupe : [...sansGroupe, modificateurId]
}

/** Rendu "nu" des groupes de choix (pas de fond/carte) — embarquable dans n'importe quel conteneur. */
export function GroupesModificateurs({ groupes, selection, onChangerSelection, sombre = false }) {
  const couleurLabel = sombre ? 'text-slate-400' : 'text-gray-500'
  const couleurOption = sombre ? 'text-slate-200' : 'text-gray-700'

  return (
    <div className="space-y-4">
      {groupes.map((groupe) => (
        <div key={groupe.categorie ?? '__sans_categorie__'}>
          <p className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${couleurLabel}`}>
            {groupe.nom}
            {groupe.obligatoire && <span className="ml-1.5 text-red-500">• choix obligatoire</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {groupe.options.map((option) => {
              const choisi = selection.includes(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onChangerSelection(toggleSelection(selection, groupe, option.id))}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                    choisi
                      ? 'border-amber-500 bg-amber-500 text-slate-900'
                      : sombre
                        ? 'border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                  }`}
                >
                  {option.libelle}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className={`text-xs ${couleurOption}`}>Appuyez à nouveau sur une option pour la désélectionner.</p>
    </div>
  )
}

/**
 * Pop-up autonome (fond + carte + boutons) pour les écrans staff
 * (Prendre commande, TPE comptoir), qui n'ont aujourd'hui aucune étape de
 * personnalisation avant ajout — contrairement au client QR
 * (`DetailPlatModal`, qui embarque `GroupesModificateurs` directement).
 */
export default function SelecteurModificateursPopup({ plat, modifiers, onConfirmer, onFermer }) {
  const groupes = groupesDepuisModificateurs(modifiers)
  const [selection, setSelection] = useState([])
  const manquantes = categoriesObligatoiresManquantes(groupes, selection)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onFermer}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-slate-800 p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <p className="text-lg font-bold text-slate-100">{plat.nom}</p>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-slate-300"
          >
            ✕
          </button>
        </div>

        <GroupesModificateurs groupes={groupes} selection={selection} onChangerSelection={setSelection} sombre />

        <button
          type="button"
          onClick={() => onConfirmer(selection)}
          disabled={manquantes.length > 0}
          className="mt-5 w-full rounded-lg bg-emerald-500 py-3 font-semibold text-slate-900 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {manquantes.length > 0 ? `Choisir : ${manquantes.map((g) => g.nom).join(', ')}` : 'Ajouter au panier'}
        </button>
      </div>
    </div>
  )
}
