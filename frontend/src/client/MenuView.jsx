import { useState } from 'react'
import PlatCard from './PlatCard'
import { GroupesModificateurs, categoriesObligatoiresManquantes, groupesDepuisModificateurs } from '../SelecteurModificateurs'

function DetailPlatModal({ plat, onFermer, onConfirmer }) {
  const [quantite, setQuantite] = useState(1)
  const [serviceImmediat, setServiceImmediat] = useState(true)
  const [commentaire, setCommentaire] = useState('')
  // `plat.modifiers` est déjà imbriqué avec ses détails complets ici
  // (`QrMenuItemSerializer`, pas une simple liste d'IDs comme côté staff)
  // — pas besoin de croiser un catalogue séparé.
  const groupes = groupesDepuisModificateurs(plat.modifiers || [])
  const [selection, setSelection] = useState([])
  const manquantes = categoriesObligatoiresManquantes(groupes, selection)

  function confirmer() {
    onConfirmer({
      plat: plat.id,
      plat_nom: plat.nom,
      prix: plat.prix,
      quantite,
      service_immediat: serviceImmediat,
      commentaire_libre: commentaire,
      modificateurs: selection,
      modificateurs_libelles: groupes
        .flatMap((g) => g.options)
        .filter((o) => selection.includes(o.id))
        .map((o) => o.libelle),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onFermer}>
      <div className="w-full rounded-t-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <p className="text-lg font-bold text-gray-900">{plat.nom}</p>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer, je ne veux pas commander ce plat"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg font-bold text-gray-500"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-gray-600">Quantité</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuantite((q) => Math.max(1, q - 1))}
              className="h-10 w-10 rounded-full bg-gray-200 text-xl font-bold text-gray-700"
            >
              −
            </button>
            <span className="w-6 text-center text-lg font-semibold">{quantite}</span>
            <button
              onClick={() => setQuantite((q) => q + 1)}
              className="h-10 w-10 rounded-full bg-gray-200 text-xl font-bold text-gray-700"
            >
              +
            </button>
          </div>
        </div>

        <div className="mb-4">
          <span className="mb-2 block text-sm text-gray-600">Quand le servir ?</span>
          <div className="flex gap-2">
            <button
              onClick={() => setServiceImmediat(true)}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
                serviceImmediat ? 'text-white' : 'bg-gray-200 text-gray-700'
              }`}
              style={serviceImmediat ? { backgroundColor: 'var(--color-primary, #1B2431)' } : undefined}
            >
              Dès que prêt
            </button>
            <button
              onClick={() => setServiceImmediat(false)}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
                !serviceImmediat ? 'text-white' : 'bg-gray-200 text-gray-700'
              }`}
              style={!serviceImmediat ? { backgroundColor: 'var(--color-primary, #1B2431)' } : undefined}
            >
              Avec le reste
            </button>
          </div>
        </div>

        <input
          type="text"
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          placeholder="Une précision ? (ex: bien cuit)"
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />

        {groupes.length > 0 && (
          <div className="mb-4">
            <GroupesModificateurs groupes={groupes} selection={selection} onChangerSelection={setSelection} />
          </div>
        )}

        <button
          onClick={confirmer}
          disabled={manquantes.length > 0}
          className="w-full rounded-lg py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: 'var(--color-secondary, #C9A24B)' }}
        >
          {manquantes.length > 0 ? `Choisir : ${manquantes.map((g) => g.nom).join(', ')}` : 'Ajouter au panier'}
        </button>
      </div>
    </div>
  )
}

export default function MenuView({ categories, devise, onAjouter }) {
  const [platDetail, setPlatDetail] = useState(null)

  function ajoutRapide(plat) {
    // Un plat avec modificateurs ouvre toujours le détail (§5.2) — même
    // s'ils sont tous optionnels, le "+" rapide ne doit pas escamoter la
    // possibilité de personnaliser (ex: Piquant) ; un plat sans
    // modificateur garde l'ajout instantané d'origine.
    if (plat.modifiers?.length > 0) {
      setPlatDetail(plat)
      return
    }
    onAjouter({
      plat: plat.id,
      plat_nom: plat.nom,
      prix: plat.prix,
      quantite: 1,
      service_immediat: true,
      commentaire_libre: '',
      modificateurs: [],
    })
  }

  function confirmerDetail(ligne) {
    onAjouter(ligne)
    setPlatDetail(null)
  }

  return (
    <div className="space-y-6 p-4 pb-32">
      {categories.map((categorie) => (
        <section key={categorie.id}>
          <h2 className="mb-3 text-lg font-bold text-gray-900">{categorie.nom}</h2>
          {categorie.plats.length === 0 ? (
            <p className="text-sm text-gray-400">Rien de disponible pour l'instant.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {categorie.plats.map((plat) => (
                <PlatCard
                  key={plat.id}
                  plat={plat}
                  devise={devise}
                  onAjoutRapide={ajoutRapide}
                  onOuvrirDetail={setPlatDetail}
                />
              ))}
            </div>
          )}
        </section>
      ))}

      {platDetail && (
        <DetailPlatModal plat={platDetail} onFermer={() => setPlatDetail(null)} onConfirmer={confirmerDetail} />
      )}
    </div>
  )
}
