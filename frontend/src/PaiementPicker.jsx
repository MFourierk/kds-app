import ClavierNumerique from './ClavierNumerique'
import { formatPrix } from './client/formatPrix'
import { LIBELLE_MODE_PAIEMENT } from './print/imprimer'

// "Mobile Money" n'est pas une valeur de paiement réelle
// (`Order.ModePaiement` n'a que wave/orange_money/momo, cf. §6.4) — juste
// une catégorie d'affichage qui replie les 3 opérateurs derrière un seul
// bouton, révélés uniquement au clic plutôt que 6 pastilles à plat d'un
// coup (plus lisible sur un écran étroit).
const OPERATEURS_MOBILE_MONEY = ['wave', 'orange_money', 'momo']
const CATEGORIES_PAIEMENT = { especes: 'Espèces', mobile_money: 'Mobile Money', carte: 'Carte', autre: 'Autre' }

/**
 * Choix du mode de paiement + montant reçu/monnaie (§5.5, extrait de
 * `CaisseScreen.jsx` pour être réutilisé tel quel par l'écran TPE,
 * §vente comptoir — même geste d'encaissement, juste appelé depuis deux
 * écrans différents plutôt qu'une nouvelle implémentation dupliquée).
 */
export default function PaiementPicker({
  total,
  modePaiement,
  setModePaiement,
  montantRecu,
  setMontantRecu,
  onValider,
  onAnnuler,
  enCours,
}) {
  function choisirCategorie(categorie) {
    if (categorie === 'mobile_money') {
      // Garde l'opérateur déjà choisi s'il y en a un, sinon présélectionne
      // Wave (il faut bien une valeur valide, l'utilisateur peut changer).
      setModePaiement((actuel) => (OPERATEURS_MOBILE_MONEY.includes(actuel) ? actuel : 'wave'))
    } else {
      setModePaiement(categorie)
    }
  }

  const monnaie = modePaiement === 'especes' ? Math.max(0, Number(montantRecu || 0) - total) : 0

  return (
    <div className="space-y-2 rounded-lg bg-slate-900 p-3">
      <div className="flex flex-wrap gap-1">
        {Object.entries(CATEGORIES_PAIEMENT).map(([categorie, label]) => {
          const active =
            categorie === 'mobile_money' ? OPERATEURS_MOBILE_MONEY.includes(modePaiement) : modePaiement === categorie
          return (
            <button
              key={categorie}
              onClick={() => choisirCategorie(categorie)}
              className={`min-w-[30%] flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                active ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-slate-300'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      {OPERATEURS_MOBILE_MONEY.includes(modePaiement) && (
        <div className="flex gap-1">
          {OPERATEURS_MOBILE_MONEY.map((operateur) => (
            <button
              key={operateur}
              onClick={() => setModePaiement(operateur)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                modePaiement === operateur ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {LIBELLE_MODE_PAIEMENT[operateur]}
            </button>
          ))}
        </div>
      )}
      {modePaiement === 'especes' && (
        <>
          <label className="block text-xs text-slate-400">
            Montant reçu
            <input
              type="text"
              inputMode="decimal"
              value={montantRecu}
              onChange={(e) => setMontantRecu(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100"
            />
          </label>
          <ClavierNumerique valeur={montantRecu} onChange={setMontantRecu} autoriserDecimales />
          <div className="flex justify-between text-sm text-slate-300">
            <span>Monnaie à rendre</span>
            <span className="font-semibold">{formatPrix(monnaie, 'XOF')}</span>
          </div>
        </>
      )}
      <div className="flex gap-2">
        <button
          onClick={onValider}
          disabled={enCours}
          className="flex-1 rounded-lg bg-emerald-500 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-400 disabled:opacity-50"
        >
          Valider
        </button>
        <button onClick={onAnnuler} className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-300">
          Annuler
        </button>
      </div>
    </div>
  )
}
