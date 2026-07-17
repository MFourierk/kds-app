from django.conf import settings
from rest_framework.permissions import BasePermission

from .models import User


class IsTenantMember(BasePermission):
    """
    Bloque tout utilisateur authentifié non rattaché à un tenant.

    Concerne notamment le superutilisateur Django créé pour `/admin/` :
    sans cette permission, un compte sans `tenant` recevrait des querysets
    vides (filtrées sur `tenant=None`) au lieu d'un refus explicite — ce
    qui masquerait le vrai problème. L'API tenant-scopée n'est destinée
    qu'aux comptes `kds_core.User` rattachés à un établissement.
    """

    message = "Cet utilisateur n'est rattaché à aucun tenant."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.tenant_id)


class IsManagerOrAdmin(BasePermission):
    """
    Réservé aux rôles admin/manager (§5.4 "Rapport par employé... accès
    restreint aux managers") — un cuisinier/serveur ne doit pas voir les
    temps de préparation individuels de ses collègues.
    """

    message = "Réservé aux managers et administrateurs."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated and getattr(user, "role", None) in (User.Role.ADMIN, User.Role.MANAGER)
        )


class PeutEncaisser(BasePermission):
    """
    Réservé aux rôles qui manipulent réellement de l'argent — admin/manager
    (comme avant) plus, depuis l'écran TPE (§vente comptoir), le rôle
    caissier·ère. Volontairement séparée d'`IsManagerOrAdmin` : ce dernier
    reste utilisé tel quel pour le back-office/les rapports, auxquels une
    caissière n'a pas accès — seul l'encaissement lui-même s'ouvre à elle.
    """

    message = "Réservé aux managers, administrateurs et caissier·ères."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and getattr(user, "role", None) in (User.Role.ADMIN, User.Role.MANAGER, User.Role.CAISSIER)
        )


class PeutFermerAppelServeur(BasePermission):
    """
    Réservé aux rôles qui accusent réception d'un appel client (§5.6,
    bandeau "Appel serveur" diffusé à tous les postes) — serveur en
    premier lieu (c'est son rôle), manager/admin en secours si le
    serveur assigné est occupé ailleurs. Volontairement PAS cuisinier ni
    caissier : le bandeau doit rester visible pour eux tant que personne
    de qualifié ne l'a traité, sans qu'ils puissent le faire disparaître
    eux-mêmes.
    """

    message = "Réservé aux serveurs, managers et administrateurs."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and getattr(user, "role", None) in (User.Role.ADMIN, User.Role.MANAGER, User.Role.SERVEUR)
        )


class IsAdmin(BasePermission):
    """
    Réservé au rôle admin STRICT (pas manager) — utilisé pour des actions
    volontairement plus restreintes qu'`IsManagerOrAdmin` (ex: suppression
    d'une commande/transaction). Un tenant peut avoir plusieurs comptes
    `role=admin` (associé, comptable...) — pas limité au superutilisateur
    Django unique (`is_superuser`), qui est une notion distincte (cf.
    `UserViewSet._est_protege`).
    """

    message = "Réservé aux administrateurs."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and getattr(user, "role", None) == User.Role.ADMIN)


class LicenceRapportsAutorises(BasePermission):
    """
    Palier intermédiaire du modèle de sanction progressif (§licence,
    "retard prolongé" — 15 à 45 jours de retard de paiement) : les
    rapports (`stats_views.py`) sont désactivés, tout le reste de l'app
    continue de fonctionner normalement. Jamais actif sur le serveur
    maître, ni avant ce palier ("actif"/"retard" simple = juste un
    bandeau d'avertissement, pas de restriction fonctionnelle).
    """

    message = "Rapports temporairement indisponibles — abonnement en retard de paiement. Contactez votre prestataire."

    def has_permission(self, request, view):
        if settings.EST_SERVEUR_MAITRE:
            return True
        from .models import EtatLicenceLocal, LicenceClient

        statut = EtatLicenceLocal.instance().statut
        return statut not in (LicenceClient.Statut.RETARD_PROLONGE, LicenceClient.Statut.SUSPENDU)
