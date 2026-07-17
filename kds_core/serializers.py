from rest_framework import serializers

from . import models, services


class TenantScopedFieldsMixin:
    """
    Mixin réutilisable (indépendant de `ModelSerializer`) qui empêche qu'un
    client référence — par erreur ou volontairement — une ressource
    appartenant à un AUTRE tenant via une clé étrangère ou un champ
    many-to-many (ex: créer un OrderTicket avec `order` = l'UUID d'une
    commande d'un restaurant concurrent). Toute relation vers un modèle
    tenant-scopé (identifiable par la présence d'un champ `tenant`) voit sa
    queryset automatiquement restreinte au tenant de l'utilisateur courant,
    sans rien à répéter dans chaque serializer concret.

    Séparé de `TenantScopedSerializer` pour pouvoir aussi l'appliquer à des
    `serializers.Serializer` "à plat" (ex: `AddOrderItemsSerializer`, qui ne
    correspond à aucun modèle unique).
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        tenant = getattr(getattr(request, "user", None), "tenant", None)
        if tenant is None:
            return
        for field in self.fields.values():
            related_field = field
            if isinstance(field, serializers.ManyRelatedField):
                related_field = field.child_relation
            if isinstance(related_field, serializers.PrimaryKeyRelatedField):
                queryset = related_field.queryset
                if queryset is not None and hasattr(queryset.model, "tenant_id"):
                    related_field.queryset = queryset.filter(tenant=tenant)


class TenantScopedSerializer(TenantScopedFieldsMixin, serializers.ModelSerializer):
    """Base commune à tous les `ModelSerializer` de ressources rattachées à un tenant (cf. `TenantScopedFieldsMixin`)."""


class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Tenant
        fields = [
            "id",
            "nom_etablissement",
            "slug",
            "logo",
            "couleur_primaire",
            "couleur_secondaire",
            "telephone",
            "adresse",
            "url_publique",
            "devise",
            "langue_defaut",
            "seuil_orange_minutes",
            "seuil_rouge_minutes",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "slug", "is_active", "created_at", "updated_at"]


class StationSerializer(TenantScopedSerializer):
    """`est_en_ligne` : au moins un écran surveille ce poste précis en ce moment (§5.5 "redondance écran")."""

    est_en_ligne = serializers.SerializerMethodField()

    class Meta:
        model = models.Station
        fields = [
            "id",
            "tenant",
            "nom",
            "is_expo",
            "ordre_affichage",
            "is_active",
            "est_en_ligne",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "tenant", "est_en_ligne", "created_at", "updated_at"]

    def get_est_en_ligne(self, obj):
        from . import presence

        return presence.is_station_online_sync(str(obj.tenant_id), str(obj.id))


class StationReassignSerializer(TenantScopedFieldsMixin, serializers.Serializer):
    """Body de `POST /api/stations/<id>/reassigner/` — redondance écran (§5.5)."""

    vers = serializers.PrimaryKeyRelatedField(queryset=models.Station.objects.all())


class MenuCategorySerializer(TenantScopedSerializer):
    class Meta:
        model = models.MenuCategory
        fields = ["id", "tenant", "nom", "station", "ordre_affichage"]
        read_only_fields = ["id", "tenant"]


class ModifierCategorySerializer(TenantScopedSerializer):
    class Meta:
        model = models.ModifierCategory
        fields = ["id", "tenant", "nom", "obligatoire", "selection_multiple", "ordre_affichage"]
        read_only_fields = ["id", "tenant"]


class ModifierSerializer(TenantScopedSerializer):
    categorie_nom = serializers.SerializerMethodField()

    class Meta:
        model = models.Modifier
        fields = [
            "id",
            "tenant",
            "libelle",
            "type_modifier",
            "categorie",
            "categorie_nom",
            "niveau_alerte_critique",
            "prix_supplement",
        ]
        read_only_fields = ["id", "tenant"]

    def get_categorie_nom(self, obj):
        return obj.categorie.nom if obj.categorie else None


class MenuItemSerializer(TenantScopedSerializer):
    class Meta:
        model = models.MenuItem
        fields = [
            "id",
            "tenant",
            "nom",
            "categorie",
            "station",
            "prix",
            "temps_preparation_estime_min",
            "image",
            "photo_dressage_url",
            "fiche_technique",
            "allergenes",
            "regimes",
            "statut",
            "modifiers",
            "is_active",
        ]
        # `is_active` en lecture seule : aucun écran n'expose de bascule pour
        # ce champ sur un plat (contrairement à Utilisateur/Poste, cf.
        # GestionUtilisateurs.jsx/GestionPostes.jsx qui l'écrivent en JSON) —
        # `statut` (disponible/rupture) est le seul levier de disponibilité
        # côté admin. Le rendre non-modifiable via l'API évite aussi un bug
        # DRF réel trouvé en usage client : `BooleanField.get_value()`
        # traite tout payload multipart/form-data (upload de photo à la
        # création d'un plat) selon la sémantique "case à cocher HTML" —
        # un champ absent y vaut explicitement `False`, pas "non fourni",
        # court-circuitant le `default=True` du modèle. Un plat créé avec
        # photo se retrouvait donc invisible partout (`is_active=False`)
        # sans qu'aucun code n'ait jamais voulu le désactiver.
        read_only_fields = ["id", "tenant", "is_active"]


class RestaurantTableSerializer(TenantScopedSerializer):
    class Meta:
        model = models.RestaurantTable
        fields = ["id", "tenant", "numero", "qr_code_token", "statut"]
        read_only_fields = ["id", "tenant", "qr_code_token"]


class UserSerializer(TenantScopedSerializer):
    """
    Expose volontairement un sous-ensemble des champs de `User` :
    - jamais `is_staff` / `password` (hash) / `pin_code` (hash) pour ne pas
      ouvrir d'escalade de privilèges via l'API tenant.
    - `is_superuser` exposé en LECTURE seule uniquement (`read_only_fields`)
      — sert au frontend (`GestionUtilisateurs.jsx`) à griser les actions
      sur le compte Admin système ; aucun risque d'escalade puisqu'il ne
      peut jamais être écrit via ce serializer, et `UserViewSet` bloque de
      toute façon `update`/`partial_update`/`destroy` sur ce compte
      indépendamment de ce que le client enverrait.
    - `password` est un champ écriture seule, haché via `set_password`.
    """

    password = serializers.CharField(
        write_only=True, required=False, style={"input_type": "password"}
    )

    class Meta:
        model = models.User
        fields = [
            "id",
            "tenant",
            "username",
            "first_name",
            "last_name",
            "email",
            "role",
            "station_assignee",
            "is_active",
            "is_superuser",
            "password",
        ]
        read_only_fields = ["id", "tenant", "is_superuser"]

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = models.User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        user = super().update(instance, validated_data)
        if password:
            user.set_password(password)
            user.save(update_fields=["password"])
        return user


class OrderSerializer(TenantScopedSerializer):
    # Ajoutés pour l'écran caisse (§5.5) — sans ça, un client de l'API
    # devait déjà connaître le détail des lignes pour afficher quoi que
    # ce soit d'utile sur une commande (aucun endpoint staff n'exposait
    # ni les plats ni le total, seul `QrOrderStatusSerializer` côté
    # client QR le faisait). Même calcul que ce dernier
    # (`services.calculer_total_commande`), une seule source de vérité.
    items = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    table_numero = serializers.SerializerMethodField()
    serveur_nom = serializers.SerializerMethodField()
    caissier_nom = serializers.SerializerMethodField()
    annule_par_nom = serializers.SerializerMethodField()

    class Meta:
        model = models.Order
        fields = [
            "id",
            "tenant",
            "table",
            "table_numero",
            "serveur",
            "serveur_nom",
            "caissier",
            "caissier_nom",
            "source",
            "statut",
            "is_rush",
            "statut_paiement",
            "mode_paiement",
            "montant_recu",
            "numero_ticket",
            "heure_paiement",
            "motif_annulation",
            "heure_annulation",
            "annule_par",
            "annule_par_nom",
            "reference_externe",
            "items",
            "total",
            "created_at",
            "updated_at",
        ]
        # `heure_paiement` est auto-horodaté par un signal `pre_save` dès que
        # `statut_paiement` passe à PAYEE (même principe que les horodatages
        # de `OrderTicket`, cf. `kds_core/signals.py`) — jamais fourni par le
        # client, staff comme POS. `montant_recu`/`caissier`/`numero_ticket`
        # en lecture ici (affichés sur un reçu déjà imprimé) — écrits
        # uniquement via `OrderViewSet.encaisser`, jamais par une simple
        # mise à jour de commande (un serveur ne doit pas pouvoir les
        # trafiquer via PATCH).
        read_only_fields = [
            "id",
            "tenant",
            "montant_recu",
            "caissier",
            "numero_ticket",
            "heure_paiement",
            "motif_annulation",
            "heure_annulation",
            "annule_par",
            "created_at",
            "updated_at",
        ]

    def get_items(self, obj):
        lignes = models.OrderItem.objects.filter(ticket__order=obj).exclude(
            statut_ligne=models.OrderItem.StatutLigne.ANNULE
        ).select_related("plat")
        return [
            {"plat_nom": ligne.plat.nom, "quantite": ligne.quantite, "prix": ligne.plat.prix}
            for ligne in lignes
        ]

    def get_total(self, obj):
        from . import services

        return services.calculer_total_commande(obj)

    def get_table_numero(self, obj):
        return obj.table.numero if obj.table else None

    def get_serveur_nom(self, obj):
        if not obj.serveur:
            return None
        return obj.serveur.get_full_name() or obj.serveur.username

    def get_caissier_nom(self, obj):
        if not obj.caissier:
            return None
        return obj.caissier.get_full_name() or obj.caissier.username

    def get_annule_par_nom(self, obj):
        if not obj.annule_par:
            return None
        return obj.annule_par.get_full_name() or obj.annule_par.username


class EncaisserSerializer(serializers.Serializer):
    """Body de `POST /api/orders/<id>/encaisser/` — manager/admin uniquement (cf. `views.py`)."""

    mode_paiement = serializers.ChoiceField(choices=models.Order.ModePaiement.choices)
    # Absent/`None` = paiement exact (carte, mobile money) : pas de monnaie à calculer.
    montant_recu = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)


class OrderTicketSerializer(TenantScopedSerializer):
    duree_preparation_secondes = serializers.ReadOnlyField()
    code_couleur = serializers.ReadOnlyField()
    lignes = serializers.SerializerMethodField()
    table_numero = serializers.SerializerMethodField()

    class Meta:
        model = models.OrderTicket
        fields = [
            "id",
            "tenant",
            "order",
            "table_numero",
            "station",
            "statut",
            "is_held",
            "is_rush",
            "heure_envoi_poste",
            "heure_debut_preparation",
            "heure_pret",
            "heure_servi",
            "duree_preparation_secondes",
            "code_couleur",
            "lignes",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "tenant",
            "heure_envoi_poste",
            "heure_debut_preparation",
            "heure_pret",
            "heure_servi",
            "created_at",
        ]

    def get_lignes(self, obj):
        """
        Détail des plats à préparer (§5.1) — sans ça, un écran cuisine ne
        verrait qu'un ticket vide, juste un numéro de poste. Aplati depuis
        `OrderItem`, avec les modificateurs (allergies/suppléments, §5.2)
        mis en évidence séparément pour un rendu visuel fort côté écran.
        """

        lignes = obj.lignes.select_related("plat").prefetch_related("modificateurs")
        return [
            {
                "id": ligne.id,
                "plat_nom": ligne.plat.nom,
                "quantite": ligne.quantite,
                "commentaire_libre": ligne.commentaire_libre,
                "statut_ligne": ligne.statut_ligne,
                "modificateurs": [
                    {
                        "libelle": m.libelle,
                        "type_modifier": m.type_modifier,
                        "niveau_alerte_critique": m.niveau_alerte_critique,
                    }
                    for m in ligne.modificateurs.all()
                ],
            }
            for ligne in lignes
        ]

    def get_table_numero(self, obj):
        return obj.order.table.numero if obj.order.table else None


class OrderItemSerializer(TenantScopedSerializer):
    servi_par_nom = serializers.SerializerMethodField()

    class Meta:
        model = models.OrderItem
        fields = [
            "id",
            "tenant",
            "ticket",
            "plat",
            "quantite",
            "modificateurs",
            "commentaire_libre",
            "statut_ligne",
            "motif_annulation",
            "servi_par",
            "servi_par_nom",
        ]
        read_only_fields = ["id", "tenant", "servi_par"]

    def get_servi_par_nom(self, obj):
        if not obj.servi_par:
            return None
        return obj.servi_par.get_full_name() or obj.servi_par.username


class TicketStatusLogSerializer(TenantScopedSerializer):
    """
    Lecture seule côté API : ce journal est destiné à être alimenté
    automatiquement par un signal `post_save` sur `OrderTicket` (cf.
    README, roadmap Phase 2), jamais écrit à la main par un client.
    """

    class Meta:
        model = models.TicketStatusLog
        fields = [
            "id",
            "tenant",
            "ticket",
            "ancien_statut",
            "nouveau_statut",
            "utilisateur",
            "created_at",
        ]
        read_only_fields = fields


class AddOrderItemLineSerializer(TenantScopedFieldsMixin, serializers.Serializer):
    """Une ligne du body de `OrderViewSet.add_items` (cf. §5.1 "routage intelligent")."""

    plat = serializers.PrimaryKeyRelatedField(queryset=models.MenuItem.objects.all())
    quantite = serializers.IntegerField(min_value=1, default=1)
    modificateurs = serializers.PrimaryKeyRelatedField(
        queryset=models.Modifier.objects.all(), many=True, required=False, default=list
    )
    commentaire_libre = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, data):
        # Catégories de modificateurs obligatoires (§5.2) — cf.
        # `services.valider_modificateurs`. S'applique à `StaffOrderCreateSerializer`
        # (prise de commande staff) et `AddOrderItemsSerializer` (add-items),
        # qui héritent/utilisent cette classe.
        try:
            services.valider_modificateurs(data["plat"], data["modificateurs"])
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))
        return data


class AddOrderItemsSerializer(serializers.Serializer):
    """
    Body de `POST /api/orders/<id>/add-items/` : une liste de plats à
    ajouter à la commande. Chaque ligne est routée automatiquement vers le
    ticket du poste concerné (créé si besoin) selon `MenuItem.station` —
    le client n'a pas à connaître ni choisir le poste lui-même.
    """

    items = AddOrderItemLineSerializer(many=True)


class StaffOrderItemLineSerializer(AddOrderItemLineSerializer):
    """
    Comme `AddOrderItemLineSerializer`, avec en plus le choix "servir dès
    que prêt / avec le reste" (§5.1/§5.6) — le client QR peut déjà le
    choisir plat par plat ; un serveur qui prend la commande à la place
    du client doit pouvoir lui poser la même question.
    """

    service_immediat = serializers.BooleanField(default=True)


class StaffOrderCreateSerializer(TenantScopedFieldsMixin, serializers.Serializer):
    """
    Body de `POST /api/orders/prendre-commande/` — prise de commande par
    le personnel pour une table (§5.1/§5.6, demandé après coup) : même
    routage que le flux QR client (`services.route_items_to_tickets`),
    mais authentifié. Utile en usage courant (le serveur commande à la
    place du client) et indispensable en cas de coupure internet : le
    client sur son propre réseau mobile ne peut alors plus atteindre le
    serveur du restaurant, mais le personnel connecté au WiFi local le
    peut toujours (cf. discussion produit sur la résilience réseau).

    `table` optionnelle (§TPE) : une vente comptoir n'est rattachée à
    aucune table — `Order.table` est déjà nullable au niveau du modèle,
    seul ce serializer imposait une table jusqu'ici.
    """

    table = serializers.PrimaryKeyRelatedField(
        queryset=models.RestaurantTable.objects.all(), required=False, allow_null=True
    )
    items = StaffOrderItemLineSerializer(many=True)


class PosIntegrationSerializer(TenantScopedSerializer):
    """
    `secret_hash` n'est jamais exposé. La clé API en clair n'est renvoyée
    qu'une seule fois, dans la réponse de création (cf. `PosIntegrationViewSet`).
    """

    class Meta:
        model = models.PosIntegration
        fields = ["id", "tenant", "label", "webhook_url", "is_active", "created_at"]
        read_only_fields = ["id", "tenant", "created_at"]


class PosCreateOrderSerializer(serializers.Serializer):
    """Body de `POST /api/pos/orders/` — création d'une commande en un seul appel depuis un logiciel de caisse."""

    reference_externe = serializers.CharField(required=False, allow_blank=True, default="")
    table_numero = serializers.CharField(required=False, allow_blank=True, default="")
    items = AddOrderItemLineSerializer(many=True)


class PosOrderLookupSerializer(TenantScopedFieldsMixin, serializers.Serializer):
    """
    Base commune aux notifications POS ciblant une commande existante :
    identifiée soit par notre `order` (UUID renvoyé à la création), soit
    par le `reference_externe` que la caisse connaît déjà (utile si elle
    n'a pas conservé l'UUID renvoyé à la création). Partagée par
    `PosPaymentSerializer` et `PosCancelSerializer`.
    """

    order = serializers.PrimaryKeyRelatedField(queryset=models.Order.objects.all(), required=False)
    reference_externe = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if not attrs.get("order") and not attrs.get("reference_externe"):
            raise serializers.ValidationError(
                "Fournir soit « order » (UUID), soit « reference_externe »."
            )
        return attrs


class PosPaymentSerializer(PosOrderLookupSerializer):
    """Body de `POST /api/pos/orders/pay/` — la caisse notifie le paiement d'une commande."""

    mode_paiement = serializers.ChoiceField(
        choices=models.Order.ModePaiement.choices, required=False, allow_blank=True, default=""
    )


class PosCancelSerializer(PosOrderLookupSerializer):
    """Body de `POST /api/pos/orders/cancel/` — la caisse notifie l'annulation d'une commande."""

    motif = serializers.CharField(required=False, allow_blank=True, default="")


# --- Interaction client via QR code (§5.6) ---------------------------------
#
# Accès public (AllowAny), scopé par `qr_code_token` — même modèle de
# confiance que `KioskStaffListView` (Phase 0) : pas de compte client, le
# token imprimé sur la table fait office de périmètre de confiance. Les
# serializers ci-dessous n'héritent PAS de `TenantScopedFieldsMixin` : ce
# mixin s'appuie sur `request.user.tenant`, or une requête QR anonyme n'a
# pas de `request.user` exploitable (`AnonymousUser`, pas de `.tenant`).
# L'isolation tenant est donc vérifiée explicitement dans `qr_views.py`
# plutôt que déléguée à un filtrage automatique de queryset.


class QrTenantBrandingSerializer(serializers.ModelSerializer):
    """Config marque blanche chargée par le frontend client au démarrage (§1.4)."""

    class Meta:
        model = models.Tenant
        fields = [
            "nom_etablissement",
            "logo",
            "couleur_primaire",
            "couleur_secondaire",
            "devise",
            "langue_defaut",
        ]


class QrModifierSerializer(serializers.ModelSerializer):
    """
    Détails complets d'un modificateur imbriqués directement (id +
    catégorie déjà résolue) — le client QR est anonyme (`AllowAny`), pas
    d'appel authentifié possible pour résoudre les IDs après coup, cf.
    `QrMenuItemSerializer`.
    """

    categorie_nom = serializers.SerializerMethodField()
    categorie_obligatoire = serializers.SerializerMethodField()
    categorie_selection_multiple = serializers.SerializerMethodField()

    class Meta:
        model = models.Modifier
        fields = [
            "id",
            "libelle",
            "prix_supplement",
            "categorie",
            "categorie_nom",
            "categorie_obligatoire",
            "categorie_selection_multiple",
        ]

    def get_categorie_nom(self, obj):
        return obj.categorie.nom if obj.categorie else None

    def get_categorie_obligatoire(self, obj):
        return obj.categorie.obligatoire if obj.categorie else False

    def get_categorie_selection_multiple(self, obj):
        return obj.categorie.selection_multiple if obj.categorie else False


class QrMenuItemSerializer(serializers.ModelSerializer):
    modifiers = QrModifierSerializer(many=True, read_only=True)

    class Meta:
        model = models.MenuItem
        fields = [
            "id",
            "nom",
            "prix",
            "temps_preparation_estime_min",
            "image",
            "allergenes",
            "regimes",
            "modifiers",
        ]


class QrMenuCategorySerializer(serializers.ModelSerializer):
    """
    Ne renvoie que les plats disponibles et actifs (le "86'd" retire
    immédiatement un plat des options côté client, §5.2), avec filtrage
    optionnel par allergène à exclure / régime alimentaire (§5.6),
    transmis via le `context` (query params de la vue).
    """

    plats = serializers.SerializerMethodField()

    class Meta:
        model = models.MenuCategory
        fields = ["id", "nom", "ordre_affichage", "plats"]

    def get_plats(self, obj):
        exclure_allergenes = self.context.get("exclure_allergenes") or []
        regime = self.context.get("regime")
        plats = obj.plats.filter(
            is_active=True, statut=models.MenuItem.Statut.DISPONIBLE
        ).order_by("nom")
        resultat = []
        for plat in plats:
            if exclure_allergenes and any(a in plat.allergenes for a in exclure_allergenes):
                continue
            if regime and regime not in plat.regimes:
                continue
            resultat.append(plat)
        return QrMenuItemSerializer(resultat, many=True, context=self.context).data


class QrOrderItemLineSerializer(serializers.Serializer):
    """
    Comme `AddOrderItemLineSerializer`, mais sans `TenantScopedFieldsMixin`
    (pas de `request.user` exploitable en QR anonyme) — les querysets ne
    sont donc PAS filtrées par tenant ici : `QrOrderCreateView` vérifie
    explicitement l'appartenance tenant de chaque `plat`/`modificateur`
    référencé avant de créer quoi que ce soit.
    """

    plat = serializers.PrimaryKeyRelatedField(queryset=models.MenuItem.objects.all())
    quantite = serializers.IntegerField(min_value=1, default=1)
    modificateurs = serializers.PrimaryKeyRelatedField(
        queryset=models.Modifier.objects.all(), many=True, required=False, default=list
    )
    commentaire_libre = serializers.CharField(required=False, allow_blank=True, default="")
    service_immediat = serializers.BooleanField(
        required=False,
        default=True,
        help_text=(
            "§5.6 : True = servir dès que prêt (défaut). False = servir avec le "
            "reste de la commande — le plat part en cuisine retenu (Fire/Hold) et "
            "se libère automatiquement quand tout le reste est prêt."
        ),
    )


class QrOrderCreateSerializer(serializers.Serializer):
    """Body de `POST /api/qr/<token>/orders/` — prise de commande client (§5.6)."""

    items = QrOrderItemLineSerializer(many=True)
    # Optionnel : généré côté client par la file d'attente hors-ligne
    # (§5.5, IndexedDB) pour rejouer une commande sans risquer de la
    # dupliquer si la première tentative a en fait atteint le serveur
    # avant que la coupure réseau n'empêche la réponse d'arriver.
    idempotency_key = serializers.CharField(required=False, allow_blank=True, max_length=64)


class QrOrderStatusSerializer(serializers.ModelSerializer):
    """
    Suivi de commande côté client (§5.6) : reçue → en préparation → prête
    → servie, sans exposer de champ interne (tenant, serveur...). `items`
    aplatit les lignes de tous les tickets de la commande, indépendamment
    du poste qui les prépare — le client ne connaît pas la notion de poste.

    `tickets` expose en plus le statut de chaque ticket (juste `id` +
    `statut`, rien de sensible) : `Order.statut` ne passe "servie" que
    lorsque TOUS les tickets de TOUS les postes le sont, ce qui est trop
    tardif pour la notification "Votre commande arrive !" — un plat servi
    peut déjà être en route vers la table pendant qu'un autre poste
    prépare encore autre chose. Le frontend (`ClientApp.jsx`) détecte donc
    la transition au niveau du TICKET, pas de la commande entière.
    """

    items = serializers.SerializerMethodField()
    tickets = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()

    class Meta:
        model = models.Order
        fields = ["id", "statut", "statut_paiement", "created_at", "items", "tickets", "total"]

    def get_items(self, obj):
        lignes = models.OrderItem.objects.filter(ticket__order=obj).select_related("plat")
        return [
            {
                # `id` sert au frontend à détecter les transitions entre deux
                # polls (ex: passage à "prêt") sans se fier à `plat_nom`, pas
                # forcément unique dans une commande (2 lignes du même plat).
                "id": ligne.id,
                "plat_nom": ligne.plat.nom,
                "prix": ligne.plat.prix,
                "quantite": ligne.quantite,
                "statut_ligne": ligne.statut_ligne,
            }
            for ligne in lignes
        ]

    def get_total(self, obj):
        # Calculé côté backend (prix figé au moment de la commande, pas
        # rafraîchi si la carte change ensuite) plutôt que recalculé côté
        # client à partir de `items[].prix` — une seule source de vérité
        # pour ce qui deviendra la note du client. Partagé avec
        # `OrderViewSet.encaisser`/`impression.imprimer_recu` via
        # `services.calculer_total_commande` (même calcul partout).
        from . import services

        return services.calculer_total_commande(obj)

    def get_tickets(self, obj):
        tickets = obj.tickets.exclude(statut=models.OrderTicket.Statut.ANNULE)
        return [{"id": t.id, "statut": t.statut} for t in tickets]
