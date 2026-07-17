/**
 * Pavé numérique tactile (§encaissement/§back-office, demandé après coup —
 * "sur Linux sans pavé numérique physique il faut maintenir Shift pour
 * taper des chiffres, gênant surtout sur écran tactile"). Vient en plus
 * du champ texte, ne le remplace pas : la saisie clavier physique
 * continue de fonctionner normalement, ce pavé est juste une alternative
 * tactile toujours visible — même principe que `PaveNumerique`
 * (`LoginScreen.jsx`, saisie du PIN), généralisé ici à n'importe quel
 * champ montant plutôt qu'un PIN à 4-6 chiffres fixes.
 */
export default function ClavierNumerique({ valeur, onChange, autoriserDecimales = false, sombre = true }) {
  function taper(car) {
    if (car === '.' && (!autoriserDecimales || String(valeur ?? '').includes('.'))) return
    onChange(`${valeur ?? ''}${car}`)
  }

  function effacer() {
    onChange(String(valeur ?? '').slice(0, -1))
  }

  const derniereTouche = autoriserDecimales ? '.' : 'C'
  const touches = ['1', '2', '3', '4', '5', '6', '7', '8', '9', derniereTouche, '0', '⌫']

  const classeTouche = sombre
    ? 'bg-slate-900 text-slate-100 hover:bg-slate-700'
    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {touches.map((touche) => (
        <button
          key={touche}
          type="button"
          onClick={() => {
            if (touche === '⌫') effacer()
            else if (touche === 'C') onChange('')
            else taper(touche)
          }}
          className={`rounded-lg py-2.5 text-base font-semibold transition ${classeTouche}`}
        >
          {touche}
        </button>
      ))}
    </div>
  )
}
