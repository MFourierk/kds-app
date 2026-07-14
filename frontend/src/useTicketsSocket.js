import { useEffect, useRef, useState } from 'react'
import { getTokens, wsBaseUrl } from './api'

const RECONNECT_DELAY_MS = 2000
const ACTIVE_STATUTS = new Set(['en_attente', 'en_preparation', 'pret'])

/**
 * Connexion temps réel à un écran KDS (`ws/kds/<scopeId>/`, cf. backend
 * Phase 1). Gère :
 * - le "sync" initial envoyé à chaque connexion/reconnexion (backend
 *   Phase 4 — rattrapage après une coupure réseau, cf. README backend
 *   "Rattrapage à la (re)connexion") : remplace tout l'état local plutôt
 *   que de fusionner, pour ne jamais rester sur un état obsolète ;
 * - les événements "created"/"updated" au fil de l'eau (upsert, ou
 *   suppression si le ticket passe servi/annulé — il quitte le tableau
 *   actif) ;
 * - la reconnexion automatique si la connexion tombe (coupure réseau
 *   locale, écran qui se rendort...) — indispensable vu tout le travail
 *   de résilience côté backend, sinon il ne servirait à rien ici.
 */
export function useTicketsSocket(scopeId) {
  const [tickets, setTickets] = useState([])
  const [statutConnexion, setStatutConnexion] = useState('connexion') // connexion | ouvert | ferme
  const [dernierAppelServeur, setDernierAppelServeur] = useState(null)
  const [dernierTicketCree, setDernierTicketCree] = useState(null)
  const socketRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const fermetureVolontaire = useRef(false)

  useEffect(() => {
    fermetureVolontaire.current = false

    function connecter() {
      const tokens = getTokens()
      if (!tokens?.access) {
        setStatutConnexion('ferme')
        return
      }

      setStatutConnexion('connexion')
      const socket = new WebSocket(`${wsBaseUrl()}/ws/kds/${scopeId}/?token=${tokens.access}`)
      socketRef.current = socket

      socket.onopen = () => setStatutConnexion('ouvert')

      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data)

        if (payload.event === 'sync') {
          setTickets(payload.tickets.filter((t) => ACTIVE_STATUTS.has(t.statut)))
          return
        }

        if (payload.event === 'appel_serveur') {
          setDernierAppelServeur(payload.table)
          return
        }

        if (payload.ticket) {
          // "created" = vraie apparition d'un ticket (nouvelle commande, ou
          // nouveau plat routé sur ce poste) — pas une simple mise à jour de
          // statut sur un ticket déjà visible. Sert à déclencher un son côté
          // écran cuisine (cf. KitchenScreen.jsx), pas à la resync initiale
          // ("sync" à la connexion, traitée séparément ci-dessus).
          if (payload.event === 'created') {
            setDernierTicketCree({ id: payload.ticket.id, a: Date.now() })
          }
          setTickets((precedents) => {
            const sansCelui = precedents.filter((t) => t.id !== payload.ticket.id)
            if (!ACTIVE_STATUTS.has(payload.ticket.statut)) {
              return sansCelui
            }
            return [...sansCelui, payload.ticket]
          })
        }
      }

      socket.onclose = () => {
        setStatutConnexion('ferme')
        if (!fermetureVolontaire.current) {
          reconnectTimerRef.current = setTimeout(connecter, RECONNECT_DELAY_MS)
        }
      }

      socket.onerror = () => {
        socket.close()
      }
    }

    connecter()

    return () => {
      fermetureVolontaire.current = true
      clearTimeout(reconnectTimerRef.current)
      socketRef.current?.close()
    }
  }, [scopeId])

  return { tickets, statutConnexion, dernierAppelServeur, dernierTicketCree }
}
