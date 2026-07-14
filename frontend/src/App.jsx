import { useEffect, useState } from 'react'
import { fetchMe, fetchStations, getTokens } from './api'
import LoginScreen from './LoginScreen'
import KitchenScreen from './KitchenScreen'
import SelectionEcran from './SelectionEcran'
import AdminDashboard from './admin/AdminDashboard'
import CaisseScreen from './CaisseScreen'

const ROLES_DASHBOARD = ['manager', 'admin']
const ROLES_CAISSE = ['serveur', 'manager', 'admin']

function App() {
  const [connecte, setConnecte] = useState(() => Boolean(getTokens()?.access))
  const [ecran, setEcran] = useState(null) // null | { scopeId, titre } | 'selection'
  const [ecranVerrouille, setEcranVerrouille] = useState(false) // true = poste assigné, pas de "changer d'écran"
  const [role, setRole] = useState(null)
  const [utilisateur, setUtilisateur] = useState(null)

  useEffect(() => {
    if (!connecte) {
      setEcran(null)
      return
    }

    let annule = false

    async function resoudreEcran() {
      const moi = await fetchMe()
      if (annule) return
      setRole(moi.role)
      setUtilisateur(moi)

      if (moi.station_assignee) {
        const stations = await fetchStations()
        if (annule) return
        const station = stations.find((s) => s.id === moi.station_assignee)
        setEcran({ scopeId: moi.station_assignee, titre: `Poste ${station?.nom ?? ''}`.trim() })
        setEcranVerrouille(true)
        return
      }

      setEcran('selection')
    }

    resoudreEcran().catch(() => setEcran('selection'))

    return () => {
      annule = true
    }
  }, [connecte])

  if (!connecte) {
    return <LoginScreen onConnecte={() => setConnecte(true)} />
  }

  if (ecran === 'selection') {
    return (
      <SelectionEcran
        onChoisir={setEcran}
        afficherTableauDeBord={ROLES_DASHBOARD.includes(role)}
        afficherCaisse={ROLES_CAISSE.includes(role)}
      />
    )
  }

  if (!ecran) {
    return <div className="flex h-full items-center justify-center bg-slate-900 text-slate-400">Chargement...</div>
  }

  if (ecran.scopeId === 'dashboard') {
    return (
      <AdminDashboard
        utilisateur={utilisateur}
        onChangerEcran={() => setEcran('selection')}
        onDeconnexion={() => setConnecte(false)}
      />
    )
  }

  if (ecran.scopeId === 'caisse') {
    return (
      <CaisseScreen
        utilisateur={utilisateur}
        onChangerEcran={() => setEcran('selection')}
        onDeconnexion={() => setConnecte(false)}
      />
    )
  }

  return (
    <KitchenScreen
      scopeId={ecran.scopeId}
      titre={ecran.titre}
      onChangerEcran={ecranVerrouille ? undefined : () => setEcran('selection')}
      onDeconnexion={() => setConnecte(false)}
    />
  )
}

export default App
