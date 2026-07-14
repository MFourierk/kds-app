"""
Présence en temps réel des écrans cuisine (poste/Master).

Deux niveaux de suivi, sur le même principe (ZSET Redis
`channel_name -> horodatage du dernier signe de vie`, TTL applicatif) :

- **Par tenant** (§5.5/§5.6) : sert à répondre à une question précise — à
  l'instant où un client passe commande via son propre réseau (4G) pendant
  que le restaurant est coupé d'internet, comment savoir — tout de suite,
  pas seulement après coup — que la cuisine ne pourra pas voir cette
  commande en temps réel ? Aucun WebSocket/webhook ne peut "pousser" quoi
  que ce soit vers un établissement sans connexion (contrainte physique,
  pas logicielle) — mais le backend PEUT savoir si un écran cuisine lui a
  donné signe de vie récemment, et le dire honnêtement au client.
- **Par poste** (§5.5 "redondance écran") : sert à détecter qu'un poste
  précis n'a plus d'écran qui le surveille (panne matérielle/logicielle de
  CET écran, indépendamment du reste du restaurant), pour permettre une
  réaffectation manuelle de ses tickets vers un autre poste actif
  (`StationViewSet.reassigner`).

Une déconnexion brutale (coupure réseau, panne, sans fermeture propre du
WebSocket) ne déclenche pas toujours `disconnect()` immédiatement côté
serveur — le TTL applicatif (`PRESENCE_TTL_SECONDS`) fait expirer
naturellement une entrée trop ancienne plutôt que de la considérer
"en ligne" indéfiniment à tort.

Toutes les opérations sont best-effort : un hoquet Redis (timeout, requête
lente) ne doit jamais faire planter un cycle de connexion/déconnexion
WebSocket, ni une requête de commande QR — la présence n'est qu'un signal
d'aide à la décision, pas une fonctionnalité critique. En cas d'erreur, les
fonctions `is_*` répondent prudemment `False` (mieux vaut prévenir à tort
que l'inverse).
"""

import logging
import time

import redis.asyncio as redis
from asgiref.sync import async_to_sync
from django.conf import settings

logger = logging.getLogger(__name__)

PRESENCE_TTL_SECONDS = 45
REDIS_TIMEOUT_SECONDS = 2

_client = None


def _get_client():
    global _client
    if _client is None:
        host, port = settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"][0]
        _client = redis.Redis(
            host=host,
            port=port,
            socket_timeout=REDIS_TIMEOUT_SECONDS,
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
        )
    return _client


def _tenant_key(tenant_id):
    return f"kds:presence:{tenant_id}"


def _scope_key(tenant_id, scope_id):
    return f"kds:presence:{tenant_id}:{scope_id}"


async def heartbeat(tenant_id, scope_id, channel_name):
    """Marque un écran comme actif (ou rafraîchit son horodatage), pour son tenant ET son poste/scope."""
    try:
        now = time.time()
        client = _get_client()
        await client.zadd(_tenant_key(tenant_id), {channel_name: now})
        await client.zadd(_scope_key(tenant_id, scope_id), {channel_name: now})
    except Exception:
        logger.warning("Échec du heartbeat de présence (tenant=%s)", tenant_id, exc_info=True)


async def forget(tenant_id, scope_id, channel_name):
    """Retire un écran de la présence, tenant ET poste/scope (déconnexion propre)."""
    try:
        client = _get_client()
        await client.zrem(_tenant_key(tenant_id), channel_name)
        await client.zrem(_scope_key(tenant_id, scope_id), channel_name)
    except Exception:
        logger.warning("Échec du retrait de présence (tenant=%s)", tenant_id, exc_info=True)


async def _is_online(key):
    try:
        cutoff = time.time() - PRESENCE_TTL_SECONDS
        count = await _get_client().zcount(key, cutoff, "+inf")
        return count > 0
    except Exception:
        logger.warning("Échec de la lecture de présence (%s)", key, exc_info=True)
        return False


async def is_kitchen_online(tenant_id):
    """Vrai si au moins un écran (poste ou Master) du tenant a donné signe de vie récemment."""
    return await _is_online(_tenant_key(tenant_id))


async def is_station_online(tenant_id, station_id):
    """Vrai si au moins un écran surveille précisément CE poste (pas seulement le tenant en général)."""
    return await _is_online(_scope_key(tenant_id, station_id))


def is_kitchen_online_sync(tenant_id):
    """Variante synchrone, pour les vues DRF classiques (non-async) comme `qr_views.py`."""
    return async_to_sync(is_kitchen_online)(tenant_id)


def is_station_online_sync(tenant_id, station_id):
    """Variante synchrone, pour les vues DRF classiques (non-async) comme `views.py`."""
    return async_to_sync(is_station_online)(tenant_id, station_id)
