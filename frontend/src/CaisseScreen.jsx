import { useEffect, useState } from 'react'
import { apiFetch, fetchTenant, logout } from './api'
import { formatPrix } from './client/formatPrix'
import { LIBELLE_MODE_PAIEMENT, construireRecuHTML, ouvrirApercuImpression } from './print/imprimer'

const ROLES_ENCAISSEMENT = ['manager', 'admin']

// "Mobile Money" n'est plus une valeur de paiement réelle
// (`Order.ModePaiement` n'a que wave/orange_money/momo, cf. §6.4) — juste
// une catégorie d'affichage qui replie les 3 opérateurs derrière un seul
// bouton, révélés uniquement au clic plutôt que 6 pastilles à plat d'un
// coup (demandé après coup, plus lisible sur un écran étroit).
const OPERATEURS_MOBILE_MONEY = ['wave', 'orange_money', 'momo']
const CATEGORIES_PAIEMENT = { especes: 'Espèces', mobile_money: 'Mobile Money', carte: 'Carte', autre: 'Autre' }

/**
 * Écran caisse (§5.5, demandé après coup avec le reçu de caisse) :
 * liste des commandes non payées, avec deux niveaux d'action distincts
 * selon le rôle —
 * - **Tout le staff** (serveur compris) : imprimer la facture (montant
 *   dû + détail, sans info de paiement) pour l'apporter à table. Aperçu
 *   HTML local (`print/imprimer.js`) — aucun appel backend, n'importe
 *   quelle imprimante installée sur le poste via le dialogue du
 *   navigateur.
 * - **Manager/admin uniquement** : encaisser (mode de paiement, montant
 *   reçu en espèces, calcul de la monnaie) — le rôle serveur sera
 *   reconsidéré plus tard pour cette partie, cf. discussion produit.
 * Correspond exactement au gate déjà posé côté backend
 * (`OrderViewSet.get_permissions` — `encaisser` réservé
 * `IsManagerOrAdmin`).
 */
export default function CaisseScreen({ utilisateur, onChangerEcran, onDeconnexion }) {
  const [commandes, setCommandes] = useState(null)
  const [erreur, setErreur] = useState('')
  const [message, setMessage] = useState(null) // { texte, erreur }
  const [encaissementOuvert, setEncaissementOuvert] = useState(null)
  const [modePaiement, setModePaiement] = useState('especes')
  const [montantRecu, setMontantRecu] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [tenant, setTenant] = useState(null)

  const peutEncaisser = ROLES_ENCAISSEMENT.includes(utilisateur?.role)

  function recharger() {
    apiFetch('/api/orders/?statut_paiement=en_attente')
      .then((r) => r.json())
      .then((data) => setCommandes(Array.isArray(data) ? data : []))
      .catch((e) => setErreur(e.message))
  }

  useEffect(recharger, [])
  useEffect(() => {
    // Chargé une fois pour l'en-tête facture/reçu (logo, nom, coordonnées,
    // §5.5) — jamais bloquant si ça échoue, l'aperçu s'affiche juste sans
    // en-tête (`construireEnTete` tolère `tenant = null`).
    fetchTenant().then(setTenant).catch(() => {})
  }, [])

  function afficherMessage(texte, erreur = false) {
    setMessage({ texte, erreur })
    setTimeout(() => setMessage(null), 6000)
  }

  function imprimerFacture(commande) {
    // Aperçu HTML local (§5.5) — les données de la commande sont déjà en
    // mémoire côté écran, pas besoin d'appeler le backend ni de dépendre
    // d'une imprimante réseau précise : le dialogue natif du navigateur
    // laisse choisir n'importe quelle imprimante installée sur le poste.
    // `construireRecuHTML` bascule elle-même entre facture (non payée) et
    // reçu (payée) selon `commande.statut_paiement`.
    const payee = commande.statut_paiement === 'payee'
    const titre = payee ? `Reçu — Table ${commande.table_numero ?? '—'}` : `Facture — Table ${commande.table_numero ?? '—'}`
    const ouvert = ouvrirApercuImpression(titre, construireRecuHTML(tenant, commande))
    if (!ouvert) {
      afficherMessage('Aperçu bloqué par le navigateur — autorisez les pop-ups pour ce site.', true)
    }
  }

  function ouvrirEncaissement(commande) {
    setEncaissementOuvert(commande.id)
    setModePaiement('especes')
    setMontantRecu(String(commande.total))
  }

  function choisirCategorie(categorie) {
    if (categorie === 'mobile_money') {
      // Révèle la sous-liste d'opérateurs ; garde l'opérateur déjà
      // choisi s'il y en a un, sinon présélectionne Wave (il faut bien
      // une valeur valide pour `encaisser`, l'utilisateur peut changer).
      setModePaiement((actuel) => (OPERATEURS_MOBILE_MONEY.includes(actuel) ? actuel : 'wave'))
    } else {
      setModePaiement(categorie)
    }
  }

  async function confirmerEncaissement(commande) {
    setEnCours(true)
    try {
      const body = { mode_paiement: modePaiement }
      if (modePaiement === 'especes') body.montant_recu = Number(montantRecu) || commande.total
      const res = await apiFetch(`/api/orders/${commande.id}/encaisser/`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        afficherMessage(data.detail ?? 'Erreur.', true)
        return
      }
      setEncaissementOuvert(null)
      afficherMessage('Commande encaissée.')
      recharger()
      // `data` = la commande à jour renvoyée par `encaisser` (numero_ticket,
      // caissier_nom, montant_recu, statut_paiement='payee'...) — imprime le
      // vrai reçu, pas la version pré-paiement encore dans `commande`.
      imprimerFacture(data)
    } finally {
      setEnCours(false)
    }
  }

  const monnaie =
    modePaiement === 'especes' && encaissementOuvert
      ? Math.max(0, Number(montantRecu || 0) - (commandes?.find((c) => c.id === encaissementOuvert)?.total ?? 0))
      : 0

  return (
    <div className="min-h-full bg-slate-900 p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="mb-3 text-2xl font-bold text-slate-100 sm:text-3xl">KDS — Caisse</h1>
        <div className="flex flex-wrap items-center gap-2">
          {!peutEncaisser && (
            <span className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-300">
              Facture uniquement — encaissement réservé aux managers
            </span>
          )}
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

      {message && (
        <div
          className={`mb-6 rounded-xl p-3 text-center text-sm font-semibold text-white shadow-lg ${
            message.erreur ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {message.texte}
        </div>
      )}
      {erreur && <div className="mb-6 rounded-xl bg-red-600 p-4 text-center text-white">{erreur}</div>}

      {!commandes ? (
        <p className="text-center text-lg text-slate-500">Chargement...</p>
      ) : commandes.length === 0 ? (
        <p className="text-center text-lg text-slate-500">Aucune commande en attente de paiement.</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {commandes.map((commande) => (
            <div key={commande.id} className="flex w-full flex-col rounded-xl border-4 border-slate-600 bg-slate-800 p-4 shadow-lg sm:w-80">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xl font-bold text-slate-100">Table {commande.table_numero ?? '—'}</span>
                {commande.serveur_nom && <span className="text-sm text-slate-400">{commande.serveur_nom}</span>}
              </div>

              <ul className="mb-3 flex-1 space-y-1">
                {commande.items.map((item, i) => (
                  <li key={i} className="flex justify-between text-sm text-slate-200">
                    <span>
                      {item.quantite}× {item.plat_nom}
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPrix(item.prix * item.quantite, 'XOF')}</span>
                  </li>
                ))}
              </ul>

              <div className="mb-3 flex items-center justify-between border-t border-slate-700 pt-2 text-lg font-bold text-slate-100">
                <span>Total</span>
                <span>{formatPrix(commande.total, 'XOF')}</span>
              </div>

              {encaissementOuvert === commande.id ? (
                <div className="space-y-2 rounded-lg bg-slate-900 p-3">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(CATEGORIES_PAIEMENT).map(([categorie, label]) => {
                      const active =
                        categorie === 'mobile_money'
                          ? OPERATEURS_MOBILE_MONEY.includes(modePaiement)
                          : modePaiement === categorie
                      return (
                        <button
                          key={categorie}
                          onClick={() => choisirCategorie(categorie)}
                          className={`min-w-[30%] flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                            active ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  {OPERATEURS_MOBILE_MONEY.includes(modePaiement) && (
                    <div className="flex gap-1">
                      {OPERATEURS_MOBILE_MONEY.map((operateur) => (
                        <button
                          key={operateur}
                          onClick={() => setModePaiement(operateur)}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                            modePaiement === operateur ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {LIBELLE_MODE_PAIEMENT[operateur]}
                        </button>
                      ))}
                    </div>
                  )}
                  {modePaiement === 'especes' && (
                    <>
                      <label className="block text-xs text-slate-400">
                        Montant reçu
                        <input
                          type="number"
                          value={montantRecu}
                          onChange={(e) => setMontantRecu(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100"
                        />
                      </label>
                      <div className="flex justify-between text-sm text-slate-300">
                        <span>Monnaie à rendre</span>
                        <span className="font-semibold">{formatPrix(monnaie, 'XOF')}</span>
                      </div>
                    </>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => confirmerEncaissement(commande)}
                      disabled={enCours}
                      className="flex-1 rounded-lg bg-emerald-500 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-400 disabled:opacity-50"
                    >
                      Valider
                    </button>
                    <button
                      onClick={() => setEncaissementOuvert(null)}
                      className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-300"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => imprimerFacture(commande)}
                    className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-600"
                  >
                    🖨️ Facture
                  </button>
                  {peutEncaisser && (
                    <button
                      onClick={() => ouvrirEncaissement(commande)}
                      className="flex-1 rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-400"
                    >
                      💰 Encaisser
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
