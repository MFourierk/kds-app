import threading

from django.conf import settings
from django.http import JsonResponse

_thread_locals = threading.local()


def get_current_user():
    """
    Récupère l'utilisateur de la requête HTTP en cours, y compris depuis un
    code appelé en dehors de la vue (ex: un signal `post_save`).

    On stocke la requête elle-même (pas `request.user`) car DRF résout
    l'authentification JWT paresseusement : au moment où le middleware
    Django s'exécute, `request.user` n'est pas encore peuplé. En gardant
    une référence à l'objet requête, la lecture différée de `.user` ici
    profite de la résolution DRF qui a eu lieu entre-temps dans la vue.

    Ne renvoie qu'un vrai `kds_core.User` : une requête authentifiée via
    `PosApiKeyAuthentication` (cf. `pos_auth.PosPrincipal`) est bien
    "authentifiée" mais n'est pas un membre du personnel — l'assigner à un
    champ `ForeignKey(User)` (ex: `TicketStatusLog.utilisateur`) lèverait
    une `ValueError`.
    """

    from .models import User

    request = getattr(_thread_locals, "request", None)
    if request is None:
        return None
    user = getattr(request, "user", None)
    if isinstance(user, User) and user.is_authenticated:
        return user
    return None


class CurrentUserMiddleware:
    """Rend l'utilisateur de la requête courante accessible hors du cycle requête/vue (cf. `get_current_user`)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _thread_locals.request = request
        try:
            return self.get_response(request)
        finally:
            _thread_locals.request = None


# Chemins jamais bloqués même en cas de suspension (§licence) : connexion
# (pour qu'un manager puisse au moins se connecter et voir pourquoi c'est
# bloqué), le statut de licence lui-même (sinon le frontend ne pourrait
# jamais afficher l'écran de blocage), `/admin/` (diagnostic), fichiers
# statiques/media.
LICENCE_CHEMINS_EXEMPTES = ("/admin/", "/api/auth/", "/api/licence/", "/media/", "/static/")


class LicenceEnforcementMiddleware:
    """
    Applique le blocage complet (§licence, statut "suspendu" — 45+ jours de
    retard de paiement, seuils validés avec l'utilisateur) au niveau API,
    en plus de l'écran de blocage côté frontend (`App.jsx`) : un membre du
    personnel technique qui contournerait l'interface ne peut pas continuer
    à utiliser l'app via des appels directs à l'API. Jamais actif sur le
    serveur maître (`EST_SERVEUR_MAITRE=True`) — il n'a pas de statut de
    licence vis-à-vis de lui-même.

    Volontairement PAS de blocage aux statuts "retard"/"retard_prolongé" —
    seuls des avertissements/restrictions ciblées (rapports) à ces
    niveaux-là, gérées ailleurs (cf. `stats_views.py`, `LicenceStatutBanner`
    côté frontend). Le blocage total est réservé au cas extrême.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.EST_SERVEUR_MAITRE or not request.path.startswith("/api/"):
            return self.get_response(request)
        if any(request.path.startswith(p) for p in LICENCE_CHEMINS_EXEMPTES):
            return self.get_response(request)

        from .models import EtatLicenceLocal, LicenceClient

        etat = EtatLicenceLocal.instance()
        if etat.statut == LicenceClient.Statut.SUSPENDU:
            return JsonResponse(
                {"detail": "Abonnement suspendu — contactez votre prestataire pour rétablir l'accès."}, status=402
            )

        return self.get_response(request)
