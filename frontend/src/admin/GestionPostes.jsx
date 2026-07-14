import { useEffect, useState } from 'react'
import { creer, lister, modifier, supprimer } from './apiAdmin'
import { Badge, BoutonLien, BoutonPrimaire, BoutonSecondaire, Carte, Champ, classeInput, Ligne, Table } from './ui'

const RESSOURCE = 'stations'

const FORM_VIDE = { nom: '', ordre_affichage: 0, is_expo: false }

/**
 * CRUD postes (§5.1). `Station` est référencée en `PROTECT` par
 * `MenuCategory`/`MenuItem`/`OrderTicket` — la suppression échoue donc
 * dès qu'un poste est réellement utilisé (backend : `ProtectedDeleteMixin`,
 * renvoie un 400 propre plutôt qu'un 500). "Désactiver" (`is_active`)
 * reste le levier normal pour un poste en service ; "Supprimer" couvre le
 * cas d'un poste créé par erreur, jamais utilisé.
 */
export default function GestionPostes() {
  const [stations, setStations] = useState(null)
  const [erreur, setErreur] = useState('')
  const [form, setForm] = useState(null) // null = fermé ; { id?, nom, ordre_affichage, is_expo }
  const [enCours, setEnCours] = useState(false)

  function recharger() {
    lister(RESSOURCE)
      .then(setStations)
      .catch((e) => setErreur(e.message))
  }

  useEffect(recharger, [])

  async function enregistrer(event) {
    event.preventDefault()
    setEnCours(true)
    setErreur('')
    try {
      const payload = { nom: form.nom, ordre_affichage: Number(form.ordre_affichage) || 0, is_expo: form.is_expo }
      if (form.id) {
        await modifier(RESSOURCE, form.id, payload)
      } else {
        await creer(RESSOURCE, payload)
      }
      setForm(null)
      recharger()
    } catch (e) {
      setErreur(e.message)
    } finally {
      setEnCours(false)
    }
  }

  async function toggleActif(station) {
    setErreur('')
    try {
      await modifier(RESSOURCE, station.id, { is_active: !station.is_active })
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  async function supprimerStation(station) {
    setErreur('')
    try {
      await supprimer(RESSOURCE, station.id)
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  if (!stations) return <p className="text-gray-400">Chargement...</p>

  return (
    <div className="space-y-4">
      {erreur && <div className="rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-800">{erreur}</div>}

      {form ? (
        <Carte>
          <form onSubmit={enregistrer} className="space-y-4">
            <div className="flex gap-4">
              <Champ label="Nom du poste" className="flex-1">
                <input
                  required
                  value={form.nom}
                  onChange={(e) => setForm({ ...form, nom: e.target.value })}
                  className={classeInput}
                />
              </Champ>
              <Champ label="Ordre" className="w-32">
                <input
                  type="number"
                  value={form.ordre_affichage}
                  onChange={(e) => setForm({ ...form, ordre_affichage: e.target.value })}
                  className={classeInput}
                />
              </Champ>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_expo}
                onChange={(e) => setForm({ ...form, is_expo: e.target.checked })}
                className="h-4 w-4 rounded accent-amber-500"
              />
              Écran de contrôle final (Expo) — pas une catégorie de menu
            </label>
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
        <BoutonPrimaire onClick={() => setForm(FORM_VIDE)}>+ Ajouter un poste</BoutonPrimaire>
      )}

      <Table colonnes={[{ label: 'Nom' }, { label: 'Ordre' }, { label: 'Type' }, { label: 'Statut' }, { label: '', className: 'text-right' }]}>
        {stations.map((s) => (
          <Ligne key={s.id}>
            <td className="px-4 py-3 font-semibold text-gray-900">{s.nom}</td>
            <td className="px-4 py-3 text-gray-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {s.ordre_affichage}
            </td>
            <td className="px-4 py-3 text-gray-600">{s.is_expo ? '🎯 Expo' : '🔥 Préparation'}</td>
            <td className="px-4 py-3">
              <Badge tone={s.is_active ? 'emerald' : 'gray'}>{s.is_active ? 'Actif' : 'Désactivé'}</Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <BoutonLien tone="sky" className="mr-4" onClick={() => setForm(s)}>
                Modifier
              </BoutonLien>
              <BoutonLien tone="gray" className="mr-4" onClick={() => toggleActif(s)}>
                {s.is_active ? 'Désactiver' : 'Réactiver'}
              </BoutonLien>
              <BoutonLien tone="red" onClick={() => supprimerStation(s)}>
                Supprimer
              </BoutonLien>
            </td>
          </Ligne>
        ))}
      </Table>
    </div>
  )
}
