import { useEffect, useState } from 'react'
import { fetchStats, fetchVentesParJour } from '../api'
import { formatPrix } from '../client/formatPrix'
import { LIBELLE_MODE_PAIEMENT } from '../print/imprimer'
import HorizontalBarChart from './charts/HorizontalBarChart'
import LineChartHeures from './charts/LineChartHeures'
import StatTile from './StatTile'

function dateDuJour() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const PRESETS = [
  { id: '24h', label: "Aujourd'hui", heures: 24 },
  { id: '7j', label: '7 derniers jours', heures: 7 * 24 },
  { id: '30j', label: '30 derniers jours', heures: 30 * 24 },
]

function periodePourPreset(heures) {
  const jusqu_a = new Date()
  const depuis = new Date(jusqu_a.getTime() - heures * 3600 * 1000)
  return { depuis: depuis.toISOString(), jusqu_a: jusqu_a.toISOString() }
}

function formatDuree(secondes) {
  if (secondes == null) return '—'
  const min = Math.round(secondes / 60)
  if (min < 1) return `${Math.round(secondes)} s`
  return `${min} min`
}

function ReportCard({ icone, titre, sousTitre, children }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-lg">{icone}</span>
        <h2 className="text-base font-semibold text-gray-900">{titre}</h2>
      </div>
      {sousTitre && <p className="mb-4 text-sm text-gray-500">{sousTitre}</p>}
      <div className={sousTitre ? '' : 'mt-4'}>{children}</div>
    </div>
  )
}

/**
 * Les 5 rapports de la Phase 6 backend (`stats_views.py`), jamais
 * consommés côté frontend jusqu'ici. `productivite-employes` peut
 * renvoyer 403 si le rôle serveur-side diverge du gate frontend :
 * affiché comme un état vide dédié plutôt qu'une erreur générale, pas de
 * raison de casser tout l'écran pour un seul rapport restreint.
 */
export default function RapportsTab() {
  const [presetId, setPresetId] = useState('24h')
  const [donnees, setDonnees] = useState(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState('')
  const [productiviteInterdite, setProductiviteInterdite] = useState(false)

  const [dateVentes, setDateVentes] = useState(dateDuJour)
  const [ventes, setVentes] = useState(null)
  const [chargementVentes, setChargementVentes] = useState(true)
  const [erreurVentes, setErreurVentes] = useState('')

  useEffect(() => {
    let annule = false
    setChargement(true)
    setErreur('')

    const preset = PRESETS.find((p) => p.id === presetId)
    const periode = periodePourPreset(preset.heures)

    Promise.allSettled([
      fetchStats('temps-preparation', periode),
      fetchStats('heures-pointe', periode),
      fetchStats('plats-plus-lents', periode),
      fetchStats('gaspillage', periode),
      fetchStats('productivite-employes', periode),
    ]).then(([tempsPoste, heuresPointe, platsLents, gaspillage, productivite]) => {
      if (annule) return

      if (tempsPoste.status === 'rejected' || heuresPointe.status === 'rejected' || platsLents.status === 'rejected' || gaspillage.status === 'rejected') {
        setErreur('Impossible de charger certains rapports. Merci de réessayer.')
      }

      setProductiviteInterdite(productivite.status === 'rejected' && productivite.reason?.status === 403)

      setDonnees({
        tempsPoste: tempsPoste.status === 'fulfilled' ? tempsPoste.value : [],
        heuresPointe: heuresPointe.status === 'fulfilled' ? heuresPointe.value : [],
        platsLents: platsLents.status === 'fulfilled' ? platsLents.value : [],
        gaspillage: gaspillage.status === 'fulfilled' ? gaspillage.value : [],
        productivite: productivite.status === 'fulfilled' ? productivite.value : [],
      })
      setChargement(false)
    })

    return () => {
      annule = true
    }
  }, [presetId])

  useEffect(() => {
    let annule = false
    setChargementVentes(true)
    setErreurVentes('')

    fetchVentesParJour(dateVentes)
      .then((data) => {
        if (annule) return
        setVentes(data)
        setChargementVentes(false)
      })
      .catch((e) => {
        if (annule) return
        setErreurVentes(e.status === 403 ? 'Accès réservé aux managers/admins.' : 'Impossible de charger les ventes.')
        setChargementVentes(false)
      })

    return () => {
      annule = true
    }
  }, [dateVentes])

  const totalCommandes = donnees?.heuresPointe.reduce((s, h) => s + h.nb_commandes, 0) ?? 0
  const totalGaspille = donnees?.gaspillage.reduce((s, g) => s + g.quantite_totale, 0) ?? 0
  const dureeGlobaleMoyenne =
    donnees && donnees.tempsPoste.length > 0
      ? donnees.tempsPoste.reduce((s, t) => s + t.duree_moyenne_secondes, 0) / donnees.tempsPoste.length
      : null

  return (
    <div>
      <div className="mb-6 inline-flex gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-gray-100">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPresetId(p.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              presetId === p.id ? 'bg-slate-900 text-white shadow' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {erreur && <div className="mb-6 rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-800">{erreur}</div>}

      <ReportCard icone="💰" titre="Ventes du jour" sousTitre="Chiffre d'affaires encaissé, par date de paiement">
        <div className="mb-4 flex items-center gap-3">
          <input
            type="date"
            value={dateVentes}
            onChange={(e) => setDateVentes(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none"
          />
          {chargementVentes && <span className="text-sm text-gray-400">Chargement...</span>}
        </div>

        {erreurVentes ? (
          <p className="py-4 text-center text-sm text-gray-400">{erreurVentes}</p>
        ) : !ventes ? null : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-2">
              <StatTile label="Total encaissé" value={formatPrix(ventes.total_ventes, 'XOF')} icone="💵" accent="amber" />
              <StatTile label="Commandes payées" value={ventes.nb_commandes} icone="🧾" accent="slate" />
            </div>

            {ventes.commandes.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">Aucune vente encaissée à cette date.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 font-medium">Heure</th>
                    <th className="pb-2 font-medium">Table</th>
                    <th className="pb-2 font-medium">Serveur</th>
                    <th className="pb-2 font-medium">Paiement</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ventes.commandes.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2 text-gray-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(c.heure_paiement).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2 text-gray-900">{c.table_numero ?? '—'}</td>
                      <td className="py-2 text-gray-600">{c.serveur_nom ?? '—'}</td>
                      <td className="py-2 text-gray-600">{LIBELLE_MODE_PAIEMENT[c.mode_paiement] ?? c.mode_paiement}</td>
                      <td className="py-2 text-right font-semibold text-gray-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatPrix(c.total, 'XOF')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportCard>

      {chargement ? (
        <p className="text-gray-400">Chargement des rapports...</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label="Commandes sur la période" value={totalCommandes} icone="🧾" accent="amber" />
            <StatTile label="Temps de préparation moyen (tous postes)" value={formatDuree(dureeGlobaleMoyenne)} icone="⏱️" accent="slate" />
            <StatTile label="Plats annulés (gaspillage)" value={totalGaspille} icone="🗑️" accent="red" />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ReportCard icone="⏱️" titre="Temps de préparation par poste" sousTitre="Durée moyenne entre l'envoi au poste et « prêt »">
              <HorizontalBarChart
                data={donnees.tempsPoste.map((t) => ({ label: t.station_nom, value: t.duree_moyenne_secondes }))}
                formatValue={formatDuree}
              />
            </ReportCard>

            <ReportCard icone="📈" titre="Heures de pointe" sousTitre="Nombre de commandes par heure de la journée">
              <LineChartHeures data={donnees.heuresPointe} />
            </ReportCard>

            <ReportCard icone="🐢" titre="Plats les plus lents" sousTitre="Durée moyenne de préparation (approximation par ticket, cf. README)">
              <HorizontalBarChart
                data={donnees.platsLents
                  .slice(0, 8)
                  .map((p) => ({ label: p.plat_nom, value: p.duree_moyenne_secondes }))}
                formatValue={formatDuree}
              />
            </ReportCard>

            <ReportCard icone="🗑️" titre="Gaspillage" sousTitre="Lignes annulées, groupées par plat et motif">
              {donnees.gaspillage.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">Aucune annulation sur cette période.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="pb-2 font-medium">Plat</th>
                      <th className="pb-2 font-medium">Motif</th>
                      <th className="pb-2 text-right font-medium">Qté</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.gaspillage.map((g, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-2 text-gray-900">{g.plat__nom}</td>
                        <td className="py-2 text-gray-600">{g.motif_annulation || '—'}</td>
                        <td className="py-2 text-right font-semibold text-gray-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {g.quantite_totale}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ReportCard>

            <ReportCard icone="🏆" titre="Productivité employés" sousTitre="Durée moyenne de préparation par employé — réservé managers/admins">
              {productiviteInterdite ? (
                <p className="py-4 text-center text-sm text-gray-400">Accès réservé aux managers/admins.</p>
              ) : donnees.productivite.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">Aucune donnée sur cette période.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="pb-2 font-medium">Employé</th>
                      <th className="pb-2 text-right font-medium">Tickets</th>
                      <th className="pb-2 text-right font-medium">Durée moyenne</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.productivite.map((p) => (
                      <tr key={p.utilisateur} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-2 text-gray-900">{p.utilisateur_nom}</td>
                        <td className="py-2 text-right text-gray-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {p.nb_tickets}
                        </td>
                        <td className="py-2 text-right font-semibold text-gray-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatDuree(p.duree_moyenne_secondes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ReportCard>
          </div>
        </div>
      )}
    </div>
  )
}
