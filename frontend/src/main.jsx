import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ClientApp from './client/ClientApp.jsx'

// Routage volontairement minimal (pas de react-router) : deux "profils"
// bien distincts partagent ce projet — l'écran KDS (staff, login requis)
// à la racine, et l'interface client anonyme sous /t/<qr_code_token>/
// (le lien encodé dans le QR code imprimé sur la table, §5.6).
const matchClient = window.location.pathname.match(/^\/t\/([^/]+)\/?$/)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {matchClient ? <ClientApp qrToken={matchClient[1]} /> : <App />}
  </StrictMode>,
)
