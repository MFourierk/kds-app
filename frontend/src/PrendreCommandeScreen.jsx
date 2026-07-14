import { useEffect, useState } from 'react'
import { apiFetch, logout } from './api'
import { formatPrix } from './client/formatPrix'

/**
 * Prise de commande par le personnel (§5.1/§5.6, demandé après coup) —
 * même routage que le flux QR client (backend : `services.
 * route_items_to_tickets` via `OrderViewSet.prendre_commande`), mais
 * authentifié. Deux usages : le serveur commande à la place du client
 * en salle, ou — cas plus important — le client ne peut plus atteindre
 * le serveur du restaurant depuis son propre réseau mobile (coupure
 * internet du restaurant), alors que le personnel connecté au WiFi
 * local le peut toujours.
 */
export default function PrendreCommandeScreen({ onChangerEcran, onDeconnexion }) {
  const [tables, setTables] = useState(null)
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [tableChoisie, setTableChoisie] = useState(null)
  const [panier, setPanier] = useState([])
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/tables/').then((r) => r.json()),
      apiFetch('/api/menu-categories/').then((r) => r.json()),
      apiFetch('/api/menu-items/').then((r) => r.json()),
    ]).then(([t, c, i]) => {
      setTables(Array.isArray(t) ? t.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true })) : [])
      setCategories(Array.isArray(c) ? c.sort((a, b) => a.ordre_affichage - b.ordre_affichage) : [])
      setItems(Array.isArray(i) ? i : [])
    })
  }, [])

  function afficherMessage(texte, erreur = false) {
    setMessage({ texte, erreur })
    setTimeout(() => setMessage(null), 5000)
  }

  function ajouterAuPanier(plat) {
    setPanier((p) => [
      ...p,
      { plat: plat.id, plat_nom: plat.nom, prix: plat.prix, quantite: 1, service_immediat: true, commentaire_libre: '' },
    ])
  }

  function modifierQuantite(index, delta) {
    setPanier((p) =>
      p
        .map((ligne, i) => (i === index ? { ...ligne, quantite: ligne.quantite + delta } : ligne))
        .filter((ligne) => ligne.quantite > 0)
    )
  }

  function toggleServiceImmediat(index) {
    setPanier((p) => p.map((ligne, i) => (i === index ? { ...ligne, service_immediat: !ligne.service_immediat } : ligne)))
  }

  function retirerDuPanier(index) {
    setPanier((p) => p.filter((_, i) => i !== index))
  }

  async function envoyerCommande() {
    if (!tableChoisie || panier.length === 0) return
    setEnCours(true)
    try {
      const res = await apiFetch('/api/orders/prendre-commande/', {
        method: 'POST',
        body: JSON.stringify({
          table: tableChoisie.id,
          items: panier.map(({ plat, quantite, service_immediat, commentaire_libre }) => ({
            plat,
            quantite,
            service_immediat,
            commentaire_libre,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        afficherMessage(data.detail ?? 'Erreur.', true)
        return
      }
      afficherMessage(`Commande envoyée pour la table ${tableChoisie.numero}.`)
      setPanier([])
      setTableChoisie(null)
    } catch {
      afficherMessage("Connexion perdue — vérifie le WiFi et réessaie.", true)
    } finally {
      setEnCours(false)
    }
  }

  const platsDisponibles = items.filter((p) => p.statut === 'disponible' && p.is_active)
  const sousTotal = panier.reduce((s, l) => s + l.prix * l.quantite, 0)

  return (
    <div className="min-h-full bg-slate-900 p-4">
      <header className="mb-4">
        <h1 className="mb-3 text-2xl font-bold text-slate-100">Prendre commande</h1>
        <div className="flex flex-wrap items-center gap-2">
          {tableChoisie && (
            <button
              onClick={() => setTableChoisie(null)}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600"
            >
              ← Changer de table
            </button>
          )}
          {onChangerEcran && (
            <button
              onClick={onChangerEcran}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600"
            >
              Changer d'écran
            </button>
          )}
          <button
            onClick={() => {
              logout()
              onDeconnexion()
            }}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600"
          >
            Déconnexion
          </button>
        </div>
      </header>

      {message && (
        <div
          className={`mb-4 rounded-xl p-3 text-center text-sm font-semibold text-white shadow-lg ${
            message.erreur ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {message.texte}
        </div>
      )}

      {!tableChoisie ? (
        !tables ? (
          <p className="text-center text-slate-500">Chargement...</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {tables.map((table) => (
              <button
                key={table.id}
                onClick={() => setTableChoisie(table)}
                className="flex flex-col items-center gap-1 rounded-xl border-2 border-slate-700 bg-slate-800 py-4 hover:border-amber-400"
              >
                <span className="text-lg font-bold text-slate-100">Table {table.numero}</span>
                <span className={`text-xs ${table.statut === 'occupee' ? 'text-amber-400' : 'text-slate-500'}`}>
                  {table.statut === 'occupee' ? 'Occupée' : 'Libre'}
                </span>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <p className="mb-4 text-lg font-semibold text-amber-400">Table {tableChoisie.numero}</p>

          <div className="space-y-6 pb-4">
            {categories.map((cat) => {
              const plats = platsDisponibles.filter((p) => p.categorie === cat.id)
              if (plats.length === 0) return null
              return (
                <section key={cat.id}>
                  <h2 className="mb-2 text-base font-bold text-slate-100">{cat.nom}</h2>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {plats.map((plat) => (
                      <button
                        key={plat.id}
                        onClick={() => ajouterAuPanier(plat)}
                        className="rounded-lg bg-slate-800 p-3 text-left hover:bg-slate-700"
                      >
                        <p className="font-semibold text-slate-100">{plat.nom}</p>
                        <p className="text-sm text-amber-400">{formatPrix(plat.prix, 'XOF')}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>

          {panier.length > 0 && (
            <div className="sticky bottom-0 -mx-4 rounded-t-2xl border-t-4 border-amber-500 bg-slate-800 p-4 shadow-2xl">
              <ul className="mb-3 max-h-48 space-y-2 overflow-y-auto">
                {panier.map((ligne, i) => (
                  <li key={i} className="rounded-lg bg-slate-900 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-slate-100">{ligne.plat_nom}</span>
                      <span className="text-sm text-slate-300" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatPrix(ligne.prix * ligne.quantite, 'XOF')}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <button onClick={() => modifierQuantite(i, -1)} className="h-6 w-6 rounded bg-slate-700 text-slate-200">
                        −
                      </button>
                      <span className="w-5 text-center text-sm text-slate-100">{ligne.quantite}</span>
                      <button onClick={() => modifierQuantite(i, 1)} className="h-6 w-6 rounded bg-slate-700 text-slate-200">
                        +
                      </button>
                      <button
                        onClick={() => toggleServiceImmediat(i)}
                        className={`rounded px-2 py-1 text-xs font-semibold ${
                          ligne.service_immediat ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-700 text-slate-400'
                        }`}
                      >
                        {ligne.service_immediat ? 'Dès que prêt' : 'Avec le reste'}
                      </button>
                      <button onClick={() => retirerDuPanier(i)} className="ml-auto text-xs text-red-400">
                        Retirer
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mb-3 flex items-center justify-between text-lg font-bold text-slate-100">
                <span>Sous-total</span>
                <span>{formatPrix(sousTotal, 'XOF')}</span>
              </div>
              <button
                onClick={envoyerCommande}
                disabled={enCours}
                className="w-full rounded-lg bg-amber-500 py-3 text-base font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
              >
                {enCours ? 'Envoi...' : `Envoyer la commande (${panier.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
