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

// Piège trouvé APRÈS coup, toujours en usage réel : `fetch()` se résout
// dès que les EN-TÊTES arrivent, pas une fois le corps téléchargé. Le
// premier correctif (ci-dessus) désarmait le minuteur juste après ça,
// avant même que `response.json()` (appelé par chaque fonction
// ci-dessous) ait lu le corps — sur une connexion qui dégrade
// précisément pendant le transfert du corps (après des en-têtes reçus
// sans souci), le blocage "Envoi..." revenait à l'identique malgré le
// minuteur. Le corps est donc lu ICI, pendant que le minuteur protège
// encore l'appel, plutôt que de renvoyer un `Response` non consommé.
async function qrFetch(path, options = {}) {
  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), DELAI_MAX_MS)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controleur.signal,
    })
    // Pas de `.catch()` ici : si la lecture du corps échoue parce que le
    // minuteur vient de l'interrompre (`AbortError`), cette erreur DOIT
    // remonter jusqu'au bloc `catch` ci-dessous pour devenir une
    // `ErreurReseau` — l'avaler silencieusement ferait croire à un succès
    // (`ok: true, data: null`) sur une commande dont on ne sait en réalité
    // pas si elle est passée, sans jamais la mettre en file hors-ligne.
    const data = await response.json()
    return { ok: response.ok, data }
  } catch {
    throw new ErreurReseau(MESSAGE_HORS_LIGNE)
  } finally {
    clearTimeout(minuteur)
  }
}

export async function fetchMenu(qrToken, { excludeAllergenes = [], regime } = {}) {
  const params = new URLSearchParams()
  excludeAllergenes.forEach((a) => params.append('exclure_allergene', a))
  if (regime) params.set('regime', regime)
  const { ok, data } = await qrFetch(`/api/qr/${qrToken}/menu/?${params}`)
  if (!ok) throw new Error('Menu indisponible.')
  return data
}

export async function creerCommande(qrToken, items, idempotencyKey) {
  const { ok, data } = await qrFetch(`/api/qr/${qrToken}/orders/create/`, {
    method: 'POST',
    body: JSON.stringify({ items, idempotency_key: idempotencyKey }),
  })
  if (!ok) throw new Error(data?.items || 'Impossible de passer la commande.')
  return data
}

export async function fetchSuivi(qrToken) {
  const { ok, data } = await qrFetch(`/api/qr/${qrToken}/orders/`)
  if (!ok) throw new Error('Suivi indisponible.')
  return data
}

export async function appelerServeur(qrToken) {
  const { ok, data } = await qrFetch(`/api/qr/${qrToken}/appel-serveur/`, { method: 'POST' })
  if (!ok) throw new Error("Impossible d'appeler le serveur.")
  return data
}
