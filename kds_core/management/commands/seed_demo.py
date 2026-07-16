from django.core.management.base import BaseCommand
from django.db import transaction

from kds_core import models

DEMO_USERNAME = "demo"
DEMO_PASSWORD = "demo1234"
DEMO_CUISINIER_USERNAME = "cuisine1"
DEMO_CUISINIER_PIN = "1234"
DEMO_SERVEUR_USERNAME = "serveur1"
DEMO_SERVEUR_PIN = "1234"
DEMO_CAISSIER_USERNAME = "caissiere1"
DEMO_CAISSIER_PIN = "1234"


class Command(BaseCommand):
    help = (
        "Crée (ou met à jour, de façon idempotente) un jeu de données de "
        "démonstration : un tenant, 3 stations, un menu, 3 tables et un "
        "utilisateur API pour tester les endpoints sans tout recréer via /admin/."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        tenant, _ = models.Tenant.objects.get_or_create(
            slug="demo-restaurant",
            defaults={
                "nom_etablissement": "Restaurant Démo",
                "devise": models.Tenant.Devise.XOF,
            },
        )

        self._migrer_anciens_postes(tenant)

        # Un poste cuisine = une catégorie de la carte (§5.6 : la carte
        # d'un vrai restaurant, pas que des grillades). Expo reste à part,
        # ce n'est pas une catégorie mais un écran de contrôle final.
        station_entrees, _ = models.Station.objects.get_or_create(
            tenant=tenant, nom="Entrées", defaults={"ordre_affichage": 1}
        )
        station_plats, _ = models.Station.objects.get_or_create(
            tenant=tenant, nom="Plats", defaults={"ordre_affichage": 2}
        )
        station_desserts, _ = models.Station.objects.get_or_create(
            tenant=tenant, nom="Desserts", defaults={"ordre_affichage": 3}
        )
        station_boissons, _ = models.Station.objects.get_or_create(
            tenant=tenant, nom="Boissons", defaults={"ordre_affichage": 4}
        )
        models.Station.objects.get_or_create(
            tenant=tenant, nom="Expo", defaults={"is_expo": True, "ordre_affichage": 5}
        )

        cat_entrees, _ = models.MenuCategory.objects.get_or_create(
            tenant=tenant, nom="Entrées", defaults={"station": station_entrees, "ordre_affichage": 1}
        )
        cat_plats, cat_plats_created = models.MenuCategory.objects.get_or_create(
            tenant=tenant, nom="Plats", defaults={"station": station_plats, "ordre_affichage": 2}
        )
        if cat_plats_created:
            # "Grillades" (nom d'origine, avant l'ajout des autres
            # catégories) fusionne dans "Plats" : mêmes plats, juste
            # renommée pour coller à une carte de restaurant classique.
            ancienne = (
                models.MenuCategory.objects.filter(tenant=tenant, nom="Grillades")
                .exclude(pk=cat_plats.pk)
                .first()
            )
            if ancienne:
                ancienne.plats.update(categorie=cat_plats, station=station_plats)
                ancienne.delete()
        cat_desserts, _ = models.MenuCategory.objects.get_or_create(
            tenant=tenant, nom="Desserts", defaults={"station": station_desserts, "ordre_affichage": 3}
        )
        cat_boissons, _ = models.MenuCategory.objects.get_or_create(
            tenant=tenant, nom="Boissons", defaults={"station": station_boissons, "ordre_affichage": 4}
        )

        models.MenuItem.objects.get_or_create(
            tenant=tenant,
            nom="Salade avocat crevettes",
            defaults={
                "categorie": cat_entrees,
                "station": station_entrees,
                "prix": 2500,
                "temps_preparation_estime_min": 8,
            },
        )
        models.MenuItem.objects.get_or_create(
            tenant=tenant,
            nom="Accras de morue",
            defaults={
                "categorie": cat_entrees,
                "station": station_entrees,
                "prix": 1500,
                "temps_preparation_estime_min": 10,
            },
        )
        models.MenuItem.objects.get_or_create(
            tenant=tenant,
            nom="Brochette de bœuf",
            defaults={
                "categorie": cat_plats,
                "station": station_plats,
                "prix": 3500,
                "temps_preparation_estime_min": 15,
            },
        )
        models.MenuItem.objects.get_or_create(
            tenant=tenant,
            nom="Poulet braisé",
            defaults={
                "categorie": cat_plats,
                "station": station_plats,
                "prix": 4000,
                "temps_preparation_estime_min": 20,
            },
        )
        models.MenuItem.objects.get_or_create(
            tenant=tenant,
            nom="Salade de fruits",
            defaults={
                "categorie": cat_desserts,
                "station": station_desserts,
                "prix": 1500,
                "temps_preparation_estime_min": 5,
            },
        )
        models.MenuItem.objects.get_or_create(
            tenant=tenant,
            nom="Fondant au chocolat",
            defaults={
                "categorie": cat_desserts,
                "station": station_desserts,
                "prix": 2000,
                "temps_preparation_estime_min": 12,
            },
        )
        models.MenuItem.objects.get_or_create(
            tenant=tenant,
            nom="Jus de bissap",
            defaults={
                "categorie": cat_boissons,
                "station": station_boissons,
                "prix": 1000,
                # 0 = déjà prêt, servi directement (pas de vrai temps de
                # préparation à afficher côté client) — contrairement à un
                # cocktail, qui demande une préparation réelle et gardera
                # un temps > 0.
                "temps_preparation_estime_min": 0,
            },
        )
        models.MenuItem.objects.get_or_create(
            tenant=tenant,
            nom="Mojito",
            defaults={
                "categorie": cat_boissons,
                "station": station_boissons,
                "prix": 3000,
                # Cocktail = vraie préparation, contrairement aux autres
                # boissons du menu démo servies directement.
                "temps_preparation_estime_min": 5,
            },
        )

        for numero in ["1", "2", "3"]:
            models.RestaurantTable.objects.get_or_create(tenant=tenant, numero=numero)

        demo_user, created = models.User.objects.get_or_create(
            username=DEMO_USERNAME,
            defaults={
                "tenant": tenant,
                "role": models.User.Role.MANAGER,
                "email": "demo@example.com",
            },
        )
        if created or not demo_user.has_usable_password():
            demo_user.tenant = tenant
            demo_user.role = models.User.Role.MANAGER
            demo_user.set_password(DEMO_PASSWORD)
            demo_user.save()

        cuisinier, created = models.User.objects.get_or_create(
            username=DEMO_CUISINIER_USERNAME,
            defaults={
                "tenant": tenant,
                "role": models.User.Role.CUISINIER,
                "station_assignee": station_plats,
                "first_name": "Cuisinier",
                "last_name": "Démo",
            },
        )
        if created or not cuisinier.pin_code:
            cuisinier.tenant = tenant
            cuisinier.role = models.User.Role.CUISINIER
            cuisinier.station_assignee = station_plats
            cuisinier.set_unusable_password()  # pas de mot de passe, connexion PIN uniquement
            cuisinier.set_pin(DEMO_CUISINIER_PIN)
            cuisinier.save()

        serveur, created = models.User.objects.get_or_create(
            username=DEMO_SERVEUR_USERNAME,
            defaults={
                "tenant": tenant,
                "role": models.User.Role.SERVEUR,
                "first_name": "Serveur",
                "last_name": "Démo",
            },
        )
        if created or not serveur.pin_code:
            serveur.tenant = tenant
            serveur.role = models.User.Role.SERVEUR
            serveur.set_unusable_password()  # pas de mot de passe, connexion PIN uniquement
            serveur.set_pin(DEMO_SERVEUR_PIN)
            serveur.save()

        caissier, created = models.User.objects.get_or_create(
            username=DEMO_CAISSIER_USERNAME,
            defaults={
                "tenant": tenant,
                "role": models.User.Role.CAISSIER,
                "first_name": "Caissière",
                "last_name": "Démo",
            },
        )
        if created or not caissier.pin_code:
            caissier.tenant = tenant
            caissier.role = models.User.Role.CAISSIER
            caissier.set_unusable_password()  # pas de mot de passe, connexion PIN uniquement
            caissier.set_pin(DEMO_CAISSIER_PIN)
            caissier.save()

        self.stdout.write(
            self.style.SUCCESS(
                f"Données de démo prêtes pour « {tenant.nom_etablissement} » "
                f"(slug={tenant.slug}).\n"
                f"Connexion manager : POST /api/auth/login/ avec "
                f'{{"username": "{DEMO_USERNAME}", "password": "{DEMO_PASSWORD}"}}\n'
                f"Connexion cuisine (PIN) : POST /api/auth/pin-login/ avec "
                f'{{"username": "{DEMO_CUISINIER_USERNAME}", "pin": "{DEMO_CUISINIER_PIN}"}}\n'
                f"Connexion serveur (PIN) : POST /api/auth/pin-login/ avec "
                f'{{"username": "{DEMO_SERVEUR_USERNAME}", "pin": "{DEMO_SERVEUR_PIN}"}}\n'
                f"Connexion caissière (PIN) : POST /api/auth/pin-login/ avec "
                f'{{"username": "{DEMO_CAISSIER_USERNAME}", "pin": "{DEMO_CAISSIER_PIN}"}}'
            )
        )

    def _migrer_anciens_postes(self, tenant):
        """
        Ancien modèle (avant l'alignement postes ↔ catégories) : la carte
        (Entrées/Plats/Desserts/Boissons) partageait seulement 3 postes
        physiques (Grill, Bar, Froid — "Froid" préparait à la fois les
        Entrées ET les Desserts). Un poste cuisine n'a plus de sens s'il ne
        correspond à aucune catégorie de la carte ("Grill" ne veut rien
        dire dès que la carte dépasse les grillades) — chaque poste doit
        maintenant correspondre 1:1 à une catégorie.

        Renommage EN PLACE (pas de suppression/recréation) pour préserver
        les FK déjà posées ailleurs (station_assignee du cuisinier,
        MenuItem.station...). Idempotent : dès que "Grill"/"Bar"/"Froid"
        n'existent plus et que "Desserts" a son propre poste, cette
        méthode ne trouve plus rien à faire.
        """

        renommages = {"Grill": "Plats", "Bar": "Boissons", "Froid": "Entrées"}
        for ancien_nom, nouveau_nom in renommages.items():
            station = models.Station.objects.filter(tenant=tenant, nom=ancien_nom).first()
            if station:
                station.nom = nouveau_nom
                station.save(update_fields=["nom"])

        # Le poste "Entrées" (ex-Froid) préparait aussi les Desserts : on
        # sépare en un poste dédié dès qu'une catégorie Desserts existe
        # encore et pointe vers lui.
        cat_desserts = models.MenuCategory.objects.filter(tenant=tenant, nom="Desserts").first()
        station_entrees = models.Station.objects.filter(tenant=tenant, nom="Entrées").first()
        if cat_desserts and station_entrees and cat_desserts.station_id == station_entrees.id:
            station_desserts, _ = models.Station.objects.get_or_create(
                tenant=tenant, nom="Desserts", defaults={"ordre_affichage": 3}
            )
            cat_desserts.station = station_desserts
            cat_desserts.save(update_fields=["station"])
            models.MenuItem.objects.filter(tenant=tenant, categorie=cat_desserts).update(
                station=station_desserts
            )
