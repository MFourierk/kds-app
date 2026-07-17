import { useEffect, useState } from 'react'
import ClavierNumerique from '../ClavierNumerique'
import { creer, lister, modifier, supprimer } from './apiAdmin'
import { formatPrix } from '../client/formatPrix'
import { Badge, BoutonLien, BoutonPrimaire, BoutonSecondaire, Carte, Champ, classeInput, Ligne, Table } from './ui'

const CAT_VIDE = { nom: '', station: '', ordre_affichage: 0 }
const PLAT_VIDE = { nom: '', categorie: '', station: '', prix: '', temps_preparation_estime_min: 10, image: '', imageFile: null, modifiers: [] }

function SectionCategories({ categories, stations, recharger, setErreur }) {
  const [form, setForm] = useState(null)
  const [enCours, setEnCours] = useState(false)

  async function enregistrer(event) {
    event.preventDefault()
    setEnCours(true)
    setErreur('')
    try {
      const payload = { nom: form.nom, station: form.station, ordre_affichage: Number(form.ordre_affichage) || 0 }
      if (form.id) await modifier('menu-categories', form.id, payload)
      else await creer('menu-categories', payload)
      setForm(null)
      recharger()
    } catch (e) {
      setErreur(e.message)
    } finally {
      setEnCours(false)
    }
  }

  async function supprimerCategorie(cat) {
    setErreur('')
    try {
      await supprimer('menu-categories', cat.id)
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-sm">📂</span>
          Catégories
        </h2>
        {!form && (
          <BoutonLien tone="amber" onClick={() => setForm(CAT_VIDE)}>
            + Ajouter une catégorie
          </BoutonLien>
        )}
      </div>

      {form && (
        <Carte>
          <form onSubmit={enregistrer} className="flex flex-wrap items-end gap-4">
            <Champ label="Nom">
              <input
                required
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                className={classeInput}
              />
            </Champ>
            <Champ label="Poste">
              <select
                required
                value={form.station}
                onChange={(e) => setForm({ ...form, station: e.target.value })}
                className={classeInput}
              >
                <option value="" disabled>
                  — choisir —
                </option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom}
                  </option>
                ))}
              </select>
            </Champ>
            <Champ label="Ordre" className="w-20">
              <input
                type="number"
                value={form.ordre_affichage}
                onChange={(e) => setForm({ ...form, ordre_affichage: e.target.value })}
                className={classeInput}
              />
            </Champ>
            <BoutonPrimaire type="submit" disabled={enCours}>
              Enregistrer
            </BoutonPrimaire>
            <BoutonSecondaire type="button" onClick={() => setForm(null)}>
              Annuler
            </BoutonSecondaire>
          </form>
        </Carte>
      )}

      <Table colonnes={[{ label: 'Nom' }, { label: 'Poste' }, { label: 'Ordre' }, { label: '', className: 'text-right' }]}>
        {categories.map((c) => (
          <Ligne key={c.id}>
            <td className="px-4 py-3 font-semibold text-gray-900">{c.nom}</td>
            <td className="px-4 py-3 text-gray-600">{stations.find((s) => s.id === c.station)?.nom ?? '—'}</td>
            <td className="px-4 py-3 text-gray-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {c.ordre_affichage}
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <BoutonLien tone="sky" className="mr-4" onClick={() => setForm(c)}>
                Modifier
              </BoutonLien>
              <BoutonLien tone="red" onClick={() => supprimerCategorie(c)}>
                Supprimer
              </BoutonLien>
            </td>
          </Ligne>
        ))}
      </Table>
    </div>
  )
}

function SectionPlats({ plats, categories, stations, modificateurs, categoriesModificateurs, recharger, setErreur }) {
  const [form, setForm] = useState(null)
  const [enCours, setEnCours] = useState(false)

  function choisirCategorie(categorieId) {
    const cat = categories.find((c) => c.id === categorieId)
    setForm({ ...form, categorie: categorieId, station: cat?.station ?? form.station })
  }

  function toggleModificateur(modificateurId) {
    setForm((f) => ({
      ...f,
      modifiers: f.modifiers.includes(modificateurId)
        ? f.modifiers.filter((id) => id !== modificateurId)
        : [...f.modifiers, modificateurId],
    }))
  }

  async function enregistrer(event) {
    event.preventDefault()
    setEnCours(true)
    setErreur('')
    try {
      // Upload de fichier local (§6.4, "les images doivent être
      // accessibles de partout" — une image collée en URL externe pouvait
      // disparaître ou être injoignable ; un fichier uploadé est servi par
      // le backend, donc toujours accessible depuis n'importe quel écran).
      // `FormData` uniquement si une nouvelle photo est choisie — sinon
      // JSON classique, pour ne pas écraser la photo existante au simple
      // changement de prix.
      let corps
      if (form.imageFile) {
        corps = new FormData()
        corps.append('nom', form.nom)
        corps.append('categorie', form.categorie)
        corps.append('station', form.station)
        corps.append('prix', form.prix)
        corps.append('temps_preparation_estime_min', Number(form.temps_preparation_estime_min) || 0)
        corps.append('image', form.imageFile)
        // Une entrée répétée par modificateur (pas de tableau JSON possible
        // en `multipart/form-data`) — le parser multipart de DRF regroupe
        // les valeurs répétées d'une même clé pour un champ M2M.
        form.modifiers.forEach((id) => corps.append('modifiers', id))
      } else {
        corps = {
          nom: form.nom,
          categorie: form.categorie,
          station: form.station,
          prix: form.prix,
          temps_preparation_estime_min: Number(form.temps_preparation_estime_min) || 0,
          modifiers: form.modifiers,
        }
      }
      if (form.id) await modifier('menu-items', form.id, corps)
      else await creer('menu-items', corps)
      setForm(null)
      recharger()
    } catch (e) {
      setErreur(e.message)
    } finally {
      setEnCours(false)
    }
  }

  async function toggleStatut(plat) {
    setErreur('')
    try {
      await modifier('menu-items', plat.id, { statut: plat.statut === 'disponible' ? 'rupture' : 'disponible' })
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  async function supprimerPlat(plat) {
    setErreur('')
    try {
      await supprimer('menu-items', plat.id)
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-sm">🍽️</span>
          Plats
        </h2>
        {!form && categories.length > 0 && (
          <BoutonLien tone="amber" onClick={() => setForm(PLAT_VIDE)}>
            + Ajouter un plat
          </BoutonLien>
        )}
      </div>

      {categories.length === 0 && (
        <p className="text-sm text-gray-400">Créez d'abord une catégorie pour pouvoir ajouter des plats.</p>
      )}

      {form && (
        <Carte>
          <form onSubmit={enregistrer} className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <Champ label="Nom du plat" className="flex-1">
                <input
                  required
                  value={form.nom}
                  onChange={(e) => setForm({ ...form, nom: e.target.value })}
                  className={classeInput}
                />
              </Champ>
              <Champ label="Catégorie">
                <select
                  required
                  value={form.categorie}
                  onChange={(e) => choisirCategorie(e.target.value)}
                  className={classeInput}
                >
                  <option value="" disabled>
                    — choisir —
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </select>
              </Champ>
              <Champ label="Poste de préparation">
                <select
                  required
                  value={form.station}
                  onChange={(e) => setForm({ ...form, station: e.target.value })}
                  className={classeInput}
                >
                  <option value="" disabled>
                    — choisir —
                  </option>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom}
                    </option>
                  ))}
                </select>
              </Champ>
            </div>
            <div className="flex flex-wrap gap-4">
              <Champ label="Prix (XOF)" className="w-40">
                <input
                  required
                  type="text"
                  inputMode="decimal"
                  value={form.prix}
                  onChange={(e) => setForm({ ...form, prix: e.target.value })}
                  className={classeInput}
                />
                <div className="mt-1.5">
                  <ClavierNumerique
                    valeur={form.prix}
                    onChange={(v) => setForm({ ...form, prix: v })}
                    autoriserDecimales
                    sombre={false}
                  />
                </div>
              </Champ>
              <Champ label="Temps de préparation (min)" className="w-40">
                <input
                  type="number"
                  min="0"
                  value={form.temps_preparation_estime_min}
                  onChange={(e) => setForm({ ...form, temps_preparation_estime_min: e.target.value })}
                  className={classeInput}
                />
              </Champ>
              <Champ label="Photo (optionnel)" className="flex-1">
                <div className="flex items-center gap-3">
                  {(form.imageFile || form.image) && (
                    <img
                      src={form.imageFile ? URL.createObjectURL(form.imageFile) : form.image}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-gray-200"
                    />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setForm({ ...form, imageFile: e.target.files?.[0] ?? null })}
                    className={classeInput}
                  />
                </div>
              </Champ>
            </div>

            {categoriesModificateurs.length > 0 && (
              <Champ label="Modificateurs applicables">
                <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                  {categoriesModificateurs.map((cat) => {
                    const optionsDeLaCategorie = modificateurs.filter((m) => m.categorie === cat.id)
                    if (optionsDeLaCategorie.length === 0) return null
                    return (
                      <div key={cat.id}>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {cat.nom}
                          {cat.obligatoire && <span className="ml-1.5 text-red-600">(choix obligatoire à la commande)</span>}
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                          {optionsDeLaCategorie.map((m) => (
                            <label key={m.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={form.modifiers.includes(m.id)}
                                onChange={() => toggleModificateur(m.id)}
                              />
                              {m.libelle}
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Champ>
            )}

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
      )}

      <Table colonnes={[{ label: 'Plat' }, { label: 'Catégorie' }, { label: 'Prix' }, { label: 'Statut' }, { label: '', className: 'text-right' }]}>
        {plats.map((p) => (
          <Ligne key={p.id}>
            <td className="px-4 py-3 font-semibold text-gray-900">
              <div className="flex items-center gap-2.5">
                {p.image ? (
                  <img src={p.image} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-gray-200" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm">🍽️</span>
                )}
                {p.nom}
              </div>
            </td>
            <td className="px-4 py-3 text-gray-600">{categories.find((c) => c.id === p.categorie)?.nom ?? '—'}</td>
            <td className="px-4 py-3 text-gray-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatPrix(p.prix, 'XOF')}
            </td>
            <td className="px-4 py-3">
              <button onClick={() => toggleStatut(p)}>
                <Badge tone={p.statut === 'disponible' ? 'emerald' : 'red'}>
                  {p.statut === 'disponible' ? 'Disponible' : "Rupture (86'd)"}
                </Badge>
              </button>
              {!p.is_active && (
                // `is_active` (distinct de `statut`) n'a aucune bascule dans cet
                // écran — un plat ne devrait jamais l'avoir à `false` en usage
                // normal (cf. serializers.py). S'affiche uniquement si trouvé
                // ainsi en base (ex: anciennes données à corriger), pour ne pas
                // laisser croire "Disponible" alors qu'il reste invisible côté
                // client/Prendre commande.
                <span className="ml-1.5 inline-block">
                  <Badge tone="red">Masqué (is_active=false)</Badge>
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <BoutonLien tone="sky" className="mr-4" onClick={() => setForm(p)}>
                Modifier
              </BoutonLien>
              <BoutonLien tone="red" onClick={() => supprimerPlat(p)}>
                Supprimer
              </BoutonLien>
            </td>
          </Ligne>
        ))}
      </Table>
    </div>
  )
}

/** CRUD menu (§5.2) : catégories puis plats, dans cet ordre — un plat a besoin d'une catégorie existante. */
export default function GestionMenu() {
  const [categories, setCategories] = useState(null)
  const [plats, setPlats] = useState(null)
  const [stations, setStations] = useState(null)
  const [modificateurs, setModificateurs] = useState(null)
  const [categoriesModificateurs, setCategoriesModificateurs] = useState(null)
  const [erreur, setErreur] = useState('')

  function recharger() {
    Promise.all([
      lister('menu-categories'),
      lister('menu-items'),
      lister('stations'),
      lister('modifiers'),
      lister('modifier-categories'),
    ])
      .then(([cats, items, stas, mods, catsMods]) => {
        setCategories(cats)
        setPlats(items)
        setStations(stas)
        setModificateurs(mods)
        setCategoriesModificateurs(catsMods)
      })
      .catch((e) => setErreur(e.message))
  }

  useEffect(recharger, [])

  if (!categories || !plats || !stations || !modificateurs || !categoriesModificateurs) {
    return <p className="text-gray-400">Chargement...</p>
  }

  return (
    <div className="space-y-8">
      {erreur && <div className="rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-800">{erreur}</div>}
      <SectionCategories categories={categories} stations={stations} recharger={recharger} setErreur={setErreur} />
      <SectionPlats
        plats={plats}
        categories={categories}
        stations={stations}
        modificateurs={modificateurs}
        categoriesModificateurs={categoriesModificateurs}
        recharger={recharger}
        setErreur={setErreur}
      />
    </div>
  )
}
