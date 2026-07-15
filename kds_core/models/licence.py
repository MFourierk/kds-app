import secrets

from django.db import models
from django.utils import timezone

from .base import TimeStampedModel, UUIDModel

# Seuils du modèle de sanction progressif (jours de retard sur
# `date_prochaine_echeance`), validés avec l'utilisateur : avertissement dès
# le premier jour de retard, rapports désactivés à 15 jours, blocage complet
# à 45 jours. Pas de configuration par tenant — une seule politique pour
# toutes les installations clientes.
JOURS_AVANT_RETARD_PROLONGE = 15
JOURS_AVANT_SUSPENSION = 45


class LicenceClient(UUIDModel, TimeStampedModel):
    """
    Suivi des abonnements des installations locales chez les clients —
    UNIQUEMENT sur le serveur maître (§licence). Une ligne = une
    installation cliente distincte, jamais un tenant de CETTE base : le
    maître ne contient jamais les données du restaurant client (menu,
    commandes...), seulement son statut d'abonnement. Gérée à la main
    via `/admin/` pour l'instant — pas de vraie facturation automatisée,
    juste un pointage périodique + un statut calculé.
    """

    class Statut(models.TextChoices):
        ACTIF = "actif", "Actif"
        RETARD = "retard", "Retard — avertissement"
        RETARD_PROLONGE = "retard_prolonge", "Retard prolongé — rapports désactivés"
        SUSPENDU = "suspendu", "Suspendu — accès bloqué"

    identifiant = models.SlugField(
        max_length=100, unique=True, help_text="Identifiant stable de l'installation (ex: slug du restaurant)."
    )
    nom_client = models.CharField(max_length=150)
    cle_api = models.CharField(
        max_length=64,
        unique=True,
        editable=False,
        help_text="Secret partagé avec l'installation cliente pour authentifier ses pointages.",
    )
    date_prochaine_echeance = models.DateField(help_text="Date jusqu'à laquelle l'abonnement est payé.")
    dernier_pointage = models.DateTimeField(null=True, blank=True, editable=False)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["nom_client"]

    def save(self, *args, **kwargs):
        if not self.cle_api:
            self.cle_api = secrets.token_hex(32)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.nom_client

    @property
    def statut(self):
        jours_retard = (timezone.localdate() - self.date_prochaine_echeance).days
        if jours_retard <= 0:
            return self.Statut.ACTIF
        if jours_retard < JOURS_AVANT_RETARD_PROLONGE:
            return self.Statut.RETARD
        if jours_retard < JOURS_AVANT_SUSPENSION:
            return self.Statut.RETARD_PROLONGE
        return self.Statut.SUSPENDU


class EtatLicenceLocal(models.Model):
    """
    Cache local du dernier statut de licence connu — présent sur TOUTE
    installation (maître compris, mais alors jamais utilisé : cf.
    `settings.EST_SERVEUR_MAITRE`). Une installation cliente interroge le
    maître périodiquement (`manage.py verifier_licence`, tâche planifiée
    système, pas Celery) et stocke le résultat ici, pour ne jamais faire
    dépendre chaque requête de l'app d'un appel réseau synchrone vers le
    maître — l'app doit rester utilisable même si le maître est
    injoignable (l'essentiel du statut de licence est calculé côté
    maître à partir d'une date, pas d'un flux temps réel).

    Singleton (une seule ligne, pk=1) : une installation ne gère qu'un
    seul abonnement, le sien.
    """

    statut = models.CharField(
        max_length=20, choices=LicenceClient.Statut.choices, default=LicenceClient.Statut.ACTIF
    )
    date_prochaine_echeance = models.DateField(null=True, blank=True)
    dernier_pointage_reussi = models.DateTimeField(null=True, blank=True)
    derniere_tentative = models.DateTimeField(null=True, blank=True)

    @classmethod
    def instance(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return f"État licence local ({self.statut})"
