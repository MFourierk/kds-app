#!/usr/bin/env bash
# Installation d'une instance KDS chez un client — pensé pour tourner sans
# aucun accès internet (cf. README-INSTALL.md). Le seul prérequis est que
# Docker Engine soit déjà installé sur cette machine (préparé au bureau,
# avec internet — jamais fait par ce script).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DEFAULT_LICENCE_MASTER_URL="https://kds.behanian.com"

echo "=== Installation KDS (client) ==="
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "Erreur : Docker n'est pas installé sur cette machine." >&2
  echo "Docker doit être installé AU PRÉALABLE, avec internet, avant de venir sur place." >&2
  echo "  curl -fsSL https://get.docker.com | sh" >&2
  exit 1
fi

IMAGE_TAR=$(ls kds-images-*.tar 2>/dev/null | head -n1 || true)
if [ -z "$IMAGE_TAR" ]; then
  echo "Erreur : aucun fichier kds-images-*.tar trouvé dans $SCRIPT_DIR." >&2
  exit 1
fi
echo "-> Chargement des images Docker ($IMAGE_TAR)..."
docker load -i "$IMAGE_TAR"

echo
echo "--- Établissement ---"
read -rp "Nom de l'établissement : " TENANT_NOM
SLUG_SUGGERE=$(echo "$TENANT_NOM" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//')
read -rp "Identifiant technique (slug) [$SLUG_SUGGERE] : " TENANT_SLUG
TENANT_SLUG="${TENANT_SLUG:-$SLUG_SUGGERE}"

echo
echo "--- Premier compte admin ---"
read -rp "Identifiant admin : " ADMIN_USERNAME
while true; do
  read -rsp "Mot de passe admin : " ADMIN_PASSWORD; echo
  read -rsp "Confirmer le mot de passe : " ADMIN_PASSWORD_CONFIRM; echo
  [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD_CONFIRM" ] && break
  echo "Les deux mots de passe ne correspondent pas, réessayez."
done
read -rp "Email admin (optionnel) : " ADMIN_EMAIL

echo
echo "--- Licence ---"
echo "(identifiant + clé API fournis au préalable via le Django admin du VPS maître —"
echo " pas besoin d'internet ici, la vérification se fera dès que la connexion sera rétablie)"
read -rp "Identifiant de licence : " LICENCE_IDENTIFIANT
read -rp "Clé API de licence : " LICENCE_CLE_API
read -rp "URL du serveur maître [$DEFAULT_LICENCE_MASTER_URL] : " LICENCE_MASTER_URL
LICENCE_MASTER_URL="${LICENCE_MASTER_URL:-$DEFAULT_LICENCE_MASTER_URL}"

echo
echo "--- Réseau local ---"
IP_DETECTEE=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
read -rp "IP locale de cette machine [$IP_DETECTEE] : " IP_LOCALE
IP_LOCALE="${IP_LOCALE:-$IP_DETECTEE}"
if [ -z "$IP_LOCALE" ]; then
  echo "Erreur : impossible de déterminer l'IP locale, et aucune valeur saisie." >&2
  exit 1
fi

echo
echo "-> Génération des secrets..."
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))" 2>/dev/null || openssl rand -base64 50 | tr -d '\n')
DB_PASSWORD=$(openssl rand -hex 16)

echo "-> Écriture de .env..."
sed \
  -e "s#__SECRET_KEY__#${SECRET_KEY}#" \
  -e "s#__ALLOWED_HOSTS__#${IP_LOCALE},localhost#" \
  -e "s#__CORS_ALLOWED_ORIGINS__#http://${IP_LOCALE}#" \
  -e "s#__DB_PASSWORD__#${DB_PASSWORD}#" \
  -e "s#__LICENCE_MASTER_URL__#${LICENCE_MASTER_URL}#" \
  -e "s#__LICENCE_IDENTIFIANT__#${LICENCE_IDENTIFIANT}#" \
  -e "s#__LICENCE_CLE_API__#${LICENCE_CLE_API}#" \
  -e "s#__TENANT_SLUG__#${TENANT_SLUG}#" \
  .env.client.example > .env

echo "-> Démarrage des conteneurs..."
docker compose -f docker-compose.client.yml up -d

echo "-> Attente que l'application soit prête (migrations en cours)..."
for i in $(seq 1 60); do
  STATUT=$(docker compose -f docker-compose.client.yml ps backend --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('Health',''))" 2>/dev/null || true)
  [ "$STATUT" = "healthy" ] && break
  sleep 2
done
if [ "$STATUT" != "healthy" ]; then
  echo "Erreur : le service backend n'est pas devenu prêt à temps." >&2
  echo "Vérifier : docker compose -f docker-compose.client.yml logs backend" >&2
  exit 1
fi

echo "-> Création du tenant et du compte admin..."
docker compose -f docker-compose.client.yml exec -T backend python manage.py setup_tenant \
  --tenant-nom "$TENANT_NOM" \
  --tenant-slug "$TENANT_SLUG" \
  --admin-username "$ADMIN_USERNAME" \
  --admin-password "$ADMIN_PASSWORD" \
  --admin-email "$ADMIN_EMAIL"

echo
echo "=== Installation terminée ==="
echo "Accès : http://${IP_LOCALE}/"
echo "Compte admin : ${ADMIN_USERNAME}"
echo
echo "La vérification de licence se fera automatiquement (toutes les 6h,"
echo "dès que cette machine aura accès à internet) — rien d'autre à faire."
echo
echo "Pour mettre à jour cette installation plus tard : ./update.sh"
echo "(va chercher automatiquement la dernière version, aucun fichier à transférer à la main)"
