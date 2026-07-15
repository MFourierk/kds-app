from django.conf import settings
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
