const COULEUR_BORDURE = {
  vert: 'border-emerald-500',
  orange: 'border-amber-500',
  rouge: 'border-red-500',
}

const LIBELLE_STATUT = {
  en_attente: 'En attente',
  en_preparation: 'En préparation',
  pret: 'Prêt',
}

const LIBELLE_BOUTON_SUIVANT = {
  en_attente: 'Démarrer',
  en_preparation: 'Marquer prêt',
  pret: 'Marquer servi',
}

export default function TicketCard({ ticket, onBump, onFire, onToggleRush, onLignePrete, onImprimer, estNouveau }) {
  const bordure = ticket.is_held ? 'border-slate-500' : COULEUR_BORDURE[ticket.code_couleur] || 'border-slate-600'

  // Suivi plat par plat (§5.1/§5.6) : chaque ligne se marque prête
  // indépendamment des autres — le poulet peut être prêt avant les
  // brochettes sur le même ticket. Le bouton du bas ne sert donc plus à
  // "marquer prêt" globalement : il ne fait que Démarrer / Lancer /
  // Marquer servi, jamais sauter l'étape ligne par ligne.
  const lignesActives = ticket.lignes.filter((l) => l.statut_ligne !== 'annule')
  // "servi" compte comme "prêt" ici (déjà au-delà) — sinon une ligne
  // servie individuellement avant les autres ferait *baisser* le
  // compteur "X/Y prêts" au lieu de rester à jour.
  const nbPretes = lignesActives.filter((l) => l.statut_ligne === 'pret' || l.statut_ligne === 'servi').length
  const enPreparation = !ticket.is_held && ticket.statut === 'en_preparation'

  return (
    <div
      className={`flex w-80 flex-col rounded-xl border-4 bg-slate-800 p-4 shadow-lg ${bordure} ${ticket.is_rush ? 'ring-4 ring-red-500' : ''} ${estNouveau ? 'animate-pulse' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xl font-bold text-slate-100">
          Table {ticket.table_numero ?? '—'}
          {estNouveau && (
            <span className="rounded-full bg-sky-500 px-2 py-0.5 text-xs font-bold text-white">🆕 Nouveau</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onImprimer(ticket.id)}
            title="Impression de secours (§5.5) — si l'écran de ce poste tombe en panne"
            className="rounded-full bg-slate-700 px-3 py-1 text-sm font-semibold text-slate-300 hover:bg-slate-600"
          >
            🖨️
          </button>
          <button
            onClick={() => onToggleRush(ticket.id)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              ticket.is_rush ? 'bg-red-500 text-white' : 'bg-slate-700 text-slate-300'
            }`}
          >
            🔥 Rush
          </button>
        </div>
      </div>

      <ul className="mb-4 flex-1 space-y-2">
        {ticket.lignes.map((ligne) => {
          const estPrete = ligne.statut_ligne === 'pret'
          const estAnnulee = ligne.statut_ligne === 'annule'
          // Une ligne peut passer "servi" individuellement (écran Service
          // dédié, §5.6 "dès que prêt" — cf. `ServeurScreen.jsx`) alors
          // que le ticket lui-même reste "en préparation" (d'autres
          // lignes pas encore prêtes) — trouvé en usage réel : sans cet
          // état séparé, une ligne déjà servie retombait dans le même
          // rendu qu'une ligne pas encore prête (bouton "Prêt" cliquable),
          // aucun moyen de voir qu'elle était en fait déjà sortie.
          const estServie = ligne.statut_ligne === 'servi'
          return (
            <li
              key={ligne.id}
              className={`rounded-lg p-2 ${estServie ? 'bg-slate-800/60 opacity-60' : estPrete ? 'bg-emerald-950' : 'bg-slate-900'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1">
                  <div className="flex justify-between text-lg text-slate-100">
                    <span className="font-semibold">{ligne.quantite}×</span>
                    <span className="flex-1 px-2">{ligne.plat_nom}</span>
                  </div>
                  {ligne.commentaire_libre && (
                    <p className="text-sm italic text-slate-400">{ligne.commentaire_libre}</p>
                  )}
                  {ligne.modificateurs.map((m) => (
                    <span
                      key={m.libelle}
                      className={`mr-1 mt-1 inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                        m.niveau_alerte_critique ? 'bg-red-600 text-white' : 'bg-amber-600 text-slate-900'
                      }`}
                    >
                      {m.libelle}
                    </span>
                  ))}
                </div>
                {estServie ? (
                  <span className="shrink-0 rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-slate-400">
                    ✓ Servi
                  </span>
                ) : (
                  enPreparation &&
                  !estAnnulee && (
                    <button
                      onClick={() => onLignePrete(ligne.id)}
                      disabled={estPrete}
                      className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${
                        estPrete
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-700 text-slate-200 hover:bg-emerald-500 hover:text-slate-900'
                      }`}
                    >
                      {estPrete ? '✓ Prêt' : 'Prêt'}
                    </button>
                  )
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="mb-3 text-sm text-slate-400">
        {LIBELLE_STATUT[ticket.statut] ?? ticket.statut}
        {enPreparation && lignesActives.length > 0 && ` — ${nbPretes}/${lignesActives.length} prêts`}
      </div>

      {ticket.is_held ? (
        <button
          onClick={() => onFire(ticket.id)}
          className="rounded-lg bg-blue-500 py-3 text-lg font-semibold text-white hover:bg-blue-400"
        >
          Lancer (Fire)
        </button>
      ) : enPreparation ? (
        <div className="rounded-lg bg-slate-700 py-3 text-center text-sm text-slate-400">
          En attente que tous les plats soient marqués prêts
        </div>
      ) : (
        <button
          onClick={() => onBump(ticket.id)}
          className="rounded-lg bg-emerald-500 py-3 text-lg font-semibold text-slate-900 hover:bg-emerald-400"
        >
          {LIBELLE_BOUTON_SUIVANT[ticket.statut] ?? 'Suivant'}
        </button>
      )}
    </div>
  )
}
