from django.db import transaction
from django.db.models import Count, Max, Sum
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import models, serializers, services
from .permissions import IsAdmin, IsManagerOrAdmin, IsTenantMember, PeutEncaisser


class TenantScopedViewSetMixin:
    """
    Mixin à appliquer à tout ViewSet exposant un modèle rattaché à un tenant.

    Principe strict : une seule ligne de filtrage (`get_queryset`) et une
    seule ligne d'injection (`perform_create`), centralisées ici une fois
    pour toutes plutôt que répétées dans chaque ViewSet. Le tenant n'est
    JAMAIS lu depuis la requête du client (body, query param...) — toujours
    depuis `request.user.tenant`, garanti non-nul par `IsTenantMember`.
    """

    permission_classes = [IsAuthenticated, IsTenantMember]

    def get_queryset(self):
        return super().get_queryset().filter(tenant=self.request.user.tenant)

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.user.tenant)


class ProtectedDeleteMixin:
    """
    Renvoie une erreur 400 propre côté API si la suppression est bloquée
    par une FK `PROTECT` (ex: poste/catégorie/plat encore utilisé par une
    commande passée), plutôt que laisser `ProtectedError` remonter tel
    quel et déclencher une 500 non gérée — un manager qui essaie de
    supprimer une ressource encore utilisée est un cas normal, pas un bug.
    """

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Impossible de supprimer : des données y sont encore rattachées."},
                status=status.HTTP_400_BAD_REQUEST,
            )


class ManagerWriteMixin:
    """
    Lecture ouverte à tout membre du tenant (nécessaire ailleurs dans l'app
    — ex: `fetchStations` côté frontend, pour router un cuisinier vers son
    poste au login), écriture réservée manager/admin. Le tableau de bord
    (`src/admin/`) cache déjà les écrans de gestion aux autres rôles côté
    frontend, mais un masquage UI n'est pas une vraie protection : sans ce
    mixin, un cuisinier avec un JWT valide pourrait quand même modifier le
    menu/les postes/les comptes via l'API directement.
    """

    def get_permissions(self):
        permissions = super().get_permissions()
        if self.request.method not in ("GET", "HEAD", "OPTIONS"):
            permissions.append(IsManagerOrAdmin())
        return permissions


class StationViewSet(ProtectedDeleteMixin, ManagerWriteMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = models.Station.objects.all()
    serializer_class = serializers.StationSerializer

    def get_permissions(self):
        # `reassigner` est une action de secours en plein service
        # (écran/poste en panne) — restreindre au staff manager/admin
        # (comme le reste des écritures via `ManagerWriteMixin`)
        # retarderait justement la réaction en cas de panne réelle.
        # Ouvert à tout membre du tenant, à la différence du CRUD normal
        # du poste (nom, ordre, activation).
        if self.action == "reassigner":
            return [IsAuthenticated(), IsTenantMember()]
        return super().get_permissions()

    @action(detail=True, methods=["get"])
    def aggregation(self, request, pk=None):
        """
        Regroupement d'ingrédients (§5.2) : vue agrégée de tous les plats
        identiques encore à préparer sur ce poste, toutes commandes
        confondues (ex: "6 brochettes" réparties sur 3 tables) — utile en
        heure de pointe pour préparer par lot plutôt que ticket par ticket.
        """

        station = self.get_object()
        # `ticket__is_held` n'est plus exclu : un ticket retenu (Fire/Hold)
        # est visible et préparable dès sa création (cf. signals.py
        # `_broadcast`), donc reste à compter dans le regroupement par lot.
        rows = (
            models.OrderItem.objects.filter(
                tenant=request.user.tenant,
                ticket__station=station,
                ticket__statut__in=[
                    models.OrderTicket.Statut.EN_ATTENTE,
                    models.OrderTicket.Statut.EN_PREPARATION,
                ],
                statut_ligne__in=[
                    models.OrderItem.StatutLigne.EN_ATTENTE,
                    models.OrderItem.StatutLigne.EN_PREPARATION,
                ],
            )
            .values("plat_id", "plat__nom")
            .annotate(quantite_totale=Sum("quantite"), nb_lignes=Count("id"))
            .order_by("-quantite_totale")
        )
        data = [
            {
                "plat": row["plat_id"],
                "plat_nom": row["plat__nom"],
                "quantite_totale": row["quantite_totale"],
                "nb_lignes": row["nb_lignes"],
            }
            for row in rows
        ]
        return Response(data)

    @action(detail=True, methods=["post"])
    def reassigner(self, request, pk=None):
        """
        Redondance d'écran (§5.5) : en cas de panne d'un poste, réaffecte
        tous ses tickets encore actifs (y compris retenus/Hold — pas
        encore `servi`/`annulé`) vers un autre poste actif du même tenant.

        Manuel, déclenché par le staff — jamais automatique : consulter
        `est_en_ligne` (cf. `StationSerializer`, alimenté par
        `kds_core.presence`) pour voir quel poste semble hors ligne avant
        de décider. Chaque ticket réaffecté déclenche le signal existant
        (log + diffusion temps réel) exactement comme un `bump` — l'écran
        de destination le voit apparaître immédiatement ; l'ancien écran,
        s'il revient en ligne, ne le reverra plus grâce au rattrapage à la
        connexion (Phase 4) qui reflète déjà l'état réel.
        """

        station = self.get_object()
        serializer = serializers.StationReassignSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        vers = serializer.validated_data["vers"]

        if vers.id == station.id:
            return Response(
                {"vers": "Le poste de destination doit être différent du poste d'origine."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tickets_actifs = list(
            station.tickets.exclude(
                statut__in=[models.OrderTicket.Statut.SERVI, models.OrderTicket.Statut.ANNULE]
            )
        )
        for ticket in tickets_actifs:
            ticket.station = vers
            ticket.save()

        return Response(
            {
                "detail": f"{len(tickets_actifs)} ticket(s) réaffecté(s) de {station.nom} vers {vers.nom}.",
                "nb_reaffectes": len(tickets_actifs),
            }
        )


class MenuCategoryViewSet(ProtectedDeleteMixin, ManagerWriteMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = models.MenuCategory.objects.select_related("station").all()
    serializer_class = serializers.MenuCategorySerializer


class ModifierViewSet(ManagerWriteMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = models.Modifier.objects.all()
    serializer_class = serializers.ModifierSerializer


class MenuItemViewSet(ProtectedDeleteMixin, ManagerWriteMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = models.MenuItem.objects.select_related("categorie", "station").all()
    serializer_class = serializers.MenuItemSerializer


class RestaurantTableViewSet(ManagerWriteMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """
    Lecture ouverte à tout membre du tenant (nécessaire pour
    `PrendreCommandeScreen`/le routage table→commande), écriture
    (créer/modifier/supprimer une table, §gestion des tables) réservée
    manager/admin — même durcissement que Station/MenuCategory/MenuItem/
    User (Phase 6), appliqué ici en même temps que le premier écran de
    gestion (`GestionTables.jsx`) : jusqu'ici aucune UI n'écrivait sur ce
    ViewSet, ce n'était pas encore un vrai risque, ça l'est dès qu'un
    formulaire existe.
    """

    queryset = models.RestaurantTable.objects.all()
    serializer_class = serializers.RestaurantTableSerializer

    @action(detail=True, methods=["post"])
    def liberer(self, request, pk=None):
        """
        Libération manuelle de secours (staff), indépendante du paiement.

        La libération normale est automatique dès que toutes les commandes
        actives de la table sont payées (cf. `kds_core/signals.py`). Cette
        action existe pour les cas où la caisse ne notifie pas correctement
        (panne, oubli, tenant sans intégration POS) — sans elle, un défaut
        de synchro bloquerait la table indéfiniment.
        """

        table = self.get_object()
        table.statut = models.RestaurantTable.Statut.LIBRE
        table.save(update_fields=["statut", "updated_at"])
        return Response(self.get_serializer(table).data)


class UserViewSet(ManagerWriteMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = models.User.objects.all()
    serializer_class = serializers.UserSerializer

    _MESSAGE_COMPTE_PROTEGE = "Ce compte administrateur système ne peut pas être modifié depuis l'application."
    _MESSAGE_HIERARCHIE = "Seul un autre administrateur peut modifier un compte administrateur."

    def _est_protege(self, utilisateur):
        # Le superutilisateur Django (`is_superuser=True`, accès `/admin/`)
        # est le seul repère fiable pour "LE compte Admin" — plus robuste
        # qu'un nom d'utilisateur en dur, et couvre aussi un futur second
        # superutilisateur créé le même sens (aucun compte de ce type ne
        # doit être modifiable/désactivable/supprimable depuis l'app,
        # seulement via `/admin/` par quelqu'un qui y a déjà accès).
        return utilisateur.is_superuser

    def _proteger_hierarchie(self, utilisateur):
        # Distinct de `_est_protege` : un compte `role=admin` créé
        # normalement (§installer, `setup_tenant` — pas un superutilisateur
        # Django) n'était protégé par rien jusqu'ici. Trouvé en usage réel :
        # un manager voyait "Désactiver"/"Supprimer" actifs sur le compte
        # administrateur du tenant. Un manager ne doit jamais pouvoir agir
        # sur un compte admin ; un autre admin le peut (ex: départ d'un
        # associé).
        return utilisateur.role == models.User.Role.ADMIN and self.request.user.role != models.User.Role.ADMIN

    def update(self, request, *args, **kwargs):
        cible = self.get_object()
        if self._est_protege(cible):
            return Response({"detail": self._MESSAGE_COMPTE_PROTEGE}, status=status.HTTP_403_FORBIDDEN)
        if self._proteger_hierarchie(cible):
            return Response({"detail": self._MESSAGE_HIERARCHIE}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        # Couvre aussi la désactivation (`PATCH {is_active: false}`,
        # `GestionUtilisateurs.jsx::toggleActif`) — pas d'action dédiée à
        # bloquer séparément, c'est une simple mise à jour de champ.
        cible = self.get_object()
        if self._est_protege(cible):
            return Response({"detail": self._MESSAGE_COMPTE_PROTEGE}, status=status.HTTP_403_FORBIDDEN)
        if self._proteger_hierarchie(cible):
            return Response({"detail": self._MESSAGE_HIERARCHIE}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        # Sans ce garde-fou, un manager/admin pourrait supprimer son propre
        # compte depuis l'écran Équipe et se retrouver déconnecté en plein
        # milieu de sa session (le JWT reste valide jusqu'à expiration, mais
        # `request.user` ne résout plus rien côté serveur). Aucune autre
        # relation ne bloque la suppression (`Order.serveur`/`caissier`,
        # `TicketStatusLog.utilisateur` sont toutes en `SET_NULL`).
        cible = self.get_object()
        if cible.id == request.user.id:
            return Response(
                {"detail": "Vous ne pouvez pas supprimer votre propre compte."}, status=status.HTTP_400_BAD_REQUEST
            )
        if self._est_protege(cible):
            return Response(
                {"detail": "Ce compte administrateur système ne peut pas être supprimé."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if self._proteger_hierarchie(cible):
            return Response({"detail": self._MESSAGE_HIERARCHIE}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def me(self, request):
        """
        `GET /api/users/me/` — utilisateur connecté (rôle, poste assigné).
        Sert au frontend à décider quel écran afficher après connexion :
        un cuisinier avec `station_assignee` va directement sur l'écran de
        son poste, un manager/admin voit un sélecteur (§6.2, un poste =
        un écran dédié physiquement en cuisine, pas de choix à faire soi-même).
        """

        return Response(self.get_serializer(request.user).data)

    @action(detail=True, methods=["post"], url_path="set-pin")
    def set_pin(self, request, pk=None):
        """
        Définit/réinitialise le code PIN d'un cuisinier/serveur (§6.4).
        `UserSerializer` n'expose jamais `pin_code` en écriture (ni en
        clair, ni le hash) — jusqu'ici la seule façon de fixer un PIN était
        `seed_demo.py`/`/admin/`/le shell Django, ce qui rendait un compte
        créé depuis le tableau de bord inutilisable en connexion PIN sans
        repasser par un accès serveur. Réservé manager/admin via
        `ManagerWriteMixin` (POST).
        """

        user = self.get_object()
        if self._est_protege(user):
            return Response({"detail": self._MESSAGE_COMPTE_PROTEGE}, status=status.HTTP_403_FORBIDDEN)
        pin = str(request.data.get("pin", "")).strip()
        if not pin.isdigit() or not (4 <= len(pin) <= 6):
            return Response(
                {"detail": "Le PIN doit contenir entre 4 et 6 chiffres."}, status=status.HTTP_400_BAD_REQUEST
            )
        user.set_pin(pin)
        user.save(update_fields=["pin_code"])
        return Response({"detail": "PIN mis à jour."})


class OrderViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = models.Order.objects.select_related("table", "serveur").all()
    serializer_class = serializers.OrderSerializer

    def get_queryset(self):
        # Filtre manuel minimal (pas de django-filter dans ce projet) —
        # sert l'écran caisse (`?statut_paiement=en_attente`, les
        # commandes encore à régler) sans avoir à retélécharger tout
        # l'historique du tenant côté frontend pour filtrer sur place.
        queryset = super().get_queryset()
        statut_paiement = self.request.query_params.get("statut_paiement")
        if statut_paiement:
            queryset = queryset.filter(statut_paiement=statut_paiement)
        return queryset

    def get_permissions(self):
        # Encaisser (manipuler de l'argent, marquer payé) reste
        # manager/admin/caissier·ère (§TPE) — un serveur peut en revanche
        # imprimer la facture (montant + détail, sans info de paiement)
        # depuis l'aperçu HTML local côté frontend (`print/imprimer.js`),
        # qui n'appelle même pas cet endpoint.
        if self.action == "encaisser":
            return [IsAuthenticated(), IsTenantMember(), PeutEncaisser()]
        # Supprimer une commande = supprimer une transaction (§5.5, demandé
        # après coup) — réservé strictement au rôle admin, pas manager :
        # une commande porte l'historique des ventes/paiements, sa
        # suppression doit rester plus rare/engagée qu'un simple geste de
        # gestion quotidienne.
        if self.action == "destroy":
            return [IsAuthenticated(), IsTenantMember(), IsAdmin()]
        return super().get_permissions()

    @action(detail=True, methods=["post"])
    def encaisser(self, request, pk=None):
        """
        Encaissement (§5.5, demandé après coup en même temps que le reçu
        de caisse) — manager/admin uniquement pour l'instant (le rôle
        serveur sera reconsidéré plus tard). `montant_recu` optionnel :
        s'il est fourni et supérieur au total, la monnaie à rendre se
        déduit côté frontend (`print/imprimer.js`) plutôt que stockée
        séparément. Absent (carte/mobile money) → vaut le total, aucune
        monnaie à calculer.
        """

        order = self.get_object()
        if order.statut_paiement == models.Order.StatutPaiement.PAYEE:
            return Response({"detail": "Cette commande est déjà payée."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = serializers.EncaisserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        montant_recu = serializer.validated_data.get("montant_recu")
        if montant_recu is None:
            montant_recu = services.calculer_total_commande(order)

        with transaction.atomic():
            # Verrouille le tenant le temps du calcul pour éviter que deux
            # encaissements concurrents ne se voient attribuer le même
            # numéro de ticket (compteur simple basé sur le max existant —
            # volume trop faible pour justifier une table de séquence dédiée).
            models.Tenant.objects.select_for_update().get(pk=order.tenant_id)
            dernier_numero = (
                models.Order.objects.filter(tenant=order.tenant)
                .exclude(numero_ticket=None)
                .aggregate(Max("numero_ticket"))["numero_ticket__max"]
                or 0
            )
            order.numero_ticket = dernier_numero + 1
            order.mode_paiement = serializer.validated_data["mode_paiement"]
            order.montant_recu = montant_recu
            order.caissier = request.user
            order.statut_paiement = models.Order.StatutPaiement.PAYEE
            order.save()

        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"], url_path="marquer-servi")
    def marquer_servi(self, request, pk=None):
        """
        "Tout servir d'un coup" (écran serveur dédié, §5.1) — bascule en
        une seule action tous les PLATS actuellement prêts de cette
        commande (ligne par ligne, pas ticket par ticket — même critère
        que `OrderItemViewSet.marquer_servi` et `ServeurScreen.jsx`,
        cf. le bug trouvé en usage réel où un plat "dès que prêt"
        n'apparaissait/ne se servait qu'une fois TOUT son ticket prêt).
        Un ticket retenu (`is_held`, "avec le reste") reste exclu : ses
        plats, même préparés en avance, n'attendent que d'être lancés,
        pas confirmés servis directement. Le ticket lui-même passe
        "servi" tout seul une fois toutes ses lignes actives servies
        (`signals.py::_sync_ticket_statut_depuis_lignes`), pas besoin de
        le faire ici.
        """

        order = self.get_object()
        lignes_pretes = models.OrderItem.objects.filter(
            ticket__order=order,
            ticket__is_held=False,
            statut_ligne=models.OrderItem.StatutLigne.PRET,
        )
        nb = lignes_pretes.count()
        for ligne in lignes_pretes:
            ligne.statut_ligne = models.OrderItem.StatutLigne.SERVI
            ligne.servi_par = request.user
            ligne.save()
        return Response({"detail": f"{nb} plat(s) marqué(s) servi(s).", "nb_servis": nb})

    @action(detail=False, methods=["post"], url_path="prendre-commande")
    def prendre_commande(self, request):
        """
        Prise de commande par le personnel pour une table (§5.1/§5.6,
        demandé après coup) — même routage que le flux QR client
        (`services.route_items_to_tickets`), mais authentifié : la
        commande porte `serveur=request.user`, pas de token QR à
        résoudre puisque la table est choisie directement. Utile en usage
        courant (le serveur commande à la place du client) et
        indispensable en cas de coupure internet — le client sur son
        propre réseau mobile ne peut alors plus atteindre le serveur du
        restaurant, mais le personnel sur le WiFi local le peut toujours.
        """

        serializer = serializers.StaffOrderCreateSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        # `table` absente = vente comptoir (§TPE, VenteComptoirScreen.jsx) —
        # pas de table à libérer/occuper, source distincte pour les rapports.
        table = serializer.validated_data.get("table")

        order = models.Order.objects.create(
            tenant=request.user.tenant,
            table=table,
            serveur=request.user,
            source=models.Order.Source.SALLE if table else models.Order.Source.COMPTOIR,
        )
        services.route_items_to_tickets(order, serializer.validated_data["items"])

        if table and table.statut == models.RestaurantTable.Statut.LIBRE:
            table.statut = models.RestaurantTable.Statut.OCCUPEE
            table.save(update_fields=["statut", "updated_at"])

        return Response(self.get_serializer(order).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="add-items")
    def add_items(self, request, pk=None):
        """
        Routage intelligent (§5.1) : ajoute une ou plusieurs lignes à la
        commande, chacune routée automatiquement vers le ticket du poste
        concerné d'après `MenuItem.station` — pas besoin que le client
        connaisse ni choisisse le poste. Un ticket déjà actif (pas encore
        `servi`) pour ce poste sur cette commande est réutilisé plutôt que
        d'en recréer un ; sinon un nouveau ticket est créé et envoyé
        immédiatement (sauf Hold explicite plus tard via `fire`).
        """

        order = self.get_object()
        serializer = serializers.AddOrderItemsSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)

        tickets = services.route_items_to_tickets(order, serializer.validated_data["items"])

        result = serializers.OrderTicketSerializer(
            tickets, many=True, context=self.get_serializer_context()
        )
        return Response(result.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """
        Annule la commande côté staff — ex: le client renonce à une
        commande en cours, la cuisine manque d'un ingrédient. Motif
        obligatoire (§5.1, demandé après coup — "avec l'option d'ajouter
        le motif, obligatoire pour valider l'annulation") : contrairement
        à `services.cancel_order` lui-même, qui tolère un motif vide pour
        `PosOrderCancelView` (pas d'écran, pas d'utilisateur humain à qui
        demander une raison), une annulation déclenchée depuis l'app doit
        toujours en porter une — traçabilité pour le rapport "Commandes
        annulées" (`stats_views.CommandesAnnuleesView`). Cascade sur les
        tickets encore actifs — cf. `services.cancel_order`, partagé avec
        `PosOrderCancelView`.
        """

        motif = (request.data.get("motif") or "").strip()
        if not motif:
            return Response(
                {"detail": "Un motif est obligatoire pour annuler une commande."}, status=status.HTTP_400_BAD_REQUEST
            )
        order = self.get_object()
        services.cancel_order(order, motif=motif, utilisateur=request.user)
        return Response(self.get_serializer(order).data)


class OrderTicketViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = models.OrderTicket.objects.select_related("order", "order__table", "station", "tenant").all()
    serializer_class = serializers.OrderTicketSerializer

    # Enchaînement des statuts pour l'action `bump` — "un tap tactile" (§5.3).
    # `en_préparation` → `prêt` est volontairement absent : ce n'est plus un
    # bump ticket-entier, chaque ligne se marque prête individuellement
    # (`OrderItemViewSet.marquer_pret`) et le ticket suit automatiquement
    # une fois toutes ses lignes prêtes (cf. signals.py
    # `_sync_ticket_statut_depuis_lignes`) — sinon "Marquer prêt" ferait
    # passer d'un coup tous les plats du ticket, même ceux pas encore sortis.
    _BUMP_SUIVANT = {
        models.OrderTicket.Statut.EN_ATTENTE: models.OrderTicket.Statut.EN_PREPARATION,
        models.OrderTicket.Statut.PRET: models.OrderTicket.Statut.SERVI,
    }

    def perform_create(self, serializer):
        """Création directe d'un ticket (hors routage auto) : envoyé immédiatement, sauf Hold explicite."""
        extra = {}
        if not serializer.validated_data.get("is_held"):
            extra["heure_envoi_poste"] = timezone.now()
        serializer.save(tenant=self.request.user.tenant, **extra)

    @action(detail=True, methods=["post"])
    def fire(self, request, pk=None):
        """Libère un ticket retenu (Fire/Hold, §5.1) : il devient visible sur les écrans concernés."""
        ticket = self.get_object()
        if not ticket.is_held:
            return Response({"detail": "Ce ticket n'est pas retenu (Hold)."}, status=status.HTTP_400_BAD_REQUEST)
        ticket.is_held = False
        ticket.heure_envoi_poste = timezone.now()
        # Pas de `update_fields` ici : le pre_save (`signals.py`) peut aussi
        # vouloir horodater `heure_debut_preparation`/`heure_pret`/`heure_servi`
        # selon le statut — un `update_fields` restreint empêcherait ces
        # colonnes d'être réellement écrites en base.
        ticket.save()
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=["post"])
    def bump(self, request, pk=None):
        """Fait avancer le ticket au statut suivant (en attente → en préparation → prêt → servi), en un appel."""
        ticket = self.get_object()
        statut_suivant = self._BUMP_SUIVANT.get(ticket.statut)
        if statut_suivant is None:
            return Response(
                {"detail": "Ticket déjà servi, ou statut non éligible au bump."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ticket.statut = statut_suivant
        ticket.save()  # cf. commentaire dans `fire` : pas d'update_fields, le pre_save horodate le champ associé
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=["post"], url_path="toggle-rush")
    def toggle_rush(self, request, pk=None):
        """Marque/démarque un ticket en urgence (§5.1 Priorité/Rush)."""
        ticket = self.get_object()
        ticket.is_rush = not ticket.is_rush
        ticket.save(update_fields=["is_rush", "updated_at"])
        return Response(self.get_serializer(ticket).data)


class OrderItemViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = models.OrderItem.objects.select_related("ticket", "plat").all()
    serializer_class = serializers.OrderItemSerializer

    @action(detail=True, methods=["post"], url_path="marquer-pret")
    def marquer_pret(self, request, pk=None):
        """
        Marque CE plat comme prêt, indépendamment des autres lignes du
        même ticket (§5.1/§5.6) — ex: le poulet braisé est prêt avant les
        brochettes, même ticket, même poste. C'est ce qui répond à "on ne
        voit jamais que le ticket entier" : la cuisine tape sur le plat
        précis qui vient de sortir, pas sur tout le ticket d'un coup.

        Le ticket lui-même suit automatiquement une fois toutes ses
        lignes actives prêtes (cf. signals.py
        `_sync_ticket_statut_depuis_lignes`), ce qui fait apparaître
        "Marquer servi" côté écran cuisine.
        """

        item = self.get_object()
        if item.statut_ligne in (
            models.OrderItem.StatutLigne.PRET,
            models.OrderItem.StatutLigne.SERVI,
            models.OrderItem.StatutLigne.ANNULE,
        ):
            return Response(
                {"detail": "Cette ligne est déjà prête, servie ou annulée."}, status=status.HTTP_400_BAD_REQUEST
            )
        item.statut_ligne = models.OrderItem.StatutLigne.PRET
        item.save()
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=["post"], url_path="marquer-servi")
    def marquer_servi(self, request, pk=None):
        """
        Confirmation de service plat par plat (§5.1/§5.6) — pensée pour
        l'écran serveur dédié (`ServeurScreen.jsx`, mobile), pas l'écran
        cuisine : un plat "servir dès que prêt" doit pouvoir être confirmé
        servi dès QU'IL est prêt, sans attendre que le reste du ticket le
        soit (contrairement à `OrderTicketViewSet.bump`, qui sert tout le
        ticket d'un coup). Le ticket passe automatiquement "servi" une fois
        toutes ses lignes actives servies (cf. signals.py
        `_sync_ticket_statut_depuis_lignes`).
        """

        item = self.get_object()
        if item.statut_ligne != models.OrderItem.StatutLigne.PRET:
            return Response(
                {"detail": "Ce plat doit être prêt avant d'être marqué servi."}, status=status.HTTP_400_BAD_REQUEST
            )
        item.statut_ligne = models.OrderItem.StatutLigne.SERVI
        item.servi_par = request.user
        item.save()
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=["post"])
    def split(self, request, pk=None):
        """
        Split ticket (§5.1) : sort cette ligne de son ticket actuel pour la
        placer seule dans un nouveau ticket (même commande, même poste),
        afin de pouvoir la renvoyer en préparation indépendamment sans
        dupliquer tout le reste de la commande (ex: un plat retourné).
        """

        item = self.get_object()
        nouveau_ticket = models.OrderTicket.objects.create(
            tenant=item.tenant,
            order=item.ticket.order,
            station=item.ticket.station,
            heure_envoi_poste=timezone.now(),
        )
        item.ticket = nouveau_ticket
        item.save(update_fields=["ticket", "updated_at"])
        return Response(
            serializers.OrderTicketSerializer(nouveau_ticket, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )


class TicketStatusLogViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Lecture seule : ce journal est alimenté par le système, pas par le client (cf. serializer)."""

    queryset = models.TicketStatusLog.objects.select_related("ticket", "utilisateur").all()
    serializer_class = serializers.TicketStatusLogSerializer


class PosIntegrationViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """
    Gestion des clés API POS par le staff (JWT), cf. §5.5. La clé API en
    clair (`<id>.<secret>`) n'est renvoyée qu'une seule fois, dans la
    réponse de création — impossible à récupérer ensuite (même principe
    que la plupart des fournisseurs d'API : Stripe, GitHub tokens...).
    """

    queryset = models.PosIntegration.objects.all()
    serializer_class = serializers.PosIntegrationSerializer

    def perform_create(self, serializer):
        raw_secret = models.PosIntegration.generate_secret()
        instance = serializer.save(tenant=self.request.user.tenant)
        instance.set_secret(raw_secret)
        instance.save(update_fields=["secret_hash"])
        self._raw_secret = raw_secret
        self._created_instance = instance

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        response.data["api_key"] = f"{self._created_instance.id}.{self._raw_secret}"
        return response


class TenantViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """
    Un utilisateur ne voit et ne modifie jamais que SON établissement —
    pas de création/suppression via l'API (onboarding = processus à part),
    et la liste ne contient jamais qu'un seul élément : le tenant courant.
    """

    queryset = models.Tenant.objects.all()
    serializer_class = serializers.TenantSerializer
    permission_classes = [IsAuthenticated, IsTenantMember]

    def get_queryset(self):
        return super().get_queryset().filter(id=self.request.user.tenant_id)
