import { useMemo, useState } from 'react'
import { apiFetch, logout } from './api'
import { useTicketsSocket } from './useTicketsSocket'

const LIBELLE_CONNEXION = {
  connexion: { texte: 'Connexion...', couleur: 'bg-amber-500' },
  ouvert: { texte: 'En ligne', couleur: 'bg-emerald-500' },
  ferme: { texte: 'Hors ligne — reconnexion...', couleur: 'bg-red-500' },
}

/**
 * Écran dédié serveur (mobile, §5.1/§5.6) — volontairement réduit à UNE
 * seule action : confirmer le service. Pas de bump/fire/rush/impression
 * comme sur Master/Poste (`KitchenScreen.jsx`) — un serveur n'a pas à
 * piloter la préparation cuisine, seulement à savoir ce qui est prêt et
 * à le confirmer servi, plat par plat ou d'un coup.
 *
 * Réutilise `useTicketsSocket('master')` (tout le tenant, temps réel)
 * plutôt qu'un nouveau canal dédié — filtré ici aux tickets `pret`. Une
 * commande peut avoir plusieurs tickets (un par poste, ex: cuisine + bar)
 * donc regroupés par `order` pour offrir un geste "tout servir" par
 * table plutôt que ticket par ticket.
 */
export default function ServeurScreen({ onChangerEcran, onDeconnexion }) {
  const { tickets, statutConnexion } = useTicketsSocket('master')
  const [enCours, setEnCours] = useState(null) // id (ligne ou commande) en cours d'action
  const [erreur, setErreur] = useState('')

  const commandes = useMemo(() => {
    const parCommande = new Map()
    for (const ticket of tickets) {
      if (ticket.statut !== 'pret') continue
      if (!parCommande.has(ticket.order)) {
        parCommande.set(ticket.order, { orderId: ticket.order, table: ticket.table_numero, tickets: [] })
      }
      parCommande.get(ticket.order).tickets.push(ticket)
    }
    return [...parCommande.values()]
      .map((cmd) => ({
        ...cmd,
        rush: cmd.tickets.some((t) => t.is_rush),
        lignes: cmd.tickets.flatMap((t) => t.lignes.filter((l) => l.statut_ligne === 'pret')),
      }))
      .filter((cmd) => cmd.lignes.length > 0)
  }, [tickets])

  function afficherErreur(texte) {
    setErreur(texte)
    setTimeout(() => setErreur(''), 5000)
  }

  async function servirPlat(ligneId) {
    setEnCours(ligneId)
    try {
      const res = await apiFetch(`/api/order-items/${ligneId}/marquer-servi/`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        afficherErreur(data.detail ?? 'Erreur.')
      }
    } catch {
      afficherErreur('Connexion perdue — réessaie.')
    } finally {
      setEnCours(null)
    }
  }

  async function toutServir(orderId) {
    setEnCours(orderId)
    try {
      const res = await apiFetch(`/api/orders/${orderId}/marquer-servi/`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        afficherErreur(data.detail ?? 'Erreur.')
      }
    } catch {
      afficherErreur('Connexion perdue — réessaie.')
    } finally {
      setEnCours(null)
    }
  }

  const connexion = LIBELLE_CONNEXION[statutConnexion]

  return (
    <div className="min-h-full bg-slate-900 p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Service</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${connexion.couleur}`}>
          {connexion.texte}
        </span>
      </header>

      <div className="mb-4 flex gap-2">
        {onChangerEcran && (
          <button
            onClick={onChangerEcran}
            className="flex-1 rounded-lg bg-slate-700 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-600"
          >
            Changer d'écran
          </button>
        )}
        <button
          onClick={() => {
            logout()
            onDeconnexion()
          }}
          className="flex-1 rounded-lg bg-slate-700 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-600"
        >
          Déconnexion
        </button>
      </div>

      {erreur && (
        <div className="mb-4 rounded-xl bg-red-600 p-3 text-center text-sm font-semibold text-white shadow-lg">
          {erreur}
        </div>
      )}

      {commandes.length === 0 ? (
        <p className="mt-12 text-center text-lg text-slate-500">Rien à servir pour l'instant.</p>
      ) : (
        <div className="space-y-4">
          {commandes.map((cmd) => (
            <div
              key={cmd.orderId}
              className={`rounded-xl border-4 bg-slate-800 p-4 shadow-lg ${cmd.rush ? 'border-red-500' : 'border-emerald-600'}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xl font-bold text-slate-100">Table {cmd.table ?? '—'}</span>
                {cmd.rush && (
                  <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white">🔥 Rush</span>
                )}
              </div>

              <ul className="mb-4 space-y-2">
                {cmd.lignes.map((ligne) => (
                  <li
                    key={ligne.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-emerald-950 p-3"
                  >
                    <span className="text-lg text-slate-100">
                      <span className="font-semibold">{ligne.quantite}×</span> {ligne.plat_nom}
                    </span>
                    <button
                      onClick={() => servirPlat(ligne.id)}
                      disabled={enCours === ligne.id}
                      className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-900 hover:bg-emerald-400 disabled:opacity-50"
                    >
                      ✓ Servi
                    </button>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => toutServir(cmd.orderId)}
                disabled={enCours === cmd.orderId}
                className="w-full rounded-lg bg-amber-500 py-3 text-base font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
              >
                ✓ Tout servir ({cmd.lignes.length})
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
