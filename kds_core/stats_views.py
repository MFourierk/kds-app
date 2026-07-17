"""
Suivi des performances et analyses (§5.4). Rapports en lecture seule,
tenant-scopés comme le reste de l'API, tous filtrables par période via
`?depuis=` / `?jusqu_a=` (ISO 8601 ; défaut : les dernières 24h).

Ces vues sont volontairement des `APIView` simples (pas des ViewSets) :
ce sont des rapports agrégés en lecture seule, pas des ressources CRUD.
"""

from datetime import timedelta

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Sum
from django.db.models.functions import ExtractHour
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models, services
from .permissions import IsManagerOrAdmin, IsTenantMember, LicenceRapportsAutorises

PERIODE_PAR_DEFAUT = timedelta(hours=24)


def _resoudre_periode(request):
    """Lit `?depuis=`/`?jusqu_a=` (ISO 8601) ; défaut : les dernières 24h."""
    maintenant = timezone.now()
    depuis = parse_datetime(request.query_params.get("depuis", "")) or (maintenant - PERIODE_PAR_DEFAUT)
    jusqu_a = parse_datetime(request.query_params.get("jusqu_a", "")) or maintenant
    return depuis, jusqu_a


class BaseStatsView(APIView):
    # `LicenceRapportsAutorises` : palier "retard prolongé" du modèle de
    # sanction progressif (§licence) — désactive spécifiquement les
    # rapports, sans toucher au reste de l'app.
    permission_classes = [IsAuthenticated, IsTenantMember, LicenceRapportsAutorises]


class TempsPreparationParPosteView(BaseStatsView):
    """
    `GET /api/stats/temps-preparation/` — durée moyenne entre l'envoi au
    poste et le statut "prêt" (§5.4), groupée par poste, sur la période.
    """

    def get(self, request):
        depuis, jusqu_a = _resoudre_periode(request)
        rows = (
            models.OrderTicket.objects.filter(
                tenant=request.user.tenant,
                heure_envoi_poste__isnull=False,
                heure_pret__isnull=False,
                created_at__gte=depuis,
                created_at__lte=jusqu_a,
            )
            .annotate(
                duree=ExpressionWrapper(
                    F("heure_pret") - F("heure_envoi_poste"), output_field=DurationField()
                )
            )
            .values("station_id", "station__nom")
            .annotate(duree_moyenne_secondes=Avg("duree"), nb_tickets=Count("id"))
            .order_by("station__nom")
        )
        data = [
            {
                "station": row["station_id"],
                "station_nom": row["station__nom"],
                "duree_moyenne_secondes": row["duree_moyenne_secondes"].total_seconds(),
                "nb_tickets": row["nb_tickets"],
            }
            for row in rows
        ]
        return Response(data)


class HeuresDePointeView(BaseStatsView):
    """`GET /api/stats/heures-pointe/` — nombre de commandes par heure de la journée (§5.4), sur la période."""

    def get(self, request):
        depuis, jusqu_a = _resoudre_periode(request)
        rows = (
            models.Order.objects.filter(tenant=request.user.tenant, created_at__gte=depuis, created_at__lte=jusqu_a)
            .annotate(heure=ExtractHour("created_at"))
            .values("heure")
            .annotate(nb_commandes=Count("id"))
            .order_by("heure")
        )
        return Response(list(rows))


class PlatsPlusLentsView(BaseStatsView):
    """
    `GET /api/stats/plats-plus-lents/` — temps de préparation moyen par
    plat (§5.4), sur la période.

    Approximation : la durée est celle du *ticket* (envoi poste → prêt),
    partagée par toutes les lignes de ce ticket — il n'y a pas
    d'horodatage par ligne individuelle dans le modèle actuel. Fiable pour
    un ticket mono-plat, indicatif pour un ticket qui mélange plusieurs
    plats à la préparation très inégale.
    """

    def get(self, request):
        depuis, jusqu_a = _resoudre_periode(request)
        rows = (
            models.OrderItem.objects.filter(
                tenant=request.user.tenant,
                ticket__heure_envoi_poste__isnull=False,
                ticket__heure_pret__isnull=False,
                created_at__gte=depuis,
                created_at__lte=jusqu_a,
            )
            .annotate(
                duree=ExpressionWrapper(
                    F("ticket__heure_pret") - F("ticket__heure_envoi_poste"), output_field=DurationField()
                )
            )
            .values("plat_id", "plat__nom")
            .annotate(duree_moyenne_secondes=Avg("duree"), nb_lignes=Count("id"))
            .order_by("-duree_moyenne_secondes")
        )
        data = [
            {
                "plat": row["plat_id"],
                "plat_nom": row["plat__nom"],
                "duree_moyenne_secondes": row["duree_moyenne_secondes"].total_seconds(),
                "nb_lignes": row["nb_lignes"],
            }
            for row in rows
        ]
        return Response(data)


class ProductiviteEmployesView(BaseStatsView):
    """
    `GET /api/stats/productivite-employes/` — temps moyen de préparation
    individuel (§5.4 "Rapport par employé"), sur la période. **Réservé aux
    managers/admins.**

    Basé sur `TicketStatusLog` : pour chaque passage à "prêt", l'utilisateur
    qui a fait le changement (`utilisateur`) est crédité de la durée du
    ticket concerné.
    """

    permission_classes = [IsAuthenticated, IsTenantMember, IsManagerOrAdmin, LicenceRapportsAutorises]

    def get(self, request):
        depuis, jusqu_a = _resoudre_periode(request)
        rows = (
            models.TicketStatusLog.objects.filter(
                tenant=request.user.tenant,
                nouveau_statut=models.OrderTicket.Statut.PRET,
                utilisateur__isnull=False,
                created_at__gte=depuis,
                created_at__lte=jusqu_a,
                ticket__heure_envoi_poste__isnull=False,
                ticket__heure_pret__isnull=False,
            )
            .annotate(
                duree=ExpressionWrapper(
                    F("ticket__heure_pret") - F("ticket__heure_envoi_poste"), output_field=DurationField()
                )
            )
            .values("utilisateur_id", "utilisateur__username", "utilisateur__first_name", "utilisateur__last_name")
            .annotate(duree_moyenne_secondes=Avg("duree"), nb_tickets=Count("id"))
            .order_by("-nb_tickets")
        )
        data = [
            {
                "utilisateur": row["utilisateur_id"],
                "utilisateur_nom": (
                    f"{row['utilisateur__first_name']} {row['utilisateur__last_name']}".strip()
                    or row["utilisateur__username"]
                ),
                "duree_moyenne_secondes": row["duree_moyenne_secondes"].total_seconds(),
                "nb_tickets": row["nb_tickets"],
            }
            for row in rows
        ]
        return Response(data)


class GaspillageView(BaseStatsView):
    """
    `GET /api/stats/gaspillage/` — lignes annulées avec motif (§5.4 "Suivi
    gaspillage / annulations"), groupées par plat, sur la période.
    """

    def get(self, request):
        depuis, jusqu_a = _resoudre_periode(request)
        rows = (
            models.OrderItem.objects.filter(
                tenant=request.user.tenant,
                statut_ligne=models.OrderItem.StatutLigne.ANNULE,
                created_at__gte=depuis,
                created_at__lte=jusqu_a,
            )
            .values("plat_id", "plat__nom", "motif_annulation")
            .annotate(quantite_totale=Sum("quantite"), nb_lignes=Count("id"))
            .order_by("-quantite_totale")
        )
        return Response(list(rows))


LIBELLE_SECTEUR = {"salle": "Commandes de table", "comptoir": "Vente comptoir"}


class VentesParJourView(BaseStatsView):
    """
    `GET /api/stats/ventes/?depuis=&jusqu_a=` (ISO 8601, même convention
    que le reste de ce fichier via `_resoudre_periode` — défaut : les
    dernières 24h) — chiffre d'affaires encaissé sur une période (§5.5,
    demandé après coup en même temps que l'écran caisse ; élargi d'"une
    journée" (`?date=`) à une vraie période après retour utilisateur — un
    gérant édite aussi ce rapport sur une semaine ou un mois, pas
    uniquement jour par jour). Réservé manager/admin (`IsManagerOrAdmin`,
    même logique que `productivite-employes` : le chiffre d'affaires est
    une donnée sensible, un serveur qui encaisse n'a pas besoin de voir
    le total du restaurant).

    Basé sur `heure_paiement`, pas `created_at` : une commande passée
    tard le soir et payée après minuit compte sur le jour où l'argent est
    réellement rentré, pas sur le jour où le client a commandé — c'est ce
    qui correspond à "les ventes du 13 juillet" pour un gérant qui fait
    sa caisse.

    `secteur` ("Commandes de table" / "Vente comptoir", demandé après
    coup) dérivé de `Order.table` (présente ou non), pas de `Order.source`
    directement — c'est le même critère que celui déjà utilisé à la
    création de la commande (`OrderViewSet.prendre_commande` : `source =
    SALLE if table else COMPTOIR`), et il reste correct même pour
    d'éventuelles sources futures (QR_CODE, click&collect...) sans qu'il
    faille mettre ce rapport à jour à chaque nouveau canal.
    """

    permission_classes = [IsAuthenticated, IsTenantMember, IsManagerOrAdmin, LicenceRapportsAutorises]

    def get(self, request):
        depuis, jusqu_a = _resoudre_periode(request)

        commandes = (
            models.Order.objects.filter(
                tenant=request.user.tenant,
                statut_paiement=models.Order.StatutPaiement.PAYEE,
                heure_paiement__gte=depuis,
                heure_paiement__lte=jusqu_a,
            )
            .select_related("table", "serveur", "caissier")
            .order_by("heure_paiement")
        )

        total_ventes = 0
        nb_commandes = 0
        par_secteur_brut = {}
        for commande in commandes:
            total_commande = services.calculer_total_commande(commande)
            total_ventes += total_commande
            nb_commandes += 1
            secteur = "salle" if commande.table else "comptoir"
            bucket = par_secteur_brut.setdefault(secteur, {"montant_total": 0, "nb_commandes": 0})
            bucket["montant_total"] += total_commande
            bucket["nb_commandes"] += 1

        par_secteur = [
            {"secteur": secteur, "secteur_libelle": LIBELLE_SECTEUR[secteur], **valeurs}
            for secteur, valeurs in par_secteur_brut.items()
        ]

        # Ventes par article/catégorie/secteur (§5.5, demandé après coup —
        # "l'état des ventes par article/catégorie", puis élargi au détail
        # ligne par ligne — "Mouvements" côté frontend, regroupant ce qui
        # était avant 3 vues séparées "Commandes"/"Par article"/"Par
        # catégorie"). Basé sur les MÊMES commandes déjà filtrées
        # ci-dessus (même période, mêmes commandes payées) — pas un
        # nouvel endpoint séparé, une deuxième vue du même jeu de
        # données. `plat__prix` (pas un prix figé par ligne, cf.
        # `OrderItem` — le projet n'a jamais stocké de prix historique par
        # ligne, seule source de vérité : le prix courant du plat, même
        # logique que `services.calculer_total_commande`).
        lignes = (
            models.OrderItem.objects.filter(
                tenant=request.user.tenant,
                ticket__order__in=commandes,
            )
            .exclude(statut_ligne=models.OrderItem.StatutLigne.ANNULE)
            .select_related("plat__categorie", "ticket__order__table", "ticket__order__serveur", "ticket__order__caissier")
        )

        par_article = list(
            lignes.values("plat_id", "plat__nom", "plat__categorie__nom")
            .annotate(quantite_totale=Sum("quantite"), montant_total=Sum(F("quantite") * F("plat__prix")))
            .order_by("-montant_total")
        )
        par_categorie = list(
            lignes.values("plat__categorie_id", "plat__categorie__nom")
            .annotate(quantite_totale=Sum("quantite"), montant_total=Sum(F("quantite") * F("plat__prix")))
            .order_by("-montant_total")
        )

        def _nom_utilisateur(utilisateur):
            return (utilisateur.get_full_name() or utilisateur.username) if utilisateur else None

        mouvements = [
            {
                "id": ligne.id,
                "secteur": "salle" if ligne.ticket.order.table else "comptoir",
                "secteur_libelle": LIBELLE_SECTEUR["salle" if ligne.ticket.order.table else "comptoir"],
                "plat_nom": ligne.plat.nom,
                "categorie_nom": ligne.plat.categorie.nom if ligne.plat.categorie else None,
                "quantite": ligne.quantite,
                "montant": ligne.plat.prix * ligne.quantite,
                "table_numero": ligne.ticket.order.table.numero if ligne.ticket.order.table else None,
                # `serveur` avant `caissier` (trouvé en usage réel : une
                # commande de table est presque toujours encaissée par un
                # manager/caissier différent de la serveuse qui l'a prise —
                # avec la priorité inverse, le nom de la serveuse
                # n'apparaissait donc quasiment jamais). `caissier` reste le
                # repli pour une vente comptoir (§TPE), qui n'a pas de
                # `serveur` du tout.
                "utilisateur": ligne.ticket.order.serveur_id or ligne.ticket.order.caissier_id,
                "utilisateur_nom": _nom_utilisateur(ligne.ticket.order.serveur) or _nom_utilisateur(ligne.ticket.order.caissier),
                "heure_paiement": ligne.ticket.order.heure_paiement,
            }
            for ligne in sorted(lignes, key=lambda l: l.ticket.order.heure_paiement, reverse=True)
        ]

        return Response(
            {
                "depuis": depuis.isoformat(),
                "jusqu_a": jusqu_a.isoformat(),
                "total_ventes": total_ventes,
                "nb_commandes": nb_commandes,
                "par_secteur": par_secteur,
                "mouvements": mouvements,
                "par_article": [
                    {
                        "plat": row["plat_id"],
                        "plat_nom": row["plat__nom"],
                        "categorie_nom": row["plat__categorie__nom"],
                        "quantite_totale": row["quantite_totale"],
                        "montant_total": row["montant_total"],
                    }
                    for row in par_article
                ],
                "par_categorie": [
                    {
                        "categorie": row["plat__categorie_id"],
                        "categorie_nom": row["plat__categorie__nom"],
                        "quantite_totale": row["quantite_totale"],
                        "montant_total": row["montant_total"],
                    }
                    for row in par_categorie
                ],
            }
        )


class CommandesAnnuleesView(BaseStatsView):
    """
    `GET /api/stats/commandes-annulees/?depuis=&jusqu_a=` — commandes
    annulées sur une période (§5.1/§5.4, demandé après coup : "quelle est
    la procédure en place ? mettre en place le motif obligatoire et
    répertorier ça sur le Tableau de bord"). Basé sur `heure_annulation`
    (cf. `Order.heure_annulation`, `services.cancel_order`), pas
    `updated_at` — un horodatage métier dédié plutôt qu'un champ
    technique générique qui pourrait en théorie bouger pour d'autres
    raisons.

    `montant_perdu` : somme des lignes réellement annulées de cette
    commande (`OrderItem.statut_ligne=ANNULE`) — pas le total qu'aurait
    fait la commande entière, puisque `cancel_order` épargne les tickets
    déjà servis (un plat déjà en salle n'est pas "perdu").
    """

    permission_classes = [IsAuthenticated, IsTenantMember, IsManagerOrAdmin, LicenceRapportsAutorises]

    def get(self, request):
        depuis, jusqu_a = _resoudre_periode(request)

        commandes = (
            models.Order.objects.filter(
                tenant=request.user.tenant,
                statut=models.Order.Statut.ANNULEE,
                heure_annulation__gte=depuis,
                heure_annulation__lte=jusqu_a,
            )
            .select_related("table", "serveur", "annule_par")
            .order_by("-heure_annulation")
        )

        def _nom(utilisateur):
            return (utilisateur.get_full_name() or utilisateur.username) if utilisateur else None

        data = []
        montant_total_perdu = 0
        for commande in commandes:
            montant = (
                models.OrderItem.objects.filter(
                    ticket__order=commande, statut_ligne=models.OrderItem.StatutLigne.ANNULE
                ).aggregate(total=Sum(F("quantite") * F("plat__prix")))["total"]
                or 0
            )
            montant_total_perdu += montant
            secteur = "salle" if commande.table else "comptoir"
            data.append(
                {
                    "id": commande.id,
                    "table_numero": commande.table.numero if commande.table else None,
                    "secteur": secteur,
                    "secteur_libelle": LIBELLE_SECTEUR[secteur],
                    "montant_perdu": montant,
                    "motif": commande.motif_annulation,
                    "serveur_nom": _nom(commande.serveur),
                    "annule_par_nom": _nom(commande.annule_par),
                    "heure_annulation": commande.heure_annulation,
                }
            )

        return Response(
            {
                "depuis": depuis.isoformat(),
                "jusqu_a": jusqu_a.isoformat(),
                "nb_commandes_annulees": len(data),
                "montant_total_perdu": montant_total_perdu,
                "commandes": data,
            }
        )
