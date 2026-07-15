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
(cd frontend && npm run build -- --mode client-package)

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
cp deploy/client-package/README-INSTALL.md "$PKG_DIR/"
sed "s#__KDS_VERSION__#${VERSION}#" deploy/client-package/.env.client.example > "$PKG_DIR/.env.client.example"

echo "-> Archivage final..."
tar czf "$OUT_DIR/kds-client-$VERSION.tar.gz" -C "$OUT_DIR" "kds-client-$VERSION"

echo
echo "=== Paquet prêt : $OUT_DIR/kds-client-$VERSION.tar.gz ==="
echo
echo "Pour le déposer sur le VPS (retrait ultérieur en SSH) :"
echo "  scp -i ~/.ssh/kds_deploy $OUT_DIR/kds-client-$VERSION.tar.gz behanian@89.167.66.194:~/kds-client-packages/"
echo
echo "Pour une clé USB : copier directement ce fichier .tar.gz dessus."
