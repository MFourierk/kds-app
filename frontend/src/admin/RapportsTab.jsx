import { useEffect, useState } from 'react'
import { fetchCommandesAnnulees, fetchStats, fetchTenant, fetchVentesParJour } from '../api'
import { formatPrix } from '../client/formatPrix'
import {
  construireCarteInfo,
  construireSignaturesRapport,
  construireTitreRapport,
  echapper,
  ouvrirRapportImpression,
} from '../print/imprimer'
import HorizontalBarChart from './charts/HorizontalBarChart'
import LineChartHeures from './charts/LineChartHeures'
import StatTile from './StatTile'
import { Badge } from './ui'

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

// Deux dates calendaires (inputs `type="date"`, ex: "du 1er au 15 juillet")
// converties en bornes ISO datetime — même format que `periodePourPreset`
// ci-dessus, `jusqu_a` couvrant toute la journée de fin (23:59:59) pour ne
// pas exclure les ventes du dernier jour de la période.
function periodePourDates(depuisStr, jusquaStr) {
  const depuis = new Date(`${depuisStr}T00:00:00`)
  const jusqu_a = new Date(`${jusquaStr}T23:59:59.999`)
  return { depuis: depuis.toISOString(), jusqu_a: jusqu_a.toISOString() }
}

function formatDuree(secondes) {
  if (secondes == null) return '—'
  const min = Math.round(secondes / 60)
  if (min < 1) return `${Math.round(secondes)} s`
  return `${min} min`
}

// `titre` optionnel : la carte "Ventes du jour" porte désormais son titre
// via `SectionEyebrow` au-dessus (cf. plus bas) plutôt qu'un doublon ici.
function ReportCard({ icone, titre, sousTitre, children }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      {titre && (
        <div className="mb-1 flex items-center gap-2">
          <span className="text-lg">{icone}</span>
          <h2 className="text-base font-semibold text-gray-900">{titre}</h2>
        </div>
      )}
      {sousTitre && <p className="mb-4 text-sm text-gray-500">{sousTitre}</p>}
      <div className={sousTitre || !titre ? '' : 'mt-4'}>{children}</div>
    </div>
  )
}

// Deux rapports de nature différente (CA du jour vs performance cuisine sur
// une période) cohabitaient sans séparation visuelle ni titre de section —
// "touffu" (retour utilisateur après usage réel) : donne à chacun son
// propre en-tête, sur le modèle des sections déjà utilisées ailleurs dans
// l'app plutôt qu'un nouveau pattern.
function SectionEyebrow({ icone, titre, sousTitre }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm text-white">{icone}</span>
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">{titre}</h2>
        {sousTitre && <p className="text-xs text-gray-500">{sousTitre}</p>}
      </div>
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

  // Période plutôt qu'une date fixe (demandé après coup — un gérant édite
  // aussi ce rapport sur une semaine/un mois, pas uniquement jour par
  // jour) ; les deux bornes démarrent sur aujourd'hui pour garder le même
  // comportement par défaut qu'avant ce changement.
  const [depuisVentes, setDepuisVentes] = useState(dateDuJour)
  const [jusquaVentes, setJusquaVentes] = useState(dateDuJour)
  const [ventes, setVentes] = useState(null)
  const [chargementVentes, setChargementVentes] = useState(true)
  const [erreurVentes, setErreurVentes] = useState('')
  const [tenant, setTenant] = useState(null)
  // Les 3 tableaux (commandes / par article / par catégorie) sont
  // regroupés en un seul tableau "Mouvements" (une ligne par article
  // vendu, demandé après coup sur le modèle d'un autre outil de gestion)
  // filtrable au lieu de rester tous dépliés en permanence.
  const [rechercheMouvement, setRechercheMouvement] = useState('')
  const [secteurFiltre, setSecteurFiltre] = useState('tous')
  const [categorieFiltre, setCategorieFiltre] = useState('toutes')
  const [utilisateurFiltre, setUtilisateurFiltre] = useState('tous')

  // "Commandes annulées" (§5.1, demandé après coup — la procédure
  // d'annulation elle-même n'existait sur aucun écran) : même période que
  // "Chiffre d'affaires" ci-dessus, un gérant regarde les deux ensemble.
  const [annulees, setAnnulees] = useState(null)
  const [chargementAnnulees, setChargementAnnulees] = useState(true)
  const [erreurAnnulees, setErreurAnnulees] = useState('')

  // Best-effort (même logique que `GestionTables.jsx`/`AdminDashboard.jsx`) :
  // sert uniquement à porter le logo/couleurs de marque sur le rapport
  // imprimé — jamais bloquant si la requête échoue.
  useEffect(() => {
    fetchTenant().then(setTenant).catch(() => {})
  }, [])

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

    fetchVentesParJour(periodePourDates(depuisVentes, jusquaVentes))
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
  }, [depuisVentes, jusquaVentes])

  useEffect(() => {
    let annule = false
    setChargementAnnulees(true)
    setErreurAnnulees('')

    fetchCommandesAnnulees(periodePourDates(depuisVentes, jusquaVentes))
      .then((data) => {
        if (annule) return
        setAnnulees(data)
        setChargementAnnulees(false)
      })
      .catch((e) => {
        if (annule) return
        setErreurAnnulees(e.status === 403 ? 'Accès réservé aux managers/admins.' : 'Impossible de charger les commandes annulées.')
        setChargementAnnulees(false)
      })

    return () => {
      annule = true
    }
  }, [depuisVentes, jusquaVentes])

  function imprimerVentes() {
    if (!ventes) return

    // Ni coût ni marge (pas de prix d'achat suivi dans l'app, cf. demande
    // explicite : "juste comme une calculatrice" — le CA encaissé par
    // article/catégorie/secteur, sans notion de rentabilité) : contrairement
    // au modèle de référence (rapport de marges), les seuls chiffres
    // fiables ici sont ceux déjà affichés à l'écran.
    const formatDate = (iso) => new Date(iso).toLocaleDateString('fr-FR')
    const periodeLisible =
      depuisVentes === jusquaVentes
        ? new Date(ventes.depuis).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : `Du ${formatDate(ventes.depuis)} au ${formatDate(ventes.jusqu_a)}`
    const panierMoyen = ventes.nb_commandes > 0 ? ventes.total_ventes / ventes.nb_commandes : 0
    const maintenant = new Date()

    const ligneArticle = (a) =>
      `<tr><td>${echapper(a.plat_nom)}</td><td>${echapper(a.categorie_nom ?? '—')}</td><td>${a.quantite_totale}</td><td>${formatPrix(a.montant_total, 'XOF')}</td></tr>`
    const ligneCategorie = (c) =>
      `<tr><td>${echapper(c.categorie_nom ?? '—')}</td><td>${c.quantite_totale}</td><td>${formatPrix(c.montant_total, 'XOF')}</td></tr>`
    const ligneSecteur = (s) =>
      `<tr><td>${echapper(s.secteur_libelle)}</td><td>${s.nb_commandes}</td><td>${formatPrix(s.montant_total, 'XOF')}</td></tr>`

    const corpsHtml = `
      ${construireTitreRapport('État des ventes', periodeLisible, `${ventes.par_categorie.length} catégorie${ventes.par_categorie.length > 1 ? 's' : ''}`)}

      <div class="cartes-info">
        ${construireCarteInfo('Informations du rapport', [
          { label: "Date d'édition", valeur: echapper(maintenant.toLocaleDateString('fr-FR')) },
          { label: 'Heure', valeur: echapper(maintenant.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })) },
          { label: 'Période', valeur: echapper(`${formatDate(ventes.depuis)} – ${formatDate(ventes.jusqu_a)}`) },
        ])}
        ${construireCarteInfo('Synthèse globale', [
          { label: 'CA total', valeur: formatPrix(ventes.total_ventes, 'XOF'), accent: true },
          { label: 'Commandes payées', valeur: ventes.nb_commandes },
          { label: 'Panier moyen', valeur: formatPrix(panierMoyen, 'XOF') },
        ])}
      </div>

      <h2 class="section-rapport">Détail par secteur</h2>
      ${
        ventes.par_secteur.length === 0
          ? '<p class="sous-titre-rapport">Aucune vente sur cette période.</p>'
          : `<table class="table-rapport">
              <thead><tr><th>Secteur</th><th>Commandes</th><th>CA</th></tr></thead>
              <tbody>${ventes.par_secteur.map(ligneSecteur).join('')}</tbody>
            </table>`
      }

      <h2 class="section-rapport">Détail par catégorie</h2>
      ${
        ventes.par_categorie.length === 0
          ? '<p class="sous-titre-rapport">Aucune vente sur cette période.</p>'
          : `<table class="table-rapport">
              <thead><tr><th>Catégorie</th><th>Qté</th><th>CA</th></tr></thead>
              <tbody>
                ${ventes.par_categorie.map(ligneCategorie).join('')}
                <tr class="ligne-total"><td>Total général</td><td>${ventes.par_categorie.reduce((s, c) => s + c.quantite_totale, 0)}</td><td>${formatPrix(ventes.total_ventes, 'XOF')}</td></tr>
              </tbody>
            </table>`
      }

      <h2 class="section-rapport">Détail par article</h2>
      ${
        ventes.par_article.length === 0
          ? '<p class="sous-titre-rapport">Aucune vente sur cette période.</p>'
          : `<table class="table-rapport">
              <thead><tr><th>Article</th><th>Catégorie</th><th>Qté</th><th>CA</th></tr></thead>
              <tbody>${ventes.par_article.map(ligneArticle).join('')}</tbody>
            </table>`
      }

      <div class="legende-rapport">
        CA : chiffre d'affaires encaissé (commandes payées uniquement). Qté : quantité totale vendue sur la
        période. Panier moyen = CA total / nombre de commandes. Aucun coût ni marge : l'application ne suit pas
        de prix d'achat, ce rapport reflète uniquement les ventes.
      </div>

      ${construireSignaturesRapport('Manager / Responsable', 'Caissier·ère')}
    `
    ouvrirRapportImpression(`État des ventes — ${formatDate(ventes.depuis)} au ${formatDate(ventes.jusqu_a)}`, corpsHtml, {
      tenant,
      piedDroite: `État des ventes — ${formatDate(ventes.depuis)} au ${formatDate(ventes.jusqu_a)}`,
    })
  }

  const totalCommandes = donnees?.heuresPointe.reduce((s, h) => s + h.nb_commandes, 0) ?? 0
  const totalGaspille = donnees?.gaspillage.reduce((s, g) => s + g.quantite_totale, 0) ?? 0
  const dureeGlobaleMoyenne =
    donnees && donnees.tempsPoste.length > 0
      ? donnees.tempsPoste.reduce((s, t) => s + t.duree_moyenne_secondes, 0) / donnees.tempsPoste.length
      : null

  // "Mouvements" (une ligne par article vendu) filtrable côté client — le
  // jeu de données d'une période reste petit (un restaurant, pas des
  // milliers de lignes), pas besoin d'un filtrage serveur dédié.
  const categoriesMouvements = ventes
    ? [...new Set(ventes.mouvements.map((m) => m.categorie_nom).filter(Boolean))].sort()
    : []
  const utilisateursMouvements = ventes
    ? [...new Map(ventes.mouvements.filter((m) => m.utilisateur).map((m) => [m.utilisateur, m.utilisateur_nom])).entries()].sort(
        (a, b) => a[1].localeCompare(b[1])
      )
    : []
  const mouvementsFiltres = ventes
    ? ventes.mouvements.filter((m) => {
        if (secteurFiltre !== 'tous' && m.secteur !== secteurFiltre) return false
        if (categorieFiltre !== 'toutes' && m.categorie_nom !== categorieFiltre) return false
        if (utilisateurFiltre !== 'tous' && String(m.utilisateur) !== utilisateurFiltre) return false
        if (rechercheMouvement && !m.plat_nom.toLowerCase().includes(rechercheMouvement.toLowerCase())) return false
        return true
      })
    : []

  return (
    <div className="space-y-10">
      {erreur && <div className="rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-800">{erreur}</div>}

      <section>
        <SectionEyebrow icone="💰" titre="Chiffre d'affaires" sousTitre="Ventes encaissées, par période de paiement" />
        <ReportCard>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-500">
              Du
              <input
                type="date"
                value={depuisVentes}
                max={jusquaVentes}
                onChange={(e) => setDepuisVentes(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-500">
              au
              <input
                type="date"
                value={jusquaVentes}
                min={depuisVentes}
                onChange={(e) => setJusquaVentes(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none"
              />
            </label>
            {chargementVentes && <span className="text-sm text-gray-400">Chargement...</span>}
            {ventes && (
              <button
                onClick={imprimerVentes}
                className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                🖨️ Imprimer
              </button>
            )}
          </div>

          {erreurVentes ? (
            <p className="py-4 text-center text-sm text-gray-400">{erreurVentes}</p>
          ) : !ventes ? null : (
            <>
              <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-2">
                <StatTile label="Total encaissé" value={formatPrix(ventes.total_ventes, 'XOF')} icone="💵" accent="amber" />
                <StatTile label="Commandes payées" value={ventes.nb_commandes} icone="🧾" accent="slate" />
              </div>

              {ventes.par_secteur.length > 0 && (
                <div className="mb-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">CA par secteur</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {ventes.par_secteur.map((s) => (
                      <div key={s.secteur} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-gray-100">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{s.secteur_libelle}</p>
                          <p className="text-xs text-gray-500">{s.nb_commandes} commande{s.nb_commandes > 1 ? 's' : ''}</p>
                        </div>
                        <p className="text-lg font-bold text-gray-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatPrix(s.montant_total, 'XOF')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Mouvements</h3>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={rechercheMouvement}
                  onChange={(e) => setRechercheMouvement(e.target.value)}
                  placeholder="Rechercher un article..."
                  className="min-w-[180px] flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none"
                />
                <select
                  value={secteurFiltre}
                  onChange={(e) => setSecteurFiltre(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none"
                >
                  <option value="tous">Tous les secteurs</option>
                  {ventes.par_secteur.map((s) => (
                    <option key={s.secteur} value={s.secteur}>
                      {s.secteur_libelle}
                    </option>
                  ))}
                </select>
                {categoriesMouvements.length > 0 && (
                  <select
                    value={categorieFiltre}
                    onChange={(e) => setCategorieFiltre(e.target.value)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none"
                  >
                    <option value="toutes">Toutes catégories</option>
                    {categoriesMouvements.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
                {utilisateursMouvements.length > 0 && (
                  <select
                    value={utilisateurFiltre}
                    onChange={(e) => setUtilisateurFiltre(e.target.value)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none"
                  >
                    <option value="tous">Tous les utilisateurs</option>
                    {utilisateursMouvements.map(([id, nom]) => (
                      <option key={id} value={id}>
                        {nom}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {mouvementsFiltres.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">
                  {ventes.mouvements.length === 0 ? 'Aucune vente sur cette période.' : 'Aucun mouvement ne correspond aux filtres.'}
                </p>
              ) : (
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="sticky top-0 border-b bg-white text-left text-gray-500">
                        <th className="pb-2 pr-3 font-medium">Secteur</th>
                        <th className="pb-2 pr-3 font-medium">Article</th>
                        <th className="pb-2 pr-3 font-medium">Catégorie</th>
                        <th className="pb-2 pr-3 text-right font-medium">Qté</th>
                        <th className="pb-2 pr-4 text-right font-medium">Montant</th>
                        <th className="pb-2 pr-3 font-medium">Date &amp; heure</th>
                        <th className="pb-2 font-medium">Utilisateur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mouvementsFiltres.map((m) => (
                        <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2 pr-3">
                            <Badge tone={m.secteur === 'salle' ? 'emerald' : 'amber'}>{m.secteur_libelle}</Badge>
                          </td>
                          <td className="py-2 pr-3 text-gray-900">{m.plat_nom}</td>
                          <td className="py-2 pr-3 text-gray-600">{m.categorie_nom ?? '—'}</td>
                          <td className="py-2 pr-3 text-right text-gray-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {m.quantite}
                          </td>
                          <td className="py-2 pr-4 text-right font-semibold text-gray-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatPrix(m.montant, 'XOF')}
                          </td>
                          <td className="py-2 pr-3 text-gray-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {new Date(m.heure_paiement).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-2 text-gray-500">{m.utilisateur_nom ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </ReportCard>
      </section>

      <section>
        <SectionEyebrow icone="🚫" titre="Commandes annulées" sousTitre="Même période que le chiffre d'affaires ci-dessus" />
        <ReportCard>
          {chargementAnnulees ? (
            <p className="text-sm text-gray-400">Chargement...</p>
          ) : erreurAnnulees ? (
            <p className="py-4 text-center text-sm text-gray-400">{erreurAnnulees}</p>
          ) : !annulees ? null : (
            <>
              <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-2">
                <StatTile label="Commandes annulées" value={annulees.nb_commandes_annulees} icone="🚫" accent="red" />
                <StatTile label="Montant perdu" value={formatPrix(annulees.montant_total_perdu, 'XOF')} icone="💸" accent="slate" />
              </div>

              {annulees.commandes.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">Aucune commande annulée sur cette période.</p>
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="sticky top-0 border-b bg-white text-left text-gray-500">
                        <th className="pb-2 pr-3 font-medium">Secteur</th>
                        <th className="pb-2 pr-3 font-medium">Table</th>
                        <th className="pb-2 pr-3 font-medium">Motif</th>
                        <th className="pb-2 pr-3 text-right font-medium">Perte</th>
                        <th className="pb-2 pr-3 font-medium">Annulée par</th>
                        <th className="pb-2 font-medium">Date &amp; heure</th>
                      </tr>
                    </thead>
                    <tbody>
                      {annulees.commandes.map((c) => (
                        <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2 pr-3">
                            <Badge tone={c.secteur === 'salle' ? 'emerald' : 'amber'}>{c.secteur_libelle}</Badge>
                          </td>
                          <td className="py-2 pr-3 text-gray-900">{c.table_numero ?? '—'}</td>
                          <td className="py-2 pr-3 text-gray-600">{c.motif || '—'}</td>
                          <td className="py-2 pr-3 text-right font-semibold text-red-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatPrix(c.montant_perdu, 'XOF')}
                          </td>
                          <td className="py-2 pr-3 text-gray-500">{c.annule_par_nom ?? '—'}</td>
                          <td className="py-2 text-gray-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {new Date(c.heure_annulation).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </ReportCard>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionEyebrow icone="📊" titre="Performance opérationnelle" sousTitre="Temps de service côté cuisine, sur une période" />
          <div className="inline-flex gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-gray-100">
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
        </div>

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
      </section>
    </div>
  )
}
