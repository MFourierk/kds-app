from rest_framework import generics, serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from . import models


class KioskStaffSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.User
        fields = ["id", "username", "first_name", "last_name", "role"]


class KioskStaffListView(generics.ListAPIView):
    """
    Liste des comptes utilisables pour la connexion rapide par PIN sur un
    écran cuisine (cf. cahier des charges §6.4).

    Volontairement accessible sans authentification : c'est l'écran de
    sélection ("qui es-tu ?") affiché AVANT la saisie du PIN sur une
    tablette de cuisine physiquement présente dans l'établissement — même
    modèle de confiance que le menu QR code client (accès public mais
    scopé à un seul tenant connu via son slug, aucune donnée sensible
    exposée : pas d'email, pas de PIN, pas de tenant_id).
    """

    serializer_class = KioskStaffSerializer
    permission_classes = [AllowAny]
    pagination_class = None

    def get_queryset(self):
        tenant_slug = self.request.query_params.get("tenant")
        if not tenant_slug:
            return models.User.objects.none()
        queryset = models.User.objects.filter(
            tenant__slug=tenant_slug,
            is_active=True,
            role__in=[
                models.User.Role.MANAGER,
                models.User.Role.CUISINIER,
                models.User.Role.SERVEUR,
            ],
        )
        station_id = self.request.query_params.get("station")
        if station_id:
            queryset = queryset.filter(station_assignee_id=station_id)
        return queryset.order_by("first_name", "username")


class PinLoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    pin = serializers.CharField()

    def validate(self, attrs):
        user = models.User.objects.filter(username=attrs["username"], is_active=True).first()
        if user is None or not user.check_pin(attrs["pin"]):
            # Message volontairement générique : ne pas révéler si c'est le
            # username ou le PIN qui est invalide (anti-énumération de comptes).
            raise serializers.ValidationError("Identifiants PIN invalides.")
        attrs["user"] = user
        return attrs


class PinLoginView(APIView):
    """
    Connexion rapide écran cuisine par code PIN (cf. §6.4) — alternative à
    `/api/auth/login/` (username + password) pour les rôles cuisinier/serveur
    sur écran tactile. Retourne la même paire de tokens JWT.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PinLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        refresh = RefreshToken.for_user(user)
        return Response(
            {"refresh": str(refresh), "access": str(refresh.access_token)},
            status=status.HTTP_200_OK,
        )
