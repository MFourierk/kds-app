import { formatPrix } from './formatPrix'

const LIBELLE_LIGNE = {
  en_attente: { texte: 'En attente', couleur: 'bg-gray-200 text-gray-700' },
  en_preparation: { texte: 'En préparation', couleur: 'bg-amber-200 text-amber-800' },
  pret: { texte: 'Prêt', couleur: 'bg-emerald-200 text-emerald-800' },
  servi: { texte: '✓ Servi', couleur: 'bg-sky-200 text-sky-800' },
  annule: { texte: 'Annulé', couleur: 'bg-red-200 text-red-800' },
}

export default function TrackingView({ suivi, devise, commandesEnFile = [] }) {
  const commandesServeur = suivi?.commandes ?? []
  const enFile = commandesEnFile.length > 0

  // Une commande en file (§5.5, hors-ligne) n'a pas encore atteint le
  // serveur — elle n'existe nulle part dans `suivi`. Sans ce cas à part,
  // "Aucune commande en cours" s'afficherait alors qu'une commande
  // attend bien d'être envoyée, ce qui contredirait le bandeau hors
  // ligne juste au-dessus (`ClientApp.jsx`).
  if (!suivi && !enFile) {
    return <p className="p-6 text-center text-gray-400">Chargement du suivi...</p>
  }

  if (commandesServeur.length === 0 && !enFile) {
    return <p className="p-6 text-center text-gray-400">Aucune commande en cours pour cette table.</p>
  }

  return (
    <div className="space-y-4 p-4 pb-32">
      {suivi && !suivi.cuisine_en_ligne && suivi.message_urgence && (
        <div className="rounded-xl bg-red-100 p-4 text-center font-semibold text-red-800">
          ⚠️ {suivi.message_urgence}
        </div>
      )}

      {commandesEnFile.map((commande) => (
        <div key={commande.idempotencyKey} className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-800">📶 En attente d'envoi (hors ligne)</p>
          <p className="text-gray-700">{commande.resume}</p>
        </div>
      ))}

      {commandesServeur.map((commande) => (
        <div key={commande.id} className="rounded-xl bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm text-gray-500">
            Commande passée à {new Date(commande.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <ul className="space-y-2">
            {commande.items.map((item, index) => {
              const libelle = LIBELLE_LIGNE[item.statut_ligne] ?? { texte: item.statut_ligne, couleur: 'bg-gray-200' }
              return (
                <li key={index} className="flex items-center justify-between">
                  <span className="text-gray-900">
                    {item.quantite}× {item.plat_nom}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${libelle.couleur}`}>
                    {libelle.texte}
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t pt-2 text-sm font-semibold text-gray-700">
            <span>Total</span>
            <span>{formatPrix(commande.total, devise)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
