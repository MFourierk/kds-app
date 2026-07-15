// Placeholder par défaut, inoffensif partout ailleurs (dev, build VPS).
// Réécrit au démarrage du conteneur nginx sur le paquet d'installation
// client (deploy/client-package/40-generate-env-config.sh) avec le vrai
// VITE_TENANT_SLUG de ce client, décidé seulement à l'installation.
window.__ENV__ = {}
