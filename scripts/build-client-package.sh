#!/usr/bin/env bash
# Construit le paquet d'installation client (Docker, hors-ligne) — à lancer
# sur la machine de l'opérateur (Docker Desktop + Node déjà installés ici,
# jamais sur le VPS). Voir DEPLOY.md, section "Paquet d'installation client".
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="${1:-$(date +%Y%m%d)-$(git rev-parse --short HEAD)}"
OUT_DIR="dist-client-package"
PKG_DIR="$OUT_DIR/kds-client-$VERSION"

echo "=== Construction du paquet client — version $VERSION ==="

echo "-> Build frontend (profil client-package, URLs relatives)..."
# `--outDir dist-client-package` : jamais dans `frontend/dist/` (le build
# VPS, committé tel quel avec une URL absolue — cf. .env.production) sous
# peine de l'écraser silencieusement avec ce profil URLs-relatives à
# chaque construction du paquet client. `frontend/dist-client-package/`
# est un artefact de build, gitignored, jamais commité.
(cd frontend && npm run build -- --mode client-package --outDir dist-client-package)

echo "-> Build image backend..."
docker build --platform linux/amd64 -f deploy/client-package/Dockerfile.backend -t "kds-backend:$VERSION" .

echo "-> Build image frontend..."
docker build --platform linux/amd64 -f deploy/client-package/Dockerfile.frontend -t "kds-frontend:$VERSION" .

rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"

echo "-> Sauvegarde des images (docker save)..."
docker save "kds-backend:$VERSION" "kds-frontend:$VERSION" -o "$PKG_DIR/kds-images-$VERSION.tar"

echo "-> Assemblage du paquet..."
cp deploy/client-package/docker-compose.client.yml "$PKG_DIR/"
cp deploy/client-package/install.sh "$PKG_DIR/"
chmod +x "$PKG_DIR/install.sh"
# update.sh embarqué dès la première install (§mise à jour client) — une
# installation déjà en place n'a jamais besoin de retélécharger un paquet
# complet, juste de lancer ce script pour se mettre à jour toute seule.
cp deploy/client-package/update.sh "$PKG_DIR/"
chmod +x "$PKG_DIR/update.sh"
cp deploy/client-package/README-INSTALL.md "$PKG_DIR/"
sed "s#__KDS_VERSION__#${VERSION}#" deploy/client-package/.env.client.example > "$PKG_DIR/.env.client.example"

echo "-> Archivage final..."
tar czf "$OUT_DIR/kds-client-$VERSION.tar.gz" -C "$OUT_DIR" "kds-client-$VERSION"

echo
echo "=== Paquet prêt : $OUT_DIR/kds-client-$VERSION.tar.gz ==="
echo
echo "Première installation chez un nouveau client (hors ligne) :"
echo "  copier ce .tar.gz sur place (clé USB), ou le déposer sur le VPS :"
echo "  scp -i ~/.ssh/kds_deploy $OUT_DIR/kds-client-$VERSION.tar.gz behanian@89.167.66.194:~/kds-client-packages/"
echo
echo "Mise à jour d'installations clientes déjà en place (elles la récupèrent"
echo "elles-mêmes via update.sh, rien à transférer à la main) :"
echo "  ./scripts/publier-maj.sh $VERSION"
