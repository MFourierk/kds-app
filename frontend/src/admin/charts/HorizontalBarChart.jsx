const HUE = '#2a78d6' // bleu séquentiel (palette validée, cf. skill dataviz) — un seul hue, la longueur de barre porte la magnitude.

/**
 * Barres horizontales classées (§5.4) : une ligne = label + piste + barre +
 * valeur. Horizontal plutôt que vertical car les libellés (postes, plats)
 * sont de longueur variable — pas de rotation de texte à gérer.
 * Bout de barre arrondi côté valeur, carré côté ligne de base (`rounded-r`
 * seulement), jamais l'inverse.
 */
export default function HorizontalBarChart({ data, formatValue, texteVide }) {
  if (!data || data.length === 0) {
    return <p className="py-4 text-center text-sm text-gray-400">{texteVide ?? 'Aucune donnée sur cette période.'}</p>
  }

  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-36 shrink-0 truncate text-sm text-gray-600" title={d.label}>
            {d.label}
          </span>
          <div className="h-5 flex-1 rounded-sm bg-gray-100">
            <div
              className="h-5 rounded-r-md"
              style={{ width: `${Math.max((d.value / max) * 100, 2)}%`, backgroundColor: HUE }}
              title={`${d.label} — ${formatValue ? formatValue(d.value) : d.value}`}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-sm font-semibold text-gray-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatValue ? formatValue(d.value) : d.value}
          </span>
        </div>
      ))}
    </div>
  )
}
