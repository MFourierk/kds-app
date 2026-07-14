from django.db import models

from .base import TenantScopedModel


class Station(TenantScopedModel):
    """Poste de préparation (Grill, Pâtisserie, Bar, Expo...)."""

    nom = models.CharField(max_length=80)
    is_expo = models.BooleanField(
        default=False, help_text="Écran de contrôle final avant envoi en salle (cf. §5.1)"
    )
    ordre_affichage = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["ordre_affichage", "nom"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "nom"], name="unique_station_par_tenant"),
        ]

    def __str__(self):
        return f"{self.nom} — {self.tenant.nom_etablissement}"


class MenuCategory(TenantScopedModel):
    """Catégorie de plat (Entrées, Grillades, Desserts...), rattachée à un poste par défaut."""

    nom = models.CharField(max_length=80)
    station = models.ForeignKey(Station, on_delete=models.PROTECT, related_name="categories")
    ordre_affichage = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Catégorie de menu"
        verbose_name_plural = "Catégories de menu"
        ordering = ["ordre_affichage", "nom"]

    def __str__(self):
        return self.nom


class Modifier(TenantScopedModel):
    """Modificateur applicable à un ou plusieurs plats (allergie, préférence, supplément)."""

    class TypeModifier(models.TextChoices):
        ALLERGIE = "allergie", "Allergie"
        PREFERENCE = "preference", "Préférence"
        SUPPLEMENT = "supplement", "Supplément"

    libelle = models.CharField(max_length=100)
    type_modifier = models.CharField(
        max_length=20, choices=TypeModifier.choices, default=TypeModifier.PREFERENCE
    )
    niveau_alerte_critique = models.BooleanField(
        default=False, help_text="Affichage renforcé sur le ticket (ex: allergie sévère)"
    )
    prix_supplement = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        ordering = ["libelle"]

    def __str__(self):
        return self.libelle


class MenuItem(TenantScopedModel):
    """Plat ou boisson du menu."""

    class Statut(models.TextChoices):
        DISPONIBLE = "disponible", "Disponible"
        RUPTURE = "rupture", "Rupture (86'd)"

    nom = models.CharField(max_length=120)
    categorie = models.ForeignKey(MenuCategory, on_delete=models.PROTECT, related_name="plats")
    station = models.ForeignKey(Station, on_delete=models.PROTECT, related_name="plats")

    prix = models.DecimalField(max_digits=10, decimal_places=2)
    temps_preparation_estime_min = models.PositiveIntegerField(default=10)

    image = models.ImageField(upload_to="plats/", blank=True, null=True)
    photo_dressage_url = models.URLField(
        blank=True, help_text="Photo de dressage pour la fiche technique cuisine"
    )
    fiche_technique = models.TextField(blank=True, help_text="Recette / instructions de préparation")

    allergenes = models.JSONField(default=list, blank=True, help_text="Liste de libellés d'allergènes")
    regimes = models.JSONField(
        default=list, blank=True, help_text="Ex: ['vegetarien', 'sans_porc', 'halal']"
    )

    statut = models.CharField(max_length=20, choices=Statut.choices, default=Statut.DISPONIBLE)
    modifiers = models.ManyToManyField(Modifier, blank=True, related_name="plats")

    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["categorie__ordre_affichage", "nom"]

    def __str__(self):
        return self.nom
