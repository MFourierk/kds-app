const HUE = '#2a78d6'
const WIDTH = 640
const HEIGHT = 180
const PADDING = { left: 32, right: 12, top: 16, bottom: 24 }
const PLOT_W = WIDTH - PADDING.left - PADDING.right
const PLOT_H = HEIGHT - PADDING.top - PADDING.bottom

/**
 * Commandes par heure de la journée (§5.4 "heures de pointe") : une seule
 * série continue sur un axe temporel → ligne + aire à ~10% d'opacité
 * (jamais un bloc saturé), pas un bar chart — c'est une tendance, pas une
 * comparaison de catégories.
 */
export default function LineChartHeures({ data, texteVide }) {
  if (!data || data.length === 0) {
    return <p className="py-4 text-center text-sm text-gray-400">{texteVide ?? 'Aucune donnée sur cette période.'}</p>
  }

  const parHeure = new Map(data.map((d) => [d.heure, d.nb_commandes]))
  const points = Array.from({ length: 24 }, (_, heure) => ({ heure, valeur: parHeure.get(heure) ?? 0 }))
  const max = Math.max(...points.map((p) => p.valeur), 1)

  const x = (heure) => PADDING.left + (heure / 23) * PLOT_W
  const y = (valeur) => PADDING.top + PLOT_H - (valeur / max) * PLOT_H

  const lignePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.heure).toFixed(1)} ${y(p.valeur).toFixed(1)}`).join(' ')
  const airePath = `${lignePath} L ${x(23).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`

  const pic = points.reduce((a, b) => (b.valeur > a.valeur ? b : a), points[0])

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Commandes par heure de la journée">
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={PADDING.top + PLOT_H * (1 - f)}
          y2={PADDING.top + PLOT_H * (1 - f)}
          stroke="#e1e0d9"
          strokeWidth="1"
        />
      ))}

      <path d={airePath} fill={HUE} fillOpacity="0.1" stroke="none" />
      <path d={lignePath} fill="none" stroke={HUE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {points.map((p) => (
        <circle key={p.heure} cx={x(p.heure)} cy={y(p.valeur)} r="4" fill={HUE} stroke="white" strokeWidth="2">
          <title>{`${p.heure}h — ${p.valeur} commande${p.valeur > 1 ? 's' : ''}`}</title>
        </circle>
      ))}

      {pic.valeur > 0 && (
        <text x={x(pic.heure)} y={y(pic.valeur) - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="#52514e">
          {pic.valeur}
        </text>
      )}

      {points
        .filter((p) => p.heure % 4 === 0)
        .map((p) => (
          <text key={p.heure} x={x(p.heure)} y={HEIGHT - 6} textAnchor="middle" fontSize="10" fill="#898781">
            {p.heure}h
          </text>
        ))}
    </svg>
  )
}
