const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

// Texte validé pour le cas 1 (le téléphone du client n'a lui-même aucune
// connexion — cf. README backend "Deux messages hors-ligne distincts").
export const MESSAGE_HORS_LIGNE = 'Connexion indisponible, Veuillez appeler un serveur'

/** Distingue une vraie panne réseau (fetch qui n'aboutit jamais) d'une erreur HTTP normale. */
export class ErreurReseau extends Error {}

async function qrFetch(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch {
    throw new ErreurReseau(MESSAGE_HORS_LIGNE)
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
