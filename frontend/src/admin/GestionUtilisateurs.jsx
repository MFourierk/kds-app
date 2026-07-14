import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { creer, lister, modifier, supprimer } from './apiAdmin'
import { Badge, BoutonLien, BoutonPrimaire, BoutonSecondaire, Carte, Champ, classeInput, Ligne, Table } from './ui'

const ROLES = [
  { value: 'admin', label: 'Administrateur' },
  { value: 'manager', label: 'Manager' },
  { value: 'cuisinier', label: 'Cuisinier' },
  { value: 'serveur', label: 'Serveur' },
]

const ROLES_AVEC_PIN = ['cuisinier', 'serveur']

const FORM_VIDE = {
  username: '',
  first_name: '',
  last_name: '',
  email: '',
  role: 'serveur',
  station_assignee: '',
  password: '',
}

function Avatar({ nom }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-xs font-bold text-slate-900">
      {nom[0]?.toUpperCase() ?? '?'}
    </span>
  )
}

/**
 * CRUD utilisateurs (§6.4). Deux modes de connexion cohabitent : mot de
 * passe classique (admin/manager, champ `password` du serializer) et PIN
 * (cuisinier/serveur, jamais exposé en écriture directe — cf.
 * `UserViewSet.set_pin`, seule façon de fixer un PIN sans passer par
 * `/admin/`/le shell). Le formulaire montre l'un ou l'autre selon le rôle
 * choisi plutôt que les deux en permanence.
 *
 * Suppression réelle exposée (jamais bloquée par une FK `PROTECT` —
 * `User` n'est référencée qu'en `SET_NULL`, contrairement à `Station`)
 * mais jamais pour son
 * propre compte : bouton masqué ici, et refusé côté backend
 * (`UserViewSet.destroy`) même en cas de contournement de l'UI.
 */
export default function GestionUtilisateurs({ utilisateur }) {
  const [utilisateurs, setUtilisateurs] = useState(null)
  const [stations, setStations] = useState(null)
  const [erreur, setErreur] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState(null)
  const [enCours, setEnCours] = useState(false)
  const [pinForm, setPinForm] = useState(null) // { id, username, pin }

  function recharger() {
    Promise.all([lister('users'), lister('stations')])
      .then(([u, s]) => {
        setUtilisateurs(u)
        setStations(s)
      })
      .catch((e) => setErreur(e.message))
  }

  useEffect(recharger, [])

  async function enregistrer(event) {
    event.preventDefault()
    setEnCours(true)
    setErreur('')
    try {
      const payload = {
        username: form.username,
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        role: form.role,
        station_assignee: ROLES_AVEC_PIN.includes(form.role) ? form.station_assignee || null : null,
      }
      if (form.password) payload.password = form.password
      if (form.id) await modifier('users', form.id, payload)
      else await creer('users', payload)
      setForm(null)
      recharger()
    } catch (e) {
      setErreur(e.message)
    } finally {
      setEnCours(false)
    }
  }

  async function toggleActif(u) {
    setErreur('')
    try {
      await modifier('users', u.id, { is_active: !u.is_active })
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  async function supprimerUtilisateur(u) {
    setErreur('')
    try {
      await supprimer('users', u.id)
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  async function enregistrerPin(event) {
    event.preventDefault()
    setErreur('')
    setMessage('')
    try {
      const response = await apiFetch(`/api/users/${pinForm.id}/set-pin/`, {
        method: 'POST',
        body: JSON.stringify({ pin: pinForm.pin }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || `Erreur ${response.status}`)
      }
      setMessage(`PIN mis à jour pour ${pinForm.username}.`)
      setPinForm(null)
    } catch (e) {
      setErreur(e.message)
    }
  }

  if (!utilisateurs || !stations) return <p className="text-gray-400">Chargement...</p>

  return (
    <div className="space-y-4">
      {erreur && <div className="rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-800">{erreur}</div>}
      {message && <div className="rounded-xl bg-emerald-100 p-4 text-sm font-semibold text-emerald-800">{message}</div>}

      {form ? (
        <Carte>
          <form onSubmit={enregistrer} className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <Champ label="Identifiant">
                <input
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className={classeInput}
                />
              </Champ>
              <Champ label="Prénom">
                <input
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  className={classeInput}
                />
              </Champ>
              <Champ label="Nom">
                <input
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  className={classeInput}
                />
              </Champ>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <Champ label="Rôle">
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className={classeInput}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Champ>

              {ROLES_AVEC_PIN.includes(form.role) ? (
                <Champ label="Poste assigné">
                  <select
                    value={form.station_assignee || ''}
                    onChange={(e) => setForm({ ...form, station_assignee: e.target.value })}
                    className={classeInput}
                  >
                    <option value="">Aucun (voit l'écran de sélection)</option>
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nom}
                      </option>
                    ))}
                  </select>
                </Champ>
              ) : (
                <Champ label={form.id ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe'}>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className={classeInput}
                  />
                </Champ>
              )}

              <Champ label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={classeInput}
                />
              </Champ>
            </div>

            <div className="flex gap-2">
              <BoutonPrimaire type="submit" disabled={enCours}>
                Enregistrer
              </BoutonPrimaire>
              <BoutonSecondaire type="button" onClick={() => setForm(null)}>
                Annuler
              </BoutonSecondaire>
            </div>
          </form>
        </Carte>
      ) : (
        <BoutonPrimaire onClick={() => setForm(FORM_VIDE)}>+ Ajouter un utilisateur</BoutonPrimaire>
      )}

      {pinForm && (
        <Carte>
          <form onSubmit={enregistrerPin} className="flex items-end gap-4">
            <Champ label={`Nouveau PIN pour ${pinForm.username} (4 à 6 chiffres)`}>
              <input
                required
                inputMode="numeric"
                pattern="[0-9]{4,6}"
                value={pinForm.pin}
                onChange={(e) => setPinForm({ ...pinForm, pin: e.target.value })}
                className={classeInput}
              />
            </Champ>
            <BoutonPrimaire type="submit">Valider</BoutonPrimaire>
            <BoutonSecondaire type="button" onClick={() => setPinForm(null)}>
              Annuler
            </BoutonSecondaire>
          </form>
        </Carte>
      )}

      <Table
        colonnes={[
          { label: 'Nom' },
          { label: 'Identifiant' },
          { label: 'Rôle' },
          { label: 'Poste' },
          { label: 'Statut' },
          { label: '', className: 'text-right' },
        ]}
      >
        {utilisateurs.map((u) => {
          const nomComplet = `${u.first_name} ${u.last_name}`.trim() || u.username
          return (
            <Ligne key={u.id}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Avatar nom={nomComplet} />
                  <span className="font-semibold text-gray-900">{nomComplet}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-gray-600">{u.username}</td>
              <td className="px-4 py-3 text-gray-600">{ROLES.find((r) => r.value === u.role)?.label ?? u.role}</td>
              <td className="px-4 py-3 text-gray-600">{stations.find((s) => s.id === u.station_assignee)?.nom ?? '—'}</td>
              <td className="px-4 py-3">
                <Badge tone={u.is_active ? 'emerald' : 'gray'}>{u.is_active ? 'Actif' : 'Désactivé'}</Badge>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                {u.is_superuser ? (
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    🔒 Compte système — protégé
                  </span>
                ) : (
                  <>
                    <BoutonLien
                      tone="sky"
                      className="mr-4"
                      onClick={() => setForm({ ...u, password: '', station_assignee: u.station_assignee || '' })}
                    >
                      Modifier
                    </BoutonLien>
                    {ROLES_AVEC_PIN.includes(u.role) && (
                      <BoutonLien tone="amber" className="mr-4" onClick={() => setPinForm({ id: u.id, username: u.username, pin: '' })}>
                        Réinitialiser PIN
                      </BoutonLien>
                    )}
                    <BoutonLien tone="gray" className="mr-4" onClick={() => toggleActif(u)}>
                      {u.is_active ? 'Désactiver' : 'Réactiver'}
                    </BoutonLien>
                    {u.id !== utilisateur?.id && (
                      <BoutonLien tone="red" onClick={() => supprimerUtilisateur(u)}>
                        Supprimer
                      </BoutonLien>
                    )}
                  </>
                )}
              </td>
            </Ligne>
          )
        })}
      </Table>
    </div>
  )
}
