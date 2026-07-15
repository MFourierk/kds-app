from django.core.management.base import BaseCommand
from django.db import transaction

from kds_core import models


class Command(BaseCommand):
    """
    Onboarding d'un vrai client (§installer) — non interactive, pensée pour
    être appelée depuis `install.sh`. Contrairement à `seed_demo`, ne crée
    QUE le tenant et un premier compte admin : le back-office (Phase 6,
    onglets Menu/Postes/Équipe/Établissement) existe déjà pour que le client
    configure lui-même sa vraie carte, ses postes et son équipe.
    """

    help = "Crée un tenant + un premier compte admin, pour l'onboarding d'un client réel (non interactif)."

    def add_arguments(self, parser):
        parser.add_argument("--tenant-nom", required=True)
        parser.add_argument("--tenant-slug", required=True)
        parser.add_argument("--admin-username", required=True)
        parser.add_argument("--admin-password", required=True)
        parser.add_argument("--admin-email", default="")

    @transaction.atomic
    def handle(self, *args, **options):
        tenant, created = models.Tenant.objects.get_or_create(
            slug=options["tenant_slug"],
            defaults={"nom_etablissement": options["tenant_nom"]},
        )
        if not created and tenant.nom_etablissement != options["tenant_nom"]:
            self.stdout.write(
                self.style.WARNING(
                    f"Tenant « {tenant.slug} » existe déjà sous le nom "
                    f"« {tenant.nom_etablissement} » — nom inchangé."
                )
            )

        # Le mot de passe est toujours réinitialisé, y compris sur un compte
        # déjà existant — cette commande sert aussi de remise à zéro rapide
        # en cas de visite support (accès admin perdu chez un client).
        admin, _ = models.User.objects.get_or_create(
            username=options["admin_username"],
            defaults={
                "tenant": tenant,
                "role": models.User.Role.ADMIN,
                "email": options["admin_email"],
            },
        )
        admin.tenant = tenant
        admin.role = models.User.Role.ADMIN
        admin.email = options["admin_email"] or admin.email
        admin.set_password(options["admin_password"])
        admin.save()

        self.stdout.write(
            self.style.SUCCESS(
                f"Tenant « {tenant.nom_etablissement} » (slug={tenant.slug}) prêt — "
                f"compte admin « {admin.username} »."
            )
        )
