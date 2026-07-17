import { useEffect, useRef, useState } from 'react'
import { getTokens, wsBaseUrl } from './api'

const RECONNECT_DELAY_MS = 2000

// Le backend envoie un `ping` applicatif toutes les 20s (cf.
// `KDSConsumer._heartbeat_loop`) en plus de tout événement réel — tant
// que l'un ou l'autre arrive, la connexion est considérée vivante. Un
// délai de vérif nettement plus long que 20s absorbe le jitter réseau
// normal sans déclencher de faux positifs.
const SEUIL_CONNEXION_ZOMBIE_MS = 45000
const INTERVALLE_VERIF_ZOMBIE_MS = 10000

const ACTIVE_STATUTS = new Set(['en_attente', 'en_preparation', 'pret'])

/**
 * Connexion temps réel à un écran KDS (`ws/kds/<scopeId>/`, cf. backend
 * Phase 1). Gère :
 * - le "sync" initial envoyé à chaque connexion/reconnexion (backend
 *   Phase 4 — rattrapage après une coupure réseau, cf. README backend
 *   "Rattrapage à la (re)connexion") : remplace tout l'état local plutôt
 *   que de fusionner, pour ne jamais rester sur un état obsolète —
 *   tickets ET appels serveur en cours (§5.6) ;
 * - les événements "created"/"updated" au fil de l'eau (upsert, ou
 *   suppression si le ticket passe servi/annulé — il quitte le tableau
 *   actif) ;
 * - les appels serveur (§5.6) : bandeau persistant tant qu'il n'est pas
 *   explicitement fermé par le staff (pas de disparition automatique) ;
 * - la reconnexion automatique si la connexion tombe (coupure réseau
 *   locale, écran qui se rendort...) OU si elle meurt SILENCIEUSEMENT
 *   (NAT/proxy qui coupe une connexion inactive sans jamais déclencher
 *   `onclose` côté navigateur — trouvé en usage réel sur des postes
 *   Cuisine/Bar restés ouverts des heures sans qu'on les touche : l'écran
 *   affichait "En ligne" en trompe-l'œil, plus rien n'arrivait, seul un
 *   rechargement manuel le débloquait). Le `ping` régulier du backend sert
 *   de signal de vie : au-delà de `SEUIL_CONNEXION_ZOMBIE_MS` sans le
 *   moindre message, on force la fermeture pour déclencher une vraie
 *   reconnexion plutôt que d'attendre un `onclose` qui ne viendra peut-être
 *   jamais.
 */
export function useTicketsSocket(scopeId) {
  const [tickets, setTickets] = useState([])
  const [statutConnexion, setStatutConnexion] = useState('connexion') // connexion | ouvert | ferme
  const [dernierAppelServeur, setDernierAppelServeur] = useState(null)
  const [appelsServeurActifs, setAppelsServeurActifs] = useState([])
  const [dernierTicketCree, setDernierTicketCree] = useState(null)
  const socketRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const zombieTimerRef = useRef(null)
  const dernierMessageRef = useRef(Date.now())
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

      socket.onopen = () => {
        dernierMessageRef.current = Date.now()
        setStatutConnexion('ouvert')
      }

      socket.onmessage = (message) => {
        dernierMessageRef.current = Date.now()
        const payload = JSON.parse(message.data)

        if (payload.event === 'sync') {
          setTickets(payload.tickets.filter((t) => ACTIVE_STATUTS.has(t.statut)))
          setAppelsServeurActifs(payload.appels_serveur ?? [])
          return
        }

        if (payload.event === 'appel_serveur') {
          setDernierAppelServeur(payload.table)
          setAppelsServeurActifs((precedents) => {
            if (precedents.some((t) => t.id === payload.table.id)) return precedents
            return [...precedents, payload.table]
          })
          return
        }

        if (payload.event === 'appel_serveur_ferme') {
          setAppelsServeurActifs((precedents) => precedents.filter((t) => t.id !== payload.table.id))
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

    zombieTimerRef.current = setInterval(() => {
      if (Date.now() - dernierMessageRef.current > SEUIL_CONNEXION_ZOMBIE_MS) {
        socketRef.current?.close()
      }
    }, INTERVALLE_VERIF_ZOMBIE_MS)

    return () => {
      fermetureVolontaire.current = true
      clearTimeout(reconnectTimerRef.current)
      clearInterval(zombieTimerRef.current)
      socketRef.current?.close()
    }
  }, [scopeId])

  return { tickets, statutConnexion, dernierAppelServeur, appelsServeurActifs, dernierTicketCree }
}
