from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """
    Utilisateur applicatif : admin, manager, cuisinier ou serveur, rattaché à un tenant.

    Les rôles admin/manager utilisent l'authentification classique (email + mdp).
    Les rôles cuisinier/serveur utilisent en priorité le code PIN pour une
    connexion rapide sur écran tactile (cf. cahier des charges §6.4).
    """

    class Role(models.TextChoices):
        ADMIN = "admin", "Administrateur"
        MANAGER = "manager", "Manager"
        CUISINIER = "cuisinier", "Cuisinier"
        BARMAN = "barman", "Barman"
        SERVEUR = "serveur", "Serveur"
        # Vente comptoir uniquement (écran TPE) — pas de poste cuisine, pas
        # d'accès au tableau de bord, cf. `VenteComptoirScreen.jsx`.
        CAISSIER = "caissier", "Caissière"

    tenant = models.ForeignKey(
        "kds_core.Tenant",
        on_delete=models.CASCADE,
        related_name="utilisateurs",
        null=True,
        blank=True,
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.SERVEUR)
    station_assignee = models.ForeignKey(
        "kds_core.Station",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="utilisateurs",
    )
    pin_code = models.CharField(
        max_length=128,
        blank=True,
        help_text="Code PIN haché (jamais stocké en clair) pour connexion rapide écran tactile",
    )

    class Meta:
        ordering = ["tenant", "role", "username"]

    def set_pin(self, raw_pin: str) -> None:
        self.pin_code = make_password(raw_pin)

    def check_pin(self, raw_pin: str) -> bool:
        if not self.pin_code:
            return False
        return check_password(raw_pin, self.pin_code)

    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.get_role_display()})"
