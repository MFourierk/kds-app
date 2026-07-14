import { useEffect, useRef, useState } from 'react'
import { appelerServeur, creerCommande, ErreurReseau, fetchMenu, fetchSuivi, MESSAGE_HORS_LIGNE } from './clientApi'
import { cacherMenu, lireMenuCache, listerCommandesEnFile, mettreEnFileCommande, retirerCommandeDeLaFile } from './offlineDb'
import { amorcerAudio, jouerBip, jouerDoubleBip } from '../notificationSound'
import { formatPrix } from './formatPrix'
import MenuView from './MenuView'
import TrackingView from './TrackingView'

const INTERVALLE_SUIVI_MS = 5000

/**
 * Compare deux réponses successives de `fetchSuivi` (§5.6) pour détecter
 * les transitions à notifier au client — un plat qui passe "prêt", ou un
 * TICKET qui passe "servi" (la cuisine vient de le faire partir en
 * salle). Le polling REST ne pousse rien tout seul, donc c'est ce diff qui
 * tient lieu de "notification temps réel" côté client.
 *
 * Le déclencheur est le TICKET, pas `commande.statut` : celui-ci ne passe
 * "servie" qu'une fois TOUS les tickets de TOUS les postes servis, ce qui
 * est trop tardif — un ticket (ex: les boissons) peut déjà être en route
 * vers la table pendant qu'un autre poste prépare encore le plat
 * principal. "Lorsque la cuisine signale SERVI" (demande explicite) veut
 * dire à l'échelle du ticket, pas de la commande entière.
 */
function detecterEvenements(precedent, nouveau) {
  if (!precedent) return []
  const evenements = []
  for (const commande of nouveau.commandes) {
    const avant = precedent.commandes.find((c) => c.id === commande.id)
    if (!avant) continue
    for (const ticket of commande.tickets) {
      const ticketAvant = avant.tickets.find((t) => t.id === ticket.id)
      if (ticketAvant && ticketAvant.statut !== 'servi' && ticket.statut === 'servi') {
        evenements.push({ type: 'servie' })
      }
    }
    for (const item of commande.items) {
      const itemAvant = avant.items.find((i) => i.id === item.id)
      if (itemAvant && itemAvant.statut_ligne !== 'pret' && item.statut_ligne === 'pret') {
        evenements.push({ type: 'plat_pret', plat_nom: item.plat_nom })
      }
    }
  }
  return evenements
}

function EcranHorsLigne({ onReessayer }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-gray-100 p-8 text-center">
      <p className="text-4xl">📶</p>
      <p className="text-lg font-semibold text-gray-800">{MESSAGE_HORS_LIGNE}</p>
      <button
        onClick={onReessayer}
        className="rounded-lg bg-gray-800 px-6 py-3 font-semibold text-white"
      >
        Réessayer
      </button>
    </div>
  )
}

export default function ClientApp({ qrToken }) {
  const [menu, setMenu] = useState(null)
  const [panier, setPanier] = useState([])
  const [onglet, setOnglet] = useState('menu') // menu | suivi
  const [suivi, setSuivi] = useState(null)
  // `modeHorsLigne` n'est plus un écran bloquant à lui seul (cf. rendu
  // plus bas) : avec un menu en cache (§5.5), le client continue de
  // consulter/composer son panier hors ligne — seul un bandeau persistant
  // le rappelle. Le blocage total ne reste que pour la toute première
  // visite hors ligne, sans aucun menu déjà mis en cache.
  const [modeHorsLigne, setModeHorsLigne] = useState(false)
  const [erreurCommande, setErreurCommande] = useState('')
  const [messageAppel, setMessageAppel] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [essaiMenu, setEssaiMenu] = useState(0)
  const [notification, setNotification] = useState('')
  const [commandesEnFile, setCommandesEnFile] = useState([])
  const suiviPrecedentRef = useRef(null)

  useEffect(() => {
    let annule = false
    fetchMenu(qrToken)
      .then((data) => {
        if (annule) return
        setMenu(data)
        setModeHorsLigne(false)
        cacherMenu(qrToken, data)
      })
      .catch(async (e) => {
        if (annule) return
        if (!(e instanceof ErreurReseau)) return
        setModeHorsLigne(true)
        // Pas de menu déjà chargé cette session : on retombe sur le
        // dernier menu mis en cache lors d'une visite précédente, s'il y
        // en a un — mieux qu'un écran bloquant si le client a déjà
        // parcouru ce menu avant la coupure.
        const enCache = await lireMenuCache(qrToken)
        if (!annule && enCache) setMenu((actuel) => actuel ?? enCache)
      })
    return () => {
      annule = true
    }
  }, [qrToken, essaiMenu])

  // Rejoue la file d'attente hors-ligne (§5.5) dès que possible : au
  // montage (une commande a pu rester en file d'une session précédente,
  // ex: l'app a été fermée avant le retour réseau) et à chaque fois que
  // le navigateur signale un retour de connexion.
  useEffect(() => {
    rafraichirFile()
    synchroniserFile()
    function surRetourEnLigne() {
      synchroniserFile()
    }
    window.addEventListener('online', surRetourEnLigne)
    return () => window.removeEventListener('online', surRetourEnLigne)
  }, [qrToken])

  async function rafraichirFile() {
    const file = await listerCommandesEnFile(qrToken)
    setCommandesEnFile(file)
  }

  async function synchroniserFile() {
    const file = await listerCommandesEnFile(qrToken)
    for (const commande of file) {
      try {
        await creerCommande(qrToken, commande.items, commande.idempotencyKey)
        await retirerCommandeDeLaFile(commande.idempotencyKey)
        setModeHorsLigne(false)
      } catch (e) {
        if (e instanceof ErreurReseau) {
          // Toujours hors ligne : on s'arrête là, on retentera au
          // prochain événement "online" plutôt que de boucler en vain
          // sur les commandes suivantes de la file.
          await rafraichirFile()
          return
        }
        // Erreur HTTP réelle (ex: plat retiré du menu entretemps) : on
        // retire quand même de la file pour ne pas y rester bloqué pour
        // toujours sur une commande qui ne passera jamais.
        await retirerCommandeDeLaFile(commande.idempotencyKey)
      }
    }
    await rafraichirFile()
  }

  useEffect(() => {
    if (onglet !== 'suivi') return
    let annule = false

    async function poll() {
      try {
        const data = await fetchSuivi(qrToken)
        if (!annule) {
          const evenements = detecterEvenements(suiviPrecedentRef.current, data)
          const servie = evenements.find((e) => e.type === 'servie')
          const platPret = evenements.find((e) => e.type === 'plat_pret')
          if (servie) {
            jouerDoubleBip()
            afficherNotification('Votre commande arrive !')
          } else if (platPret) {
            jouerBip()
            afficherNotification(`${platPret.plat_nom} est prêt !`)
          }
          suiviPrecedentRef.current = data
          setSuivi(data)
          setModeHorsLigne(false)
        }
      } catch (e) {
        if (!annule && e instanceof ErreurReseau) setModeHorsLigne(true)
      }
    }

    poll()
    const interval = setInterval(poll, INTERVALLE_SUIVI_MS)
    return () => {
      annule = true
      clearInterval(interval)
    }
  }, [onglet, qrToken])

  function afficherNotification(message) {
    setNotification(message)
    setTimeout(() => setNotification(''), 8000)
  }

  function ajouterAuPanier(ligne) {
    amorcerAudio() // premier vrai geste utilisateur probable — débloque le son pour les notifs à venir
    setPanier((p) => {
      // Même plat + même choix "dès que prêt/avec le reste" + même
      // commentaire = la même ligne pour le client : on additionne la
      // quantité plutôt que d'afficher deux lignes identiques dans le
      // panier. Un commentaire ou un choix de service différent reste
      // volontairement une ligne à part (ce n'est plus "le même" ajout).
      const index = p.findIndex(
        (l) =>
          l.plat === ligne.plat &&
          l.service_immediat === ligne.service_immediat &&
          l.commentaire_libre === ligne.commentaire_libre,
      )
      if (index === -1) return [...p, ligne]
      const copie = [...p]
      copie[index] = { ...copie[index], quantite: copie[index].quantite + ligne.quantite }
      return copie
    })
  }

  function retirerDuPanier(index) {
    setPanier((p) => p.filter((_, i) => i !== index))
  }

  async function validerCommande() {
    setEnvoiEnCours(true)
    setErreurCommande('')
    // Généré ici (pas dans clientApi.js) : c'est CETTE tentative précise
    // qui doit garder la même clé si elle est rejouée depuis la file
    // hors-ligne, sinon la déduplication côté serveur ne sert à rien.
    const idempotencyKey = crypto.randomUUID()
    const items = panier.map(({ plat, quantite, service_immediat, commentaire_libre }) => ({
      plat,
      quantite,
      service_immediat,
      commentaire_libre,
    }))
    try {
      await creerCommande(qrToken, items, idempotencyKey)
      setModeHorsLigne(false)
      setPanier([])
      setOnglet('suivi')
    } catch (e) {
      if (e instanceof ErreurReseau) {
        // Pas de connexion pour envoyer la commande maintenant : mise en
        // file IndexedDB plutôt qu'un blocage pur — le client garde la
        // main, la commande partira dès que la connexion revient (§5.5).
        await mettreEnFileCommande({
          idempotencyKey,
          qrToken,
          items,
          resume: panier.map((l) => `${l.quantite}× ${l.plat_nom}`).join(', '),
        })
        await rafraichirFile()
        setModeHorsLigne(true)
        setPanier([])
        setOnglet('suivi')
        afficherNotification('Connexion indisponible — votre commande est enregistrée, elle sera envoyée dès que possible.')
      } else {
        setErreurCommande(e.message)
      }
    } finally {
      setEnvoiEnCours(false)
    }
  }

  async function handleAppelServeur() {
    amorcerAudio()
    try {
      const res = await appelerServeur(qrToken)
      jouerBip()
      setModeHorsLigne(false)
      setMessageAppel(res.message_urgence || 'Le serveur a été notifié — merci de patienter.')
      setTimeout(() => setMessageAppel(''), 8000)
    } catch (e) {
      if (e instanceof ErreurReseau) setModeHorsLigne(true)
    }
  }

  if (modeHorsLigne && !menu) {
    return (
      <EcranHorsLigne
        onReessayer={() => {
          setModeHorsLigne(false)
          setEssaiMenu((n) => n + 1)
        }}
      />
    )
  }

  if (!menu) {
    return <div className="flex h-full items-center justify-center bg-gray-100 text-gray-500">Chargement du menu...</div>
  }

  const couleurPrimaire = menu.tenant.couleur_primaire || '#1B2431'
  const couleurSecondaire = menu.tenant.couleur_secondaire || '#C9A24B'
  // "Sous-total", pas "Total" : le client peut encore ajouter des plats
  // tant qu'il n'a pas validé — ce n'est pas la somme finale de la visite
  // (qui inclura d'éventuelles commandes suivantes, cf. §5.5/§5.6).
  const sousTotal = panier.reduce((somme, ligne) => somme + Number(ligne.prix) * ligne.quantite, 0)

  return (
    <div
      className="flex h-full flex-col bg-gray-100"
      style={{ '--color-primary': couleurPrimaire, '--color-secondary': couleurSecondaire }}
    >
      <header className="flex items-center justify-between px-4 py-4 text-white" style={{ backgroundColor: couleurPrimaire }}>
        <div className="flex items-center gap-3">
          {menu.tenant.logo && (
            <img src={menu.tenant.logo} alt="" className="h-10 w-10 rounded-full bg-white object-contain p-0.5" />
          )}
          <div>
            <p className="text-lg font-bold">{menu.tenant.nom_etablissement}</p>
            <p className="text-sm opacity-80">Table {menu.table.numero}</p>
          </div>
        </div>
        <button
          onClick={handleAppelServeur}
          className="rounded-full px-4 py-2 text-sm font-semibold"
          style={{ backgroundColor: couleurSecondaire, color: couleurPrimaire }}
        >
          🔔 Appeler
        </button>
      </header>

      {modeHorsLigne && (
        <div className="bg-amber-100 p-2 text-center text-xs font-semibold text-amber-800">
          📶 Hors ligne — menu en cache{commandesEnFile.length > 0 ? `, ${commandesEnFile.length} commande(s) en attente d'envoi` : ''}
        </div>
      )}
      {notification && (
        <div className="bg-sky-100 p-3 text-center text-sm font-semibold text-sky-800">🔔 {notification}</div>
      )}
      {messageAppel && (
        <div className="bg-emerald-100 p-3 text-center text-sm font-semibold text-emerald-800">{messageAppel}</div>
      )}
      {erreurCommande && (
        <div className="bg-red-100 p-3 text-center text-sm font-semibold text-red-800">{erreurCommande}</div>
      )}

      <nav className="flex border-b bg-white">
        <button
          onClick={() => setOnglet('menu')}
          className={`flex-1 py-3 text-center font-semibold ${onglet === 'menu' ? 'border-b-2' : 'text-gray-400'}`}
          style={onglet === 'menu' ? { borderColor: couleurPrimaire, color: couleurPrimaire } : undefined}
        >
          Menu
        </button>
        <button
          onClick={() => setOnglet('suivi')}
          className={`flex-1 py-3 text-center font-semibold ${onglet === 'suivi' ? 'border-b-2' : 'text-gray-400'}`}
          style={onglet === 'suivi' ? { borderColor: couleurPrimaire, color: couleurPrimaire } : undefined}
        >
          Ma commande {(suivi?.commandes?.length ?? 0) + commandesEnFile.length > 0 ? `(${(suivi?.commandes?.length ?? 0) + commandesEnFile.length})` : ''}
        </button>
      </nav>

      <main className="flex-1 overflow-y-auto">
        {onglet === 'menu' ? (
          <MenuView categories={menu.categories} devise={menu.tenant.devise} onAjouter={ajouterAuPanier} />
        ) : (
          <TrackingView suivi={suivi} devise={menu.tenant.devise} commandesEnFile={commandesEnFile} />
        )}
      </main>

      {onglet === 'menu' && panier.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-white p-4 shadow-lg">
          <ul className="mb-3 max-h-32 space-y-1 overflow-y-auto text-sm">
            {panier.map((ligne, index) => (
              <li key={index} className="flex items-center justify-between">
                <span>
                  {ligne.quantite}× {ligne.plat_nom}
                  {!ligne.service_immediat && <span className="ml-1 text-xs text-gray-400">(avec le reste)</span>}
                </span>
                <button onClick={() => retirerDuPanier(index)} className="text-red-500">
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="mb-3 flex items-center justify-between border-t pt-2 text-sm font-semibold text-gray-700">
            <span>Sous-total</span>
            <span>{formatPrix(sousTotal, menu.tenant.devise)}</span>
          </div>
          <button
            onClick={validerCommande}
            disabled={envoiEnCours}
            className="w-full rounded-lg py-3 font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: couleurPrimaire }}
          >
            {envoiEnCours ? 'Envoi...' : `Commander (${panier.length})`}
          </button>
        </div>
      )}
    </div>
  )
}
