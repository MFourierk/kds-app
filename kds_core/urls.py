from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("tenant", views.TenantViewSet, basename="tenant")
router.register("stations", views.StationViewSet, basename="station")
router.register("menu-categories", views.MenuCategoryViewSet, basename="menucategory")
router.register("modifier-categories", views.ModifierCategoryViewSet, basename="modifiercategory")
router.register("modifiers", views.ModifierViewSet, basename="modifier")
router.register("menu-items", views.MenuItemViewSet, basename="menuitem")
router.register("tables", views.RestaurantTableViewSet, basename="restauranttable")
router.register("users", views.UserViewSet, basename="user")
router.register("orders", views.OrderViewSet, basename="order")
router.register("order-tickets", views.OrderTicketViewSet, basename="orderticket")
router.register("order-items", views.OrderItemViewSet, basename="orderitem")
router.register("ticket-status-logs", views.TicketStatusLogViewSet, basename="ticketstatuslog")
router.register("pos-integrations", views.PosIntegrationViewSet, basename="posintegration")

urlpatterns = router.urls
