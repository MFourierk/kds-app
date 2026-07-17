from django.utils import timezone

from . import models


def valider_modificateurs(plat, modificateurs):
    """
    Fait respecter les catégories de modificateurs obligatoires (§5.2,
    demandé après coup — "dès qu'un client clique sur Entrecôte, le POS
    doit l'obliger à choisir une cuisson"). Volontairement côté serveur,
    pas seulement dans l'écran (`SelecteurModificateurs.jsx`) : un vieux
    frontend en cache, ou l'intégration POS tierce
    (`PosOrderCreateView`), pourrait sinon contourner la contrainte —
    pour un plat mal cuit, une simple validation d'interface ne suffit
    pas. Partagée entre `AddOrderItemLineSerializer.validate` (staff) et
    `QrOrderCreateView` (client QR, qui n'a pas de serializer commun avec
    le staff, cf. note dans `serializers.py`).

    Lève `ValueError(message)` si un modificateur soumis n'appartient pas
    au plat, ou si une catégorie obligatoire représentée parmi les
    modificateurs *disponibles* pour ce plat n'a aucune sélection parmi
    les modificateurs *soumis*.
    """

    modificateurs = list(modificateurs)
    modificateurs_disponibles = list(plat.modifiers.select_related("categorie"))
    ids_disponibles = {m.id for m in modificateurs_disponibles}

    for modificateur in modificateurs:
        if modificateur.id not in ids_disponibles:
            raise ValueError(f"« {modificateur.libelle} » ne fait pas partie des modificateurs de « {plat.nom} ».")

    ids_soumis = {m.id for m in modificateurs}
    categories_obligatoires_disponibles = {
        m.categorie for m in modificateurs_disponibles if m.categorie_id and m.categorie.obligatoire
    }
    for categorie in categories_obligatoires_disponibles:
        options_de_la_categorie = {
            m.id for m in modificateurs_disponibles if m.categorie_id == categorie.id
        }
        if not (options_de_la_categorie & ids_soumis):
            raise ValueError(f"« {plat.nom} » nécessite un choix dans la catégorie « {categorie.nom} ».")


def route_items_to_tickets(order, items):
    """
    Routage intelligent partagé (§5.1) : route chaque ligne
    `{plat, quantite, modificateurs, commentaire_libre, service_immediat,
    servir_en_dernier}` vers le ticket actif du poste concerné d'après
    `MenuItem.station` — créé s'il n'en existe pas déjà un pour ce poste
    sur cette commande (réutilisation d'un ticket existant tant qu'il
    n'est pas `servi`).

    `service_immediat` (défaut `True`, ignoré si absent — staff/POS
    n'exposent pas ce choix) : §5.6 "servir maintenant" vs "servir avec le
    reste". Un plat marqué `False` part sur un ticket **retenu**
    (`is_held=True`), même s'il partage le même poste qu'un plat immédiat
    — d'où le regroupement par (poste, retenu, en_dernier) et non plus
    par poste seul. Retenu ne veut pas dire invisible : le ticket
    apparaît normalement sur son poste (avec un bouton "Lancer" plutôt
    que le bump habituel, cf. `TicketCard.jsx`), pour que la cuisine
    puisse quand même le préparer en parallèle — sinon un plat lent
    marqué "avec le reste" ne commencerait jamais à cuire avant que le
    reste soit déjà prêt. Le ticket retenu se libère automatiquement
    quand le reste de la commande est prêt (cf.
    `signals.py::_auto_fire_tickets_retenus_si_reste_pret`), ou peut être
    lancé manuellement avant ça.

    `servir_en_dernier` (défaut `False`, sans effet si `service_immediat`
    est vrai — §5.6, "À la fin", demandé après coup en plus de "dès que
    prêt"/"avec le reste" : ex: un dessert qui doit arriver après tout le
    reste, MÊME après les plats "avec le reste") : un raffinement de
    "retenu", pas une troisième valeur indépendante — d'où le
    regroupement par (poste, retenu, en_dernier) plutôt que
    (poste, moment) à plat, qui aurait autorisé la combinaison
    incohérente "immédiat ET en dernier".

    Partagé entre `OrderViewSet.add_items` (staff, JWT), `PosOrderCreateView`
    (caisse tierce, clé API) et `QrOrderCreateView` (client, §5.6) pour ne
    pas dupliquer la logique de routage entre ces points d'entrée.
    """

    TICKETS_NON_REUTILISABLES = [models.OrderTicket.Statut.SERVI, models.OrderTicket.Statut.ANNULE]

    tickets_par_cle = {}
    for ligne in items:
        plat = ligne["plat"]
        station = plat.station
        retenu = not ligne.get("service_immediat", True)
        en_dernier = retenu and bool(ligne.get("servir_en_dernier", False))
        cle = (station.id, retenu, en_dernier)

        ticket = tickets_par_cle.get(cle)
        if ticket is None:
            ticket = (
                order.tickets.filter(station=station, is_held=retenu, en_dernier=en_dernier)
                .exclude(statut__in=TICKETS_NON_REUTILISABLES)
                .first()
            )
        if ticket is None:
            ticket = models.OrderTicket.objects.create(
                tenant=order.tenant,
                order=order,
                station=station,
                is_held=retenu,
                en_dernier=en_dernier,
                heure_envoi_poste=None if retenu else timezone.now(),
            )
        item = models.OrderItem.objects.create(
            tenant=order.tenant,
            ticket=ticket,
            plat=plat,
            quantite=ligne.get("quantite", 1),
            commentaire_libre=ligne.get("commentaire_libre", ""),
        )
        if ligne.get("modificateurs"):
            item.modificateurs.set(ligne["modificateurs"])
        tickets_par_cle[cle] = ticket

    tickets = list(tickets_par_cle.values())

    # Re-diffuse chaque ticket touché une fois TOUTES ses lignes attachées.
    # `OrderTicket.objects.create()` déclenche déjà une diffusion (§5.3) au
    # moment même de sa création — donc AVANT que la boucle ci-dessus ait
    # créé la moindre `OrderItem` dessus. Sans ce correctif, le tout premier
    # ticket d'une commande apparaît un instant en cuisine sans aucun plat
    # dedans (juste "Table X / En attente / Démarrer"), le temps qu'un
    # futur changement de statut le rediffuse — repéré en testant les
    # notifications "nouveau ticket" en conditions réelles, pas par un test
    # automatisé (le décalage est de l'ordre de la milliseconde, invisible
    # sauf capture d'écran au bon moment).
    from .signals import _broadcast

    for ticket in tickets:
        _broadcast(ticket, created=False)

    return tickets


def calculer_total_commande(order):
    """
    Total facturable d'une commande : somme des lignes NON annulées
    (quantité × prix du plat au moment de l'appel — pas figé en base,
    cf. note sur `Order.idempotency_key`/§5.5 pour le "montant reçu" figé
    lui à l'encaissement). Partagé entre `QrOrderStatusSerializer.get_total`
    (suivi client), `OrderViewSet.encaisser` (calcul de la monnaie) et
    `impression.imprimer_recu` (montant imprimé) pour ne pas avoir trois
    implémentations légèrement différentes du même calcul.
    """

    lignes = models.OrderItem.objects.filter(ticket__order=order).exclude(
        statut_ligne=models.OrderItem.StatutLigne.ANNULE
    ).select_related("plat")
    return sum((ligne.plat.prix * ligne.quantite for ligne in lignes), start=0)


def cancel_order(order, motif="", utilisateur=None):
    """
    Annule une commande et répercute la cascade sur ce qui est encore en
    cours (§5.1/§5.4) : les tickets déjà `servi` ne sont jamais touchés (le
    plat est déjà en salle), mais tout ticket encore actif passe `annulé`
    — ce qui déclenche le signal existant sur `OrderTicket` (log +
    diffusion temps réel : les écrans concernés voient immédiatement que
    ce ticket est annulé). Les lignes de commande (`OrderItem`) de ces
    tickets sont marquées `annulé` avec un motif, pour le futur suivi
    gaspillage/annulations (§5.4).

    Idempotent : ré-annuler une commande déjà annulée ne fait rien.

    Partagé entre `OrderViewSet.cancel` (staff, JWT — motif obligatoire,
    `utilisateur=request.user`, cf. §5.1 "procédure d'annulation") et
    `PosOrderCancelView` (logiciel de caisse tiers, clé API — pas
    d'utilisateur humain à créditer, `utilisateur` reste `None`).
    """

    if order.statut == models.Order.Statut.ANNULEE:
        return order

    # L'ordre compte : on annule la commande AVANT ses tickets, pour que le
    # garde-fou `if order.statut == Order.Statut.ANNULEE: return` de
    # `_sync_order_statut` (déclenché par le save de chaque ticket
    # ci-dessous) empêche toute resynchronisation intempestive du statut.
    order.statut = models.Order.Statut.ANNULEE
    # `statut_paiement` (pas seulement `statut`, cf. `Order.StatutPaiement.
    # ANNULEE`, définie mais jamais posée nulle part avant ce correctif) :
    # sans ça, une commande annulée mais jamais payée restait indéfiniment
    # dans la liste "Commandes de table" de la caisse (filtrée sur
    # `statut_paiement=en_attente`), comme n'importe quelle commande en
    # attente normale — un caissier aurait pu tenter de l'encaisser. Ne
    # touche jamais une commande déjà `PAYEE` : ce chemin gère l'annulation
    # d'une commande encore en cours, pas un remboursement après paiement
    # (hors périmètre ici).
    if order.statut_paiement == models.Order.StatutPaiement.EN_ATTENTE:
        order.statut_paiement = models.Order.StatutPaiement.ANNULEE
    order.motif_annulation = motif or "Commande annulée"
    order.annule_par = utilisateur
    order.heure_annulation = timezone.now()
    order.save()

    tickets_actifs = list(
        order.tickets.exclude(statut__in=[models.OrderTicket.Statut.SERVI, models.OrderTicket.Statut.ANNULE])
    )
    for ticket in tickets_actifs:
        ticket.statut = models.OrderTicket.Statut.ANNULE
        ticket.save()

    ticket_ids = [ticket.id for ticket in tickets_actifs]
    models.OrderItem.objects.filter(ticket_id__in=ticket_ids).exclude(
        statut_ligne=models.OrderItem.StatutLigne.ANNULE
    ).update(statut_ligne=models.OrderItem.StatutLigne.ANNULE, motif_annulation=motif or "Commande annulée")

    return order
