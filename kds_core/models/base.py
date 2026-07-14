import uuid

from django.db import models


class UUIDModel(models.Model):
    """Clé primaire UUID pour tous les modèles métier (évite les IDs séquentiels devinables)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    """Ajoute les champs de suivi de création/modification."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TenantScopedModel(UUIDModel, TimeStampedModel):
    """
    Modèle de base pour toute donnée rattachée à un établissement (tenant).

    Garantit l'isolation stricte des données entre clients (architecture marque
    blanche). Toute vue/API doit systématiquement filtrer par `tenant` — ne
    jamais exposer un queryset non filtré côté API multi-tenant.
    """

    tenant = models.ForeignKey(
        "kds_core.Tenant",
        on_delete=models.CASCADE,
        related_name="%(class)ss",
    )

    class Meta:
        abstract = True
