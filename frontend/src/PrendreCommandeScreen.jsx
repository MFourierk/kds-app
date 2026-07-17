import { useEffect, useState } from 'react'
import { apiFetch, logout } from './api'
import { formatPrix } from './client/formatPrix'
import SelecteurModificateursPopup, { resoudreModificateursDuPlat } from './SelecteurModificateurs'
import BandeauAppelServeur from './BandeauAppelServeur'
import { useTicketsSocket } from './useTicketsSocket'

/**
 * Prise de commande par le personnel (§5.1/§5.6, demandé après coup) —
 * même routage que le flux QR client (backend : `services.
 * route_items_to_tickets` via `OrderViewSet.prendre_commande`), mais
 * authentifié. Deux usages : le serveur commande à la place du client
 * en salle, ou — cas plus important — le client ne peut plus atteindre
 * le serveur du restaurant depuis son propre réseau mobile (coupure
 * internet du restaurant), alors que le personnel connecté au WiFi
 * local le peut toujours.
 *
 * Habillage volontairement plus soigné que les autres écrans internes
 * (photos des plats, dégradés, transitions) — contrairement à
 * Caisse/Service/Master qui sont des outils utilitaires pour du
 * personnel déjà formé, celui-ci reproduit un vrai geste de prise de
 * commande devant un client : l'écran doit donner envie, pas juste être
 * fonctionnel.
 */
export default function PrendreCommandeScreen({ role, onChangerEcran, onDeconnexion }) {
  // Même raisonnement que CaisseScreen (§5.6) : pas de canal temps réel
  // jusqu'ici, connecté seulement pour le bandeau "Appel serveur" partagé.
  const { appelsServeurActifs } = useTicketsSocket('master')
  const [tables, setTables] = useState(null)
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [catalogueModificateurs, setCatalogueModificateurs] = useState([])
  const [catalogueCategoriesModificateurs, setCatalogueCategoriesModificateurs] = useState([])
  const [tableChoisie, setTableChoisie] = useState(null)
  const [panier, setPanier] = useState([])
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState(null)
  // Plat en attente de personnalisation (§5.2) — n'ouvre le pop-up que
  // pour un plat qui a au moins un modificateur lié ; sinon ajout direct
  // inchangé, comme avant cette fonctionnalité.
  const [platPourModificateurs, setPlatPourModificateurs] = useState(null)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/tables/').then((r) => r.json()),
      apiFetch('/api/menu-categories/').then((r) => r.json()),
      apiFetch('/api/menu-items/').then((r) => r.json()),
      apiFetch('/api/modifiers/').then((r) => r.json()),
      apiFetch('/api/modifier-categories/').then((r) => r.json()),
    ]).then(([t, c, i, m, cm]) => {
      setTables(Array.isArray(t) ? t.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true })) : [])
      setCategories(Array.isArray(c) ? c.sort((a, b) => a.ordre_affichage - b.ordre_affichage) : [])
      setItems(Array.isArray(i) ? i : [])
      setCatalogueModificateurs(Array.isArray(m) ? m : [])
      setCatalogueCategoriesModificateurs(Array.isArray(cm) ? cm : [])
    })
  }, [])

  function afficherMessage(texte, erreur = false) {
    setMessage({ texte, erreur })
    setTimeout(() => setMessage(null), 5000)
  }

  function ajouterLigneAuPanier(plat, modificateurs = []) {
    setPanier((p) => [
      ...p,
      {
        plat: plat.id,
        plat_nom: plat.nom,
        prix: plat.prix,
        quantite: 1,
        service_immediat: true,
        servir_en_dernier: false,
        commentaire_libre: '',
        modificateurs,
      },
    ])
  }

  function ajouterAuPanier(plat) {
    if (plat.modifiers?.length > 0) {
      setPlatPourModificateurs(plat)
      return
    }
    ajouterLigneAuPanier(plat)
  }

  function confirmerModificateurs(modificateurs) {
    ajouterLigneAuPanier(platPourModificateurs, modificateurs)
    setPlatPourModificateurs(null)
  }

  function modifierQuantite(index, delta) {
    setPanier((p) =>
      p
        .map((ligne, i) => (i === index ? { ...ligne, quantite: ligne.quantite + delta } : ligne))
        .filter((ligne) => ligne.quantite > 0)
    )
  }

  // Cycle "Dès que prêt" → "Avec le reste" → "À la fin" → ... (§5.6,
  // "à la fin" ajouté après coup) — un tap répété sur la même puce,
  // plutôt qu'un sélecteur séparé, pour rester compact dans la liste du
  // panier.
  function cyclerMomentService(index) {
    setPanier((p) =>
      p.map((ligne, i) => {
        if (i !== index) return ligne
        if (ligne.service_immediat) return { ...ligne, service_immediat: false, servir_en_dernier: false }
        if (!ligne.servir_en_dernier) return { ...ligne, servir_en_dernier: true }
        return { ...ligne, service_immediat: true, servir_en_dernier: false }
      })
    )
  }

  function retirerDuPanier(index) {
    setPanier((p) => p.filter((_, i) => i !== index))
  }

  async function envoyerCommande() {
    if (!tableChoisie || panier.length === 0) return
    setEnCours(true)
    try {
      const res = await apiFetch('/api/orders/prendre-commande/', {
        method: 'POST',
        body: JSON.stringify({
          table: tableChoisie.id,
          items: panier.map(({ plat, quantite, service_immediat, servir_en_dernier, commentaire_libre, modificateurs }) => ({
            plat,
            quantite,
            service_immediat,
            servir_en_dernier,
            commentaire_libre,
            modificateurs,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        afficherMessage(data.detail ?? 'Erreur.', true)
        return
      }
      afficherMessage(`Commande envoyée pour la table ${tableChoisie.numero}.`)
      setPanier([])
      setTableChoisie(null)
    } catch {
      afficherMessage("Connexion perdue — vérifie le WiFi et réessaie.", true)
    } finally {
      setEnCours(false)
    }
  }

  const platsDisponibles = items.filter((p) => p.statut === 'disponible' && p.is_active)
  const sousTotal = panier.reduce((s, l) => s + l.prix * l.quantite, 0)

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-900 to-slate-950 p-4">
      <header className="mb-5">
        <h1 className="mb-3 bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 bg-clip-text text-2xl font-extrabold text-transparent">
          Prendre commande
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {tableChoisie && (
            <button
              onClick={() => setTableChoisie(null)}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 ring-1 ring-white/10 transition hover:bg-slate-700"
            >
              ← Changer de table
            </button>
          )}
          {onChangerEcran && (
            <button
              onClick={onChangerEcran}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 ring-1 ring-white/10 transition hover:bg-slate-700"
            >
              Changer d'écran
            </button>
          )}
          <button
            onClick={() => {
              logout()
              onDeconnexion()
            }}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 ring-1 ring-white/10 transition hover:bg-slate-700"
          >
            Déconnexion
          </button>
        </div>
      </header>

      <BandeauAppelServeur appels={appelsServeurActifs} role={role} />

      {message && (
        <div
          className={`mb-4 rounded-xl p-3 text-center text-sm font-semibold text-white shadow-lg ${
            message.erreur ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {message.texte}
        </div>
      )}

      {!tableChoisie ? (
        !tables ? (
          <p className="text-center text-slate-500">Chargement...</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {tables.map((table) => {
              const occupee = table.statut === 'occupee'
              return (
                <button
                  key={table.id}
                  onClick={() => setTableChoisie(table)}
                  className={`group flex flex-col items-center gap-2 rounded-2xl border py-6 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
                    occupee
                      ? 'border-amber-500/30 bg-gradient-to-b from-amber-950/50 to-slate-800 hover:shadow-amber-900/40'
                      : 'border-slate-700/80 bg-gradient-to-b from-slate-800 to-slate-800/60 hover:border-amber-400/50 hover:shadow-black/40'
                  }`}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900/70 text-xl font-bold text-slate-100 ring-1 ring-white/10 transition group-hover:ring-amber-400/40">
                    {table.numero}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Table</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                      occupee ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/10 text-emerald-400'
                    }`}
                  >
                    {occupee ? 'Occupée' : 'Libre'}
                  </span>
                </button>
              )
            })}
          </div>
        )
      ) : (
        <>
          <div className="mb-5 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15 text-sm font-bold text-amber-400 ring-1 ring-amber-500/30">
              {tableChoisie.numero}
            </span>
            <p className="text-lg font-semibold text-slate-100">Table {tableChoisie.numero}</p>
          </div>

          <div className="space-y-7 pb-4">
            {categories.map((cat) => {
              const plats = platsDisponibles.filter((p) => p.categorie === cat.id)
              if (plats.length === 0) return null
              return (
                <section key={cat.id}>
                  <div className="mb-3 flex items-center gap-3">
                    <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-amber-400">{cat.nom}</h2>
                    <span className="h-px flex-1 bg-gradient-to-r from-amber-500/40 to-transparent" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {plats.map((plat) => (
                      <button
                        key={plat.id}
                        onClick={() => ajouterAuPanier(plat)}
                        className="group overflow-hidden rounded-2xl bg-slate-800 text-left shadow-md ring-1 ring-white/5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 active:scale-[0.98]"
                      >
                        <div className="relative aspect-square w-full overflow-hidden bg-slate-700">
                          {plat.image ? (
                            <img
                              src={plat.image}
                              alt=""
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-4xl opacity-40">🍽️</div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-2 pt-8">
                            <span className="rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-900 shadow">
                              {formatPrix(plat.prix, 'XOF')}
                            </span>
                          </div>
                        </div>
                        <p className="truncate px-2.5 py-2 text-sm font-semibold text-slate-100">{plat.nom}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>

          {panier.length > 0 && (
            <div className="sticky bottom-0 -mx-4 rounded-t-3xl border-t border-amber-500/30 bg-slate-900/95 p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-base">🧾</span>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Panier</p>
              </div>
              <ul className="mb-3 max-h-48 space-y-2 overflow-y-auto pr-1">
                {panier.map((ligne, i) => (
                  <li key={i} className="rounded-xl bg-slate-800/80 p-2.5 ring-1 ring-white/5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-100">{ligne.plat_nom}</span>
                      <span className="text-sm font-semibold text-amber-400" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatPrix(ligne.prix * ligne.quantite, 'XOF')}
                      </span>
                    </div>
                    {ligne.modificateurs?.length > 0 && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {ligne.modificateurs
                          .map((id) => catalogueModificateurs.find((m) => m.id === id)?.libelle)
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex items-center gap-1.5 rounded-full bg-slate-900 px-1 py-1 ring-1 ring-white/5">
                        <button
                          onClick={() => modifierQuantite(i, -1)}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-slate-200 transition hover:bg-slate-600"
                        >
                          −
                        </button>
                        <span className="w-4 text-center text-sm font-semibold text-slate-100">{ligne.quantite}</span>
                        <button
                          onClick={() => modifierQuantite(i, 1)}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-slate-200 transition hover:bg-slate-600"
                        >
                          +
                        </button>
                      </div>
                      <button
                        onClick={() => cyclerMomentService(i)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                          ligne.service_immediat ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-400'
                        }`}
                      >
                        {ligne.service_immediat ? '⚡ Dès que prêt' : ligne.servir_en_dernier ? '🏁 À la fin' : '⏳ Avec le reste'}
                      </button>
                      <button
                        onClick={() => retirerDuPanier(i)}
                        className="ml-auto text-xs font-semibold text-red-400 transition hover:text-red-300"
                      >
                        Retirer
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mb-3 flex items-center justify-between border-t border-white/10 pt-3 text-lg font-bold text-slate-100">
                <span>Sous-total</span>
                <span className="text-amber-400">{formatPrix(sousTotal, 'XOF')}</span>
              </div>
              <button
                onClick={envoyerCommande}
                disabled={enCours}
                className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 py-3.5 text-base font-bold text-slate-900 shadow-lg shadow-amber-500/20 transition hover:from-amber-300 hover:to-amber-400 disabled:opacity-50"
              >
                {enCours ? 'Envoi...' : `Envoyer la commande (${panier.length})`}
              </button>
            </div>
          )}
        </>
      )}

      {platPourModificateurs && (
        <SelecteurModificateursPopup
          plat={platPourModificateurs}
          modifiers={resoudreModificateursDuPlat(platPourModificateurs, catalogueModificateurs, catalogueCategoriesModificateurs)}
          onConfirmer={confirmerModificateurs}
          onFermer={() => setPlatPourModificateurs(null)}
        />
      )}
    </div>
  )
}
