import json

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone
from rest_framework.renderers import JSONRenderer

from .middleware import get_current_user
from .models import Order, OrderItem, OrderTicket, TicketStatusLog

# Correspondance statut ticket -> statut ligne (§5.6 "voir sa commande
# avancer plat par plat"), UNIQUEMENT dans le sens ticket → lignes qui
# n'a pas d'ambiguïté : démarrer le ticket ("Démarrer") met en
# préparation toutes ses lignes pas encore prêtes, l'annuler annule
# toutes ses lignes actives, et servir le ticket marque ses lignes
# "servi" — comme TOUTES les lignes actives d'un ticket sont déjà
# forcément "prêt" au moment où il passe "servi" (le ticket ne peut
# devenir "servi" qu'après être passé "prêt", lui-même déclenché
# uniquement une fois toutes ses lignes prêtes), il n'y a aucune
# ambiguïté à les faire toutes basculer ensemble ici — contrairement à
# "prêt", qui doit rester ligne par ligne (cf. plus bas). `PRET` est
# volontairement absent d'ici en tant que CIBLE : ce n'est plus le
# ticket qui décide que ses lignes sont prêtes, c'est l'inverse — chaque
# plat est marqué prêt INDIVIDUELLEMENT par la cuisine (cf.
# `OrderItemViewSet.marquer_pret`), et c'est seulement une fois TOUTES
# les lignes actives d'un ticket prêtes que le ticket lui-même passe
# "prêt" automatiquement (cf. `_sync_ticket_statut_depuis_lignes` plus
# bas). Sans ça, marquer un ticket "prêt" ferait passer d'un coup tous
# ses plats prêts même si un seul est réellement sorti — impossible de
# savoir que "le poulet est prêt mais pas les brochettes" sur un même
# ticket.
STATUT_TICKET_VERS_LIGNE = {
    OrderTicket.Statut.EN_PREPARATION: OrderItem.StatutLigne.EN_PREPARATION,
    OrderTicket.Statut.SERVI: OrderItem.StatutLigne.SERVI,
    OrderTicket.Statut.ANNULE: OrderItem.StatutLigne.ANNULE,
}


@receiver(pre_save, sender=Order)
def _stash_previous_paiement_and_stamp(sender, instance, **kwargs):
    """Mémorise `statut_paiement` avant écriture et horodate `heure_paiement` à la première transition vers PAYEE."""

    previous = None
    if instance.pk:
        previous = Order.objects.filter(pk=instance.pk).values("statut_paiement").first()
    instance._previous_statut_paiement = previous["statut_paiement"] if previous else None

    if instance._previous_statut_paiement != instance.statut_paiement:
        if instance.statut_paiement == Order.StatutPaiement.PAYEE and not instance.heure_paiement:
            instance.heure_paiement = timezone.now()


@receiver(post_save, sender=Order)
def _liberer_table_si_tout_paye(sender, instance, created, **kwargs):
    """
    Libération automatique de la table dès que `statut_paiement` passe à
    PAYEE (§5.5/§5.6) — mais seulement si TOUTES les commandes actives de
    cette table sont elles aussi payées, pour ne pas libérer une table où
    une commande précédente resterait impayée (ex: deux commandes
    successives sur la même visite).
    """

    if created or instance.table_id is None:
        return

    previous = getattr(instance, "_previous_statut_paiement", None)
    if previous == instance.statut_paiement or instance.statut_paiement != Order.StatutPaiement.PAYEE:
        return

    table = instance.table
    commandes_actives = table.commandes.exclude(statut=Order.Statut.ANNULEE)
    tout_paye = not commandes_actives.exclude(statut_paiement=Order.StatutPaiement.PAYEE).exists()

    if tout_paye and table.statut != table.Statut.LIBRE:
        table.statut = table.Statut.LIBRE
        table.save(update_fields=["statut", "updated_at"])


@receiver(pre_save, sender=OrderTicket)
def _stash_previous_state_and_stamp_timestamps(sender, instance, **kwargs):
    """
    Mémorise statut/is_held avant écriture (pour détecter un changement dans
    le post_save), et horodate automatiquement les transitions de statut
    (`heure_debut_preparation`, `heure_pret`, `heure_servi`).

    Fait ici plutôt que dans l'action `bump` de la vue : ainsi la stampe
    reste cohérente quel que soit le chemin utilisé pour changer le statut
    (action `bump`, `PATCH` direct, `/admin/`, script de données...).
    """

    previous = None
    if instance.pk:
        previous = (
            OrderTicket.objects.filter(pk=instance.pk).values("statut", "is_held").first()
        )
    instance._previous_statut = previous["statut"] if previous else None
    instance._previous_is_held = previous["is_held"] if previous else None

    if instance._previous_statut != instance.statut:
        now = timezone.now()
        if instance.statut == OrderTicket.Statut.EN_PREPARATION and not instance.heure_debut_preparation:
            instance.heure_debut_preparation = now
        elif instance.statut == OrderTicket.Statut.PRET and not instance.heure_pret:
            instance.heure_pret = now
        elif instance.statut == OrderTicket.Statut.SERVI and not instance.heure_servi:
            instance.heure_servi = now


@receiver(post_save, sender=OrderTicket)
def _log_broadcast_and_sync(sender, instance, created, **kwargs):
    """
    Alimente `TicketStatusLog` (§5.4), diffuse l'événement temps réel (§5.3)
    et resynchronise le statut de la commande parente (§5.1).
    """

    previous_statut = getattr(instance, "_previous_statut", None)
    statut_a_change = created or previous_statut != instance.statut
    if statut_a_change:
        TicketStatusLog.objects.create(
            tenant=instance.tenant,
            ticket=instance,
            ancien_statut=previous_statut or "",
            nouveau_statut=instance.statut,
            utilisateur=get_current_user(),
        )
        _sync_lignes_statut(instance)

    _broadcast(instance, created)
    _sync_order_statut(instance.order)
    _auto_fire_tickets_retenus_si_reste_pret(instance.order)


def _sync_lignes_statut(instance):
    """
    Répercute le démarrage/le service/l'annulation du ticket sur ses
    lignes (§5.6). Les lignes déjà annulées ne sont jamais réécrites (un
    motif d'annulation existant doit être préservé). Les lignes déjà
    "prêt" ne sont protégées d'un écrasement QUE quand la cible est
    "en préparation" — on ne fait pas régresser un plat déjà annoncé prêt
    juste parce que le ticket redémarre — mais PAS quand la cible est
    "servi" : c'est justement le sens normal de la transition (un ticket
    ne peut passer "servi" qu'une fois "prêt", donc TOUTES ses lignes
    actives sont déjà "prêt" à ce moment précis, cf.
    `STATUT_TICKET_VERS_LIGNE`).
    """

    nouveau_statut_ligne = STATUT_TICKET_VERS_LIGNE.get(instance.statut)
    if nouveau_statut_ligne is None:
        return
    exclusions = [nouveau_statut_ligne, OrderItem.StatutLigne.ANNULE]
    if nouveau_statut_ligne == OrderItem.StatutLigne.EN_PREPARATION:
        exclusions.append(OrderItem.StatutLigne.PRET)
    instance.lignes.exclude(statut_ligne__in=exclusions).update(statut_ligne=nouveau_statut_ligne)


@receiver(post_save, sender=OrderItem)
def _sync_ticket_statut_depuis_lignes(sender, instance, **kwargs):
    """
    Suivi plat par plat (§5.1/§5.6) : la cuisine marque chaque ligne
    "prête" individuellement (`OrderItemViewSet.marquer_pret`) — ex: le
    poulet braisé avant les brochettes, même ticket, même poste. Le
    ticket lui-même ne passe "prêt" automatiquement que lorsque TOUTES
    ses lignes actives (non annulées) le sont : c'est ce qui fait
    apparaître le bouton "Marquer servi" côté écran cuisine plutôt que de
    forcer la cuisine à attendre que tout soit prêt avant de rien voir.

    Diffuse aussi l'état du ticket même quand il ne bascule pas encore
    "prêt" (un seul plat sur deux marqué prêt) — sinon l'écran cuisine ne
    verrait jamais ce plat passer prêt en temps réel tant que le reste du
    ticket n'a pas suivi.
    """

    if instance.statut_ligne != OrderItem.StatutLigne.PRET:
        return

    ticket = instance.ticket
    if ticket.statut == OrderTicket.Statut.EN_PREPARATION:
        lignes_actives = ticket.lignes.exclude(statut_ligne=OrderItem.StatutLigne.ANNULE)
        tout_pret = not lignes_actives.exclude(statut_ligne=OrderItem.StatutLigne.PRET).exists()
        if tout_pret:
            ticket.statut = OrderTicket.Statut.PRET
            ticket.save()  # déclenche déjà `_broadcast` via le post_save de OrderTicket
            return

    _broadcast(ticket, created=False)


def _broadcast(instance, created):
    """
    Diffuse aux écrans poste ET Master. Un ticket retenu (Fire/Hold,
    §5.1) reste diffusé comme les autres — `is_held` ne masque plus rien
    ici, il ne fait que qualifier visuellement la carte côté frontend
    (bordure grise + bouton "Lancer" au lieu du bump normal, cf.
    `TicketCard.jsx`). Le cacher entièrement rendrait le bouton "Lancer"
    inatteignable (personne ne verrait jamais la carte pour cliquer
    dessus), et empêcherait la cuisine de commencer à préparer un plat
    marqué "servir avec le reste" — précisément ce qu'elle doit pouvoir
    faire en parallèle du reste de la commande.
    """

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    from .serializers import OrderTicketSerializer

    # `.data` peut contenir des types non JSON-natifs (UUID, Decimal...) que
    # le channel layer (sérialisation msgpack) ne sait pas encoder tel quel
    # — on repasse par le JSONRenderer de DRF pour forcer des types primitifs.
    payload = json.loads(JSONRenderer().render(OrderTicketSerializer(instance).data))
    event = "created" if created else "updated"
    for group_name in (
        f"kds_{instance.tenant_id}_{instance.station_id}",
        f"kds_{instance.tenant_id}_master",
    ):
        async_to_sync(channel_layer.group_send)(
            group_name, {"type": "ticket.event", "event": event, "ticket": payload}
        )


def _sync_order_statut(order):
    """
    Fait passer automatiquement `Order.statut` en fonction de l'état agrégé
    de ses `OrderTicket` (§5.1) : "prête" quand tous les tickets sont prêts
    (ou servis), "servie" quand tous sont servis, "en préparation" dès qu'un
    poste a commencé. Ne touche jamais une commande annulée.

    Les tickets `annulé` sont ignorés du calcul — un ticket annulé ne doit
    pas faire redescendre artificiellement le statut agrégé (ex: 1 ticket
    servi + 1 annulé doit être considéré "servie", pas "en préparation").
    """

    if order.statut == Order.Statut.ANNULEE:
        return

    statuts = set(
        order.tickets.exclude(statut=OrderTicket.Statut.ANNULE).values_list("statut", flat=True)
    )
    if not statuts:
        return

    if statuts == {OrderTicket.Statut.SERVI}:
        nouveau_statut = Order.Statut.SERVIE
    elif statuts <= {OrderTicket.Statut.PRET, OrderTicket.Statut.SERVI}:
        nouveau_statut = Order.Statut.PRETE
    elif statuts & {OrderTicket.Statut.EN_PREPARATION, OrderTicket.Statut.PRET, OrderTicket.Statut.SERVI}:
        nouveau_statut = Order.Statut.EN_PREPARATION
    else:
        nouveau_statut = Order.Statut.NOUVELLE

    if order.statut != nouveau_statut:
        order.statut = nouveau_statut
        order.save(update_fields=["statut", "updated_at"])
        if nouveau_statut in (Order.Statut.PRETE, Order.Statut.SERVIE):
            from .pos_webhooks import notify_order_statut

            notify_order_statut(order)


def _auto_fire_tickets_retenus_si_reste_pret(order):
    """
    Fire/Hold choisi par le client à la commande (§5.1/§5.6) : un plat
    marqué "servir avec le reste" part en cuisine retenu (`is_held=True`)
    — visible sur son poste dès la création (cf. `_broadcast`), avec un
    bouton "Lancer" (la cuisine garde la main pour le démarrer plus tôt,
    ex: un plat lent qu'il vaut mieux ne pas attendre), mais pas encore
    "en préparation" tant que personne ne l'a lancé. Dès que TOUS les
    autres tickets de la commande (non retenus, non annulés) sont prêts
    ou servis, les tickets encore retenus se lancent automatiquement —
    sans action du client ni du staff : c'est ce qui doit "mettre le
    client à l'aise" plutôt que de le faire réclamer ou attendre une
    action côté service.

    Cas limite important : si la commande ne contient QUE des plats
    retenus (aucun plat "immédiat" à côté), il n'y a littéralement rien
    à attendre — le ticket doit alors se lancer tout de suite, pas rester
    bloqué indéfiniment. `tickets_non_retenus.exclude(...).exists()` sur
    une queryset déjà vide vaut `False`, donc `tout_pret` est naturellement
    `True` dans ce cas : aucun garde-fou "rien à comparer" à ajouter ici,
    ç'a été une vraie régression une première fois (cf. historique).

    Appelé à chaque sauvegarde de ticket : la fonction est idempotente
    (ne fait rien si aucun ticket n'est plus retenu ou si le reste n'est
    pas encore prêt), donc être appelée "trop souvent" est sans risque.
    """

    if order.statut == Order.Statut.ANNULEE:
        return

    if not order.tickets.filter(is_held=True).exclude(statut=OrderTicket.Statut.ANNULE).exists():
        return  # rien de retenu, rien à faire

    tickets_non_retenus = order.tickets.filter(is_held=False).exclude(statut=OrderTicket.Statut.ANNULE)
    tout_pret = not tickets_non_retenus.exclude(
        statut__in=[OrderTicket.Statut.PRET, OrderTicket.Statut.SERVI]
    ).exists()
    if not tout_pret:
        return

    for ticket in order.tickets.filter(is_held=True).exclude(statut=OrderTicket.Statut.ANNULE):
        ticket.is_held = False
        ticket.heure_envoi_poste = timezone.now()
        ticket.save()
