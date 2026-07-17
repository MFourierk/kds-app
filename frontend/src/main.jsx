import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import ClientApp from './client/ClientApp.jsx'

// Routage volontairement minimal (pas de react-router) : deux "profils"
// bien distincts partagent ce projet — l'écran KDS (staff, login requis)
// à la racine, et l'interface client anonyme sous /t/<qr_code_token>/
// (le lien encodé dans le QR code imprimé sur la table, §5.6).
const matchClient = window.location.pathname.match(/^\/t\/([^/]+)\/?$/)

// Rafraîchissement automatique du kiosque (§PWA, demandé après coup —
// jusqu'ici un "Ctrl+Alt+R" manuel après chaque mise à jour publiée,
// parfois oublié : "il arrive que des mise à jour passe et cela ne
// s'affiche pas"). Cause : un kiosque reste ouvert indéfiniment sans
// jamais renaviguer/recharger — le service worker n'apprend l'existence
// d'un nouveau déploiement qu'au moment où on l'y force explicitement via
// `registration.update()` ; `registerType: 'autoUpdate'` seul
// (`vite.config.js`) ne suffit pas sur un onglet qui ne revérifie jamais.
// Une fois le nouveau SW détecté, il prend le contrôle tout seul
// (`skipWaiting`/`clientsClaim`), mais le bundle JS déjà en mémoire doit
// être rechargé pour s'exécuter réellement — `onNeedRefresh` s'en charge.
//
// Le kiosque staff (`!matchClient`) recharge sans demander (personne
// n'a de saisie en cours sur un écran inoccupé). Le client QR poll aussi
// (sinon un téléphone qui a déjà visité une fois reste bloqué sur un
// vieux bundle pour toujours — vécu en prod : le correctif "Envoi..."
// qui reste bloqué n'atteignait jamais un téléphone déjà venu avant sa
// publication), mais ne recharge JAMAIS de force sous un panier en
// cours de composition — `ClientApp` applique la mise à jour dès que
// son panier repasse à vide (juste après une commande envoyée, ou avant
// même d'avoir commencé), et propose un bouton pour le faire plus tôt.
const updateSW = registerSW({
  onRegisteredSW(swUrl, registration) {
    if (!registration) return
    setInterval(() => registration.update(), matchClient ? 30000 : 5000)
  },
  onNeedRefresh() {
    if (matchClient) {
      window.__kdsAppliquerMiseAJour = () => updateSW(true)
      window.dispatchEvent(new CustomEvent('kds-maj-disponible'))
    } else {
      updateSW(true)
    }
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {matchClient ? <ClientApp qrToken={matchClient[1]} /> : <App />}
  </StrictMode>,
)
