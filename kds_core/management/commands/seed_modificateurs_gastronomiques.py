from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from kds_core import models

# Contenu métier fourni tel quel par le client (§5.2, "structurer les
# modificateurs en catégories") — pas des données de démonstration,
# contrairement à `seed_demo.py`. Seule "Cuisson" est obligatoire par
# défaut (seul exemple explicite donné : "dès qu'un client clique sur
# Entrecôte, le POS doit l'obliger à choisir une cuisson") ; les 6 autres
# restent sélectionnables mais optionnelles — ajustable ensuite depuis
# l'écran d'admin "Modificateurs".
CATEGORIES = [
    {
        "nom": "Cuisson (Viandes & Poissons)",
        "obligatoire": True,
        "options": ["Bleu", "Saignant", "À point", "Bien cuit", "Rosé (pour le canard ou le veau)", "Nacré (pour les poissons)"],
    },
    {
        "nom": "Assaisonnement & Sel",
        "obligatoire": False,
        "options": ["Sans sel", "Peu salé", "Sel à part", "Sans poivre"],
    },
    {
        "nom": "Sauce & Garniture",
        "obligatoire": False,
        "options": ["Sauce à part", "Vinaigrette à part", "Sans sauce", "Sans garniture"],
    },
    {
        "nom": "Texture & Gras",
        "obligatoire": False,
        "options": ["Sans gras (viande dégraissée, pas de beurre)", "Sauce légère", "Mixé / Mouliné (pour les soupes ou purées)", "Croustillant / Bien grillé"],
    },
    {
        "nom": "Piquant (Épices)",
        "obligatoire": False,
        "options": ["Non épicé", "Doux", "Moyen / Relevé", "Très épicé", "Piment à part"],
    },
    {
        "nom": "Bar : Température & Glace",
        "obligatoire": False,
        "options": ["Sans glaçon", "Glace pilée", "Gros glaçon (Ice ball pour spiritueux)", "Frappé", "Glacé", "Chambré", "Brûlant (pour les cafés/thés)"],
    },
    {
        "nom": "Bar : Sucre & Profil",
        "obligatoire": False,
        "options": ["Sans sucre", "Sucre à part", "Sec (sans sucre/sirop, ou type de Martini)", "Allongé (avec de l'eau ou du soda)", "Corsé"],
    },
]


class Command(BaseCommand):
    help = (
        "Crée (ou complète, de façon idempotente) les 7 catégories de "
        "modificateurs de préparation demandées par le client, pour un "
        "tenant donné. Ne touche jamais aux modificateurs allergie/"
        "supplément existants."
    )

    def add_arguments(self, parser):
        parser.add_argument("--tenant", required=True, help="Slug du tenant (ex: demo-restaurant)")

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            tenant = models.Tenant.objects.get(slug=options["tenant"])
        except models.Tenant.DoesNotExist:
            raise CommandError(f"Aucun tenant avec le slug « {options['tenant']} ».")

        nb_categories_creees = 0
        nb_modificateurs_crees = 0

        for ordre, categorie_def in enumerate(CATEGORIES):
            categorie, cree = models.ModifierCategory.objects.get_or_create(
                tenant=tenant,
                nom=categorie_def["nom"],
                defaults={"obligatoire": categorie_def["obligatoire"], "ordre_affichage": ordre},
            )
            if cree:
                nb_categories_creees += 1

            for libelle in categorie_def["options"]:
                # Clé d'unicité = (tenant, libelle) uniquement, pas
                # `categorie` — sinon relancer la commande après une
                # réaffectation de catégorie créerait un doublon au lieu de
                # mettre à jour l'existant.
                modificateur, cree_modif = models.Modifier.objects.get_or_create(
                    tenant=tenant,
                    libelle=libelle,
                    defaults={"categorie": categorie, "type_modifier": models.Modifier.TypeModifier.PREFERENCE},
                )
                if cree_modif:
                    nb_modificateurs_crees += 1
                elif modificateur.categorie_id != categorie.id:
                    modificateur.categorie = categorie
                    modificateur.save(update_fields=["categorie"])

        self.stdout.write(
            self.style.SUCCESS(
                f"{nb_categories_creees} catégorie(s) et {nb_modificateurs_crees} modificateur(s) "
                f"créés pour « {tenant.nom_etablissement} » (déjà présents ignorés)."
            )
        )
