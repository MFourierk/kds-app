# ---------------------------------------------------------------------------
# À FUSIONNER dans settings.py du projet Django (après `django-admin startproject`)
# Ne remplace pas le fichier — copier les blocs pertinents.
# ---------------------------------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Tiers
    "rest_framework",
    "corsheaders",
    "channels",
    # App locale
    "kds_core",
]

AUTH_USER_MODEL = "kds_core.User"

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",  # doit être placé avant CommonMiddleware
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# --- Base de données (PostgreSQL) ---
import os  # noqa: E402

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "kds_db"),
        "USER": os.environ.get("DB_USER", "kds_user"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "changeme"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
    }
}

# --- Django REST Framework ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
}

# --- CORS (à restreindre en production aux domaines des tenants) ---
CORS_ALLOW_ALL_ORIGINS = True  # DEV UNIQUEMENT — remplacer par CORS_ALLOWED_ORIGINS en prod

# --- Channels (WebSocket temps réel) ---
ASGI_APPLICATION = "config.asgi.application"  # adapter "config" au nom réel du projet

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [(os.environ.get("REDIS_HOST", "localhost"), 6379)],
        },
    },
}

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Africa/Abidjan"
USE_I18N = True
USE_TZ = True
