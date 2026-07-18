from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models, presence, serializers, services, signals

# Interaction client via QR code (§5.6). Accès public (AllowAny), scopé par
# `qr_code_token` — voir la note en tête de la section QR dans serializers.py
# pour le choix de ne pas réutiliser TenantScopedFieldsMixin ici.

MESSAGE_CUISINE_INJOIGNABLE = "Connexion indisponible côté cuisine, veuillez appeler un serveur"


def _presence_payload(tenant_id):
    """
    Statut de présence cuisine (`kds_core.presence`) à joindre aux réponses
    QR : permet au client de savoir, à l'instant même de son action (pas
    seulement après coup), si un écran cuisine est réellement joignable —
    répond à un cas concret : le client a sa 4G, mais le restaurant est
    coupé d'internet, donc personne en cuisine ne verra rien en temps réel.
    """

    en_ligne = presence.is_kitchen_online_sync(tenant_id)
    return {
        "cuisine_en_ligne": en_ligne,
        "message_urgence": None if en_ligne else MESSAGE_CUISINE_INJOIGNABLE,
    }


class QrMenuView(APIView):
    """`GET /api/qr/<token>/menu/` — menu digital (§5.6), filtrable par allergène/régime."""

    permission_classes = [AllowAny]

    def get(self, request, qr_code_token):
        table = get_object_or_404(models.RestaurantTable, qr_code_token=qr_code_token)
        tenant = table.tenant

        # `prefetch_related` (trouvé en auditant le module QR, régression
        # de perf introduite par les modificateurs, §5.2) : sans ça,
        # chaque plat déclenche une requête pour ses modificateurs, et
        # chaque modificateur une autre pour sa catégorie
        # (`QrModifierSerializer.get_categorie_*`) — un menu de quelques
        # dizaines de plats avec modificateurs peut facilement dépasser
        # la centaine de requêtes pour un seul chargement de menu.
        categories = (
            models.MenuCategory.objects.filter(tenant=tenant)
            .prefetch_related("plats__modifiers__categorie")
            .order_by("ordre_affichage")
        )
        context = {
            "request": request,
            "exclure_allergenes": request.query_params.getlist("exclure_allergene"),
            "regime": request.query_params.get("regime"),
        }

        return Response(
            {
                "tenant": serializers.QrTenantBrandingSerializer(tenant, context=context).data,
                "table": {"id": str(table.id), "numero": table.numero},
                "categories": serializers.QrMenuCategorySerializer(
                    categories, many=True, context=context
                ).data,
            }
        )


class QrOrderCreateView(APIView):
    """
    `POST /api/qr/<token>/orders/create/` — prise de commande client (§5.6),
    associée à la table via le token du QR code. Marque la table
    `occupée` si elle était `libre` (un client vient de s'y installer) ;
    la libération reste automatique au paiement complet (cf. Phase 3).
    """

    permission_classes = [AllowAny]

    def post(self, request, qr_code_token):
        table = get_object_or_404(models.RestaurantTable, qr_code_token=qr_code_token)

        serializer = serializers.QrOrderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = serializer.validated_data["items"]
        idempotency_key = serializer.validated_data.get("idempotency_key", "")

        if idempotency_key:
            # Rejeu depuis la file d'attente hors-ligne (§5.5) : la
            # première tentative a peut-être déjà atteint le serveur avant
            # que la coupure ne coupe la réponse — sans ce contrôle, le
            # client se retrouverait avec deux commandes identiques dès
            # qu'il repasse en ligne. Retourne la commande déjà créée telle
            # quelle plutôt que d'en recréer une (`get`, pas `create` :
            # c'est le comportement idempotent attendu).
            existante = models.Order.objects.filter(
                tenant=table.tenant, table=table, idempotency_key=idempotency_key
            ).first()
            if existante is not None:
                data = serializers.QrOrderStatusSerializer(existante).data
                data.update(_presence_payload(table.tenant_id))
                return Response(data, status=status.HTTP_200_OK)

        # Isolation tenant explicite (cf. note serializers.py) : un client
        # ne doit jamais pouvoir référencer le plat/modificateur d'un autre
        # établissement, même en devinant un UUID.
        for ligne in items:
            if ligne["plat"].tenant_id != table.tenant_id:
                return Response(
                    {"items": "Un plat référencé n'appartient pas à cet établissement."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            for modificateur in ligne.get("modificateurs") or []:
                if modificateur.tenant_id != table.tenant_id:
                    return Response(
                        {"items": "Un modificateur référencé n'appartient pas à cet établissement."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            # Catégories de modificateurs obligatoires (§5.2) — même
            # contrôle que côté staff (`AddOrderItemLineSerializer.validate`),
            # dupliqué ici car le flux QR anonyme n'a pas de serializer
            # commun avec le staff (cf. docstring `QrOrderItemLineSerializer`).
            try:
                services.valider_modificateurs(ligne["plat"], ligne.get("modificateurs") or [])
            except ValueError as exc:
                return Response({"items": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Atomique (trouvé en auditant le module QR) : sans ça, une
        # commande créée puis un échec en cours de routage (exception
        # inattendue) laissait une commande fantôme, vide, en base — plus
        # jamais rattrapable par le client (son panier a déjà été vidé
        # côté écran à ce moment-là).
        try:
            with transaction.atomic():
                order = models.Order.objects.create(
                    tenant=table.tenant,
                    table=table,
                    source=models.Order.Source.QR_CODE,
                    idempotency_key=idempotency_key,
                )
                services.route_items_to_tickets(order, items)
        except IntegrityError:
            # Contrainte unique (migration 0019) déclenchée : une autre
            # requête portant la MÊME `idempotency_key` a gagné la course
            # (cf. contrôle "déjà existante" ci-dessus, qui ne suffit pas
            # seul contre deux requêtes concurrentes). Comportement
            # identique à ce contrôle : renvoyer la commande gagnante.
            existante = models.Order.objects.get(
                tenant=table.tenant, table=table, idempotency_key=idempotency_key
            )
            data = serializers.QrOrderStatusSerializer(existante).data
            data.update(_presence_payload(table.tenant_id))
            return Response(data, status=status.HTTP_200_OK)

        if table.statut == models.RestaurantTable.Statut.LIBRE:
            table.statut = models.RestaurantTable.Statut.OCCUPEE
            table.save(update_fields=["statut", "updated_at"])

        data = serializers.QrOrderStatusSerializer(order).data
        data.update(_presence_payload(table.tenant_id))
        return Response(data, status=status.HTTP_201_CREATED)


class QrOrderStatusView(APIView):
    """
    `GET /api/qr/<token>/orders/` — suivi de commande en temps réel côté
    client (§5.6, via polling ; pas de WebSocket public pour l'instant).

    Ne renvoie que les commandes de la visite en cours (non payées, non
    annulées) : une fois payée, une commande n'a plus rien à suivre et
    disparaît de la liste — ça évite aussi qu'un client suivant, scannant
    le même QR code (le token est fixe par table, pas par visite), ne
    voie les commandes déjà soldées du client précédent.
    """

    permission_classes = [AllowAny]

    def get(self, request, qr_code_token):
        table = get_object_or_404(models.RestaurantTable, qr_code_token=qr_code_token)
        orders = (
            table.commandes.filter(statut_paiement=models.Order.StatutPaiement.EN_ATTENTE)
            .exclude(statut=models.Order.Statut.ANNULEE)
            .order_by("-created_at")
        )
        data = {"commandes": serializers.QrOrderStatusSerializer(orders, many=True).data}
        data.update(_presence_payload(table.tenant_id))
        return Response(data)


class QrCallWaiterView(APIView):
    """
    `POST /api/qr/<token>/appel-serveur/` — bouton d'appel serveur (§5.6),
    alerte ciblée avec le numéro de table exact, diffusée en temps réel à
    TOUS les écrans staff connectés (`broadcast_appel_serveur`) — pas
    seulement Master, cf. le raisonnement complet sur cette fonction.
    """

    permission_classes = [AllowAny]

    def post(self, request, qr_code_token):
        table = get_object_or_404(models.RestaurantTable, qr_code_token=qr_code_token)
        table.statut = models.RestaurantTable.Statut.APPEL_SERVEUR
        table.save(update_fields=["statut", "updated_at"])

        signals.broadcast_appel_serveur(table, "appel_serveur")

        data = {"detail": "Le serveur a été notifié."}
        data.update(_presence_payload(table.tenant_id))
        return Response(data)
