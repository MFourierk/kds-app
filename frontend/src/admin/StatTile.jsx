/** Contrat "stat tile" (skill dataviz) : label en phrase, valeur en gras. Icône + accent coloré pour sortir du gris plat. */
export default function StatTile({ label, value, icone, accent = 'slate', description }) {
  const ACCENTS = {
    slate: 'from-slate-500 to-slate-700',
    amber: 'from-amber-400 to-amber-600',
    emerald: 'from-emerald-400 to-emerald-600',
    red: 'from-red-400 to-red-600',
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 transition hover:shadow-md">
      <div
        className={`absolute -right-4 -top-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br text-2xl opacity-90 ${ACCENTS[accent]}`}
      >
        <span className="-translate-x-1 translate-y-1">{icone}</span>
      </div>
      <p className="pr-14 text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900" style={{ fontVariantNumeric: 'proportional-nums' }}>
        {value}
      </p>
      {/* Optionnel : quelques chiffres (ex: "Montant perdu") ne sont pas
          auto-explicatifs par leur seul libellé — précision courte plutôt
          qu'un tooltip, toujours visible sans interaction (§tactile). */}
      {description && <p className="mt-1 pr-14 text-xs text-gray-400">{description}</p>}
    </div>
  )
}
