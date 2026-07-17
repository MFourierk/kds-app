#!/usr/bin/env bash
# Mise à jour d'une installation cliente déjà en place — à lancer depuis le
# dossier d'installation (celui qui contient .env et docker-compose.client.yml).
# Va chercher automatiquement la dernière version publiée sur le serveur
# maître (identifiant/clé API déjà dans .env, aucune ressaisie) : pas de
# reconstruction locale, pas de scp manuel, pas d'édition de .env à la main.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
  echo "Erreur : .env introuvable dans $SCRIPT_DIR — lance ce script depuis le dossier d'installation." >&2
  exit 1
fi

# `.env` est un simple fichier KEY=VALUE (déjà écrit par install.sh) — le
# sourcer directement plutôt que de le re-parser à la main. Volontairement
# SANS `set -a` : si ces variables étaient exportées, `docker compose`
# (appelé plus bas) en hériterait via l'environnement du process — qui
# primerait alors sur le `.env` pourtant déjà mis à jour par le `sed` juste
# avant (l'environnement du process a priorité sur le fichier pour la
# substitution de variables de Compose). Bug réel trouvé en testant : sans
# ce détail, `docker compose up -d` relançait l'ANCIENNE version malgré un
# `.env` correctement modifié sur disque.
source .env

if [ -z "${LICENCE_MASTER_URL:-}" ] || [ -z "${LICENCE_IDENTIFIANT:-}" ] || [ -z "${LICENCE_CLE_API:-}" ]; then
  echo "Erreur : LICENCE_MASTER_URL/LICENCE_IDENTIFIANT/LICENCE_CLE_API manquants dans .env." >&2
  exit 1
fi

VERSION_ACTUELLE="${KDS_VERSION:-inconnue}"
echo "Version actuellement installée : $VERSION_ACTUELLE"
echo "-> Vérification de la dernière version disponible..."

REPONSE=$(curl -fsS "${LICENCE_MASTER_URL}/api/licence/derniere-version/?identifiant=${LICENCE_IDENTIFIANT}&cle_api=${LICENCE_CLE_API}") || {
  echo "Impossible de contacter le serveur maître (pas d'internet ?). Rien à faire pour l'instant." >&2
  exit 0
}

# Réponse toujours de forme fixe `{"version":"..."}` — extraction directe
# sans dépendance à python3 pour un JSON aussi simple.
DERNIERE_VERSION=$(echo "$REPONSE" | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]+)"$/\1/')
if [ -z "$DERNIERE_VERSION" ]; then
  echo "Réponse inattendue du serveur maître : $REPONSE" >&2
  exit 1
fi

if [ "$DERNIERE_VERSION" = "$VERSION_ACTUELLE" ]; then
  echo "Déjà à jour (version $VERSION_ACTUELLE)."
  exit 0
fi

echo "Nouvelle version disponible : $DERNIERE_VERSION"
TAR_TEMP=$(mktemp --suffix=.tar)
trap 'rm -f "$TAR_TEMP"' EXIT

echo "-> Téléchargement (~110 Mo, reprise automatique en cas de coupure)..."
# `-C -` : reprend là où une tentative précédente s'est arrêtée plutôt que
# de repartir de zéro ; `--retry`/`--retry-all-errors` : un fichier de
# cette taille sur une connexion imparfaite (Wi-Fi client, cf. terrain)
# a de vraies chances de subir une coupure en cours de route — sans ça,
# une simple coupure faisait échouer toute la mise à jour au lieu de
# réessayer automatiquement.
curl -fsS --retry 5 --retry-delay 3 --retry-all-errors -C - -o "$TAR_TEMP" \
  "${LICENCE_MASTER_URL}/api/licence/telecharger/${DERNIERE_VERSION}/?identifiant=${LICENCE_IDENTIFIANT}&cle_api=${LICENCE_CLE_API}"

echo "-> Chargement de l'image Docker..."
docker load -i "$TAR_TEMP"

echo "-> Mise à jour de .env..."
sed -i "s/^KDS_VERSION=.*/KDS_VERSION=${DERNIERE_VERSION}/" .env

echo "-> Redémarrage des conteneurs..."
docker compose -f docker-compose.client.yml up -d

echo
echo "=== Mise à jour terminée : $VERSION_ACTUELLE → $DERNIERE_VERSION ==="
