import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA (§5.5 "mode hors-ligne") — précache l'app shell (JS/CSS/HTML) via
    // service worker, pour que l'interface client QR se recharge même
    // sans réseau. Les requêtes API/WS ne passent volontairement PAS par
    // le cache Workbox : le menu et la file de commandes sont déjà gérés
    // "à la main" via IndexedDB (`client/offlineDb.js`), avec une logique
    // de fraîcheur/déduplication précise — ajouter un cache HTTP générique
    // par-dessus ferait doublon et risquerait de servir des réponses
    // périmées sans qu'on contrôle quand.
    VitePWA({
      registerType: 'autoUpdate',
      // Sans ça, un service worker déjà installé chez un utilisateur
      // continue de servir l'ancien app shell en cache tant que tous ses
      // onglets ne sont pas fermés — un `git push vps` peut donc être
      // "invisible" pendant un moment malgré un déploiement réussi
      // (constaté en usage réel : "Cuisine (PIN)" affiché alors que le
      // bundle servi contenait déjà "Service"). `skipWaiting` +
      // `clientsClaim` font prendre le contrôle immédiatement par le
      // nouveau SW dès son activation, sans attendre un rechargement
      // complet.
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: { enabled: true }, // SW actif aussi en `npm run dev`, pour pouvoir tester le mode hors-ligne sans build de prod
      manifest: {
        name: 'KDS',
        short_name: 'KDS',
        description: 'Commande et suivi de commande via QR code',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [{ src: '/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  server: {
    port: 5173,
  },
})
