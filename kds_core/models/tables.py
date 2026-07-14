import uuid

from django.db import models

from .base import TenantScopedModel


class RestaurantTable(TenantScopedModel):
    """Table physique du restaurant, associée à un QR code unique (carton de table)."""

    class Statut(models.TextChoices):
        LIBRE = "libre", "Libre"
        OCCUPEE = "occupee", "Occupée"
        APPEL_SERVEUR = "appel_serveur", "Appel serveur actif"

    numero = models.CharField(max_length=20)
    qr_code_token = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False,
        help_text="Token encodé dans le QR code imprimé, sert d'URL d'accès client",
    )
    statut = models.CharField(max_length=20, choices=Statut.choices, default=Statut.LIBRE)

    class Meta:
        ordering = ["numero"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "numero"], name="unique_table_par_tenant"),
        ]

    def __str__(self):
        return f"Table {self.numero}"
