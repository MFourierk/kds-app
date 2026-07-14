import threading

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
