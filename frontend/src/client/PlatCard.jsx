import { formatPrix } from './formatPrix'

/**
 * Carte "bouton" façon grille (menu digital, §5.6) — image, badge
 * disponibilité, nom, prix, temps de préparation, et un bouton "+"
 * flottant pour ajout rapide (quantité 1, service dès que prêt). Taper la
 * carte elle-même ouvre le détail (quantité, "servir avec le reste",
 * commentaire) via `onOuvrirDetail`, pour ne pas perdre cette
 * personnalisation derrière un simple ajout rapide.
 */
export default function PlatCard({ plat, devise, onAjoutRapide, onOuvrirDetail }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-md">
      <button type="button" onClick={() => onOuvrirDetail(plat)} className="block w-full text-left">
        <div className="relative aspect-square w-full bg-gray-200">
          {plat.image ? (
            <img src={plat.image} alt={plat.nom} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-5xl">🍽️</div>
          )}
          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-emerald-500 shadow">
            ✓
          </span>
        </div>
      </button>

      <div className="relative px-3 pb-3 pt-3">
        <button
          type="button"
          onClick={() => onAjoutRapide(plat)}
          aria-label={`Ajouter ${plat.nom}`}
          className="absolute -top-6 right-3 flex h-10 w-10 items-center justify-center rounded-xl text-2xl font-bold text-white shadow-lg"
          style={{ backgroundColor: 'var(--color-secondary, #6d28d9)' }}
        >
          +
        </button>

        <button type="button" onClick={() => onOuvrirDetail(plat)} className="block w-full pr-10 text-left">
          <p className="truncate font-semibold text-gray-900">{plat.nom}</p>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="font-bold" style={{ color: 'var(--color-primary, #6d28d9)' }}>
              {formatPrix(plat.prix, devise)}
            </span>
            {/* 0 = déjà prêt (ex: eau, soda) — pas de temps affiché. Les
                boissons qui demandent une vraie préparation (cocktails)
                gardent un temps > 0 et l'affichent normalement. */}
            {plat.temps_preparation_estime_min > 0 && (
              <span className="text-gray-400">⏱ {plat.temps_preparation_estime_min} min</span>
            )}
          </div>
        </button>
      </div>
    </div>
  )
}
