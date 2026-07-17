from django.db import models

from .base import TimeStampedModel, UUIDModel


class Tenant(UUIDModel, TimeStampedModel):
    """
    Un établissement client (restaurant, espace gastronomique...).

    Centralise les paramètres de marque blanche : logo, couleurs, devise,
    langue, seuils de temps. Le frontend charge cette config au démarrage
    et injecte les couleurs comme variables CSS — pas de build séparé par client.
    """

    class Devise(models.TextChoices):
        XOF = "XOF", "Franc CFA (XOF)"
        EUR = "EUR", "Euro"
        USD = "USD", "Dollar US"

    class Langue(models.TextChoices):
        FR = "fr", "Français"
        EN = "en", "English"

    nom_etablissement = models.CharField(max_length=150)
    slug = models.SlugField(max_length=160, unique=True)

    # --- Marque blanche ---
    logo = models.ImageField(upload_to="logos/", blank=True, null=True)
    couleur_primaire = models.CharField(
        max_length=7, default="#1B2431", help_text="Code hexadécimal, ex: #1B2431"
    )
    couleur_secondaire = models.CharField(max_length=7, default="#C9A24B")

    # --- Coordonnées (§5.5, en-tête facture/reçu de caisse) ---
    telephone = models.CharField(max_length=40, blank=True)
    adresse = models.CharField(max_length=255, blank=True)

    url_publique = models.URLField(
        blank=True,
        help_text=(
            "Adresse utilisée pour générer les QR codes clients (ex: http://192.168.1.6 sur "
            "une installation locale). Laisser vide pour retomber sur l'adresse du navigateur "
            "ayant généré le QR — fragile si générée depuis un appareil qui n'a pas la même "
            "adresse que celle utilisée par les clients (ex: le kiosque lui-même, qui charge "
            "souvent http://localhost/ plutôt que l'IP réseau de la machine)."
        ),
    )

    devise = models.CharField(max_length=3, choices=Devise.choices, default=Devise.XOF)
    langue_defaut = models.CharField(max_length=2, choices=Langue.choices, default=Langue.FR)

    # --- Seuils du code couleur temporel (en minutes), cf. cahier des charges §5.1 ---
    seuil_orange_minutes = models.PositiveIntegerField(default=10)
    seuil_rouge_minutes = models.PositiveIntegerField(default=15)

    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["nom_etablissement"]

    def __str__(self):
        return self.nom_etablissement
