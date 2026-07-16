import { useEffect, useState } from 'react'
import { apiFetch, fetchTenant, logout } from './api'
import { formatPrix } from './client/formatPrix'
import { construireRecuHTML, ouvrirApercuImpression } from './print/imprimer'
import PaiementPicker from './PaiementPicker'
import VenteComptoirScreen from './VenteComptoirScreen'

const ROLES_ENCAISSEMENT = ['manager', 'admin']

/**
 * Écran caisse (§5.5, demandé après coup avec le reçu de caisse) :
 * liste des commandes non payées, avec deux niveaux d'action distincts
 * selon le rôle —
 * - **Serveur** : consultation seule de la facture (montant dû + détail,
 *   sans info de paiement) — aperçu HTML local (`print/imprimer.js`),
 *   sans le bouton d'impression (§interface serveur : "Facture" = un des
 *   3 écrans dédiés au rôle serveur, consultation uniquement). Pas
 *   d'onglets pour lui : cet écran garde exactement son comportement
 *   d'avant l'ajout de la vente comptoir.
 * - **Manager/admin uniquement** : impression de la facture/du reçu, ET
 *   encaissement (mode de paiement, montant reçu en espèces, calcul de la
 *   monnaie). Correspond exactement au gate déjà posé côté backend pour
 *   l'encaissement (`OrderViewSet.get_permissions` — `encaisser` réservé
 *   `PeutEncaisser`) ; l'impression n'a pas d'équivalent backend (aperçu
 *   généré côté écran), le gate est purement frontend ici. Gagne en plus
 *   un onglet "Vente comptoir" (§TPE) — un client au comptoir n'a pas de
 *   commande de table à régler, juste un achat direct à encaisser tout de
 *   suite (`VenteComptoirScreen`, aussi utilisé tel quel comme écran
 *   verrouillé du rôle caissier·ère, cf. `App.jsx`).
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
  const [onglet, setOnglet] = useState('tables') // 'tables' | 'comptoir' — seul le manager/admin voit la bascule

  const peutEncaisser = ROLES_ENCAISSEMENT.includes(utilisateur?.role)
  // Même liste de rôles qu'`ROLES_ENCAISSEMENT` aujourd'hui, mais nommée à
  // part : ce sont deux permissions distinctes (imprimer / encaisser) qui
  // pourraient diverger plus tard, pas la même règle recyclée par hasard.
  const peutImprimer = ROLES_ENCAISSEMENT.includes(utilisateur?.role)

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
    const ouvert = ouvrirApercuImpression(titre, construireRecuHTML(tenant, commande), {
      autoriserImpression: peutImprimer,
    })
    if (!ouvert) {
      afficherMessage('Aperçu bloqué par le navigateur — autorisez les pop-ups pour ce site.', true)
    }
  }

  function ouvrirEncaissement(commande) {
    setEncaissementOuvert(commande.id)
    setModePaiement('especes')
    setMontantRecu(String(commande.total))
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
          {peutEncaisser && (
            <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
              <button
                onClick={() => setOnglet('tables')}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                  onglet === 'tables' ? 'bg-amber-500 text-slate-900' : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                Commandes de table
              </button>
              <button
                onClick={() => setOnglet('comptoir')}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                  onglet === 'comptoir' ? 'bg-amber-500 text-slate-900' : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                Vente comptoir
              </button>
            </div>
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

      {onglet === 'comptoir' && peutEncaisser ? (
        <VenteComptoirScreen utilisateur={utilisateur} tenant={tenant} embarque />
      ) : (
        <>
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
                    <PaiementPicker
                      total={commande.total}
                      modePaiement={modePaiement}
                      setModePaiement={setModePaiement}
                      montantRecu={montantRecu}
                      setMontantRecu={setMontantRecu}
                      onValider={() => confirmerEncaissement(commande)}
                      onAnnuler={() => setEncaissementOuvert(null)}
                      enCours={enCours}
                    />
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => imprimerFacture(commande)}
                        className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-600"
                      >
                        {peutImprimer ? '🖨️ Facture' : '👁️ Consulter'}
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
        </>
      )}
    </div>
  )
}
