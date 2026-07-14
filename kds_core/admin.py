from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

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


@admin.register(models.Station)
class StationAdmin(admin.ModelAdmin):
    list_display = ("nom", "tenant", "is_expo", "is_active", "ordre_affichage")
    list_filter = ("tenant", "is_active")


@admin.register(models.MenuCategory)
class MenuCategoryAdmin(admin.ModelAdmin):
    list_display = ("nom", "tenant", "station", "ordre_affichage")
    list_filter = ("tenant", "station")


@admin.register(models.Modifier)
class ModifierAdmin(admin.ModelAdmin):
    list_display = ("libelle", "tenant", "type_modifier", "niveau_alerte_critique")
    list_filter = ("tenant", "type_modifier", "niveau_alerte_critique")


@admin.register(models.MenuItem)
class MenuItemAdmin(admin.ModelAdmin):
    list_display = ("nom", "tenant", "categorie", "station", "prix", "statut", "is_active")
    list_filter = ("tenant", "categorie", "statut", "is_active")
    search_fields = ("nom",)


@admin.register(models.RestaurantTable)
class RestaurantTableAdmin(admin.ModelAdmin):
    list_display = ("numero", "tenant", "statut", "qr_code_token")
    list_filter = ("tenant", "statut")
    readonly_fields = ("qr_code_token",)


@admin.register(models.User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("username", "tenant", "role", "station_assignee", "is_active")
    list_filter = ("tenant", "role", "is_active")
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
