import { useEffect, useState } from 'react'
import { fetchKioskStaff, login, loginPin } from './api'
import { amorcerAudio } from './notificationSound'

const LIBELLE_ROLE = {
  manager: 'Manager',
  admin: 'Administrateur',
  cuisinier: 'Cuisinier',
  serveur: 'Serveur',
  caissier: 'Caissière',
}

function FormulaireMotDePasse({ onConnecte }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    amorcerAudio()
    setErreur('')
    setEnCours(true)
    try {
      await login(username, password)
      onConnecte()
    } catch {
      setErreur('Identifiants invalides.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label className="mb-1 block text-sm text-slate-300" htmlFor="username">
        Identifiant
      </label>
      <input
        id="username"
        className="mb-4 w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-lg text-slate-100 focus:border-amber-400 focus:outline-none"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        required
      />

      <label className="mb-1 block text-sm text-slate-300" htmlFor="password">
        Mot de passe
      </label>
      <input
        id="password"
        type="password"
        className="mb-6 w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-lg text-slate-100 focus:border-amber-400 focus:outline-none"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />

      {erreur && <p className="mb-4 text-center text-sm text-red-400">{erreur}</p>}

      <button
        type="submit"
        disabled={enCours}
        className="w-full rounded-lg bg-amber-500 py-3 text-lg font-semibold text-slate-900 transition hover:bg-amber-400 disabled:opacity-50"
      >
        {enCours ? 'Connexion...' : 'Se connecter'}
      </button>
    </form>
  )
}

function SelecteurPersonnel({ onChoisir }) {
  const [personnel, setPersonnel] = useState(null)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    fetchKioskStaff()
      .then(setPersonnel)
      .catch((e) => setErreur(e.message))
  }, [])

  if (erreur) return <p className="text-center text-red-400">{erreur}</p>
  if (!personnel) return <p className="text-center text-slate-400">Chargement...</p>
  if (personnel.length === 0) return <p className="text-center text-slate-400">Aucun compte à connexion rapide pour cet établissement.</p>

  return (
    <div>
      <p className="mb-4 text-center text-sm text-slate-400">Qui es-tu ?</p>
      <div className="grid grid-cols-2 gap-3">
        {personnel.map((p) => (
          <button
            key={p.id}
            onClick={() => onChoisir(p)}
            className="rounded-xl border border-slate-600 bg-slate-900 p-4 text-center transition hover:border-amber-400 hover:bg-slate-700"
          >
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-lg font-bold text-slate-900">
              {(p.first_name || p.username)[0].toUpperCase()}
            </div>
            <p className="truncate font-semibold text-slate-100">{`${p.first_name} ${p.last_name}`.trim() || p.username}</p>
            <p className="text-xs text-slate-400">{LIBELLE_ROLE[p.role] ?? p.role}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function PaveNumerique({ personne, onRetour, onConnecte }) {
  const [pin, setPin] = useState('')
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)

  function taper(chiffre) {
    setErreur('')
    if (pin.length >= 6) return
    setPin(pin + chiffre)
  }

  async function valider() {
    amorcerAudio()
    setEnCours(true)
    setErreur('')
    try {
      await loginPin(personne.username, pin)
      onConnecte()
    } catch {
      setErreur('PIN incorrect.')
      setPin('')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div>
      <button onClick={onRetour} className="mb-4 text-sm text-slate-400 hover:text-slate-200">
        ← Changer d'utilisateur
      </button>

      <p className="mb-4 text-center font-semibold text-slate-100">
        {`${personne.first_name} ${personne.last_name}`.trim() || personne.username}
      </p>

      <div className="mb-6 flex justify-center gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full ${i < pin.length ? 'bg-amber-400' : 'bg-slate-600'}`}
          />
        ))}
      </div>

      {erreur && <p className="mb-4 text-center text-sm text-red-400">{erreur}</p>}

      <div className="mb-4 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((chiffre) => (
          <button
            key={chiffre}
            onClick={() => taper(chiffre)}
            className="rounded-xl bg-slate-900 py-4 text-xl font-semibold text-slate-100 hover:bg-slate-700"
          >
            {chiffre}
          </button>
        ))}
        <button
          onClick={() => setPin(pin.slice(0, -1))}
          className="rounded-xl bg-slate-900 py-4 text-lg font-semibold text-slate-400 hover:bg-slate-700"
        >
          ⌫
        </button>
        <button
          onClick={() => taper('0')}
          className="rounded-xl bg-slate-900 py-4 text-xl font-semibold text-slate-100 hover:bg-slate-700"
        >
          0
        </button>
        <button
          onClick={valider}
          disabled={pin.length < 4 || enCours}
          className="rounded-xl bg-amber-500 py-4 text-lg font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-40"
        >
          OK
        </button>
      </div>
    </div>
  )
}

/**
 * Deux modes de connexion cohabitent (§6.4) : mot de passe classique
 * (manager/admin) et PIN sur écran tactile (cuisinier/serveur, qui n'ont
 * pas de mot de passe utilisable). Le mode PIN n'avait jusqu'ici AUCUN
 * écran — le backend (`/api/auth/pin-login/`, `/api/kiosk/staff/`)
 * existait depuis la Phase 0 mais n'était jamais appelé, rendant tout
 * compte cuisinier/serveur impossible à connecter depuis l'app.
 */
export default function LoginScreen({ onConnecte }) {
  const [mode, setMode] = useState('manager') // manager | cuisine
  const [personneChoisie, setPersonneChoisie] = useState(null)

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800">
      <div className="w-full max-w-sm rounded-2xl bg-slate-800 p-8 shadow-2xl ring-1 ring-slate-700">
        <h1 className="mb-6 text-center text-2xl font-semibold text-slate-100">KDS — Connexion</h1>

        <div className="mb-6 flex rounded-lg bg-slate-900 p-1">
          <button
            onClick={() => {
              setMode('manager')
              setPersonneChoisie(null)
            }}
            className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${
              mode === 'manager' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'
            }`}
          >
            Manager
          </button>
          <button
            onClick={() => setMode('cuisine')}
            className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${
              mode === 'cuisine' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'
            }`}
          >
            Service
          </button>
        </div>

        {mode === 'manager' && <FormulaireMotDePasse onConnecte={onConnecte} />}

        {mode === 'cuisine' &&
          (personneChoisie ? (
            <PaveNumerique personne={personneChoisie} onRetour={() => setPersonneChoisie(null)} onConnecte={onConnecte} />
          ) : (
            <SelecteurPersonnel onChoisir={setPersonneChoisie} />
          ))}
      </div>
    </div>
  )
}
