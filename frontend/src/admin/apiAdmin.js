import { apiFetch } from '../api'

async function extraireErreur(response) {
  try {
    const data = await response.json()
    if (typeof data === 'string') return data
    if (data.detail) return data.detail
    return Object.entries(data)
      .map(([champ, valeur]) => `${champ}: ${Array.isArray(valeur) ? valeur.join(', ') : valeur}`)
      .join(' — ')
  } catch {
    return `Erreur ${response.status}`
  }
}

/**
 * Client CRUD générique pour les écrans de gestion (`GestionMenu.jsx`,
 * `GestionPostes.jsx`, `GestionUtilisateurs.jsx`) — évite de réécrire le
 * même quadruplet list/create/update/delete pour chaque ressource. Les
 * ViewSets ciblés sont en écriture réservée manager/admin côté backend
 * (`ManagerWriteMixin`), donc un 403 ici reflète un vrai contrôle serveur,
 * pas seulement le masquage du bouton côté frontend.
 */
export async function lister(ressource) {
  const response = await apiFetch(`/api/${ressource}/`)
  if (!response.ok) throw new Error(await extraireErreur(response))
  return response.json()
}

// `payload` peut être un `FormData` (upload de fichier — logo, photo de
// plat) transmis tel quel, ou un objet simple sérialisé en JSON.
function corpsRequete(payload) {
  return payload instanceof FormData ? payload : JSON.stringify(payload)
}

export async function creer(ressource, payload) {
  const response = await apiFetch(`/api/${ressource}/`, { method: 'POST', body: corpsRequete(payload) })
  if (!response.ok) throw new Error(await extraireErreur(response))
  return response.json()
}

export async function modifier(ressource, id, payload) {
  const response = await apiFetch(`/api/${ressource}/${id}/`, { method: 'PATCH', body: corpsRequete(payload) })
  if (!response.ok) throw new Error(await extraireErreur(response))
  return response.json()
}

export async function supprimer(ressource, id) {
  const response = await apiFetch(`/api/${ressource}/${id}/`, { method: 'DELETE' })
  if (!response.ok) throw new Error(await extraireErreur(response))
}
