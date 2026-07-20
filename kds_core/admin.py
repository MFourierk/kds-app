from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import UserCreationForm

from . import models


@admin.register(models.Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("nom_etablissement", "devise", "langue_defaut", "is_active", "created_at")
    search_fields = ("nom_etablissement", "slug")


@admin.register(models.PosIntegration)
class PosIntegrationAdmin(admin.ModelAdmin):
    list_display = ("label", "tenant", "webhook_url", "is_active")
    list_filter = ("tenant", "is_active")
    readonly_fields = ("secret_hash",)


@admin.register(models.LicenceClient)
class LicenceClientAdmin(admin.ModelAdmin):
    """
    Gestion des abonnements clients (§licence) — UNIQUEMENT pertinent sur
    le serveur maître. `cle_api` généré automatiquement à la création
    (cf. `LicenceClient.save`) : à copier ici vers le `.env` de
    l'installation cliente concernée (`LICENCE_CLE_API`).
    """

    list_display = ("nom_client", "identifiant", "statut_affiche", "date_prochaine_echeance", "dernier_pointage")
    search_fields = ("nom_client", "identifiant")
    readonly_fields = ("cle_api", "dernier_pointage", "statut_affiche")

    @admin.display(description="Statut")
    def statut_affiche(self, obj):
        # `statut` est une propriété calculée (pas un champ), donc pas de
        # `get_statut_display()` auto-généré par Django ici.
        return models.LicenceClient.Statut(obj.statut).label


@admin.register(models.Station)
class StationAdmin(admin.ModelAdmin):
    list_display = ("nom", "tenant", "is_expo", "is_active", "ordre_affichage")
    list_filter = ("tenant", "is_active")


@admin.register(models.MenuCategory)
class MenuCategoryAdmin(admin.ModelAdmin):
    list_display = ("nom", "tenant", "station", "ordre_affichage")
    list_filter = ("tenant", "station")


@admin.register(models.ModifierCategory)
class ModifierCategoryAdmin(admin.ModelAdmin):
    """
    Manquait entièrement du menu admin (§audit) — la fonctionnalité
    catégories de modificateurs existe côté modèle/API/frontend depuis son
    ajout, mais n'avait jamais été enregistrée ici, donc invisible/
    inaccessible depuis la console Django.
    """

    list_display = ("nom", "tenant", "obligatoire", "selection_multiple", "ordre_affichage")
    list_filter = ("tenant", "obligatoire")


@admin.register(models.Modifier)
class ModifierAdmin(admin.ModelAdmin):
    # `categorie` ajoutée (§audit) — absente alors que le champ existe sur
    # le modèle depuis les catégories de modificateurs ; la console ne
    # reflétait plus ce que gère déjà le frontend.
    list_display = ("libelle", "tenant", "categorie", "type_modifier", "niveau_alerte_critique")
    list_filter = ("tenant", "categorie", "type_modifier", "niveau_alerte_critique")


@admin.register(models.MenuItem)
class MenuItemAdmin(admin.ModelAdmin):
    list_display = ("nom", "tenant", "categorie", "station", "prix", "statut", "is_active")
    list_filter = ("tenant", "categorie", "statut", "is_active")
    search_fields = ("nom",)
    # Widget à deux colonnes avec recherche plutôt que le <select multiple>
    # brut par défaut — plus lisible dès qu'un plat a plus de 2-3
    # modificateurs (cf. Brochette de bœuf, 19 dans les données réelles).
    filter_horizontal = ("modifiers",)


@admin.register(models.RestaurantTable)
class RestaurantTableAdmin(admin.ModelAdmin):
    list_display = ("numero", "tenant", "statut", "qr_code_token")
    list_filter = ("tenant", "statut")
    readonly_fields = ("qr_code_token",)


class KdsUserCreationForm(UserCreationForm):
    """
    §audit — cause réelle de "je ne trouve pas le menu pour les rôles" :
    le formulaire d'ajout de Django par défaut (`add_fieldsets` hérité,
    jamais surchargé jusqu'ici) ne demande QUE identifiant + mot de passe,
    avec le message "vous pourrez modifier plus d'options ensuite" — le
    champ rôle existe bien, mais seulement sur l'écran d'édition qui
    s'affiche APRÈS l'enregistrement, pas sur celui-ci. Ce formulaire
    étendu fait apparaître tenant/rôle/poste dès la création, comme le
    fait déjà l'écran "Équipe" du frontend (`GestionUtilisateurs.jsx`) en
    une seule étape.
    """

    class Meta(UserCreationForm.Meta):
        model = models.User
        fields = ("username", "tenant", "role", "station_assignee")


@admin.register(models.User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("username", "tenant", "role", "station_assignee", "is_active")
    list_filter = ("tenant", "role", "is_active")
    add_form = KdsUserCreationForm
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("username", "password1", "password2", "tenant", "role", "station_assignee"),
            },
        ),
    )
    fieldsets = DjangoUserAdmin.fieldsets + (
        ("KDS", {"fields": ("tenant", "role", "station_assignee", "pin_code")}),
    )


class OrderItemInline(admin.TabularInline):
    model = models.OrderItem
    extra = 0


@admin.register(models.OrderTicket)
class OrderTicketAdmin(admin.ModelAdmin):
    list_display = ("id", "order", "station", "statut", "is_rush", "is_held", "heure_pret")
    list_filter = ("tenant", "station", "statut", "is_rush")
    inlines = [OrderItemInline]


@admin.register(models.Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("id", "tenant", "table", "source", "statut", "is_rush", "created_at")
    list_filter = ("tenant", "source", "statut", "is_rush")


@admin.register(models.TicketStatusLog)
class TicketStatusLogAdmin(admin.ModelAdmin):
    list_display = ("ticket", "ancien_statut", "nouveau_statut", "utilisateur", "created_at")
    list_filter = ("tenant",)


@admin.register(models.EtatLicenceLocal)
class EtatLicenceLocalAdmin(admin.ModelAdmin):
    """
    Manquait du menu admin (§audit). Lecture seule à dessein : rempli
    automatiquement par `manage.py verifier_licence` (pointage périodique),
    jamais par une saisie manuelle — utile ici uniquement pour consulter le
    dernier statut de licence connu sans SSH sur une installation cliente.
    """

    list_display = ("statut", "date_prochaine_echeance", "dernier_pointage_reussi", "derniere_tentative")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
