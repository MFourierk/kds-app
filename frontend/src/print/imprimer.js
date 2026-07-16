import { formatPrix } from '../client/formatPrix'

/**
 * Impression de secours (§5.5) — plus de dépendance à une imprimante
 * réseau fixe (ESC/POS vers une IP figée). À la place : une fenêtre
 * d'aperçu HTML, format "ticket 80mm", dont le bouton Imprimer ouvre le
 * dialogue natif du navigateur — celui-ci liste automatiquement toutes
 * les imprimantes installées sur le poste (USB, réseau, PDF...), pas
 * seulement un modèle particulier. Remplace l'ancien module backend
 * `kds_core/impression.py` (ESC/POS brut), retiré : plus rien à
 * configurer côté serveur (pas d'IP, pas de port), et ça fonctionne même
 * si le backend est injoignable puisque les données du ticket/reçu sont
 * déjà en mémoire côté écran au moment du clic.
 */

export const LIBELLE_MODE_PAIEMENT = {
  especes: 'Espèces',
  wave: 'Wave',
  orange_money: 'Orange Money',
  momo: 'Momo',
  carte: 'Carte',
  autre: 'Autre',
}

function echapper(texte) {
  const div = document.createElement('div')
  div.textContent = texte ?? ''
  return div.innerHTML
}

function formatNumeroTicket(numero) {
  return numero != null ? `TC-${String(numero).padStart(6, '0')}` : '—'
}

/**
 * En-tête commun à la facture (avant paiement) et au reçu (après
 * encaissement) — logo, nom de l'établissement, coordonnées. Ces deux
 * documents doivent porter la même identité (§5.5, demandé après coup :
 * "la Facture doit aussi porter et entête le logo - le nom du tenant -
 * les coordonnées... comme sur le reçu final"). `tenant` peut être
 * `null` (chargement en cours) — dans ce cas l'en-tête est juste vide,
 * jamais bloquant pour imprimer.
 */
function construireEnTete(tenant) {
  if (!tenant) return ''
  return `
    ${tenant.logo ? `<div class="centre"><img src="${echapper(tenant.logo)}" alt="" class="logo" /></div>` : ''}
    <div class="centre gras titre">${echapper(tenant.nom_etablissement)}</div>
    ${tenant.adresse ? `<div class="centre petit">${echapper(tenant.adresse)}</div>` : ''}
    ${tenant.telephone ? `<div class="centre petit">Tél : ${echapper(tenant.telephone)}</div>` : ''}
    <div class="separateur-double"></div>
  `
}

const STYLE_TICKET = `
  @page { margin: 4mm; size: 80mm auto; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    line-height: 1.4;
    color: #000;
    width: 72mm;
    margin: 0 auto;
    padding: 8px 0;
  }
  .centre { text-align: center; }
  .droite { text-align: right; }
  .gras { font-weight: bold; }
  .titre { font-size: 16px; }
  .petit { font-size: 10px; }
  .ligne { display: flex; justify-content: space-between; gap: 8px; }
  .separateur { border-top: 1px dashed #000; margin: 6px 0; }
  .separateur-double { border-top: 2px solid #000; margin: 6px 0; }
  .commentaire { font-style: italic; padding-left: 8px; }
  .badge { display: inline-block; border: 1px solid #000; padding: 0 4px; margin: 2px 4px 0 0; font-size: 10px; }
  .badge-critique { background: #000; color: #fff; }
  .encadre { border: 2px solid #000; padding: 4px; margin: 6px 0; }
  .logo { max-height: 48px; max-width: 100%; margin-bottom: 4px; }
  table.articles { width: 100%; border-collapse: collapse; }
  table.articles th { text-align: left; font-size: 10px; border-bottom: 1px solid #000; padding-bottom: 2px; }
  table.articles th:last-child, table.articles td:last-child { text-align: right; }
  table.articles th:nth-child(2), table.articles td:nth-child(2) { text-align: center; }
  table.articles td { padding: 2px 0; vertical-align: top; }
  .bouton-imprimer {
    font-family: system-ui, sans-serif;
    display: block;
    width: 100%;
    margin-top: 12px;
    padding: 10px;
    font-size: 14px;
    font-weight: 600;
    background: #0f172a;
    color: #fff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  @media print {
    .bouton-imprimer { display: none; }
  }
`

/**
 * Ouvre la fenêtre d'aperçu et déclenche le dialogue d'impression natif.
 * `window.open` doit être appelé de façon synchrone depuis un handler de
 * clic — sinon la plupart des navigateurs bloquent le popup.
 *
 * `autoriserImpression` (§interface serveur, demandé après coup) : un
 * serveur ne doit avoir accès qu'à la *consultation* de la facture, pas à
 * l'impression (réservée manager/admin, cf. `CaisseScreen.jsx`) — retire
 * simplement le bouton "Imprimer" de l'aperçu dans ce cas. N'empêche pas
 * un utilisateur déterminé d'imprimer quand même via le raccourci natif
 * du navigateur (Ctrl+P) : ce n'est pas une vraie barrière de sécurité,
 * juste le geste normal retiré de l'écran.
 */
export function ouvrirApercuImpression(titre, corpsHtml, { autoriserImpression = true } = {}) {
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${echapper(titre)}</title>
<style>${STYLE_TICKET}</style>
</head>
<body>
${corpsHtml}
${autoriserImpression ? '<button class="bouton-imprimer" onclick="window.print()">🖨️ Imprimer</button>' : ''}
</body>
</html>`

  // Navigation directe vers une Blob URL plutôt que `window.open('') +
  // document.write` : ce dernier ouvre d'abord une fenêtre sur
  // "about:blank", puis écrit le contenu par-dessus — un navigateur qui
  // termine sa propre navigation vers "about:blank" *après* ce write
  // écrase silencieusement le contenu (fenêtre blanche, pas d'erreur
  // JS). La Blob URL est un document déjà complet dès l'ouverture : une
  // seule navigation, pas de course.
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const fenetre = window.open(url, '_blank', 'width=420,height=720')
  if (!fenetre) {
    URL.revokeObjectURL(url)
    return false
  }
  fenetre.focus()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  return true
}

/** Ticket cuisine — table, plats + modificateurs/commentaire, rush. */
export function construireTicketHTML(ticket, contexte) {
  const lignesActives = ticket.lignes.filter((l) => l.statut_ligne !== 'annule')

  const lignesHtml = lignesActives
    .map((ligne) => {
      const modificateursHtml = ligne.modificateurs
        .map(
          (m) =>
            `<span class="badge${m.niveau_alerte_critique ? ' badge-critique' : ''}">${
              m.niveau_alerte_critique ? '⚠ ' : ''
            }${echapper(m.libelle)}</span>`
        )
        .join('')

      return `
        <div class="ligne gras">
          <span>${ligne.quantite}× ${echapper(ligne.plat_nom)}</span>
        </div>
        ${ligne.commentaire_libre ? `<div class="commentaire">"${echapper(ligne.commentaire_libre)}"</div>` : ''}
        ${modificateursHtml ? `<div>${modificateursHtml}</div>` : ''}
      `
    })
    .join('<div style="height:6px;"></div>')

  return `
    <div class="centre gras titre">TABLE ${echapper(ticket.table_numero ?? '—')}</div>
    <div class="centre petit">*** IMPRESSION DE SECOURS ***</div>
    <div class="centre petit">${echapper(contexte)} — ${new Date().toLocaleString('fr-FR')}</div>
    ${ticket.is_rush ? '<div class="centre gras encadre">🔥 RUSH</div>' : ''}
    <div class="separateur"></div>
    ${lignesHtml || '<div class="centre petit">Aucun plat actif.</div>'}
    <div class="separateur"></div>
  `
}

/**
 * Facture (avant paiement, `commande.statut_paiement !== 'payee'`) ou
 * reçu (après `OrderViewSet.encaisser`, qui renvoie déjà la commande à
 * jour avec `numero_ticket`/`caissier_nom`/`mode_paiement`/
 * `montant_recu` — pas besoin de les passer séparément). Même en-tête
 * (§5.5, demandé après coup), corps différent : la facture reste le
 * résumé simple qu'un serveur apporte à table (N° table, serveur, date,
 * articles, total) ; le reçu reprend le modèle complet fourni par
 * l'utilisateur (date, N° ticket, serveur, caissier, règlement, détail
 * article par article avec prix unitaire, reçu/monnaie, mentions de
 * fin).
 */
export function construireRecuHTML(tenant, commande) {
  const payee = commande.statut_paiement === 'payee'
  const total = commande.total
  const monnaie = payee ? Math.max(0, Number(commande.montant_recu ?? total) - total) : 0

  const enTete = construireEnTete(tenant)

  if (!payee) {
    const lignesHtml = commande.items
      .map(
        (item) => `
          <div class="ligne">
            <span>${item.quantite}× ${echapper(item.plat_nom)}</span>
            <span>${formatPrix(item.prix * item.quantite, 'XOF')}</span>
          </div>
        `
      )
      .join('')

    return `
      ${enTete}
      <div class="ligne"><span>N° Table</span><span>${echapper(commande.table_numero ?? '—')}</span></div>
      ${commande.serveur_nom ? `<div class="ligne"><span>Serveur</span><span>${echapper(commande.serveur_nom)}</span></div>` : ''}
      <div class="ligne"><span>Date</span><span>${new Date().toLocaleString('fr-FR')}</span></div>
      <div class="separateur"></div>
      ${lignesHtml}
      <div class="separateur-double"></div>
      <div class="ligne gras titre"><span>TOTAL</span><span>${formatPrix(total, 'XOF')}</span></div>
      <div class="separateur"></div>
      <div class="centre gras encadre">A RÉGLER EN CAISSE</div>
    `
  }

  const lignesHtml = commande.items
    .map(
      (item) => `
        <tr>
          <td>${echapper(item.plat_nom)}</td>
          <td>${item.quantite} × ${formatPrix(item.prix, 'XOF')}</td>
          <td>${formatPrix(item.prix * item.quantite, 'XOF')}</td>
        </tr>
      `
    )
    .join('')

  return `
    ${enTete}
    <div class="ligne"><span>Date</span><span>${new Date(commande.heure_paiement ?? Date.now()).toLocaleString('fr-FR')}</span></div>
    <div class="ligne"><span>Ticket N°</span><span>${formatNumeroTicket(commande.numero_ticket)}</span></div>
    ${commande.serveur_nom ? `<div class="ligne"><span>Serveur</span><span>${echapper(commande.serveur_nom)}</span></div>` : ''}
    ${commande.caissier_nom ? `<div class="ligne"><span>Caissier</span><span>${echapper(commande.caissier_nom)}</span></div>` : ''}
    <div class="ligne"><span>Règlement</span><span>${LIBELLE_MODE_PAIEMENT[commande.mode_paiement] ?? commande.mode_paiement}</span></div>
    <div class="separateur"></div>
    <table class="articles">
      <thead><tr><th>Article</th><th>Qté × P.U</th><th>Montant</th></tr></thead>
      <tbody>${lignesHtml}</tbody>
    </table>
    <div class="separateur-double"></div>
    <div class="ligne gras titre"><span>TOTAL</span><span>${formatPrix(total, 'XOF')}</span></div>
    ${
      monnaie > 0
        ? `
          <div class="separateur"></div>
          <div class="ligne"><span>Reçu</span><span>${formatPrix(commande.montant_recu, 'XOF')}</span></div>
          <div class="ligne"><span>Monnaie rendue</span><span>${formatPrix(monnaie, 'XOF')}</span></div>
        `
        : ''
    }
    <div class="separateur"></div>
    <div class="centre">Merci de votre visite</div>
    <div class="centre petit">Conservez ce ticket pour tout litige</div>
  `
}
