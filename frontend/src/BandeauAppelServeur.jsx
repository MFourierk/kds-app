import { apiFetch } from './api'

// Seuls ces rôles peuvent fermer le bandeau (§5.6, demande explicite :
// "aucun employé ne dira qu'il n'a pas vu... c'est seulement après
// fermeture par la serveuse — uniquement — qu'elle disparaîtra"). Manager/
// admin en secours si le serveur assigné est occupé ailleurs — jamais
// cuisinier ni caissier, qui doivent le voir rester tant que personne de
// qualifié ne l'a traité. Backend : `PeutFermerAppelServeur`.
const ROLES_PEUVENT_FERMER = new Set(['serveur', 'manager', 'admin'])

/**
 * Bandeau "Appel serveur" (§5.6) — partagé par tous les écrans staff
 * (Cuisine, Bar, Service, Caisse, Prendre commande) via `useTicketsSocket`,
 * qui maintient `appelsServeurActifs` synchronisé en temps réel (diffusion
 * à tous les postes) ET au (re)branchement (`sync`, rattrapage §Phase 4).
 * Persistant tant qu'il n'est pas fermé — pas de minuterie locale.
 */
export default function BandeauAppelServeur({ appels, role }) {
  if (!appels || appels.length === 0) return null

  const peutFermer = ROLES_PEUVENT_FERMER.has(role)

  async function fermer(id) {
    await apiFetch(`/api/tables/${id}/fermer-appel-serveur/`, { method: 'POST' })
  }

  return (
    <div className="mb-6 space-y-2">
      {appels.map((table) => (
        <div
          key={table.id}
          className="flex items-center justify-between gap-4 rounded-xl bg-red-600 p-4 text-white shadow-lg"
        >
          <p className="text-xl font-bold">🔔 Table {table.numero} — Appel serveur</p>
          {peutFermer && (
            <button
              onClick={() => fermer(table.id)}
              aria-label="Fermer"
              className="rounded-lg bg-white/20 px-4 py-2 text-lg font-bold leading-none hover:bg-white/30"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
