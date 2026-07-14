import { useEffect, useState } from 'react'
import { fetchTenant } from '../api'
import { modifier } from './apiAdmin'
import { BoutonPrimaire, Carte, Champ, classeInput } from './ui'

/**
 * Réglages établissement (§5.5/§6.4) : logo, nom, coordonnées — jusqu'ici
 * seulement modifiables via Django `/admin/` (compte superutilisateur
 * distinct des comptes manager/admin de l'app), ce qui a semé la
 * confusion en usage réel ("je ne retrouve plus le menu pour la
 * création de tenant"). Le logo accepte un fichier local (upload,
 * `Tenant.logo` en `ImageField`) plutôt qu'un lien externe à coller —
 * servi par le backend via `MEDIA_URL`, donc une URL absolue toujours
 * accessible depuis n'importe quel écran du réseau, pas un chemin local
 * au poste qui l'a choisi.
 */
export default function EtablissementTab() {
  const [tenant, setTenant] = useState(null)
  const [form, setForm] = useState(null)
  const [logoFile, setLogoFile] = useState(null)
  const [erreur, setErreur] = useState('')
  const [message, setMessage] = useState('')
  const [enCours, setEnCours] = useState(false)

  function recharger() {
    fetchTenant()
      .then((t) => {
        setTenant(t)
        setForm({ nom_etablissement: t.nom_etablissement, telephone: t.telephone, adresse: t.adresse })
      })
      .catch((e) => setErreur(e.message))
  }

  useEffect(recharger, [])

  async function enregistrer(event) {
    event.preventDefault()
    setEnCours(true)
    setErreur('')
    setMessage('')
    try {
      let corps
      if (logoFile) {
        corps = new FormData()
        corps.append('nom_etablissement', form.nom_etablissement)
        corps.append('telephone', form.telephone)
        corps.append('adresse', form.adresse)
        corps.append('logo', logoFile)
      } else {
        corps = form
      }
      const misAJour = await modifier('tenant', tenant.id, corps)
      setTenant(misAJour)
      setLogoFile(null)
      setMessage('Établissement mis à jour.')
    } catch (e) {
      setErreur(e.message)
    } finally {
      setEnCours(false)
    }
  }

  if (!tenant || !form) return <p className="text-gray-400">Chargement...</p>

  return (
    <div className="max-w-2xl space-y-4">
      {erreur && <div className="rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-800">{erreur}</div>}
      {message && <div className="rounded-xl bg-emerald-100 p-4 text-sm font-semibold text-emerald-800">{message}</div>}

      <Carte>
        <form onSubmit={enregistrer} className="space-y-4">
          <Champ label="Logo">
            <div className="flex items-center gap-4">
              {(logoFile || tenant.logo) && (
                <img
                  src={logoFile ? URL.createObjectURL(logoFile) : tenant.logo}
                  alt=""
                  className="h-16 w-16 rounded-xl object-contain ring-1 ring-gray-200"
                />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                className={classeInput}
              />
            </div>
          </Champ>

          <Champ label="Nom de l'établissement">
            <input
              required
              value={form.nom_etablissement}
              onChange={(e) => setForm({ ...form, nom_etablissement: e.target.value })}
              className={classeInput}
            />
          </Champ>

          <div className="flex flex-wrap gap-4">
            <Champ label="Téléphone" className="flex-1">
              <input
                value={form.telephone}
                onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                className={classeInput}
                placeholder="07 58 29 11 10 / 01 43 09 76 16"
              />
            </Champ>
            <Champ label="Adresse" className="flex-1">
              <input
                value={form.adresse}
                onChange={(e) => setForm({ ...form, adresse: e.target.value })}
                className={classeInput}
                placeholder="Quartier, ville..."
              />
            </Champ>
          </div>

          <p className="text-xs text-gray-400">
            Logo, nom, adresse et téléphone apparaissent en en-tête de la facture et du reçu de caisse.
          </p>

          <BoutonPrimaire type="submit" disabled={enCours}>
            Enregistrer
          </BoutonPrimaire>
        </form>
      </Carte>
    </div>
  )
}
