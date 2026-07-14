from django.apps import AppConfig


class KdsCoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "kds_core"
    verbose_name = "KDS — Cœur métier"

    def ready(self):
        from . import signals  # noqa: F401
