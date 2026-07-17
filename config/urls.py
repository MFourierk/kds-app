"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from kds_core.auth_views import KioskStaffListView, PinLoginView
from kds_core.licence_views import (
    LicenceDerniereVersionView,
    LicencePointageView,
    LicenceStatutView,
    LicenceTelechargerVersionView,
)
from kds_core.pos_views import PosOrderCancelView, PosOrderCreateView, PosOrderPaymentView
from kds_core.qr_views import QrCallWaiterView, QrMenuView, QrOrderCreateView, QrOrderStatusView
from kds_core.stats_views import (
    CommandesAnnuleesView,
    GaspillageView,
    HeuresDePointeView,
    PlatsPlusLentsView,
    ProductiviteEmployesView,
    TempsPreparationParPosteView,
    VentesParJourView,
)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/pin-login/', PinLoginView.as_view(), name='pin_login'),
    path('api/kiosk/staff/', KioskStaffListView.as_view(), name='kiosk_staff'),
    path('api/pos/orders/pay/', PosOrderPaymentView.as_view(), name='pos_order_pay'),
    path('api/pos/orders/cancel/', PosOrderCancelView.as_view(), name='pos_order_cancel'),
    path('api/pos/orders/', PosOrderCreateView.as_view(), name='pos_order_create'),
    path('api/qr/<uuid:qr_code_token>/menu/', QrMenuView.as_view(), name='qr_menu'),
    path('api/qr/<uuid:qr_code_token>/orders/', QrOrderStatusView.as_view(), name='qr_order_status'),
    path('api/qr/<uuid:qr_code_token>/orders/create/', QrOrderCreateView.as_view(), name='qr_order_create'),
    path('api/qr/<uuid:qr_code_token>/appel-serveur/', QrCallWaiterView.as_view(), name='qr_call_waiter'),
    path('api/stats/temps-preparation/', TempsPreparationParPosteView.as_view(), name='stats_temps_preparation'),
    path('api/stats/heures-pointe/', HeuresDePointeView.as_view(), name='stats_heures_pointe'),
    path('api/stats/plats-plus-lents/', PlatsPlusLentsView.as_view(), name='stats_plats_lents'),
    path('api/stats/productivite-employes/', ProductiviteEmployesView.as_view(), name='stats_productivite'),
    path('api/stats/gaspillage/', GaspillageView.as_view(), name='stats_gaspillage'),
    path('api/stats/ventes/', VentesParJourView.as_view(), name='stats_ventes'),
    path('api/stats/commandes-annulees/', CommandesAnnuleesView.as_view(), name='stats_commandes_annulees'),
    path('api/licence/pointage/', LicencePointageView.as_view(), name='licence_pointage'),
    path('api/licence/statut/', LicenceStatutView.as_view(), name='licence_statut'),
    path('api/licence/derniere-version/', LicenceDerniereVersionView.as_view(), name='licence_derniere_version'),
    path(
        'api/licence/telecharger/<str:version>/',
        LicenceTelechargerVersionView.as_view(),
        name='licence_telecharger_version',
    ),
    path('api/', include('kds_core.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
