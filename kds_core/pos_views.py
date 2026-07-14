from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models, serializers, services
from .pos_auth import IsPosIntegration, PosApiKeyAuthentication


def _resolve_order(tenant, data):
    """Résout la commande visée par `order` ou `reference_externe` (cf. `PosOrderLookupSerializer`)."""

    order = data.get("order")
    if order is not None:
        return order
    return (
        models.Order.objects.filter(tenant=tenant, reference_externe=data["reference_externe"])
        .order_by("-created_at")
        .first()
    )


class PosOrderCreateView(APIView):
    """
    `POST /api/pos/orders/` — création d'une commande en un seul appel
    depuis un logiciel de caisse tiers (cf. §5.5 "synchro POS ... stricte :
    la commande créée en caisse arrive en cuisine").

    Authentification par clé API (`PosApiKeyAuthentication`), pas JWT : un
    POS n'est pas un utilisateur `kds_core.User`. Réutilise
    `services.route_items_to_tickets`, le même routage intelligent que
    `OrderViewSet.add_items` côté staff — un seul endroit qui décide
    comment un plat est ventilé vers un poste.
    """

    authentication_classes = [PosApiKeyAuthentication]
    permission_classes = [IsPosIntegration]

    def post(self, request):
        tenant = request.user.tenant
        serializer = serializers.PosCreateOrderSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        table = None
        if data.get("table_numero"):
            table = models.RestaurantTable.objects.filter(
                tenant=tenant, numero=data["table_numero"]
            ).first()

        order = models.Order.objects.create(
            tenant=tenant,
            table=table,
            source=models.Order.Source.SALLE,
            reference_externe=data.get("reference_externe", ""),
        )
        services.route_items_to_tickets(order, data["items"])

        return Response(
            serializers.OrderSerializer(order, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class PosOrderPaymentView(APIView):
    """
    `POST /api/pos/orders/pay/` — la caisse notifie le KDS qu'une commande
    a été payée (§5.5 : la caisse est la source de vérité du paiement).

    Déclenche automatiquement la libération de la table associée si toutes
    ses commandes actives sont désormais payées (cf.
    `kds_core/signals.py::_liberer_table_si_tout_paye`). La commande peut
    être identifiée soit par `order` (l'UUID renvoyé à la création), soit
    par `reference_externe` (au cas où la caisse ne l'aurait pas conservé).
    """

    authentication_classes = [PosApiKeyAuthentication]
    permission_classes = [IsPosIntegration]

    def post(self, request):
        tenant = request.user.tenant
        serializer = serializers.PosPaymentSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        order = _resolve_order(tenant, data)
        if order is None:
            return Response({"detail": "Commande introuvable."}, status=status.HTTP_404_NOT_FOUND)

        order.statut_paiement = models.Order.StatutPaiement.PAYEE
        if data.get("mode_paiement"):
            order.mode_paiement = data["mode_paiement"]
        # Pas de `update_fields` : le pre_save (`signals.py`) horodate aussi
        # `heure_paiement`, qui doit donc être réellement écrit en base
        # (cf. le même bug déjà corrigé pour `OrderTicket` en Phase 2).
        order.save()

        return Response(serializers.OrderSerializer(order, context={"request": request}).data)


class PosOrderCancelView(APIView):
    """
    `POST /api/pos/orders/cancel/` — la caisse notifie l'annulation d'une
    commande (client parti, erreur de saisie...). Répercute la cascade sur
    les tickets encore actifs pour que la cuisine arrête immédiatement leur
    préparation (cf. `services.cancel_order`).
    """

    authentication_classes = [PosApiKeyAuthentication]
    permission_classes = [IsPosIntegration]

    def post(self, request):
        tenant = request.user.tenant
        serializer = serializers.PosCancelSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        order = _resolve_order(tenant, data)
        if order is None:
            return Response({"detail": "Commande introuvable."}, status=status.HTTP_404_NOT_FOUND)

        services.cancel_order(order, motif=data.get("motif", ""))

        return Response(serializers.OrderSerializer(order, context={"request": request}).data)
