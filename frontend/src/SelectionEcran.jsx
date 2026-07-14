import { useEffect, useState } from 'react'
import { fetchStations } from './api'

/**
 * Sélecteur affiché quand l'utilisateur n'a pas de poste assigné
 * (`station_assignee`, ex: manager/admin) — laisse choisir Master ou un
 * poste précis. Un cuisinier avec un poste assigné ne voit jamais cet
 * écran, il est routé directement (§6.2 : un écran dédié par poste en
 * cuisine, pas de choix à faire sur place).
 */
export default function SelectionEcran({ onChoisir, afficherTableauDeBord, afficherCaisse }) {
  const [stations, setStations] = useState([])
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    fetchStations()
      .then(setStations)
      .catch(() => setErreur('Impossible de charger la liste des postes.'))
  }, [])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-slate-900 p-8">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Quel écran ouvrir ?</h1>

      {erreur && <p className="text-red-400">{erreur}</p>}

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

      <button
        onClick={() => onChoisir({ scopeId: 'master', titre: 'Écran Master' })}
        className="w-72 rounded-xl bg-amber-500 py-4 text-lg font-semibold text-slate-900 hover:bg-amber-400"
      >
        Écran Master (tous les postes)
      </button>

      {stations.map((station) => (
        <button
          key={station.id}
          onClick={() => onChoisir({ scopeId: station.id, titre: `Poste ${station.nom}` })}
          className="w-72 rounded-xl bg-slate-700 py-4 text-lg font-semibold text-slate-100 hover:bg-slate-600"
        >
          Poste {station.nom}
        </button>
      ))}
    </div>
  )
}
