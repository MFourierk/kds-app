import { useEffect, useState } from 'react'
import ClavierNumerique from '../ClavierNumerique'
import { creer, lister, modifier, supprimer } from './apiAdmin'
import { formatPrix } from '../client/formatPrix'
import { Badge, BoutonLien, BoutonPrimaire, BoutonSecondaire, Carte, Champ, classeInput, Ligne, Table } from './ui'

const CATEGORIE_VIDE = { nom: '', obligatoire: false, selection_multiple: false, ordre_affichage: 0 }
const MODIFICATEUR_VIDE = { libelle: '', categorie: '', type_modifier: 'preference', niveau_alerte_critique: false, prix_supplement: '0' }

const LIBELLE_TYPE = { allergie: 'Allergie', preference: 'Préférence', supplement: 'Supplément' }

function SectionCategories({ categories, recharger, setErreur }) {
  const [form, setForm] = useState(null)
  const [enCours, setEnCours] = useState(false)

  async function enregistrer(event) {
    event.preventDefault()
    setEnCours(true)
    setErreur('')
    try {
      const payload = {
        nom: form.nom,
        obligatoire: form.obligatoire,
        selection_multiple: form.selection_multiple,
        ordre_affichage: Number(form.ordre_affichage) || 0,
      }
      if (form.id) await modifier('modifier-categories', form.id, payload)
      else await creer('modifier-categories', payload)
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
      await supprimer('modifier-categories', cat.id)
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-sm">🗂️</span>
          Catégories de modificateurs
        </h2>
        {!form && (
          <BoutonLien tone="amber" onClick={() => setForm(CATEGORIE_VIDE)}>
            + Ajouter une catégorie
          </BoutonLien>
        )}
      </div>

      {form && (
        <Carte>
          <form onSubmit={enregistrer} className="flex flex-wrap items-end gap-4">
            <Champ label="Nom" className="flex-1">
              <input
                required
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                className={classeInput}
              />
            </Champ>
            <Champ label="Ordre" className="w-20">
              <input
                type="number"
                value={form.ordre_affichage}
                onChange={(e) => setForm({ ...form, ordre_affichage: e.target.value })}
                className={classeInput}
              />
            </Champ>
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.obligatoire}
                onChange={(e) => setForm({ ...form, obligatoire: e.target.checked })}
              />
              Choix obligatoire
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.selection_multiple}
                onChange={(e) => setForm({ ...form, selection_multiple: e.target.checked })}
              />
              Choix multiples
            </label>
            <BoutonPrimaire type="submit" disabled={enCours}>
              Enregistrer
            </BoutonPrimaire>
            <BoutonSecondaire type="button" onClick={() => setForm(null)}>
              Annuler
            </BoutonSecondaire>
          </form>
        </Carte>
      )}

      <Table colonnes={[{ label: 'Nom' }, { label: 'Obligatoire' }, { label: 'Choix multiples' }, { label: 'Ordre' }, { label: '', className: 'text-right' }]}>
        {categories.map((c) => (
          <Ligne key={c.id}>
            <td className="px-4 py-3 font-semibold text-gray-900">{c.nom}</td>
            <td className="px-4 py-3">
              <Badge tone={c.obligatoire ? 'red' : 'gray'}>{c.obligatoire ? 'Oui' : 'Non'}</Badge>
            </td>
            <td className="px-4 py-3 text-gray-600">{c.selection_multiple ? 'Oui' : 'Non'}</td>
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

function SectionModificateurs({ modificateurs, categories, recharger, setErreur }) {
  const [form, setForm] = useState(null)
  const [enCours, setEnCours] = useState(false)

  async function enregistrer(event) {
    event.preventDefault()
    setEnCours(true)
    setErreur('')
    try {
      const payload = {
        libelle: form.libelle,
        categorie: form.categorie || null,
        type_modifier: form.type_modifier,
        niveau_alerte_critique: form.niveau_alerte_critique,
        prix_supplement: form.prix_supplement,
      }
      if (form.id) await modifier('modifiers', form.id, payload)
      else await creer('modifiers', payload)
      setForm(null)
      recharger()
    } catch (e) {
      setErreur(e.message)
    } finally {
      setEnCours(false)
    }
  }

  async function supprimerModificateur(m) {
    setErreur('')
    try {
      await supprimer('modifiers', m.id)
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-sm">⚙️</span>
          Modificateurs
        </h2>
        {!form && (
          <BoutonLien tone="amber" onClick={() => setForm(MODIFICATEUR_VIDE)}>
            + Ajouter un modificateur
          </BoutonLien>
        )}
      </div>

      {form && (
        <Carte>
          <form onSubmit={enregistrer} className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <Champ label="Libellé" className="flex-1">
                <input
                  required
                  value={form.libelle}
                  onChange={(e) => setForm({ ...form, libelle: e.target.value })}
                  className={classeInput}
                />
              </Champ>
              <Champ label="Catégorie">
                <select
                  value={form.categorie}
                  onChange={(e) => setForm({ ...form, categorie: e.target.value })}
                  className={classeInput}
                >
                  <option value="">— aucune —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </select>
              </Champ>
              <Champ label="Type">
                <select
                  value={form.type_modifier}
                  onChange={(e) => setForm({ ...form, type_modifier: e.target.value })}
                  className={classeInput}
                >
                  {Object.entries(LIBELLE_TYPE).map(([valeur, label]) => (
                    <option key={valeur} value={valeur}>
                      {label}
                    </option>
                  ))}
                </select>
              </Champ>
            </div>
            <div className="flex flex-wrap items-start gap-4">
              <Champ label="Prix supplément (XOF)" className="w-40">
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.prix_supplement}
                  onChange={(e) => setForm({ ...form, prix_supplement: e.target.value })}
                  className={classeInput}
                />
                <div className="mt-1.5">
                  <ClavierNumerique
                    valeur={form.prix_supplement}
                    onChange={(v) => setForm({ ...form, prix_supplement: v })}
                    autoriserDecimales
                    sombre={false}
                  />
                </div>
              </Champ>
              <label className="flex items-center gap-2 pt-6 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.niveau_alerte_critique}
                  onChange={(e) => setForm({ ...form, niveau_alerte_critique: e.target.checked })}
                />
                Alerte critique (ticket cuisine)
              </label>
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
      )}

      <Table colonnes={[{ label: 'Libellé' }, { label: 'Catégorie' }, { label: 'Type' }, { label: 'Supplément' }, { label: '', className: 'text-right' }]}>
        {modificateurs.map((m) => (
          <Ligne key={m.id}>
            <td className="px-4 py-3 font-semibold text-gray-900">{m.libelle}</td>
            <td className="px-4 py-3 text-gray-600">{m.categorie_nom ?? '—'}</td>
            <td className="px-4 py-3 text-gray-600">
              {LIBELLE_TYPE[m.type_modifier] ?? m.type_modifier}
              {m.niveau_alerte_critique && (
                <span className="ml-1.5 inline-block">
                  <Badge tone="red">⚠ critique</Badge>
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-gray-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Number(m.prix_supplement) > 0 ? formatPrix(m.prix_supplement, 'XOF') : '—'}
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <BoutonLien tone="sky" className="mr-4" onClick={() => setForm({ ...m, categorie: m.categorie ?? '' })}>
                Modifier
              </BoutonLien>
              <BoutonLien tone="red" onClick={() => supprimerModificateur(m)}>
                Supprimer
              </BoutonLien>
            </td>
          </Ligne>
        ))}
      </Table>
    </div>
  )
}

/**
 * CRUD des modificateurs et de leurs catégories (§5.2, demandé après
 * coup — structurer "Cuisson", "Sauce & Garniture"... au lieu d'une
 * liste plate, avec des catégories pouvant être rendues obligatoires à
 * la commande, cf. `SelecteurModificateurs.jsx`). `ModifierViewSet`
 * existait déjà côté backend mais n'était exposé sur aucun écran — comme
 * `GestionTables.jsx` en son temps pour les tables.
 */
export default function GestionModificateurs() {
  const [categories, setCategories] = useState(null)
  const [modificateurs, setModificateurs] = useState(null)
  const [erreur, setErreur] = useState('')

  function recharger() {
    Promise.all([lister('modifier-categories'), lister('modifiers')])
      .then(([cats, mods]) => {
        setCategories(cats)
        setModificateurs(mods)
      })
      .catch((e) => setErreur(e.message))
  }

  useEffect(recharger, [])

  if (!categories || !modificateurs) return <p className="text-gray-400">Chargement...</p>

  return (
    <div className="space-y-8">
      {erreur && <div className="rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-800">{erreur}</div>}
      <SectionCategories categories={categories} recharger={recharger} setErreur={setErreur} />
      <SectionModificateurs modificateurs={modificateurs} categories={categories} recharger={recharger} setErreur={setErreur} />
    </div>
  )
}
