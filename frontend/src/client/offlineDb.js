// Persistance locale côté client QR (§5.5 "Mode hors-ligne — sauvegarde
// locale IndexedDB des commandes en cas de coupure internet, avec file
// d'attente de synchronisation au retour du réseau"). Deux magasins :
// - `commandesEnAttente` : commandes qui n'ont pas pu être envoyées tout
//   de suite (coupure réseau), rejouées dès que la connexion revient.
// - `menuCache` : dernier menu chargé avec succès par table, pour que le
//   client puisse continuer à consulter/composer son panier même hors
//   ligne, plutôt qu'un écran bloquant dès la première coupure.
//
// IndexedDB brut (pas de librairie) : deux magasins simples, pas besoin
// de plus pour ce volume de données.

const DB_NAME = 'kds-client-offline'
const DB_VERSION = 1
const STORE_COMMANDES = 'commandesEnAttente'
const STORE_MENU = 'menuCache'

function ouvrirDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB non disponible sur ce navigateur.'))
      return
    }
    const requete = indexedDB.open(DB_NAME, DB_VERSION)
    requete.onupgradeneeded = () => {
      const db = requete.result
      if (!db.objectStoreNames.contains(STORE_COMMANDES)) {
        db.createObjectStore(STORE_COMMANDES, { keyPath: 'idempotencyKey' })
      }
      if (!db.objectStoreNames.contains(STORE_MENU)) {
        db.createObjectStore(STORE_MENU, { keyPath: 'qrToken' })
      }
    }
    requete.onsuccess = () => resolve(requete.result)
    requete.onerror = () => reject(requete.error)
  })
}

async function transaction(store, mode, executer) {
  const db = await ouvrirDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const resultat = executer(tx.objectStore(store))
    tx.oncomplete = () => resolve(resultat?.result)
    tx.onerror = () => reject(tx.error)
  })
}

export async function mettreEnFileCommande({ idempotencyKey, qrToken, items, resume }) {
  await transaction(STORE_COMMANDES, 'readwrite', (store) =>
    store.put({ idempotencyKey, qrToken, items, resume, creeLe: Date.now() }),
  )
}

export async function listerCommandesEnFile(qrToken) {
  const toutes = await transaction(STORE_COMMANDES, 'readonly', (store) => store.getAll())
  return (toutes ?? []).filter((c) => c.qrToken === qrToken)
}

export async function retirerCommandeDeLaFile(idempotencyKey) {
  await transaction(STORE_COMMANDES, 'readwrite', (store) => store.delete(idempotencyKey))
}

export async function cacherMenu(qrToken, data) {
  await transaction(STORE_MENU, 'readwrite', (store) => store.put({ qrToken, data, cacheLe: Date.now() }))
}

export async function lireMenuCache(qrToken) {
  const entree = await transaction(STORE_MENU, 'readonly', (store) => store.get(qrToken))
  return entree?.data ?? null
}
