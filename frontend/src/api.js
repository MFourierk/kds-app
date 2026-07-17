// `|| ''` : sur le paquet d'installation client (§installer), l'app est
// buildée UNE FOIS puis déployée telle quelle chez des clients ayant chacun
// une IP LAN différente — pas d'URL absolue possible à la compilation. Une
// env var absente vaut `undefined` (pas `''`) côté Vite ; sans ce fallback,
// tout appel deviendrait `fetch("undefined/api/...")`. Racine vide = appel
// relatif, résolu contre l'origine servie par le navigateur (marche pour le
// build VPS aussi, qui garde une URL absolue explicite via .env.production).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

const TOKEN_STORAGE_KEY = 'kds_tokens'

// `sessionStorage`, pas `localStorage` : trouvé en usage réel sur la VM
// cliente — un redémarrage complet rouvrait directement la session Manager
// de la veille sans jamais redemander le mot de passe (le kiosque relance
// le navigateur sur une machine partagée, comptoir accessible à tous).
// `localStorage` survit indéfiniment aux redémarrages ; `sessionStorage`
// est propre à l'onglet/processus navigateur et disparaît à sa fermeture —
// une vraie coupure (VM éteinte, navigateur relancé) revient donc toujours
// à l'écran de connexion, tout en laissant un simple rechargement de page
// en cours de service (F5, ex: après une erreur JS) garder la session.
export function getTokens() {
  const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

export function setTokens(tokens) {
  if (tokens) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens))
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
  }
}

export async function login(username, password) {
  const response = await fetch(`${API_BASE_URL}/api/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) {
    throw new Error('Identifiants invalides')
  }
  const tokens = await response.json()
  setTokens(tokens)
  return tokens
}

/**
 * Connexion rapide écran cuisine par PIN (§6.4) — alternative à `login()`
 * pour les rôles cuisinier/serveur, qui n'ont pas de mot de passe
 * utilisable (`set_unusable_password()`, cf. `seed_demo.py` et
 * `GestionUtilisateurs.jsx`). Existait déjà côté backend
 * (`/api/auth/pin-login/`) mais n'était jamais appelé nulle part côté
 * frontend — `LoginScreen.jsx` n'avait qu'un formulaire mot de passe,
 * rendant tout compte PIN-only impossible à connecter depuis l'écran KDS.
 */
export async function loginPin(username, pin) {
  const response = await fetch(`${API_BASE_URL}/api/auth/pin-login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  })
  if (!response.ok) {
    throw new Error('PIN invalide')
  }
  const tokens = await response.json()
  setTokens(tokens)
  return tokens
}

/**
 * Écran "qui es-tu ?" avant saisie du PIN (§6.4) — public, scopé à un
 * tenant connu via son slug (cf. `VITE_TENANT_SLUG`, un tablette cuisine
 * est provisionnée pour UN SEUL établissement, pas de sélection de
 * tenant à l'écran).
 */
export async function fetchKioskStaff() {
  // `window.__ENV__` (deploy/client-package/40-generate-env-config.sh) : sur
  // le paquet d'installation client, le slug n'est connu qu'à l'installation
  // (une valeur par client), pas à la compilation comme sur le build VPS —
  // injecté au démarrage du conteneur nginx plutôt que baked-in au build.
  const slug = window.__ENV__?.VITE_TENANT_SLUG || import.meta.env.VITE_TENANT_SLUG
  const response = await fetch(`${API_BASE_URL}/api/kiosk/staff/?tenant=${encodeURIComponent(slug)}`)
  if (!response.ok) throw new Error('Impossible de charger la liste du personnel.')
  return response.json()
}

export function logout() {
  setTokens(null)
}

async function refreshAccessToken() {
  const tokens = getTokens()
  if (!tokens?.refresh) return null
  const response = await fetch(`${API_BASE_URL}/api/auth/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh: tokens.refresh }),
  })
  if (!response.ok) {
    setTokens(null)
    return null
  }
  const data = await response.json()
  const updated = { ...tokens, access: data.access }
  setTokens(updated)
  return updated.access
}

/**
 * Appel HTTP authentifié : rejoue une fois l'appel après rafraîchissement
 * du token en cas de 401 (access token expiré, cf. durée de vie courte —
 * 5 min par défaut, cf. README backend).
 */
export async function apiFetch(path, options = {}) {
  const tokens = getTokens()
  // Upload de fichier (logo, photo de plat, §5.5/§6.4) : le body est un
  // `FormData` — ne jamais forcer `Content-Type: application/json` dans ce
  // cas, sinon le navigateur n'ajoute plus lui-même le boundary
  // multipart et la requête arrive illisible côté serveur.
  const estFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const doFetch = (accessToken) =>
    fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(estFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    })

  let response = await doFetch(tokens?.access)
  if (response.status === 401) {
    const newAccess = await refreshAccessToken()
    if (!newAccess) {
      throw new Error('Session expirée, merci de vous reconnecter.')
    }
    response = await doFetch(newAccess)
  }
  return response
}

export function wsBaseUrl() {
  if (import.meta.env.VITE_WS_BASE_URL) return import.meta.env.VITE_WS_BASE_URL
  // Même raisonnement que API_BASE_URL ci-dessus (§installer) : sans URL
  // absolue baked-in, dérive le bon schéma/hôte depuis la page elle-même —
  // `ws://` sur une install cliente en HTTP simple, `wss://` sur le VPS.
  const protocole = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocole}://${window.location.host}`
}

export async function fetchMe() {
  const response = await apiFetch('/api/users/me/')
  if (!response.ok) throw new Error("Impossible de récupérer l'utilisateur connecté.")
  return response.json()
}

export async function fetchStations() {
  const response = await apiFetch('/api/stations/')
  if (!response.ok) throw new Error('Impossible de récupérer les postes.')
  return response.json()
}

/**
 * Statut de licence (§licence) — `actif` sur le serveur maître comme sur
 * une installation cliente à jour. Jamais bloquant à l'appel lui-même :
 * en cas d'erreur (ex: déploiement fraîchement mis à jour), `App.jsx`
 * traite ça comme "actif" plutôt que de bloquer l'app sur un détail
 * réseau.
 */
export async function fetchLicenceStatut() {
  const response = await apiFetch('/api/licence/statut/')
  if (!response.ok) throw new Error('Impossible de récupérer le statut de licence.')
  return response.json()
}

/**
 * `TenantViewSet` (staff, authentifié) ne renvoie jamais qu'un seul
 * établissement — celui de l'utilisateur connecté — mais reste une
 * liste côté API (`ListModelMixin`, pas de endpoint singulier dédié).
 */
export async function fetchTenant() {
  const response = await apiFetch('/api/tenant/')
  if (!response.ok) throw new Error("Impossible de récupérer les informations de l'établissement.")
  const data = await response.json()
  return Array.isArray(data) ? data[0] : data
}

/**
 * Rapports de performance (§5.4, `kds_core/stats_views.py`). `periode` est
 * `{ depuis, jusqu_a }` en ISO 8601 (`null`/absent = défaut backend, les
 * dernières 24h). `productivite-employes` renvoie 403 pour un rôle non
 * manager/admin — laissé tel quel, l'appelant décide comment l'afficher.
 */
export async function fetchStats(chemin, periode = {}) {
  const params = new URLSearchParams()
  if (periode.depuis) params.set('depuis', periode.depuis)
  if (periode.jusqu_a) params.set('jusqu_a', periode.jusqu_a)
  const suffixe = params.toString() ? `?${params.toString()}` : ''
  const response = await apiFetch(`/api/stats/${chemin}/${suffixe}`)
  if (!response.ok) {
    const erreur = new Error(`Impossible de charger le rapport "${chemin}".`)
    erreur.status = response.status
    throw erreur
  }
  return response.json()
}

/**
 * Ventes encaissées sur une période (`VentesParJourView`, réservé
 * manager/admin) — même convention `{ depuis, jusqu_a }` ISO 8601 que
 * `fetchStats` (élargi de "une journée" à une vraie période, demandé
 * après coup). Défaut backend = les dernières 24h si omis.
 */
export async function fetchVentesParJour(periode = {}) {
  const params = new URLSearchParams()
  if (periode.depuis) params.set('depuis', periode.depuis)
  if (periode.jusqu_a) params.set('jusqu_a', periode.jusqu_a)
  const suffixe = params.toString() ? `?${params.toString()}` : ''
  const response = await apiFetch(`/api/stats/ventes/${suffixe}`)
  if (!response.ok) {
    const erreur = new Error('Impossible de charger les ventes.')
    erreur.status = response.status
    throw erreur
  }
  return response.json()
}

/**
 * Commandes annulées sur une période (`CommandesAnnuleesView`, réservé
 * manager/admin, §5.1 "procédure d'annulation"). Même convention
 * `{ depuis, jusqu_a }` que `fetchVentesParJour`/`fetchStats`.
 */
export async function fetchCommandesAnnulees(periode = {}) {
  const params = new URLSearchParams()
  if (periode.depuis) params.set('depuis', periode.depuis)
  if (periode.jusqu_a) params.set('jusqu_a', periode.jusqu_a)
  const suffixe = params.toString() ? `?${params.toString()}` : ''
  const response = await apiFetch(`/api/stats/commandes-annulees/${suffixe}`)
  if (!response.ok) {
    const erreur = new Error('Impossible de charger les commandes annulées.')
    erreur.status = response.status
    throw erreur
  }
  return response.json()
}
