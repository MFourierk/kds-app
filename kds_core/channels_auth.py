from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def _get_user_from_token(token):
    from kds_core.models import User

    try:
        access_token = AccessToken(token)
        return User.objects.get(id=access_token["user_id"])
    except (TokenError, InvalidToken, User.DoesNotExist, KeyError):
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """
    Authentifie les connexions WebSocket via un token JWT passé en query
    string (`ws://.../?token=<access_token>`).

    Un navigateur ne peut pas fixer de header `Authorization` sur le
    handshake WebSocket natif (`new WebSocket(url)` ne le permet pas) —
    la query string est le mécanisme standard pour ce cas, au prix d'un
    token qui peut se retrouver dans des logs d'accès. Acceptable ici car
    ce sont des *access tokens* de courte durée (5 min par défaut).
    """

    async def __call__(self, scope, receive, send):
        query_string = parse_qs(scope.get("query_string", b"").decode())
        token = query_string.get("token", [None])[0]
        scope["user"] = await _get_user_from_token(token) if token else AnonymousUser()
        return await super().__call__(scope, receive, send)
