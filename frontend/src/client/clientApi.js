// cf. src/api.js pour le raisonnement complet (§installer, paquet client)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

// Texte validé pour le cas 1 (le téléphone du client n'a lui-même aucune
// connexion — cf. README backend "Deux messages hors-ligne distincts").
export const MESSAGE_HORS_LIGNE = 'Connexion indisponible, Veuillez appeler un serveur'

/** Distingue une vraie panne réseau (fetch qui n'aboutit jamais) d'une erreur HTTP normale. */
export class ErreurReseau extends Error {}

// Trouvé en usage réel (client sur son propre WiFi/4G, pas le réseau
// fiable du poste de dev) : `fetch` sans délai maximum peut rester en
// attente indéfiniment sur une connexion qui se dégrade en cours de
// route (pas de coupure nette, donc pas d'erreur réseau immédiate) — le
// bouton "Envoi..." restait bloqué pour toujours, `finally` n'étant
// jamais atteint puisque la promesse ne se résolvait ni ne rejetait
// jamais. `AbortController` force un abandon après `DELAI_MAX_MS`,
// traité comme une `ErreurReseau` normale : la commande part alors dans
// la file hors-ligne existante (§5.5) plutôt que de bloquer l'écran.
const DELAI_MAX_MS = 12000

async function qrFetch(path, options = {}) {
  let response
  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), DELAI_MAX_MS)
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controleur.signal,
    })
  } catch {
    throw new ErreurReseau(MESSAGE_HORS_LIGNE)
  } finally {
    clearTimeout(minuteur)
  }
  return response
}

export async function fetchMenu(qrToken, { excludeAllergenes = [], regime } = {}) {
  const params = new URLSearchParams()
  excludeAllergenes.forEach((a) => params.append('exclure_allergene', a))
  if (regime) params.set('regime', regime)
  const response = await qrFetch(`/api/qr/${qrToken}/menu/?${params}`)
  if (!response.ok) throw new Error('Menu indisponible.')
  return response.json()
}

export async function creerCommande(qrToken, items, idempotencyKey) {
  const response = await qrFetch(`/api/qr/${qrToken}/orders/create/`, {
    method: 'POST',
    body: JSON.stringify({ items, idempotency_key: idempotencyKey }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.items || 'Impossible de passer la commande.')
  }
  return response.json()
}

export async function fetchSuivi(qrToken) {
  const response = await qrFetch(`/api/qr/${qrToken}/orders/`)
  if (!response.ok) throw new Error('Suivi indisponible.')
  return response.json()
}

export async function appelerServeur(qrToken) {
  const response = await qrFetch(`/api/qr/${qrToken}/appel-serveur/`, { method: 'POST' })
  if (!response.ok) throw new Error("Impossible d'appeler le serveur.")
  return response.json()
}
