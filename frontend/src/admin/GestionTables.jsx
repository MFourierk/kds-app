import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { creer, lister, modifier, supprimer } from './apiAdmin'
import { apiFetch } from '../api'
import { echapper, ouvrirApercuImpression } from '../print/imprimer'
import { Badge, BoutonLien, BoutonPrimaire, BoutonSecondaire, Carte, Champ, classeInput, Ligne, Table } from './ui'

const RESSOURCE = 'tables'

const FORM_VIDE = { numero: '' }

const LIBELLE_STATUT = {
  libre: { texte: 'Libre', tone: 'emerald' },
  occupee: { texte: 'Occupée', tone: 'amber' },
  appel_serveur: { texte: 'Appel serveur', tone: 'red' },
}

/**
 * CRUD tables (§5.6, manquant jusqu'ici — seul moyen de créer une table
 * était `seed_demo`/`/admin/` Django, aucun écran de gestion normal).
 * Sans ça, une installation cliente fraîche (`setup_tenant`, §installer)
 * n'a aucune table, ce qui bloque à la fois "Prendre commande" (grille de
 * tables vide, sans message) et la génération des QR codes clients.
 *
 * QR code généré entièrement côté navigateur (`qrcode`, aucun appel
 * réseau externe — cohérent avec le reste du projet pensé pour
 * fonctionner hors ligne) à partir de `qr_code_token` (déjà présent sur
 * chaque table, généré par le backend) : `${origine}/t/<token>/`, la même
 * origine que la page actuelle, pas une URL codée en dur — fonctionne
 * aussi bien sur le VPS que sur une installation cliente locale.
 */
export default function GestionTables() {
  const [tables, setTables] = useState(null)
  const [erreur, setErreur] = useState('')
  const [form, setForm] = useState(null) // null = fermé ; { id?, numero }
  const [enCours, setEnCours] = useState(false)
  const [qrOuvert, setQrOuvert] = useState(null) // table ou null
  const [qrDataUrl, setQrDataUrl] = useState('')

  function recharger() {
    lister(RESSOURCE)
      .then(setTables)
      .catch((e) => setErreur(e.message))
  }

  useEffect(recharger, [])

  useEffect(() => {
    if (!qrOuvert) {
      setQrDataUrl('')
      return
    }
    const url = `${window.location.origin}/t/${qrOuvert.qr_code_token}/`
    QRCode.toDataURL(url, { width: 320, margin: 2 }).then(setQrDataUrl)
  }, [qrOuvert])

  async function enregistrer(event) {
    event.preventDefault()
    setEnCours(true)
    setErreur('')
    try {
      const payload = { numero: form.numero }
      if (form.id) await modifier(RESSOURCE, form.id, payload)
      else await creer(RESSOURCE, payload)
      setForm(null)
      recharger()
    } catch (e) {
      setErreur(e.message)
    } finally {
      setEnCours(false)
    }
  }

  async function liberer(table) {
    setErreur('')
    try {
      await apiFetch(`/api/tables/${table.id}/liberer/`, { method: 'POST' })
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  function imprimerQr() {
    // Réutilise l'aperçu HTML ticket déjà en place (§5.5) — même dialogue
    // d'impression natif (n'importe quelle imprimante installée sur le
    // poste), pas de nouveau mécanisme à construire pour un simple QR code.
    const corpsHtml = `
      <div class="centre gras titre">Table ${echapper(qrOuvert.numero)}</div>
      <div class="centre" style="margin-top:12px;">
        <img src="${qrDataUrl}" alt="" style="width:200px;height:200px;" />
      </div>
      <div class="centre petit" style="margin-top:8px;">Scannez pour voir le menu et commander</div>
    `
    ouvrirApercuImpression(`QR code — Table ${qrOuvert.numero}`, corpsHtml)
  }

  async function supprimerTable(table) {
    setErreur('')
    try {
      await supprimer(RESSOURCE, table.id)
      recharger()
    } catch (e) {
      setErreur(e.message)
    }
  }

  if (!tables) return <p className="text-gray-400">Chargement...</p>

  return (
    <div className="space-y-4">
      {erreur && <div className="rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-800">{erreur}</div>}

      {form ? (
        <Carte>
          <form onSubmit={enregistrer} className="space-y-4">
            <Champ label="Numéro de table" className="w-48">
              <input
                required
                value={form.numero}
                onChange={(e) => setForm({ ...form, numero: e.target.value })}
                className={classeInput}
              />
            </Champ>
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
        <BoutonPrimaire onClick={() => setForm(FORM_VIDE)}>+ Ajouter une table</BoutonPrimaire>
      )}

      {qrOuvert && (
        <Carte>
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm font-semibold text-gray-700">QR code — Table {qrOuvert.numero}</p>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={`QR code table ${qrOuvert.numero}`} className="h-64 w-64" />
            ) : (
              <p className="text-gray-400">Génération...</p>
            )}
            <div className="flex gap-2">
              {qrDataUrl && (
                <>
                  <a
                    href={qrDataUrl}
                    download={`qr-table-${qrOuvert.numero}.png`}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
                  >
                    Télécharger
                  </a>
                  <BoutonPrimaire type="button" onClick={imprimerQr}>
                    🖨️ Imprimer
                  </BoutonPrimaire>
                </>
              )}
              <BoutonSecondaire type="button" onClick={() => setQrOuvert(null)}>
                Fermer
              </BoutonSecondaire>
            </div>
          </div>
        </Carte>
      )}

      <Table colonnes={[{ label: 'Numéro' }, { label: 'Statut' }, { label: '', className: 'text-right' }]}>
        {tables.map((t) => {
          const statut = LIBELLE_STATUT[t.statut] ?? { texte: t.statut, tone: 'gray' }
          return (
            <Ligne key={t.id}>
              <td className="px-4 py-3 font-semibold text-gray-900">Table {t.numero}</td>
              <td className="px-4 py-3">
                <Badge tone={statut.tone}>{statut.texte}</Badge>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <BoutonLien tone="sky" className="mr-4" onClick={() => setQrOuvert(t)}>
                  QR code
                </BoutonLien>
                <BoutonLien tone="sky" className="mr-4" onClick={() => setForm(t)}>
                  Modifier
                </BoutonLien>
                {t.statut !== 'libre' && (
                  <BoutonLien tone="gray" className="mr-4" onClick={() => liberer(t)}>
                    Libérer
                  </BoutonLien>
                )}
                <BoutonLien tone="red" onClick={() => supprimerTable(t)}>
                  Supprimer
                </BoutonLien>
              </td>
            </Ligne>
          )
        })}
      </Table>
    </div>
  )
}
