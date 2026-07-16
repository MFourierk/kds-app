import { useEffect, useState } from 'react'
import { fetchTenant, logout } from '../api'
import RapportsTab from './RapportsTab'
import GestionMenu from './GestionMenu'
import GestionPostes from './GestionPostes'
import GestionUtilisateurs from './GestionUtilisateurs'
import EtablissementTab from './EtablissementTab'

const ONGLETS = [
  { id: 'rapports', label: 'Rapports', icone: '📊', description: 'Performance & activité', Composant: RapportsTab },
  { id: 'menu', label: 'Menu', icone: '🍽️', description: 'Catégories & plats', Composant: GestionMenu },
  { id: 'postes', label: 'Postes', icone: '🔥', description: 'Postes de préparation', Composant: GestionPostes },
  { id: 'utilisateurs', label: 'Équipe', icone: '👥', description: 'Comptes & accès', Composant: GestionUtilisateurs },
  { id: 'etablissement', label: 'Établissement', icone: '🏢', description: 'Logo, nom & coordonnées', Composant: EtablissementTab },
]

/**
 * Back-office manager/admin (Phase 6 §5.4 + §5.2/§6.4). Layout sidebar
 * plutôt que des onglets horizontaux plats (demandé après coup : "trop
 * plat, pas design") — identité visuelle alignée sur le reste de l'app
 * (fond ardoise + accent ambre déjà utilisés sur l'écran de connexion et
 * les écrans cuisine), pas une nouvelle palette isolée pour cet écran.
 * Accès gaté par rôle en amont (`App.jsx`) ET côté backend
 * (`ManagerWriteMixin`) : le masquage du bouton n'est qu'un confort.
 */
const LIBELLE_ROLE = { admin: 'Administrateur', manager: 'Manager', cuisinier: 'Cuisinier', serveur: 'Serveur', caissier: 'Caissière' }

export default function AdminDashboard({ utilisateur, onChangerEcran, onDeconnexion }) {
  const [ongletId, setOngletId] = useState('rapports')
  const [menuMobileOuvert, setMenuMobileOuvert] = useState(false)
  const [tenant, setTenant] = useState(null)
  const onglet = ONGLETS.find((o) => o.id === ongletId)
  const Onglet = onglet.Composant
  const nomAffiche = utilisateur
    ? `${utilisateur.first_name} ${utilisateur.last_name}`.trim() || utilisateur.username
    : ''
  const nomEtablissement = tenant?.nom_etablissement ?? '...'

  // Jamais bloquant si ça échoue (même logique que CaisseScreen/EtablissementTab)
  // — le nom de l'établissement était en dur ("Restaurant Démo") depuis la
  // première version de cet écran, jamais remarqué faute d'avoir jamais
  // testé avec un tenant réel différent du jeu de démo avant l'essai
  // d'installation client sur la VM.
  useEffect(() => {
    fetchTenant().then(setTenant).catch(() => {})
  }, [])

  function choisirOnglet(id) {
    setOngletId(id)
    setMenuMobileOuvert(false)
  }

  return (
    <div className="flex h-full flex-col bg-gray-100 md:flex-row">
      {/* Barre mobile : la sidebar fixe (256px) ne peut pas cohabiter avec le
          contenu sur un écran de téléphone — devient un tiroir masqué par
          défaut, ouvert via ce bouton ☰ (jamais testé sur un vrai téléphone
          avant l'essai d'installation client sur la VM, seulement "en plein
          écran" comme documenté dans le README). */}
      <div className="flex items-center justify-between border-b border-white/10 bg-slate-950 px-4 py-3 md:hidden">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-400">
            {nomEtablissement}
          </p>
          <h1 className="text-base font-bold text-white">
            {onglet.icone} {onglet.label}
          </h1>
        </div>
        <button
          onClick={() => setMenuMobileOuvert(true)}
          className="shrink-0 rounded-lg p-2 text-xl text-white hover:bg-white/10"
          aria-label="Ouvrir le menu"
        >
          ☰
        </button>
      </div>

      {menuMobileOuvert && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMenuMobileOuvert(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 -translate-x-full flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-900 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          menuMobileOuvert ? 'translate-x-0' : ''
        }`}
      >
        <div className="border-b border-white/10 px-6 py-6">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
            {nomEtablissement}
          </p>
          <h1 className="mt-1 text-xl font-bold text-white">Tableau de bord</h1>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {ONGLETS.map((o) => (
            <button
              key={o.id}
              onClick={() => choisirOnglet(o.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                ongletId === o.id
                  ? 'bg-white/10 text-white shadow-inner ring-1 ring-amber-400/40'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg ${
                ongletId === o.id ? 'bg-amber-500 text-slate-900' : 'bg-white/5'
              }`}>
                {o.icone}
              </span>
              <span>
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-xs text-slate-500">{o.description}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="space-y-2 border-t border-white/10 p-3">
          {utilisateur && (
            <div className="mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-xs font-bold text-slate-900">
                {nomAffiche[0]?.toUpperCase() ?? '?'}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">{nomAffiche}</span>
                <span className="block text-xs text-slate-400">
                  {LIBELLE_ROLE[utilisateur.role] ?? utilisateur.role} · {utilisateur.username}
                </span>
              </span>
            </div>
          )}
          <button
            onClick={onChangerEcran}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-300 transition hover:bg-white/5"
          >
            ↩ Changer d'écran
          </button>
          <button
            onClick={() => {
              logout()
              onDeconnexion()
            }}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-400 transition hover:bg-white/5"
          >
            ⏻ Déconnexion
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="hidden border-b border-gray-200 bg-white px-8 py-6 md:block">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">{onglet.description}</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">
            {onglet.icone} {onglet.label}
          </h2>
        </header>

        <div className="p-4 md:p-8">
          <Onglet utilisateur={utilisateur} />
        </div>
      </main>
    </div>
  )
}
