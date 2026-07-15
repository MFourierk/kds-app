import requests
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from kds_core import models


class Command(BaseCommand):
    help = (
        "Pointage periodique aupres du serveur maitre de licence (§licence). "
        "A lancer via une tache planifiee systeme (cron/systemd timer), jamais "
        "manuellement en usage normal. Sans effet sur le serveur maitre "
        "lui-meme (EST_SERVEUR_MAITRE=True)."
    )

    def handle(self, *args, **options):
        if settings.EST_SERVEUR_MAITRE:
            self.stdout.write("Serveur maitre — aucun pointage necessaire, commande ignoree.")
            return

        etat = models.EtatLicenceLocal.instance()
        etat.derniere_tentative = timezone.now()

        if not settings.LICENCE_MASTER_URL or not settings.LICENCE_IDENTIFIANT or not settings.LICENCE_CLE_API:
            self.stdout.write(self.style.WARNING(
                "LICENCE_MASTER_URL/LICENCE_IDENTIFIANT/LICENCE_CLE_API manquant(s) dans .env — verification ignoree."
            ))
            etat.save()
            return

        try:
            reponse = requests.post(
                f"{settings.LICENCE_MASTER_URL}/api/licence/pointage/",
                json={"identifiant": settings.LICENCE_IDENTIFIANT, "cle_api": settings.LICENCE_CLE_API},
                timeout=10,
            )
        except requests.RequestException as exc:
            # Best-effort : pas d'internet ou maitre injoignable — on garde le
            # dernier statut connu tel quel (§résilience réseau), pas d'échec
            # bruyant. La tache reessaiera au prochain declenchement planifie.
            self.stdout.write(self.style.WARNING(f"Pointage impossible (pas d'internet ?) : {exc}"))
            etat.save()
            return

        if not reponse.ok:
            self.stdout.write(self.style.WARNING(f"Pointage refuse par le maitre : {reponse.status_code} {reponse.text}"))
            etat.save()
            return

        data = reponse.json()
        etat.statut = data["statut"]
        etat.date_prochaine_echeance = data.get("date_prochaine_echeance")
        etat.dernier_pointage_reussi = timezone.now()
        etat.save()
        self.stdout.write(self.style.SUCCESS(f"Pointage reussi — statut : {etat.statut}"))
