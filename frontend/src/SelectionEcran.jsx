/**
 * Sélecteur affiché quand l'utilisateur n'a pas de poste assigné
 * (`station_assignee`, ex: manager/admin) — laisse choisir Master. Un
 * cuisinier avec un poste assigné ne voit jamais cet écran, il est
 * routé directement (§6.2 : un écran dédié par poste en cuisine, pas de
 * choix à faire sur place). Les boutons "Poste X" individuels ont été
 * retirés de ce sélecteur (demandé après coup) — "Écran Master" voit
 * déjà tous les postes, un doublon inutile pour qui arrive sur cet écran
 * (manager/admin sans poste assigné).
 *
 * `masquerEcransCuisine` (rôle serveur) retire Master de la liste — un
 * serveur n'a pas à piloter la préparation cuisine. `afficherService`
 * n'est passé à `true` QUE pour le rôle serveur côté `App.jsx` (Master +
 * Caisse couvrent déjà largement plus qu'un manager n'en a besoin,
 * Service y serait redondant).
 */
export default function SelectionEcran({ onChoisir, afficherTableauDeBord, afficherCaisse, afficherService, masquerEcransCuisine }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-slate-900 p-8">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Quel écran ouvrir ?</h1>

      {afficherTableauDeBord && (
        <button
          onClick={() => onChoisir({ scopeId: 'dashboard', titre: 'Tableau de bord' })}
          className="w-72 rounded-xl border-2 border-sky-400 bg-slate-800 py-4 text-lg font-semibold text-sky-300 hover:bg-slate-700"
        >
          📊 Tableau de bord
        </button>
      )}

      {afficherCaisse && (
        <button
          onClick={() => onChoisir({ scopeId: 'caisse', titre: 'Caisse' })}
          className="w-72 rounded-xl border-2 border-amber-400 bg-slate-800 py-4 text-lg font-semibold text-amber-300 hover:bg-slate-700"
        >
          💰 Caisse
        </button>
      )}

      {afficherService && (
        <button
          onClick={() => onChoisir({ scopeId: 'service', titre: 'Service' })}
          className="w-72 rounded-xl border-2 border-emerald-400 bg-slate-800 py-4 text-lg font-semibold text-emerald-300 hover:bg-slate-700"
        >
          🍽️ Service
        </button>
      )}

      {!masquerEcransCuisine && (
        <button
          onClick={() => onChoisir({ scopeId: 'master', titre: 'Écran Master' })}
          className="w-72 rounded-xl bg-amber-500 py-4 text-lg font-semibold text-slate-900 hover:bg-amber-400"
        >
          Écran Master (tous les postes)
        </button>
      )}
    </div>
  )
}
