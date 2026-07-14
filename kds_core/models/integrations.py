import secrets

from django.contrib.auth.hashers import check_password, make_password
from django.db import models

from .base import TenantScopedModel


class PosIntegration(TenantScopedModel):
    """
    Identifiants d'intégration pour un logiciel de caisse (POS) tiers
    (cf. cahier des charges §5.5 "Synchro POS / caisse").

    Un POS n'est pas un membre du personnel (`kds_core.User`) : il
    s'authentifie par clé API (`kds_core.pos_auth.PosApiKeyAuthentication`),
    pas par JWT/PIN. `secret_hash` suit le même principe que
    `User.pin_code` — jamais stocké ni renvoyé en clair après création.
    """

    label = models.CharField(max_length=100, help_text="Ex: « Caisse principale », nom du logiciel POS")
    secret_hash = models.CharField(max_length=128, editable=False)
    webhook_url = models.URLField(
        blank=True,
        help_text="Appelé en POST par le KDS quand une commande passe prête/servie",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["label"]

    def set_secret(self, raw_secret: str) -> None:
        self.secret_hash = make_password(raw_secret)

    def check_secret(self, raw_secret: str) -> bool:
        if not self.secret_hash:
            return False
        return check_password(raw_secret, self.secret_hash)

    @staticmethod
    def generate_secret() -> str:
        return secrets.token_urlsafe(32)

    def __str__(self):
        return f"{self.label} — {self.tenant.nom_etablissement}"
