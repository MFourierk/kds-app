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
