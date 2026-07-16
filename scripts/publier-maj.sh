#!/usr/bin/env bash
# Publie une version déjà construite (via build-client-package.sh) comme
# "dernière version" disponible pour les installations clientes déjà en
# place (deploy/client-package/update.sh la trouvera automatiquement).
# Ne garde que les 2 dernières versions publiées sur le VPS — écrase la
# plus ancienne à chaque nouvelle publication.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="${1:?Usage: scripts/publier-maj.sh <version>  (ex: 20260716-875450b, cf. dist-client-package/)}"
TAR_LOCAL="dist-client-package/kds-client-${VERSION}/kds-images-${VERSION}.tar"
VPS_HOST="behanian@89.167.66.194"
VPS_KEY="$HOME/.ssh/kds_deploy"
VPS_DIR="~/kds-client-packages"

if [ ! -f "$TAR_LOCAL" ]; then
  echo "Erreur : $TAR_LOCAL introuvable — lance d'abord ./scripts/build-client-package.sh $VERSION" >&2
  exit 1
fi

echo "-> Envoi de l'image ($VERSION) vers le VPS..."
scp -i "$VPS_KEY" "$TAR_LOCAL" "${VPS_HOST}:${VPS_DIR}/"

echo "-> Publication (ne garde que les 2 dernières versions)..."
ssh -i "$VPS_KEY" "$VPS_HOST" "cd ${VPS_DIR} && ls -t kds-images-*.tar 2>/dev/null | tail -n +3 | xargs -r rm -f && echo '${VERSION}' > LATEST_VERSION && echo 'Versions conservées :' && ls -la kds-images-*.tar"

echo
echo "=== Version $VERSION publiée — les installations clientes la récupéreront via update.sh ==="
