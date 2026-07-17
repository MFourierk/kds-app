import { useEffect, useMemo, useState } from 'react'
import { apiFetch, fetchTenant, logout } from './api'
import { formatPrix } from './client/formatPrix'
import { construireRecuHTML, ouvrirApercuImpression } from './print/imprimer'
import PaiementPicker from './PaiementPicker'
import SelecteurModificateursPopup, { resoudreModificateursDuPlat } from './SelecteurModificateurs'

/**
 * Écran TPE — vente comptoir (§vente comptoir, demandé après coup) :
 * un client au comptoir n'est rattaché à aucune table, contrairement au
 * reste de l'app pensée autour du service en salle. Grille de produits +
 * panier + encaissement immédiat, dans le même thème sombre ambre/ardoise
 * que le reste des écrans staff (référence "ResolvPOS" fournie pour la
 * mise en page uniquement, pas la palette).
 *
 * Toujours `embarque` désormais (onglet "Vente comptoir" de
 * `CaisseScreen`, y compris pour la caissière — elle atterrit sur
 * `CaisseScreen` verrouillé plutôt que directement ici, cf. `App.jsx`,
 * pour pouvoir aussi encaisser les commandes de table) : pas d'en-tête
 * propre, celui de `CaisseScreen` suffit déjà. Le montage autonome
 * (`embarque=false`) reste supporté par ce composant mais n'est plus
 * utilisé nulle part — laissé au cas où un futur usage isolé en aurait
 * besoin.
 *
 * Toujours `service_immediat: true` sur chaque ligne — pas de "poste
 * cuisine vs reste de la commande" à arbitrer pour un achat comptoir,
 * contrairement à `PrendreCommandeScreen` (service en salle).
 *
 * Réutilise `OrderViewSet.prendre_commande` (sans `table`, §backend) puis
 * `encaisser` — création et paiement en une seule séquence côté écran,
 * pas de nouvel endpoint : si l'encaissement échoue après la création
 * (coupure réseau), la commande existe déjà non payée et reste
 * récupérable depuis l'onglet "Commandes de table" de `CaisseScreen`
 * (liste non filtrée par table).
 */
export default function VenteComptoirScreen({ utilisateur, onChangerEcran, onDeconnexion, embarque = false, tenant: tenantProp }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [catalogueModificateurs, setCatalogueModificateurs] = useState([])
  const [catalogueCategoriesModificateurs, setCatalogueCategoriesModificateurs] = useState([])
  const [recherche, setRecherche] = useState('')
  const [categorieActive, setCategorieActive] = useState('tous')
  const [panier, setPanier] = useState([])
  const [paiementOuvert, setPaiementOuvert] = useState(false)
  const [modePaiement, setModePaiement] = useState('especes')
  const [montantRecu, setMontantRecu] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState(null)
  const [tenantLocal, setTenantLocal] = useState(null)
  // Plat en attente de personnalisation (§5.2) — cf. `PrendreCommandeScreen.jsx`.
  const [platPourModificateurs, setPlatPourModificateurs] = useState(null)
  const tenant = tenantProp ?? tenantLocal

  useEffect(() => {
    Promise.all([
      apiFetch('/api/menu-categories/').then((r) => r.json()),
      apiFetch('/api/menu-items/').then((r) => r.json()),
      apiFetch('/api/modifiers/').then((r) => r.json()),
      apiFetch('/api/modifier-categories/').then((r) => r.json()),
    ]).then(([c, i, m, cm]) => {
      setCategories(Array.isArray(c) ? c.sort((a, b) => a.ordre_affichage - b.ordre_affichage) : [])
      setItems(Array.isArray(i) ? i : [])
      setCatalogueModificateurs(Array.isArray(m) ? m : [])
      setCatalogueCategoriesModificateurs(Array.isArray(cm) ? cm : [])
    })
  }, [])

  useEffect(() => {
    // Ne re-télécharge pas si `CaisseScreen` a déjà le tenant en mémoire
    // (§embarque) — évite un double appel pour la même donnée.
    if (tenantProp) return
    fetchTenant().then(setTenantLocal).catch(() => {})
  }, [tenantProp])

  function afficherMessage(texte, erreur = false) {
    setMessage({ texte, erreur })
    setTimeout(() => setMessage(null), 5000)
  }

  const platsDisponibles = useMemo(() => {
    const recherche_ = recherche.trim().toLowerCase()
    return items.filter((p) => {
      if (p.statut !== 'disponible' || !p.is_active) return false
      if (categorieActive !== 'tous' && p.categorie !== categorieActive) return false
      if (recherche_ && !p.nom.toLowerCase().includes(recherche_)) return false
      return true
    })
  }, [items, categorieActive, recherche])

  // Deux lignes du même plat ne fusionnent que si elles portent EXACTEMENT
  // les mêmes modificateurs (§5.2) — sinon deux cuissons différentes pour
  // la même "Entrecôte" perdraient silencieusement l'une des deux
  // sélections en fusionnant leurs quantités.
  function memeSelectionModificateurs(a, b) {
    if (a.length !== b.length) return false
    const ensembleA = new Set(a)
    return b.every((id) => ensembleA.has(id))
  }

  function ajouterLigneAuPanier(plat, modificateurs = []) {
    setPanier((p) => {
      const existante = p.findIndex((l) => l.plat === plat.id && memeSelectionModificateurs(l.modificateurs || [], modificateurs))
      if (existante === -1) {
        return [...p, { plat: plat.id, plat_nom: plat.nom, prix: plat.prix, quantite: 1, modificateurs }]
      }
      return p.map((l, i) => (i === existante ? { ...l, quantite: l.quantite + 1 } : l))
    })
  }

  function ajouterAuPanier(plat) {
    // Un plat avec modificateurs rouvre toujours le sélecteur (jamais
    // d'incrément aveugle sur retap) — sinon impossible de savoir quels
    // modificateurs seraient concernés par le +1. Un plat sans
    // modificateur garde le comportement d'origine (incrément direct).
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
      p.map((ligne, i) => (i === index ? { ...ligne, quantite: ligne.quantite + delta } : ligne)).filter((l) => l.quantite > 0)
    )
  }

  function viderPanier() {
    setPanier([])
    setPaiementOuvert(false)
  }

  const total = panier.reduce((s, l) => s + l.prix * l.quantite, 0)

  function ouvrirPaiement() {
    if (panier.length === 0) return
    setModePaiement('especes')
    setMontantRecu(String(total))
    setPaiementOuvert(true)
  }

  async function confirmerVente() {
    setEnCours(true)
    try {
      const resCreation = await apiFetch('/api/orders/prendre-commande/', {
        method: 'POST',
        body: JSON.stringify({
          items: panier.map(({ plat, quantite, modificateurs }) => ({
            plat,
            quantite,
            service_immediat: true,
            modificateurs,
          })),
        }),
      })
      const commande = await resCreation.json().catch(() => ({}))
      if (!resCreation.ok) {
        afficherMessage(commande.detail ?? 'Erreur lors de la création de la vente.', true)
        return
      }

      const bodyPaiement = { mode_paiement: modePaiement }
      if (modePaiement === 'especes') bodyPaiement.montant_recu = Number(montantRecu) || commande.total
      const resPaiement = await apiFetch(`/api/orders/${commande.id}/encaisser/`, {
        method: 'POST',
        body: JSON.stringify(bodyPaiement),
      })
      const paye = await resPaiement.json().catch(() => ({}))
      if (!resPaiement.ok) {
        afficherMessage(
          `Vente enregistrée mais encaissement échoué (${paye.detail ?? 'erreur'}) — retrouvable dans "Commandes de table".`,
          true
        )
        setPanier([])
        setPaiementOuvert(false)
        return
      }

      const ouvert = ouvrirApercuImpression(`Reçu — Vente comptoir`, construireRecuHTML(tenant, paye), {
        autoriserImpression: true,
      })
      if (!ouvert) {
        afficherMessage('Vente encaissée. Aperçu bloqué par le navigateur — autorisez les pop-ups pour imprimer.', true)
      } else {
        afficherMessage('Vente encaissée.')
      }
      setPanier([])
      setPaiementOuvert(false)
    } catch {
      afficherMessage('Connexion perdue — vérifie le réseau et réessaie.', true)
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className={embarque ? '' : 'min-h-full bg-slate-900 p-4 sm:p-6'}>
      {!embarque && (
        <header className="mb-6">
          <h1 className="mb-3 text-2xl font-bold text-slate-100 sm:text-3xl">Vente comptoir</h1>
          <div className="flex flex-wrap items-center gap-2">
            {onChangerEcran && (
              <button
                onClick={onChangerEcran}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600"
              >
                Changer d'écran
              </button>
            )}
            <button
              onClick={() => {
                logout()
                onDeconnexion()
              }}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600"
            >
              Déconnexion
            </button>
          </div>
        </header>
      )}

      {message && (
        <div
          className={`mb-4 rounded-xl p-3 text-center text-sm font-semibold text-white shadow-lg ${
            message.erreur ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {message.texte}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          <input
            type="text"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un article..."
            className="mb-3 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder:text-slate-500"
          />

          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setCategorieActive('tous')}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${
                categorieActive === 'tous' ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'
              }`}
            >
              Tous
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategorieActive(cat.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${
                  categorieActive === cat.id ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {cat.nom}
              </button>
            ))}
          </div>

          {platsDisponibles.length === 0 ? (
            <p className="text-center text-slate-500">Aucun article.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {platsDisponibles.map((plat) => (
                <button
                  key={plat.id}
                  onClick={() => ajouterAuPanier(plat)}
                  className="group overflow-hidden rounded-2xl bg-slate-800 text-left shadow-md ring-1 ring-white/5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl active:scale-[0.98]"
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-slate-700">
                    {plat.image ? (
                      <img src={plat.image} alt="" className="h-full w-full object-cover" />
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
          )}
        </div>

        <div className="h-fit rounded-2xl bg-slate-800 p-4 ring-1 ring-white/5 lg:sticky lg:top-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🧾</span>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Ticket de caisse</p>
          </div>

          {panier.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Panier vide.</p>
          ) : (
            <ul className="mb-3 max-h-72 space-y-2 overflow-y-auto pr-1">
              {panier.map((ligne, i) => (
                <li key={i} className="rounded-xl bg-slate-900/80 p-2.5 ring-1 ring-white/5">
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
                  <div className="mt-1.5 flex items-center gap-1.5 rounded-full bg-slate-800 px-1 py-1 ring-1 ring-white/5">
                    <button
                      onClick={() => modifierQuantite(i, -1)}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-slate-200 hover:bg-slate-600"
                    >
                      −
                    </button>
                    <span className="w-4 text-center text-sm font-semibold text-slate-100">{ligne.quantite}</span>
                    <button
                      onClick={() => modifierQuantite(i, 1)}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-slate-200 hover:bg-slate-600"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mb-3 flex items-center justify-between border-t border-white/10 pt-3 text-lg font-bold text-slate-100">
            <span>Total</span>
            <span className="text-amber-400">{formatPrix(total, 'XOF')}</span>
          </div>

          {paiementOuvert ? (
            <PaiementPicker
              total={total}
              modePaiement={modePaiement}
              setModePaiement={setModePaiement}
              montantRecu={montantRecu}
              setMontantRecu={setMontantRecu}
              onValider={confirmerVente}
              onAnnuler={() => setPaiementOuvert(false)}
              enCours={enCours}
            />
          ) : (
            <div className="flex gap-2">
              <button
                onClick={viderPanier}
                disabled={panier.length === 0}
                className="rounded-lg bg-slate-700 px-3 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-600 disabled:opacity-40"
              >
                🗑️ Vider
              </button>
              <button
                onClick={ouvrirPaiement}
                disabled={panier.length === 0}
                className="flex-1 rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-40"
              >
                💳 Paiement
              </button>
            </div>
          )}
        </div>
      </div>

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
