import uuid

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

from .models import PosIntegration


class PosPrincipal:
    """
    Représente un logiciel de caisse tiers authentifié par clé API.

    Joue le même rôle que `request.user` vis-à-vis des mixins tenant-scopés
    (`.tenant`, `.tenant_id`, `.is_authenticated`) sans être un vrai
    `kds_core.User` — un POS n'est pas un membre du personnel et ne doit
    pas pouvoir se connecter via les endpoints JWT/PIN habituels.
    """

    is_authenticated = True
    is_active = True

    def __init__(self, integration: PosIntegration):
        self.integration = integration
        self.tenant = integration.tenant
        self.tenant_id = integration.tenant_id

    def __str__(self):
        return f"POS:{self.integration.label}"


class PosApiKeyAuthentication(BaseAuthentication):
    """
    Authentifie une requête de logiciel de caisse tiers via
    `Authorization: Api-Key <id>.<secret>` (cf. §5.5 "Synchro POS / caisse").

    Le format `<id>.<secret>` permet un lookup direct par clé primaire
    (`id`, l'UUID de la `PosIntegration`) puis une vérification du `secret`
    par hachage (`check_secret`), sur le même principe que le PIN écran
    cuisine — jamais de comparaison en clair, jamais de scan de toutes les
    clés existantes.
    """

    keyword = "Api-Key"

    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header.startswith(f"{self.keyword} "):
            return None

        raw_key = header[len(self.keyword) + 1:]
        try:
            integration_id, secret = raw_key.split(".", 1)
            integration_id = uuid.UUID(integration_id)
        except ValueError:
            raise AuthenticationFailed("Clé API POS malformée.")

        integration = PosIntegration.objects.filter(id=integration_id, is_active=True).first()
        if integration is None or not integration.check_secret(secret):
            raise AuthenticationFailed("Clé API POS invalide.")

        return (PosPrincipal(integration), integration)

    def authenticate_header(self, request):
        return self.keyword


class IsPosIntegration(BasePermission):
    """Restreint une vue aux requêtes authentifiées via `PosApiKeyAuthentication`."""

    def has_permission(self, request, view):
        return bool(request.auth and isinstance(request.auth, PosIntegration))
