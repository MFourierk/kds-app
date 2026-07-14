import json
import logging
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)


def notify_order_statut(order):
    """
    Remonte le changement de statut d'une commande aux logiciels de caisse
    intégrés (§5.5 : "le statut prêt remonte en caisse" / "alerte...dès
    qu'un plat est marqué prêt"), via un `POST` sur `PosIntegration.webhook_url`.

    Envoi synchrone, best-effort : une caisse injoignable ou lente ne doit
    jamais faire échouer la requête API d'origine (bump d'un ticket,
    changement de statut...). Pas de file d'attente/retry pour l'instant
    (aucune tâche asynchrone — Celery ou équivalent — n'est encore en place
    dans ce projet) ; à revoir si le volume ou la fiabilité l'exigent.
    """

    from .models import PosIntegration  # import différé : évite un cycle avec models -> signals

    integrations = PosIntegration.objects.filter(
        tenant=order.tenant, is_active=True
    ).exclude(webhook_url="")
    if not integrations:
        return

    payload = json.dumps(
        {
            "event": "order.statut_change",
            "order": {
                "id": str(order.id),
                "reference_externe": order.reference_externe,
                "statut": order.statut,
                "table": order.table.numero if order.table else None,
            },
        }
    ).encode("utf-8")

    for integration in integrations:
        _post(integration.webhook_url, payload)


def _post(url, payload, timeout=3):
    request = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        urllib.request.urlopen(request, timeout=timeout)
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as exc:
        logger.warning("Échec de la notification webhook POS vers %s : %s", url, exc)
