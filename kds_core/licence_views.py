import re
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models
from .permissions import IsTenantMember

# Impossible d'être bloqué par sa propre politique de licence — le maître
# héberge les abonnements de TOUS les clients, il ne s'auto-facture pas.
STATUTS_OK_SI_MAITRE = {"actif"}

# N'autorise que des caractères de nom de version sûrs — le nom de fichier
# final est reconstruit à partir de ça (§mise à jour client), jamais un
# chemin fourni tel quel : bloque toute tentative de traversée de
# répertoire (`/`, `..` combiné à un `/`) par construction, pas par
# nettoyage a posteriori.
VERSION_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def _client_licence_valide(request):
    """
    Même authentification que `LicencePointageView` (secret partagé
    identifiant+cle_api) — réutilisée ici pour gater la découverte/le
    téléchargement de mise à jour aux seules installations à jour de leur
    abonnement (cf. §mise à jour client) sans introduire un nouveau secret.
    Renvoie `(client, None)` ou `(None, Response d'erreur)`.
    """
    identifiant = request.query_params.get("identifiant", "")
    cle_api = request.query_params.get("cle_api", "")
    if not identifiant or not cle_api:
        return None, Response({"detail": "identifiant et cle_api requis."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        client = models.LicenceClient.objects.get(identifiant=identifiant, cle_api=cle_api)
    except models.LicenceClient.DoesNotExist:
        return None, Response({"detail": "Identifiants de licence invalides."}, status=status.HTTP_403_FORBIDDEN)
    return client, None


class LicencePointageView(APIView):
    """
    `POST /api/licence/pointage/` — appelée UNIQUEMENT par la commande
    `manage.py verifier_licence` d'une installation cliente (jamais par
    le frontend web), pas par un utilisateur authentifié : c'est la
    machine serveur elle-même qui se signale en tâche de fond, il n'y a
    pas de session/JWT à ce moment-là. Authentification par secret
    partagé (`identifiant` + `cle_api`, cf. `LicenceClient`) plutôt que
    par compte utilisateur.

    N'existe de façon utile que sur le serveur maître (`EST_SERVEUR_
    MAITRE=True`) — répond `404` ailleurs : une installation cliente n'a
    de toute façon aucune raison d'appeler CETTE route sur elle-même.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        if not settings.EST_SERVEUR_MAITRE:
            return Response({"detail": "Cette installation n'est pas un serveur maître."}, status=404)

        identifiant = request.data.get("identifiant", "")
        cle_api = request.data.get("cle_api", "")
        if not identifiant or not cle_api:
            return Response({"detail": "identifiant et cle_api requis."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            client = models.LicenceClient.objects.get(identifiant=identifiant, cle_api=cle_api)
        except models.LicenceClient.DoesNotExist:
            return Response({"detail": "Identifiants de licence invalides."}, status=status.HTTP_403_FORBIDDEN)

        client.dernier_pointage = timezone.now()
        client.save(update_fields=["dernier_pointage", "updated_at"])

        return Response({"statut": client.statut, "date_prochaine_echeance": client.date_prochaine_echeance})


class LicenceStatutView(APIView):
    """
    `GET /api/licence/statut/` — lu par le frontend (bandeau
    d'avertissement, écran de blocage) sur l'installation CLIENTE
    elle-même. Renvoie toujours "actif" sur le serveur maître (cf.
    `STATUTS_OK_SI_MAITRE`) — jamais de restriction auto-appliquée là où
    vivent les abonnements de tout le monde.
    """

    permission_classes = [IsAuthenticated, IsTenantMember]

    def get(self, request):
        if settings.EST_SERVEUR_MAITRE:
            return Response({"statut": "actif", "date_prochaine_echeance": None})

        etat = models.EtatLicenceLocal.instance()
        return Response({"statut": etat.statut, "date_prochaine_echeance": etat.date_prochaine_echeance})


class LicenceDerniereVersionView(APIView):
    """
    `GET /api/licence/derniere-version/?identifiant=...&cle_api=...` —
    appelée par `update.sh` (§mise à jour client, deploy/client-package/)
    sur une installation cliente pour savoir si une nouvelle version du
    paquet Docker est disponible. Renvoie juste le numéro de version : la
    comparaison avec `KDS_VERSION` local et le téléchargement effectif
    sont faits côté client, ce endpoint ne fait que lire
    `LATEST_VERSION` (texte brut, écrit par `scripts/publier-maj.sh` à
    chaque publication) dans `settings.CLIENT_PACKAGES_DIR`.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        if not settings.EST_SERVEUR_MAITRE:
            return Response({"detail": "Cette installation n'est pas un serveur maître."}, status=404)

        _, erreur = _client_licence_valide(request)
        if erreur:
            return erreur

        fichier_version = Path(settings.CLIENT_PACKAGES_DIR) / "LATEST_VERSION"
        if not fichier_version.is_file():
            return Response({"detail": "Aucune version publiée."}, status=404)

        return Response({"version": fichier_version.read_text().strip()})


class LicenceTelechargerVersionView(APIView):
    """
    `GET /api/licence/telecharger/<version>/?identifiant=...&cle_api=...`
    — sert l'image Docker (`kds-images-<version>.tar`) correspondante,
    en flux direct depuis `settings.CLIENT_PACKAGES_DIR` (pas de passage
    par Nginx/un dossier statique dédié : reste dans le pipeline
    git-deploy déjà en place, aucune config serveur supplémentaire à
    toucher). Le VPS ne garde que les 2 dernières versions publiées
    (`scripts/publier-maj.sh` fait le ménage) — une version plus ancienne
    renvoie simplement 404.
    """

    permission_classes = [AllowAny]

    def get(self, request, version):
        if not settings.EST_SERVEUR_MAITRE:
            return Response({"detail": "Cette installation n'est pas un serveur maître."}, status=404)

        _, erreur = _client_licence_valide(request)
        if erreur:
            return erreur

        if not VERSION_RE.match(version):
            raise Http404

        chemin = Path(settings.CLIENT_PACKAGES_DIR) / f"kds-images-{version}.tar"
        if not chemin.is_file():
            raise Http404

        return FileResponse(open(chemin, "rb"), as_attachment=True, filename=chemin.name)
