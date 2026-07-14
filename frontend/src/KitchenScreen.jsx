import { useEffect, useState } from 'react'
import { apiFetch, logout } from './api'
import { useTicketsSocket } from './useTicketsSocket'
import { jouerDoubleBip } from './notificationSound'
import TicketCard from './TicketCard'
import { construireTicketHTML, ouvrirApercuImpression } from './print/imprimer'

const LIBELLE_CONNEXION = {
  connexion: { texte: 'Connexion...', couleur: 'bg-amber-500' },
  ouvert: { texte: 'En ligne', couleur: 'bg-emerald-500' },
  ferme: { texte: 'Hors ligne — reconnexion...', couleur: 'bg-red-500' },
}

const DUREE_MISE_EN_AVANT_NOUVEAU_MS = 6000

/**
 * Écran cuisine générique : Master (`scopeId="master"`, voit tous les
 * postes) ou poste unique (`scopeId=<uuid_station>`, ne voit que ses
 * propres tickets — cf. `KDSConsumer` côté backend). Même composant pour
 * les deux, seul le canal WebSocket change.
 */
export default function KitchenScreen({ scopeId, titre, onChangerEcran, onDeconnexion }) {
  const { tickets, statutConnexion, dernierAppelServeur, dernierTicketCree } = useTicketsSocket(scopeId)
  const [alerteAppel, setAlerteAppel] = useState(null)
  const [ticketsNouveaux, setTicketsNouveaux] = useState(new Set())
  const [messageImpression, setMessageImpression] = useState(null) // { texte, erreur }

  useEffect(() => {
    if (!dernierAppelServeur) return
    jouerDoubleBip()
    setAlerteAppel(dernierAppelServeur)
    const timer = setTimeout(() => setAlerteAppel(null), 15000)
    return () => clearTimeout(timer)
  }, [dernierAppelServeur])

  useEffect(() => {
    if (!dernierTicketCree) return
    jouerDoubleBip()
    setTicketsNouveaux((precedents) => new Set(precedents).add(dernierTicketCree.id))
    const timer = setTimeout(() => {
      setTicketsNouveaux((precedents) => {
        const copie = new Set(precedents)
        copie.delete(dernierTicketCree.id)
        return copie
      })
    }, DUREE_MISE_EN_AVANT_NOUVEAU_MS)
    return () => clearTimeout(timer)
  }, [dernierTicketCree])

  async function bump(ticketId) {
    await apiFetch(`/api/order-tickets/${ticketId}/bump/`, { method: 'POST' })
  }

  async function fire(ticketId) {
    await apiFetch(`/api/order-tickets/${ticketId}/fire/`, { method: 'POST' })
  }

  async function toggleRush(ticketId) {
    await apiFetch(`/api/order-tickets/${ticketId}/toggle-rush/`, { method: 'POST' })
  }

  async function marquerLignePrete(ligneId) {
    await apiFetch(`/api/order-items/${ligneId}/marquer-pret/`, { method: 'POST' })
  }

  function imprimer(ticketId) {
    // Impression de secours (§5.5) : aperçu HTML local, pas d'appel
    // réseau — fonctionne même si le backend est injoignable, et laisse
    // choisir n'importe quelle imprimante installée via le dialogue
    // natif du navigateur (pas de dépendance à un modèle/IP fixe).
    const ticket = tickets.find((t) => t.id === ticketId)
    if (!ticket) return
    const ouvert = ouvrirApercuImpression(`Ticket — Table ${ticket.table_numero ?? '—'}`, construireTicketHTML(ticket, titre))
    if (!ouvert) {
      setMessageImpression({ texte: 'Aperçu bloqué par le navigateur — autorisez les pop-ups pour ce site.', erreur: true })
      setTimeout(() => setMessageImpression(null), 6000)
    }
  }

  const ticketsTries = [...tickets].sort((a, b) => {
    if (a.is_rush !== b.is_rush) return a.is_rush ? -1 : 1
    return new Date(a.created_at) - new Date(b.created_at)
  })

  const connexion = LIBELLE_CONNEXION[statutConnexion]

  return (
    <div className="min-h-full bg-slate-900 p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-100">KDS — {titre}</h1>
        <div className="flex items-center gap-4">
          <span className={`rounded-full px-4 py-1.5 text-sm font-semibold text-white ${connexion.couleur}`}>
            {connexion.texte}
          </span>
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

      {alerteAppel && (
        <div className="mb-6 rounded-xl bg-red-600 p-4 text-center text-xl font-bold text-white shadow-lg">
          🔔 Appel serveur — Table {alerteAppel.numero}
        </div>
      )}

      {messageImpression && (
        <div
          className={`mb-6 rounded-xl p-3 text-center text-sm font-semibold text-white shadow-lg ${
            messageImpression.erreur ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          🖨️ {messageImpression.texte}
        </div>
      )}

      {ticketsTries.length === 0 ? (
        <p className="text-center text-lg text-slate-500">Aucun ticket actif.</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {ticketsTries.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onBump={bump}
              onFire={fire}
              onToggleRush={toggleRush}
              onLignePrete={marquerLignePrete}
              onImprimer={imprimer}
              estNouveau={ticketsNouveaux.has(ticket.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
