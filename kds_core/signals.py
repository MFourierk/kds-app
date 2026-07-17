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

    Quand la cible est "servi", stampe aussi `servi_par` (traçabilité de
    service, demandée après coup) avec l'utilisateur de la requête en
    cours — que ce soit un bump ticket-entier (écran cuisine classique)
    ou la promotion automatique déclenchée par
    `_sync_ticket_statut_depuis_lignes` une fois toutes les lignes déjà
    individuellement servies via l'écran Service. Dans ce dernier cas,
    l'exclusion `nouveau_statut_ligne` ci-dessous exclut déjà les lignes
    concernées (déjà "servi", chacune avec son propre `servi_par` posé
    par `OrderItemViewSet.marquer_servi`) — jamais écrasées ici.
    """

    nouveau_statut_ligne = STATUT_TICKET_VERS_LIGNE.get(instance.statut)
    if nouveau_statut_ligne is None:
        return
    exclusions = [nouveau_statut_ligne, OrderItem.StatutLigne.ANNULE]
    if nouveau_statut_ligne == OrderItem.StatutLigne.EN_PREPARATION:
        exclusions.append(OrderItem.StatutLigne.PRET)
    champs = {"statut_ligne": nouveau_statut_ligne}
    if nouveau_statut_ligne == OrderItem.StatutLigne.SERVI:
        champs["servi_par"] = get_current_user()
    instance.lignes.exclude(statut_ligne__in=exclusions).update(**champs)


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

    Symétrique côté service (écran serveur dédié, `ServeurScreen.jsx`) :
    une fois le ticket "prêt", chaque plat peut être confirmé servi
    individuellement (`OrderItemViewSet.marquer_servi`) dès qu'IL est
    prêt — un plat "servir dès que prêt" n'attend pas ses voisins. Le
    ticket bascule "servi" tout seul une fois toutes ses lignes actives
    servies, en repassant par "prêt" au passage si ce n'était pas déjà
    fait (jamais de saut direct en_préparation → servi, sinon
    `heure_pret` ne serait jamais horodaté — cf. `_stash_previous_state_
    and_stamp_timestamps` — et fausserait les rapports de temps de
    préparation, Phase 6).

    Diffuse aussi l'état du ticket même quand il ne bascule pas encore
    (un seul plat sur deux marqué prêt/servi) — sinon l'écran cuisine ou
    l'écran serveur ne verraient jamais ce plat avancer en temps réel
    tant que le reste du ticket n'a pas suivi.
    """

    if instance.statut_ligne not in (OrderItem.StatutLigne.PRET, OrderItem.StatutLigne.SERVI):
        return

    ticket = instance.ticket
    lignes_actives = ticket.lignes.exclude(statut_ligne=OrderItem.StatutLigne.ANNULE)

    if ticket.statut == OrderTicket.Statut.EN_PREPARATION:
        tout_pret_ou_servi = not lignes_actives.exclude(
            statut_ligne__in=[OrderItem.StatutLigne.PRET, OrderItem.StatutLigne.SERVI]
        ).exists()
        if tout_pret_ou_servi:
            ticket.statut = OrderTicket.Statut.PRET
            ticket.save()  # déclenche déjà `_broadcast` via le post_save de OrderTicket
            ticket.refresh_from_db()

    if ticket.statut == OrderTicket.Statut.PRET:
        tout_servi = not lignes_actives.exclude(statut_ligne=OrderItem.StatutLigne.SERVI).exists()
        if tout_servi:
            ticket.statut = OrderTicket.Statut.SERVI
            ticket.save()  # déclenche déjà `_broadcast`
            return

    _broadcast(ticket, created=False)


def broadcast_appel_serveur(table, event):
    """
    Diffuse un événement "appel serveur" (déclenché ou fermé, §5.6) à
    TOUS les écrans staff connectés — Master ET chaque poste (Cuisine,
    Bar...), pas seulement Master comme avant. Constat client réel : un
    cuisinier/barman qui n'a jamais ouvert l'écran Master (il vit sur
    l'écran de son poste, `ws/kds/<station>/`) ne recevait jamais
    l'appel, alors même que "aucun employé ne dira qu'il n'a pas vu" est
    justement le but recherché.
    """

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    from .models import Station

    payload = {"id": str(table.id), "numero": table.numero, "statut": table.statut}
    groupes = [f"kds_{table.tenant_id}_master"]
    groupes += [
        f"kds_{table.tenant_id}_{station_id}"
        for station_id in Station.objects.filter(tenant_id=table.tenant_id).values_list("id", flat=True)
    ]
    for group_name in groupes:
        async_to_sync(channel_layer.group_send)(
            group_name, {"type": "table.event", "event": event, "table": payload}
        )


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
    marqué "servir avec le reste" ou "à la fin" part en cuisine retenu
    (`is_held=True`) — visible sur son poste dès la création (cf.
    `_broadcast`), avec un bouton "Lancer" (la cuisine garde la main pour
    le démarrer plus tôt, ex: un plat lent qu'il vaut mieux ne pas
    attendre), mais pas encore "en préparation" tant que personne ne l'a
    lancé. Deux paliers de libération automatique, sans action du client
    ni du staff — c'est ce qui doit "mettre le client à l'aise" plutôt
    que de le faire réclamer ou attendre une action côté service :

    1. "Avec le reste" (`en_dernier=False`) se lance dès que TOUS les
       tickets immédiats (`is_held=False`) de la commande sont prêts ou
       servis — comportement d'origine, inchangé.
    2. "À la fin" (`en_dernier=True`, demandé après coup — ex: un dessert
       qui doit arriver après tout le reste) se lance seulement une fois
       TOUT LE RESTE de la commande (immédiat + "avec le reste", donc
       APRÈS le palier 1) prêt ou servi — pas seulement les tickets
       jamais retenus.

    Cas limite important, dans les deux paliers : si le sous-ensemble à
    comparer est vide (ex: une commande ne contenant QUE des plats "à la
    fin", ou que des plats "avec le reste"/"à la fin" sans rien
    d'immédiat), il n'y a littéralement rien à attendre — le palier
    concerné se lance alors tout de suite, pas de blocage indéfini.
    `queryset_vide.exclude(...).exists()` vaut `False`, donc "prêt" est
    naturellement `True` dans ce cas : aucun garde-fou "rien à comparer"
    à ajouter, ç'a été une vraie régression une première fois pour le
    palier 1 (cf. historique) — même raisonnement appliqué au palier 2.

    Appelé à chaque sauvegarde de ticket : la fonction est idempotente
    (ne fait rien si aucun ticket n'est plus retenu ou si le palier
    concerné n'est pas encore prêt), donc être appelée "trop souvent" est
    sans risque.
    """

    if order.statut == Order.Statut.ANNULEE:
        return

    tickets_retenus = order.tickets.filter(is_held=True).exclude(statut=OrderTicket.Statut.ANNULE)
    if not tickets_retenus.exists():
        return  # rien de retenu, rien à faire

    # Palier 1 — "avec le reste" : attend les tickets immédiats.
    tickets_immediats = order.tickets.filter(is_held=False).exclude(statut=OrderTicket.Statut.ANNULE)
    immediats_prets = not tickets_immediats.exclude(
        statut__in=[OrderTicket.Statut.PRET, OrderTicket.Statut.SERVI]
    ).exists()
    if immediats_prets:
        for ticket in tickets_retenus.filter(en_dernier=False):
            ticket.is_held = False
            ticket.heure_envoi_poste = timezone.now()
            ticket.save()

    # Palier 2 — "à la fin" : attend TOUT le reste (immédiat + "avec le
    # reste"), donc naturellement après le palier 1 ci-dessus — au moment
    # précis où le palier 1 vient de lancer un ticket, son statut est
    # encore `en_attente` (pas encore `pret`/`servi`), donc ce palier ne
    # se déclenchera qu'à un appel ultérieur de cette fonction (au
    # prochain changement de statut de ce ticket) : pas de faux-départ
    # simultané des deux paliers.
    tickets_pas_en_dernier = order.tickets.exclude(en_dernier=True).exclude(statut=OrderTicket.Statut.ANNULE)
    reste_pret = not tickets_pas_en_dernier.exclude(
        statut__in=[OrderTicket.Statut.PRET, OrderTicket.Statut.SERVI]
    ).exists()
    if reste_pret:
        for ticket in tickets_retenus.filter(en_dernier=True):
            ticket.is_held = False
            ticket.heure_envoi_poste = timezone.now()
            ticket.save()
