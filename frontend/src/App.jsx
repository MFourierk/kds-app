import { useEffect, useState } from 'react'
import { fetchLicenceStatut, fetchMe, fetchStations, getTokens } from './api'
import LoginScreen from './LoginScreen'
import KitchenScreen from './KitchenScreen'
import SelectionEcran from './SelectionEcran'
import AdminDashboard from './admin/AdminDashboard'
import CaisseScreen from './CaisseScreen'
import ServeurScreen from './ServeurScreen'
import PrendreCommandeScreen from './PrendreCommandeScreen'

const ROLES_DASHBOARD = ['manager', 'admin']
const ROLES_CAISSE = ['serveur', 'manager', 'admin']
// Service réservé au rôle serveur (demandé après coup) — un manager/admin a
// déjà Master (voit tout, tous postes confondus) et Caisse, "Service" y
// serait redondant sur l'écran de sélection.
const ROLES_SERVICE = ['serveur']
// Prendre commande : utile en usage courant (serveur commande à la place du
// client) et indispensable en cas de coupure internet (le client sur son
// réseau mobile ne peut plus atteindre le serveur du restaurant) — ouvert
// à tout le staff qui prend des commandes.
const ROLES_PRENDRE_COMMANDE = ['serveur', 'manager', 'admin']
// Le bandeau d'avertissement de licence (statut "retard"/"retard_prolonge")
// ne concerne que le staff qui peut agir dessus — un serveur/cuisinier n'a
// rien à faire d'une question d'abonnement.
const ROLES_BANNIERE_LICENCE = ['manager', 'admin']

function EcranSuspendu({ onDeconnexion }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-slate-900 p-8 text-center">
      <span className="text-5xl">🔒</span>
      <h1 className="text-2xl font-bold text-slate-100">Abonnement suspendu</h1>
      <p className="max-w-md text-slate-400">
        L'accès à l'application est temporairement bloqué suite à un retard de paiement prolongé.
        Contactez votre prestataire pour rétablir l'accès.
      </p>
      <button
        onClick={onDeconnexion}
        className="mt-2 rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600"
      >
        Déconnexion
      </button>
    </div>
  )
}

function BanniereLicence({ statut }) {
  const texte =
    statut === 'retard_prolonge'
      ? "Abonnement en retard prolongé — les rapports sont désactivés. Contactez votre prestataire."
      : 'Abonnement en retard de paiement — pensez à régulariser pour éviter toute interruption de service.'
  return (
    <div className="bg-amber-600 px-4 py-2 text-center text-sm font-semibold text-slate-900">⚠️ {texte}</div>
  )
}

function App() {
  const [connecte, setConnecte] = useState(() => Boolean(getTokens()?.access))
  const [ecran, setEcran] = useState(null) // null | { scopeId, titre } | 'selection'
  const [ecranVerrouille, setEcranVerrouille] = useState(false) // true = poste assigné, pas de "changer d'écran"
  const [role, setRole] = useState(null)
  const [utilisateur, setUtilisateur] = useState(null)
  const [licenceStatut, setLicenceStatut] = useState('actif')

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
    // Best-effort (§licence) : une erreur réseau ne doit jamais bloquer
    // l'app sur un détail de licence — reste sur "actif" par défaut.
    fetchLicenceStatut()
      .then((data) => {
        if (!annule) setLicenceStatut(data.statut)
      })
      .catch(() => {})

    return () => {
      annule = true
    }
  }, [connecte])

  if (!connecte) {
    return <LoginScreen onConnecte={() => setConnecte(true)} />
  }

  if (licenceStatut === 'suspendu') {
    return <EcranSuspendu onDeconnexion={() => setConnecte(false)} />
  }

  const afficherBanniere = ROLES_BANNIERE_LICENCE.includes(role) && ['retard', 'retard_prolonge'].includes(licenceStatut)

  let contenu

  if (ecran === 'selection') {
    contenu = (
      <SelectionEcran
        onChoisir={setEcran}
        afficherTableauDeBord={ROLES_DASHBOARD.includes(role)}
        afficherCaisse={ROLES_CAISSE.includes(role)}
        afficherService={ROLES_SERVICE.includes(role)}
        afficherPrendreCommande={ROLES_PRENDRE_COMMANDE.includes(role)}
        masquerEcransCuisine={role === 'serveur'}
      />
    )
  } else if (!ecran) {
    contenu = <div className="flex h-full items-center justify-center bg-slate-900 text-slate-400">Chargement...</div>
  } else if (ecran.scopeId === 'dashboard') {
    contenu = (
      <AdminDashboard
        utilisateur={utilisateur}
        onChangerEcran={() => setEcran('selection')}
        onDeconnexion={() => setConnecte(false)}
      />
    )
  } else if (ecran.scopeId === 'caisse') {
    contenu = (
      <CaisseScreen
        utilisateur={utilisateur}
        onChangerEcran={() => setEcran('selection')}
        onDeconnexion={() => setConnecte(false)}
      />
    )
  } else if (ecran.scopeId === 'service') {
    contenu = <ServeurScreen onChangerEcran={() => setEcran('selection')} onDeconnexion={() => setConnecte(false)} />
  } else if (ecran.scopeId === 'prendre-commande') {
    contenu = (
      <PrendreCommandeScreen onChangerEcran={() => setEcran('selection')} onDeconnexion={() => setConnecte(false)} />
    )
  } else {
    contenu = (
      <KitchenScreen
        scopeId={ecran.scopeId}
        titre={ecran.titre}
        onChangerEcran={ecranVerrouille ? undefined : () => setEcran('selection')}
        onDeconnexion={() => setConnecte(false)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      {afficherBanniere && <BanniereLicence statut={licenceStatut} />}
      <div className="min-h-0 flex-1">{contenu}</div>
    </div>
  )
}

export default App
