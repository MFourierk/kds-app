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
// Uniquement le kiosque staff (`!matchClient`) : un client en train de
// remplir son panier sur son propre téléphone ne doit pas se faire
// recharger la page sous lui parce qu'une mise à jour du menu est
// publiée au même moment — son SW continue de s'enregistrer normalement
// (le mode hors-ligne du menu QR en dépend), juste sans le polling ni le
// rechargement forcé.
const updateSW = registerSW({
  onRegisteredSW(swUrl, registration) {
    if (!registration || matchClient) return
    setInterval(() => registration.update(), 5000)
  },
  onNeedRefresh() {
    if (!matchClient) updateSW(true)
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {matchClient ? <ClientApp qrToken={matchClient[1]} /> : <App />}
  </StrictMode>,
)
