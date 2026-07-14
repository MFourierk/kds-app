import asyncio
import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.core.exceptions import ValidationError
from rest_framework.renderers import JSONRenderer

from . import presence

HEARTBEAT_INTERVAL_SECONDS = 20


class KDSConsumer(AsyncJsonWebsocketConsumer):
    """
    Canal temps réel d'un écran KDS (cf. cahier des charges §5.3).

    URL : `ws/kds/<scope_id>/` où `<scope_id>` est soit l'UUID d'une
    `Station` (écran poste — ne reçoit que les tickets de CE poste), soit
    le mot-clé `master` (écran Master/Expéditeur — reçoit tous les tickets
    du tenant, tous postes confondus).

    Authentification par JWT en query string (`?token=...`), résolue par
    `kds_core.channels_auth.JWTAuthMiddleware` avant que `connect()` ne
    s'exécute. La connexion est refusée si l'utilisateur n'est pas
    authentifié ou n'appartient à aucun tenant — même garde-fou
    d'isolation multi-tenant que le reste de l'API (cf. `IsTenantMember`).
    """

    async def connect(self):
        user = self.scope["user"]
        if not user.is_authenticated or not user.tenant_id:
            await self.close(code=4401)
            return

        self.scope_id = self.scope["url_route"]["kwargs"]["scope_id"]
        self.tenant_id = user.tenant_id
        self.group_name = f"kds_{user.tenant_id}_{self.scope_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Présence (cf. `kds_core.presence`) : un premier signe de vie
        # immédiat, puis rafraîchi périodiquement tant que la connexion
        # reste ouverte — permet à `QrOrderCreateView` de savoir, à
        # l'instant même d'une commande, si un écran cuisine est
        # réellement joignable.
        await presence.heartbeat(self.tenant_id, self.scope_id, self.channel_name)
        self._stop_heartbeat = asyncio.Event()
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        # Rattrapage (§6.5 "fonctionnement en mode dégradé... sans perte de
        # commande") : à CHAQUE connexion — la toute première, ou une
        # reconnexion après une coupure réseau côté restaurant — l'écran
        # reçoit immédiatement l'état actuel de tous les tickets actifs de
        # son périmètre, avant de continuer à écouter les événements en
        # direct. Sans ça, un ticket créé/mis à jour pendant que cet écran
        # était déconnecté (ex: commande QR passée via la 4G du client
        # pendant une panne internet du restaurant) resterait invisible
        # indéfiniment côté cuisine, alors même qu'il est bien en base.
        snapshot = await self._get_active_tickets_snapshot(user.tenant_id, self.scope_id)
        await self.send_json({"event": "sync", "tickets": snapshot})

    async def disconnect(self, close_code):
        if hasattr(self, "_stop_heartbeat"):
            self._stop_heartbeat.set()
        if hasattr(self, "_heartbeat_task"):
            # `await` plutôt que `.cancel()` : on laisse le cycle en cours
            # (s'il y en a un) se terminer proprement. Interrompre un appel
            # Redis en plein vol via cancellation risquerait de laisser la
            # connexion partagée dans un état incohérent (réponse à moitié
            # lue), ce qui ferait échouer — par timeout — le prochain appel
            # Redis de ce process, y compris sans rapport avec cet écran.
            await self._heartbeat_task
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        if hasattr(self, "tenant_id"):
            await presence.forget(self.tenant_id, self.scope_id, self.channel_name)

    async def _heartbeat_loop(self):
        while not self._stop_heartbeat.is_set():
            try:
                await asyncio.wait_for(
                    self._stop_heartbeat.wait(), timeout=HEARTBEAT_INTERVAL_SECONDS
                )
            except asyncio.TimeoutError:
                await presence.heartbeat(self.tenant_id, self.scope_id, self.channel_name)

    async def ticket_event(self, event):
        """Relaye au client un événement poussé par `kds_core.signals` via `group_send`."""
        await self.send_json({"event": event["event"], "ticket": event["ticket"]})

    async def table_event(self, event):
        """Relaye un événement table (ex: appel serveur, §5.6) poussé par `kds_core.qr_views`."""
        await self.send_json({"event": event["event"], "table": event["table"]})

    @database_sync_to_async
    def _get_active_tickets_snapshot(self, tenant_id, scope_id):
        from .models import OrderTicket
        from .serializers import OrderTicketSerializer

        # `is_held` n'exclut plus rien ici : un ticket retenu (Fire/Hold)
        # doit rester visible sur son poste — avec le bouton "Lancer" côté
        # frontend (cf. TicketCard.jsx) — sinon personne ne peut jamais le
        # déclencher manuellement ni même savoir qu'il existe.
        queryset = OrderTicket.objects.filter(tenant_id=tenant_id).exclude(
            statut__in=[OrderTicket.Statut.SERVI, OrderTicket.Statut.ANNULE]
        )
        if scope_id != "master":
            queryset = queryset.filter(station_id=scope_id)
        queryset = queryset.select_related("tenant", "order", "order__table", "station").order_by("created_at")

        try:
            tickets = list(queryset)
        except (ValueError, ValidationError):
            # `scope_id` n'est ni "master" ni un UUID de station valide —
            # aucun ticket à rattraper plutôt qu'une erreur de connexion.
            return []

        return json.loads(JSONRenderer().render(OrderTicketSerializer(tickets, many=True).data))
