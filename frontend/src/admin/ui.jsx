/**
 * Petit kit d'UI partagé entre les 3 écrans de gestion (Menu/Postes/
 * Utilisateurs) — évite de réécrire la même carte/bouton/badge/table 3
 * fois avec des détails qui divergent au fil des éditions. Accent ambre +
 * ardoise pour rester cohérent avec le reste de l'app (écran de
 * connexion, écrans cuisine), pas une palette isolée pour le back-office.
 */

export function Carte({ children, className = '' }) {
  return <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 ${className}`}>{children}</div>
}

export function BoutonPrimaire({ children, className = '', ...props }) {
  return (
    <button
      className={`rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function BoutonSecondaire({ children, className = '', ...props }) {
  return (
    <button
      className={`rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-200 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

const TONES_LIEN = {
  sky: 'text-sky-700',
  red: 'text-red-600',
  amber: 'text-amber-700',
  gray: 'text-gray-500',
}

export function BoutonLien({ children, tone = 'sky', className = '', ...props }) {
  return (
    <button className={`text-sm font-semibold hover:underline ${TONES_LIEN[tone]} ${className}`} {...props}>
      {children}
    </button>
  )
}

const TONES_BADGE = {
  emerald: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-gray-200 text-gray-600',
  amber: 'bg-amber-100 text-amber-800',
}

export function Badge({ children, tone = 'gray' }) {
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${TONES_BADGE[tone]}`}>{children}</span>
}

export function Champ({ label, className = '', children }) {
  return (
    <label className={`text-sm ${className}`}>
      <span className="mb-1.5 block font-medium text-gray-600">{label}</span>
      {children}
    </label>
  )
}

export const classeInput =
  'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 transition focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100 disabled:bg-gray-100 disabled:text-gray-400'

export function Table({ colonnes, children }) {
  return (
    // `overflow-x-auto` (pas `overflow-hidden`) : sur un écran étroit, ce
    // tableau dépasse largement la largeur visible (colonnes Statut/Actions
    // en plus de Nom/Identifiant/Rôle) — `overflow-hidden` les coupait
    // purement et simplement, sans aucune indication qu'on pouvait faire
    // défiler pour les voir (trouvé en marge de l'essai d'installation
    // client, onglet Équipe sur un vrai téléphone).
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/80 text-left">
            {colonnes.map((c) => (
              <th key={c.label} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${c.className ?? ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Ligne({ children }) {
  return <tr className="border-b border-gray-50 transition last:border-0 hover:bg-amber-50/40">{children}</tr>
}
