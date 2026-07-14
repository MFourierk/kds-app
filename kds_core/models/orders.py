from django.db import models
from django.utils import timezone

from .base import TenantScopedModel
from .catalog import MenuItem, Modifier, Station
from .tables import RestaurantTable
from .users import User


class Order(TenantScopedModel):
    """Commande globale d'une table ou d'un canal (QR, click&collect, plateforme tierce)."""

    class Source(models.TextChoices):
        SALLE = "salle", "Prise en salle"
        QR_CODE = "qr_code", "QR Code client"
        CLICK_COLLECT = "click_collect", "Click & Collect"
        YANGO = "yango", "Yango Food"
        GLOVO = "glovo", "Glovo"

    class Statut(models.TextChoices):
        NOUVELLE = "nouvelle", "Nouvelle"
        EN_PREPARATION = "en_preparation", "En préparation"
        PRETE = "prete", "Prête"
        SERVIE = "servie", "Servie"
        ANNULEE = "annulee", "Annulée"

    class StatutPaiement(models.TextChoices):
        """
        Suivi du paiement, indépendant de `Statut` (qui suit la
        préparation). La caisse (POS) est la source de vérité de cette
        information — cf. cahier des charges §5.5. Le paiement direct par
        QR code étant hors périmètre V1 (§2.3), il n'y a volontairement pas
        de vraie transaction ici, juste ce statut alimenté par la caisse.
        """

        EN_ATTENTE = "en_attente", "En attente"
        PAYEE = "payee", "Payée"
        ANNULEE = "annulee", "Annulée"

    class ModePaiement(models.TextChoices):
        ESPECES = "especes", "Espèces"
        MOBILE_MONEY = "mobile_money", "Mobile Money"
        CARTE = "carte", "Carte"
        AUTRE = "autre", "Autre"

    table = models.ForeignKey(
        RestaurantTable, on_delete=models.SET_NULL, null=True, blank=True, related_name="commandes"
    )
    serveur = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="commandes_prises"
    )
    caissier = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="commandes_encaissees",
        help_text="Manager/admin qui a traité l'encaissement — renseigné automatiquement par OrderViewSet.encaisser.",
    )

    source = models.CharField(max_length=20, choices=Source.choices, default=Source.SALLE)
    statut = models.CharField(max_length=20, choices=Statut.choices, default=Statut.NOUVELLE)
    is_rush = models.BooleanField(default=False, help_text="Priorité/urgence marquée manuellement")

    statut_paiement = models.CharField(
        max_length=20, choices=StatutPaiement.choices, default=StatutPaiement.EN_ATTENTE
    )
    mode_paiement = models.CharField(max_length=20, choices=ModePaiement.choices, blank=True)
    heure_paiement = models.DateTimeField(null=True, blank=True)
    montant_recu = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "Montant remis par le client (espèces) — sert à calculer la monnaie à rendre sur "
            "le reçu de caisse. Sans objet pour carte/mobile money (le montant reçu vaut alors "
            "le total, aucune monnaie à rendre)."
        ),
    )
    numero_ticket = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text=(
            "Numéro séquentiel du reçu de caisse (par tenant), attribué à l'encaissement — "
            "affiché formaté 'TC-000056' sur le reçu imprimé. Absent tant que la commande "
            "n'est pas payée."
        ),
    )

    reference_externe = models.CharField(
        max_length=100, blank=True, help_text="Identifiant côté POS ou plateforme tierce (Yango, Glovo...)"
    )

    idempotency_key = models.CharField(
        max_length=64,
        blank=True,
        help_text=(
            "Clé générée côté client QR (§5.5, file d'attente hors-ligne) : évite de créer un "
            "doublon si une commande mise en file IndexedDB est réémise après une coupure réseau "
            "dont on ne sait pas si elle a atteint le serveur avant de couper."
        ),
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "statut"]),
            models.Index(fields=["tenant", "table", "idempotency_key"]),
        ]

    def __str__(self):
        table_label = self.table.numero if self.table else self.get_source_display()
        return f"Commande #{str(self.id)[:8]} — {table_label}"


class OrderTicket(TenantScopedModel):
    """Bon envoyé à un poste de préparation spécifique pour une commande donnée."""

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        EN_PREPARATION = "en_preparation", "En préparation"
        PRET = "pret", "Prêt"
        SERVI = "servi", "Servi"
        ANNULE = "annule", "Annulé"

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="tickets")
    station = models.ForeignKey(Station, on_delete=models.PROTECT, related_name="tickets")

    statut = models.CharField(max_length=20, choices=Statut.choices, default=Statut.EN_ATTENTE)
    is_held = models.BooleanField(
        default=False, help_text="Fire/Hold — envoi volontairement retenu (cf. §5.1)"
    )
    is_rush = models.BooleanField(default=False)

    heure_envoi_poste = models.DateTimeField(null=True, blank=True)
    heure_debut_preparation = models.DateTimeField(null=True, blank=True)
    heure_pret = models.DateTimeField(null=True, blank=True)
    heure_servi = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["tenant", "station", "statut"])]

    def marquer_pret(self):
        self.statut = self.Statut.PRET
        self.heure_pret = timezone.now()
        self.save(update_fields=["statut", "heure_pret", "updated_at"])

    @property
    def duree_preparation_secondes(self):
        if self.heure_envoi_poste and self.heure_pret:
            return (self.heure_pret - self.heure_envoi_poste).total_seconds()
        return None

    @property
    def code_couleur(self):
        """
        Code couleur temporel vert/orange/rouge (cf. §5.1), selon les seuils
        du tenant (`seuil_orange_minutes` / `seuil_rouge_minutes`).

        `None` tant que le ticket n'a pas été envoyé au poste (retenu par un
        Hold, ou pas encore créé), une fois servi (l'urgence n'a plus lieu
        d'être une fois le plat en salle), ou annulé. La référence de fin
        est l'heure "prêt" si déjà atteinte, sinon l'instant présent (ticket
        toujours en cours).
        """

        if not self.heure_envoi_poste or self.statut in (self.Statut.SERVI, self.Statut.ANNULE):
            return None
        reference = self.heure_pret or timezone.now()
        elapsed_minutes = (reference - self.heure_envoi_poste).total_seconds() / 60
        if elapsed_minutes >= self.tenant.seuil_rouge_minutes:
            return "rouge"
        if elapsed_minutes >= self.tenant.seuil_orange_minutes:
            return "orange"
        return "vert"

    def __str__(self):
        return f"Ticket {self.station.nom} — {self.order}"


class OrderItem(TenantScopedModel):
    """Ligne de commande : un plat, sa quantité et ses modificateurs, rattachée à un ticket."""

    class StatutLigne(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        EN_PREPARATION = "en_preparation", "En préparation"
        PRET = "pret", "Prêt"
        SERVI = "servi", "Servi"
        ANNULE = "annule", "Annulé"

    ticket = models.ForeignKey(OrderTicket, on_delete=models.CASCADE, related_name="lignes")
    plat = models.ForeignKey(MenuItem, on_delete=models.PROTECT, related_name="lignes_commande")

    quantite = models.PositiveIntegerField(default=1)
    modificateurs = models.ManyToManyField(Modifier, blank=True, related_name="lignes_commande")
    commentaire_libre = models.CharField(max_length=255, blank=True)

    statut_ligne = models.CharField(
        max_length=20, choices=StatutLigne.choices, default=StatutLigne.EN_ATTENTE
    )
    motif_annulation = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.quantite} x {self.plat.nom}"


class TicketStatusLog(TenantScopedModel):
    """
    Journal d'audit des changements de statut.

    Alimente l'historique des tickets (§5.4) et permet l'annulation immédiate
    d'un bump fait par erreur (§5.3 — Undo).
    """

    ticket = models.ForeignKey(OrderTicket, on_delete=models.CASCADE, related_name="logs_statut")
    ancien_statut = models.CharField(max_length=20)
    nouveau_statut = models.CharField(max_length=20)
    utilisateur = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.ticket} : {self.ancien_statut} → {self.nouveau_statut}"
