# KDS — Application (backend Django + frontend React)

Application KDS décrite dans le *Cahier des charges — Application KDS*.
Backend Django multi-tenant (Phases 0 à 6, cf. roadmap plus bas) +
premier écran frontend (Master cuisine, React/Vite/Tailwind).

## Contenu

```
config/                     ← projet Django (généré par django-admin startproject)
  settings.py                ← settings_snippet.py déjà fusionné dedans
kds_core/                  ← app Django réutilisable, cœur métier
  models/
    base.py                ← classes abstraites (UUID, timestamps, tenant scoping)
    tenants.py              ← Tenant (marque blanche : logo, couleurs, devise...)
    catalog.py              ← Station, MenuCategory, Modifier, MenuItem
    tables.py                ← RestaurantTable (QR code)
    users.py                 ← User (rôles, PIN, poste assigné)
    orders.py                ← Order, OrderTicket, OrderItem, TicketStatusLog
  admin.py                 ← interface d'administration Django
  apps.py
  migrations/               ← 0001_initial générée
manage.py
requirements.txt
docker-compose.yml          ← Postgres + Redis pour le dev local (Postgres exposé sur le port hôte 5433, voir plus bas)
.env                        ← copié depuis .env.example, chargé automatiquement via python-decouple
frontend/                   ← React + Vite + Tailwind (écran Master pour l'instant, cf. section Frontend)
deploy/client-package/      ← paquet d'installation Docker pour une installation cliente (hors ligne, cf. DEPLOY.md)
scripts/build-client-package.sh  ← construit ce paquet (cf. DEPLOY.md)
```

## Installation (déjà réalisée sur ce poste — historique pour référence / réinstallation ailleurs)

```bash
# 1. Installer les dépendances (Django doit être installé avant startproject)
python -m venv venv && source venv/Scripts/activate   # source venv/bin/activate sous Linux/Mac
pip install -r requirements.txt

# 2. Créer le projet Django s'il n'existe pas encore
django-admin startproject config .

# 3. kds_core/ doit être à la racine du projet Django (déjà le cas ici)

# 4. Fusionner settings_snippet.py dans config/settings.py
#    (INSTALLED_APPS, AUTH_USER_MODEL, DATABASES, REST_FRAMEWORK, CHANNEL_LAYERS...)
#    → déjà fait sur ce poste, config/settings.py utilise `decouple.config()` pour lire .env

# 5. Copier .env.example vers .env et ajuster si besoin

# 6. Lancer les services locaux
docker compose up -d

# 7. Générer et appliquer les migrations
python manage.py makemigrations kds_core
python manage.py migrate

# 8. Créer un superutilisateur
python manage.py createsuperuser

# 9. Lancer le serveur
python manage.py runserver
```

### Particularités de ce poste (Windows)

- **Docker Desktop nécessite WSL2.** S'il n'est pas installé : `wsl --install` dans un PowerShell **administrateur**, puis redémarrer le PC avant de relancer Docker Desktop.
- **Port Postgres 5432 déjà pris** par une installation PostgreSQL native (service Windows `postgresql-x64-17`). Le conteneur Docker du projet est donc mappé sur le port hôte **5433** (`docker-compose.yml` + `DB_PORT=5433` dans `.env`) pour ne pas entrer en conflit. Si tu déploies ce projet sur une machine sans Postgres natif, tu peux repasser `DB_PORT` à `5432` des deux côtés.
- **`.env` est chargé automatiquement** au démarrage de Django via `python-decouple` (`from decouple import config` dans `config/settings.py`). Modifier `.env` a un effet immédiat, pas besoin d'exporter des variables d'environnement manuellement.

## Frontend (`frontend/`)

React + Vite + Tailwind CSS v4 (§3.1). Premier écran construit : **Master
cuisine** (Phase 1) — tableau de tickets temps réel, connecté en
WebSocket. Node.js (LTS) installé via winget sur ce poste, comme Docker.

### Lancer le frontend

```bash
cd frontend
npm install        # déjà fait sur ce poste
npm run dev         # démarre sur http://localhost:5173
```

Nécessite le backend démarré en parallèle (`python manage.py runserver`,
port 8000) — `frontend/.env` pointe dessus (`VITE_API_BASE_URL`,
`VITE_WS_BASE_URL`). Se connecter avec un compte existant, ex.
`demo` / `demo1234` (cf. `seed_demo`).

### Bug important trouvé et corrigé en testant dans un vrai navigateur

**`daphne` manquait de `INSTALLED_APPS`.** Jusqu'ici, tout le WebSocket
avait été testé via `channels.testing.WebsocketCommunicator`, qui pilote
`config.asgi.application` directement en mémoire — **sans jamais passer
par un vrai serveur**. En conditions réelles, `manage.py runserver` sans
`daphne` dans `INSTALLED_APPS` reste sur le serveur **WSGI** classique de
Django, qui ignore silencieusement toute route WebSocket (404 sur
`/ws/kds/...`, jamais d'erreur qui l'aurait signalé plus tôt). Ce bug
existait depuis la Phase 1 sans avoir jamais été détecté — la première
vraie connexion depuis un navigateur (Playwright, cf. plus bas) l'a
immédiatement révélé. Corrigé en ajoutant `daphne` en tout premier de
`INSTALLED_APPS` (`config/settings.py`), comme l'exige la documentation
Channels 4.x.

**Leçon retenue** : les tests via `WebsocketCommunicator` (utilisés
abondamment Phases 1 à 6) valident la logique métier des consumers, mais
ne prouvent PAS que `manage.py runserver` sait effectivement servir du
WebSocket à un vrai client — les deux checks sont complémentaires, pas
substituables.

### Ce qui a aussi changé côté backend pour que l'écran Master soit utilisable

`OrderTicketSerializer` (`kds_core/serializers.py`) ne renvoyait aucun
détail des plats — un ticket sans le contenu de la commande n'est
d'aucune utilité pour un cuisinier. Ajout de deux champs :
- `lignes` — plats, quantités, commentaire libre, modificateurs (avec
  `niveau_alerte_critique` pour les allergies, mis en évidence visuelle
  forte côté écran, §5.2) ;
- `table_numero` — pour affichage direct sans jointure côté client.

### Structure du code

- `src/api.js` — client HTTP : login, stockage des tokens (`localStorage`),
  rafraîchissement automatique sur 401 (access token 5 min), `fetchMe()` /
  `fetchStations()`.
- `src/useTicketsSocket.js` — hook WebSocket : gère le `sync` initial
  (rattrapage, cf. Phase 4/backend), les événements `created`/`updated`
  (upsert, ou retrait du tableau si le ticket passe servi/annulé), la
  reconnexion automatique après coupure.
- `src/KitchenScreen.jsx` — écran cuisine **générique**, piloté par une
  prop `scopeId` (`"master"` ou l'UUID d'un poste) : c'est le même
  composant qui sert d'écran Master et d'écran poste unique, seul le
  canal WebSocket change (`ws/kds/<scopeId>/`, cf. `KDSConsumer` côté
  backend — la logique d'isolation par poste existait déjà, il ne
  manquait que l'écran pour l'exploiter).
- `src/SelectionEcran.jsx` — sélecteur (Master ou un poste précis),
  affiché uniquement si l'utilisateur connecté n'a pas de poste assigné.
- `src/App.jsx` — après connexion, appelle `GET /api/users/me/` (nouveau,
  `UserViewSet.me`) : si l'utilisateur a un `station_assignee`, routage
  **direct et verrouillé** vers l'écran de ce poste (pas de bouton
  "changer d'écran" — §6.2, un poste = un écran dédié physiquement en
  cuisine, personne ne doit avoir à choisir sur place) ; sinon (manager/
  admin), passe par `SelectionEcran`.
- `src/LoginScreen.jsx`, `src/TicketCard.jsx` — écrans/composants
  inchangés. Code couleur temporel (vert/orange/rouge) sur la bordure de
  chaque carte, anneau rouge + badge si `is_rush`, gros boutons tactiles
  (§6.2 ergonomie cuisine).

Testé de bout en bout avec Playwright dans un vrai navigateur Chromium,
trois scénarios : (1) cuisinier avec poste assigné → écran de son poste
affiché directement, sans passer par le sélecteur, bouton "changer
d'écran" absent ; (2) manager sans poste assigné → sélecteur affiché →
choix "Écran Master" → écran Master avec bouton "changer d'écran"
présent ; (3) retour au sélecteur → choix d'un poste précis (Bar) → écran
de ce poste affiché. Aucune erreur console sur les trois scénarios. Le
tout premier test (Phase 1, écran Master avec tickets réels + bump temps
réel) reste valide, `KitchenScreen` étant un remplacement direct de
l'ancien `MasterScreen` figé sur `scopeId="master"`.

### Interface client QR (`src/client/`)

Deuxième "app" dans le même projet Vite, routée sur `/t/<qr_code_token>/`
(le lien encodé dans le QR code physique de la table) — pas de
react-router : `main.jsx` fait un simple test d'URL et rend `ClientApp`
ou l'app KDS existante. Mobile-first, thème **clair** (contrairement aux
écrans cuisine, sombres) et sans authentification (accès public scopé par
le token, cf. backend `qr_views.py`).

- `client/clientApi.js` — appels aux endpoints `/api/qr/<token>/...`
  (aucun JWT). Distingue une vraie panne réseau (`ErreurReseau`, fetch qui
  échoue) d'une erreur HTTP normale, pour déclencher le bon message parmi
  les deux définis côté backend (cf. section juste au-dessus).
- `client/offlineDb.js` — file d'attente de commandes + cache menu
  (IndexedDB, §5.5 "PWA / mode hors-ligne"), cf. section Phase 5bis plus bas.
- `client/PlatCard.jsx` / `client/MenuView.jsx` — menu en **grille de
  cartes** (2 colonnes, image/placeholder, badge disponibilité, prix,
  temps de préparation, bouton "+" flottant) plutôt qu'une liste de lignes
  — redesign demandé après coup pour coller à une maquette fournie. Deux
  façons d'ajouter au panier : le bouton "+" fait un **ajout rapide**
  (quantité 1, "dès que prêt", pas de commentaire) ; taper la carte
  elle-même ouvre un modal de détail pour choisir quantité, commentaire
  libre, et surtout **le choix "Dès que prêt" / "Avec le reste"**
  (`service_immediat`) demandé explicitement — c'est ce qui active le
  Fire/Hold côté client (cf. section Phase 4 "Suivi plat par plat"). Sans
  ce modal, l'ajout rapide seul aurait fait perdre cette fonctionnalité
  déjà construite.
  `MenuItem.image_url` (backend) est optionnel : `PlatCard` retombe sur un
  placeholder 🍽️ tant qu'aucune image n'est renseignée. Les 4 plats du
  jeu de démo (`seed_demo.py`) pointent vers de vraies photos servies
  depuis `media/menu/` (upload manuel, hors `/admin/` pour l'instant) —
  d'où l'ajout de `MEDIA_URL`/`MEDIA_ROOT` dans `settings.py` et du
  `static(...)` de service en `DEBUG` dans `config/urls.py`. En
  production, ces fichiers devront être uploadés via `/admin/` (le champ
  `MenuItem.image_url` reste une simple URL, pas un `ImageField` — pas de
  changement de schéma nécessaire) et servis par un vrai stockage
  (S3/CDN) plutôt que par Django directement.
  - Le badge ⏱ temps de préparation est masqué quand
    `temps_preparation_estime_min == 0` : convention pour les boissons déjà
    prêtes (eau, jus, sodas) qui n'ont rien à "préparer", par opposition
    aux cocktails (ex: Mojito, 5 min) qui gardent un vrai temps affiché.
- `client/TrackingView.jsx` — suivi par plat (`statut_ligne`, synchronisé
  automatiquement depuis la Phase 4/5) avec polling toutes les 5s ;
  affiche le bandeau ⚠️ `message_urgence` si `cuisine_en_ligne: false`.
- `client/ClientApp.jsx` — orchestration : header avec branding tenant
  (`couleur_primaire`/`secondaire` injectées en CSS custom properties,
  §1.4), panier flottant, bouton appel serveur, écran hors-ligne dédié
  (message 1, "Connexion indisponible, Veuillez appeler un serveur")
  affiché quand `ErreurReseau` est levée n'importe où dans l'app.
  Le panier flottant affiche un **"Sous-total"** (pas "Total" : le client
  peut encore ajouter des plats tant qu'il n'a pas validé, ce n'est pas la
  somme finale de la visite) — calculé côté frontend
  (`ligne.prix × ligne.quantite`, `formatPrix` partagé avec `PlatCard.jsx`
  via `client/formatPrix.js`). Les deux chemins d'ajout au panier
  (bouton "+" rapide dans `MenuView.jsx::ajoutRapide`, et le modal détail
  `DetailPlatModal::confirmer`) doivent chacun poser `prix: plat.prix` sur
  la ligne ajoutée — c'est un champ purement d'affichage, jamais envoyé à
  `POST .../orders/create/` (`validerCommande` ne déstructure que
  `plat`/`quantite`/`service_immediat`/`commentaire_libre` avant l'envoi).

  **"Sous-total" (panier) vs "Total" (suivi) — pas le même champ, pas la
  même autorité.** Repéré par l'utilisateur : le sous-total du panier
  n'apparaît que pendant la construction de la commande (onglet Menu,
  avant validation) — une fois la commande passée, l'onglet "Ma commande"
  n'affichait toujours aucun montant. Ajouté séparément : `TrackingView.jsx`
  affiche un **"Total"** par commande déjà passée, calculé côté
  **backend** cette fois (`QrOrderStatusSerializer.get_total`, somme des
  lignes non annulées) plutôt que recalculé côté client à partir de
  `items[].prix` — une commande déjà validée a des prix figés, une seule
  source de vérité pour ce qui deviendra la note du client. Les lignes
  annulées ne comptent pas dans ce total.

**Bug trouvé et corrigé en testant visuellement** : les cartes de menu
s'affichaient avec le thème sombre des écrans cuisine au lieu du thème
clair prévu — `text-gray-900`/`bg-white` ne s'appliquaient pas du tout.
Cause : Tailwind v4 range ses utilitaires dans des `@layer`, et les
règles `body {...}` de `index.css` étaient écrites **hors** de tout
layer — en cascade CSS, une règle non-layée bat toujours une règle layée,
quelle que soit la spécificité, donc mes `body { color; background }`
codés en dur écrasaient silencieusement toutes les classes de couleur
Tailwind du projet entier (ça n'avait jamais posé problème avant que les
deux apps aient des thèmes différents, coïncidence de couleurs). Corrigé
en déplaçant ces règles dans `@layer base` et en retirant les couleurs
codées en dur (chaque écran fixe déjà son propre fond via ses classes
Tailwind, ce n'était pas nécessaire globalement).

Testé de bout en bout avec Playwright (viewport téléphone 390×844) :
menu chargé avec branding + numéro de table → ajout d'un plat "avec le
reste" et d'un plat "dès que prêt" → panier à 2 articles → commande
validée → bascule automatique sur "Ma commande" avec les 2 lignes en
"En attente" → appel serveur → confirmation affichée. Aucune erreur
console. Capture d'écran comparée avant/après le correctif CSS.

### Reste à construire (frontend)

Back-office/dashboard (Phase 6) — **fait**, cf. sections dédiées plus
bas (rapports + gestion menu/postes/utilisateurs). PWA/IndexedDB client
— **fait**, cf. section dédiée. Il ne reste que l'impression de secours
(Phase 5, nécessite une imprimante thermique physique pour tester). Côté
client QR : pas de sélection de modificateurs structurés à la commande
(le backend n'expose pas encore la liste des `Modifier` disponibles par
plat dans `QrMenuItemSerializer` — seul un commentaire libre est
disponible pour l'instant, ex. "sans oignon"). Le CRUD `Modifier`
lui-même reste sans écran dédié côté back-office (API brute/`/admin/`).

### Tableau de bord admin/manager (`src/admin/`) — onglet "Rapports"

Consomme les 5 rapports de la Phase 6 backend (`stats_views.py`), jamais
exposés côté frontend jusqu'ici — le seul moyen de les consulter était
`curl`/Postman. Accessible via un bouton **"📊 Tableau de bord"** sur
`SelectionEcran.jsx`, visible uniquement pour les rôles `manager`/`admin`
(`App.jsx` récupère `moi.role` via `/api/users/me/` et le transmet).
Un cuisinier/serveur avec un poste assigné ne voit jamais cet écran (il
est routé directement sur son poste, comme avant) ; un manager/admin sans
poste assigné passe par `SelectionEcran` et voit le bouton en plus
d'"Écran Master" et des postes.

- **Filtre de période** : 3 préréglages (Aujourd'hui = dernières 24h,
  7 et 30 derniers jours) plutôt qu'un vrai date-picker — suffisant pour
  un premier jet, cf. §5.4. Chaque preset calcule `depuis`/`jusqu_a` en
  ISO 8601 et les passe tel quel aux 5 endpoints (`api.js::fetchStats`).
- **3 stat tiles** en tête (commandes sur la période, temps de
  préparation moyen tous postes confondus, plats annulés) — calculées
  côté frontend à partir des rapports déjà chargés, pas de nouvel
  endpoint.
- **`temps-preparation` et `plats-plus-lents`** → barres horizontales
  classées (`charts/HorizontalBarChart.jsx`, réutilisé pour les deux) :
  horizontal plutôt que vertical car les libellés (noms de poste, noms de
  plat) sont de longueur variable, ça évite de faire pivoter du texte.
- **`heures-pointe`** → ligne + aire (`charts/LineChartHeures.jsx`),
  24 points fixes (0h-23h, complétés à 0 si absents des données) — une
  tendance sur un axe temporel, pas une comparaison de catégories, donc
  pas un bar chart. Seul le pic est étiqueté directement (label
  sélectif) ; le reste passe par les graduations + l'info-bulle native au
  survol de chaque point (élément `<title>` SVG).
- **`gaspillage` et `productivite-employes`** → tableaux HTML plutôt que
  des graphiques : trop de combinaisons plat×motif ou d'employés pour
  qu'un bar chart reste lisible (cf. skill dataviz, "plus de ~7 classes
  → table"). `productivite-employes` peut renvoyer 403 (endpoint
  `IsManagerOrAdmin`) même si l'écran est déjà gaté par rôle côté
  frontend (rôles pourraient diverger) — affiché comme état vide dédié
  ("Accès réservé...") plutôt que casser tout l'écran.
- **Palette** : un seul hue bleu séquentiel (`#2a78d6`, palette validée
  via `scripts/validate_palette.js` du skill dataviz) pour toutes les
  barres/lignes — chaque rapport est une série unique (une magnitude par
  catégorie), donc pas besoin de couleurs catégorielles distinctes.
- Pas de bibliothèque de graphiques ajoutée (`package.json` inchangé) :
  barres en divs Tailwind, ligne en SVG écrit à la main — le besoin
  restait simple (1 série par graphique) et n'en justifiait pas une.

**Bug trouvé en construisant cet écran (pas par un test automatisé) :
`bg-gray-900` ne générait aucune règle CSS**, alors que `text-gray-900`
(même fichier) et `bg-gray-800`/`bg-slate-900` (ailleurs dans le projet)
fonctionnaient normalement — vérifié en inspectant directement le CSS
servi par Vite (`curl .../src/index.css`), la classe `.bg-gray-900`
était absente du bundle généré malgré une occurrence littérale dans le
JSX. Cause exacte non identifiée (a priori un cas limite du scanner de
candidats de Tailwind v4/Oxide, pas un souci de configuration — aucun
`tailwind.config`/`@theme`/`.gitignore` n'exclut quoi que ce soit ici).
Contourné en utilisant `bg-slate-900` à la place (déjà utilisé et
fonctionnel ailleurs dans ce projet) plutôt que de perdre du temps à
creuser un internals Tailwind pour un remplacement à coût nul.

Testé de bout en bout : connecté en `demo`/`demo1234` (rôle manager), les
5 rapports se chargent avec des données réelles, le changement de preset
recharge tout correctement, un cuisinier (`cuisine1`, poste assigné) ne
voit jamais le bouton "Tableau de bord" (routé direct sur son poste comme
avant, aucune régression).

`AdminDashboard.jsx` est redevenu un simple conteneur à 4 onglets
(Rapports / Menu / Postes / Utilisateurs) — le contenu ci-dessus a été
extrait tel quel dans `RapportsTab.jsx` pour faire de la place aux 3
nouveaux onglets de gestion, cf. section suivante.

### Gestion menu/postes/utilisateurs (`src/admin/GestionMenu.jsx`,
`GestionPostes.jsx`, `GestionUtilisateurs.jsx`)

Jusqu'ici la seule façon de modifier le menu, les postes ou les comptes
était l'API brute ou `/admin/` (Django admin) — pas d'écran dédié malgré
des ViewSets CRUD complets depuis la Phase 0. Trois onglets, un client
CRUD générique partagé (`apiAdmin.js` — `lister`/`creer`/`modifier`/
`supprimer`, un seul endroit pour parser les erreurs DRF en message
lisible) :

- **Postes** : nom, ordre d'affichage, drapeau Expo. "Désactiver"
  (`is_active`) reste le levier normal pour un poste en service, mais
  "Supprimer" est aussi exposé — `Station` est référencée en `PROTECT`
  par `MenuCategory`/`MenuItem`/`OrderTicket`, donc la suppression réussit
  seulement pour un poste jamais utilisé (créé par erreur, par exemple).
- **Menu** : catégories puis plats (un plat a besoin d'une catégorie
  existante). Le formulaire "plat" pré-remplit le poste de préparation
  à partir de la catégorie choisie (`categorie.station`) mais reste
  modifiable — les deux champs sont indépendants dans le modèle (une
  catégorie a un poste par défaut, un plat peut en théorie s'en écarter).
  Bouton de statut cliquable directement dans le tableau
  ("Disponible"/"Rupture (86'd)") plutôt qu'un formulaire à rouvrir, pour
  correspondre au geste réel en service (86 un plat en rupture,
  vite). Suppression déjà exposée dès la première version de cet écran.
- **Utilisateurs** : identifiant, nom, rôle, email, plus un champ qui
  change selon le rôle choisi — poste assigné pour cuisinier/serveur, mot
  de passe pour manager/admin (les deux modes de connexion ne se
  recoupent pas, cf. `User.role` et §6.4). Suppression exposée (jamais
  bloquée par une FK `PROTECT` — `Order.serveur`/`caissier` et
  `TicketStatusLog.utilisateur` sont toutes en `SET_NULL`), sauf pour son
  propre compte : bouton masqué côté frontend et refusé côté backend
  (`UserViewSet.destroy`, même en contournant l'UI) pour éviter de se
  retrouver déconnecté en pleine session.

**Suppression généralisée, ajoutée après coup** ("l'admin doit avoir
l'option suppression là où cela est applicable") : postes et comptes
utilisateurs n'avaient jusqu'ici que "Désactiver", jamais de vraie
suppression. Au passage, `ProtectedDeleteMixin` (`views.py`) — appliqué à
`StationViewSet`/`MenuCategoryViewSet`/`MenuItemViewSet` — attrape
`ProtectedError` et renvoie un 400 avec un message clair au lieu de
laisser remonter une 500 non gérée ; corrige au passage le même défaut
côté catégories de menu, qui existait déjà mais était masqué côté
frontend par un message d'erreur codé en dur (`GestionMenu.jsx`,
maintenant remplacé par le vrai message renvoyé par l'API).

**Ajout backend nécessaire pour que ce dernier point fonctionne
réellement : `POST /api/users/<id>/set-pin/`.** Le PIN
(`User.pin_code`, haché) n'était exposé nulle part en écriture —
`UserSerializer` l'exclut explicitement ("jamais en clair, jamais le
hash"), et jusqu'ici la seule façon d'en fixer un était
`seed_demo.py`/`/admin/`/le shell Django. Un compte cuisinier/serveur
créé depuis ce nouvel écran de gestion aurait donc été **inutilisable en
connexion PIN** sans cette action dédiée. Valide 4 à 6 chiffres,
réservée manager/admin comme le reste des écritures.

**Durcissement de permission fait en même temps, pas demandé
explicitement mais nécessaire dès qu'une vraie UI d'écriture existe** :
`StationViewSet`/`MenuCategoryViewSet`/`ModifierViewSet`/
`MenuItemViewSet`/`UserViewSet` n'avaient jusqu'ici que `IsTenantMember`
— n'importe quel compte du tenant (y compris un cuisinier avec son JWT)
pouvait déjà modifier le menu/les postes/les comptes via l'API, le
masquage du bouton "Tableau de bord" côté frontend n'étant qu'un
confort, pas une vraie protection. Nouveau mixin `ManagerWriteMixin`
(`views.py`) : lecture ouverte à tout membre du tenant (nécessaire
ailleurs — `fetchStations` sert aussi à router un cuisinier vers son
poste au login), écriture (tout sauf GET/HEAD/OPTIONS) réservée
manager/admin via `IsManagerOrAdmin`, déjà utilisé pour
`productivite-employes` (Phase 6). `RestaurantTableViewSet` n'est pas
concerné pour l'instant (pas d'écran de gestion des tables construit
dans cette passe).

Testé de bout en bout, y compris les permissions serveur (pas seulement
le masquage frontend) : `curl` avec le JWT d'un cuisinier reçoit 403 sur
`POST /api/stations/` mais 200 sur `GET` (routage écran toujours
fonctionnel) ; `demo` (manager) crée/modifie/désactive un poste, crée un
plat puis bascule son statut en rupture puis le supprime, crée un
utilisateur `serveur` puis réinitialise son PIN via `set-pin` — chaque
étape vérifiée visible dans le tableau correspondant, aucune erreur
console. Suppression re-testée après l'ajout du bouton "Supprimer" sur
Postes/Équipe : un poste en service (`Entrées`) renvoie bien le message
"Impossible de supprimer : des données y sont encore rattachées." sans
rien casser côté écran, un poste vide créé pour le test se supprime
normalement, et le compte manager connecté (`demo`) n'affiche aucun
bouton "Supprimer" sur sa propre ligne dans Équipe. Toutes les données de
test créées pendant ces vérifications ont
été nettoyées après coup.

**Identifiant modifiable + upload de fichier local (logo, photos de
plats) — deux ajouts demandés après coup.** L'identifiant (`username`)
était verrouillé côté formulaire dès qu'on modifiait un compte existant
(`disabled={Boolean(form.id)}`, sans raison backend — le champ n'a
jamais été en lecture seule côté API) ; retiré, un manager/admin peut
maintenant le corriger.

Plus gros morceau : *"le logo peut être une image sur mon ordinateur,
les images doivent être accessibles de partout"* — jusqu'ici `Tenant.
logo_url`/`MenuItem.image_url` n'étaient que des champs URL à coller (un
lien externe déjà hébergé ailleurs), aucune vraie prise en charge de
fichier local. Les deux deviennent des `ImageField` (`logo`/`image`,
migration `0009`, Pillow déjà en dépendance) :

- **Upload multipart** : `apiFetch` ne force plus `Content-Type:
  application/json` quand le body est un `FormData` (sinon le navigateur
  n'ajoute plus lui-même le boundary multipart, requête illisible côté
  serveur) ; `apiAdmin.creer`/`modifier` transmettent un `FormData` tel
  quel au lieu de le `JSON.stringify`. Envoyé en `FormData` uniquement si
  une nouvelle photo est choisie — sinon JSON classique, pour ne pas
  écraser la photo existante au simple changement d'un autre champ.
- **URLs toujours absolues, "accessibles de partout"** : DRF construit
  automatiquement une URL absolue (`http://hôte:port/media/...`) pour un
  `ImageField` dès que `request` est dans le contexte du serializer —
  déjà le cas pour tous les ViewSets staff (fourni par défaut par
  `GenericAPIView`), mais **pas** pour les vues QR client
  (`qr_views.py`, `APIView` simples avec des serializers instanciés à la
  main) : `QrTenantBrandingSerializer`/`QrMenuCategorySerializer`/
  `QrMenuItemSerializer` étaient tous instanciés sans `context`, donc
  auraient renvoyé des chemins relatifs (`/media/logos/x.png`) inutiles
  pour un client sur un autre appareil que le serveur. Corrigé en
  propageant `context={"request": request, ...}` sur toute la chaîne
  jusqu'au serializer imbriqué (`QrMenuCategorySerializer.get_plats`).
- **Nouvel onglet "Établissement"** (`EtablissementTab.jsx`) : logo,
  nom, téléphone, adresse — jusqu'ici seulement modifiables via Django
  `/admin/` (aucun écran dédié dans le tableau de bord), ce qui a
  généré de la confusion en usage réel (*"je ne retrouve plus le menu
  pour la création de tenant"* — en réalité jamais présent dans l'app,
  seulement dans `/admin/` avec le compte superutilisateur `Admin`).
  Cet onglet couvre l'édition de l'établissement courant ; la création
  d'un tout nouveau tenant (onboarding multi-établissement) reste
  volontairement un processus à part, via `/admin/`.

Testé de bout en bout (Playwright, vrai fichier PNG généré localement) :
upload du logo depuis l'onglet Établissement → `GET /api/tenant/`
renvoie bien une URL absolue (`http://localhost:8000/media/logos/...`),
servie 200 `image/png`, et visible dans l'en-tête de la facture/du reçu
de caisse (aperçu HTML, §5.5) sans rien recharger. Upload d'une photo de
plat depuis l'écran Menu → miniature visible immédiatement dans le
tableau, sans casser l'édition des autres champs (prix modifié sans
photo re-choisie → photo existante conservée).

### Connexion PIN cuisine — écran manquant, jamais utilisable jusqu'ici

**Bug critique trouvé en usage réel : `cuisine1` (et tout nouveau compte
cuisinier/serveur créé depuis "Équipe") ne pouvait pas se connecter du
tout.** Cause : `/api/auth/pin-login/` et `/api/kiosk/staff/` existent
côté backend depuis la Phase 0 (§6.4), mais `LoginScreen.jsx` n'a
**jamais eu qu'un formulaire identifiant/mot de passe** — aucun écran
n'appelait ces deux endpoints. Un compte cuisinier/serveur a
`set_unusable_password()` (pas de mot de passe réel, PIN only, cf.
`seed_demo.py`/`UserSerializer.create`) : il n'y avait donc littéralement
aucun moyen de le connecter depuis l'app, quel que soit le PIN configuré.

Corrigé en ajoutant le mode manquant à `LoginScreen.jsx` — deux onglets,
**Manager** (formulaire existant, inchangé) et **Cuisine (PIN)** :
sélection tactile du personnel (`SelecteurPersonnel`, cartes avatar +
nom + rôle, alimenté par `fetchKioskStaff()`) puis pavé numérique
(`PaveNumerique`, 4 à 6 chiffres, points de progression) qui appelle le
nouveau `loginPin()` (`api.js`). `fetchKioskStaff()` a besoin du slug du
tenant (`?tenant=<slug>` — endpoint public mais scopé, cf.
`KioskStaffListView`) : nouvelle variable `VITE_TENANT_SLUG` dans
`.env`, un tablette cuisine étant provisionnée pour un seul
établissement (pas de sélecteur de tenant à l'écran).

Testé de bout en bout : `cuisine1` se connecte par PIN et atterrit
directement sur son poste assigné (comportement `station_assignee`
inchangé) ; un compte `serveur` fraîchement créé via "Équipe", PIN fixé
via "Réinitialiser PIN", se connecte aussi du premier coup et atterrit
sur l'écran de sélection (pas de poste assigné).

### Refonte visuelle du tableau de bord — "trop plat, pas design"

Retour direct de l'utilisateur après la première version (onglets
horizontaux plats, cartes grises uniformes) : voulait quelque chose de
"professionnel, glamour, classe". Refonte sans changer l'architecture
(toujours 4 écrans + le kit CRUD `apiAdmin.js`), portée entièrement par
le layout et les à-plats de couleur :

- **`AdminDashboard.jsx`** passe d'onglets horizontaux à une **sidebar**
  façon SaaS premium (dégradé ardoise `slate-950 → slate-900`, icônes +
  sous-titre par section, item actif surligné avec un anneau ambre) —
  réutilise l'identité déjà posée par l'écran de connexion et les écrans
  cuisine (fond ardoise + accent ambre) plutôt que d'inventer une
  troisième palette pour le back-office.
- **`StatTile.jsx`** : badge circulaire en dégradé (icône) en coin de
  carte, valeur en `text-3xl font-bold`, `ring-1 ring-gray-100` +
  `hover:shadow-md` plutôt qu'un simple `shadow-sm` statique.
- **Nouveau kit partagé `src/admin/ui.jsx`** (`Carte`, `BoutonPrimaire`/
  `BoutonSecondaire`/`BoutonLien`, `Badge`, `Champ`, `Table`/`Ligne`,
  `classeInput`) : les 3 écrans de gestion réécrits pour le consommer,
  au lieu de trois versions légèrement divergentes du même
  formulaire/tableau. Tables avec en-tête `uppercase tracking-wide`,
  lignes à survol ambre pâle ; inputs avec focus ring ambre (cohérent
  avec l'accent de la sidebar) plutôt que le focus gris par défaut du
  navigateur.
- Icônes emoji partout (postes, catégories, plats, avatars d'équipe en
  dégradé ambre) — même convention que le reste de l'app (🔔, 🆕, 🔥...),
  pas de bibliothèque d'icônes ajoutée.
- Les graphiques (`HorizontalBarChart`/`LineChartHeures`) et leur hue
  bleu séquentiel n'ont volontairement **pas** été retouchés : c'est un
  choix posé par le skill dataviz (une seule série par graphique, la
  couleur porte la magnitude, pas l'identité de marque) — le glamour se
  joue dans le chrome (sidebar, cartes, boutons), pas dans la donnée.

**Bug trouvé en construisant le premier jet du tableau de bord (pas par
un test automatisé) : le libellé d'une stat tile pouvait chevaucher son
icône** quand le texte était un peu long ("Temps de préparation moyen
(tous postes)") — repéré sur capture d'écran, pas par un test qui ne
vérifie que la présence du texte. Corrigé avec un `padding-right` sur le
label pour réserver la place du badge circulaire.

Testé de bout en bout après la refonte : les 4 écrans capturés en
plein écran, aucune erreur console, et le cycle CRUD complet (créer/
modifier/désactiver un poste) rejoué avec succès pour confirmer que le
changement visuel n'a rien cassé fonctionnellement.

### Compte "Admin" avec des rapports vides — superutilisateur Django sans tenant

**Signalé par l'utilisateur : "le compte Admin est censé avoir plus de
privilèges que Manager" mais le tableau de bord affichait des rapports
vides et un bandeau d'erreur.** Diagnostic : `Admin` (`id=1`) est le
superutilisateur Django créé très tôt (Phase 0) pour l'accès `/admin/`
(`is_staff=True`, `is_superuser=True`) — mais `createsuperuser` ne
touche jamais aux champs custom du modèle `User` : son `role` était
resté à la valeur par défaut (`serveur`) et surtout **son `tenant` était
`None`**. Confirmé en testant directement les classes de permission
(`IsTenantMember().has_permission(...)` → `False` pour ce compte) : sans
tenant, l'API tenant-scopée rejette (quasiment) tout, quel que soit le
rôle — le statut `is_superuser` Django ne contourne aucune permission
DRF custom, ce sont deux systèmes d'autorisation totalement séparés.
Reproduit à l'identique côté "ça marche" avec un compte `role=admin`
créé proprement depuis l'écran "Équipe" (tenant hérité automatiquement
du manager qui le crée) : rapports OK, aucune erreur — confirme que le
souci était spécifique à ce compte-là, pas un bug du tableau de bord.

Corrigé en rattachant `Admin` au tenant `demo-restaurant` et en passant
son `role` à `admin` (garde son accès `/admin/` Django intact, devient
en plus utilisable normalement dans l'app avec son mot de passe actuel).
Vérifié après coup : `IsTenantMember`/`IsManagerOrAdmin` passent tous
les deux, `GET /api/stats/temps-preparation/` et
`/api/stats/productivite-employes/` (réservé manager/admin) renvoient
de vraies données pour ce compte.

### Utilisateur connecté affiché dans la sidebar

Demandé explicitement : savoir quel compte est connecté sans devoir se
souvenir de qui s'est logué en dernier sur la machine partagée.
`App.jsx` conserve désormais l'objet utilisateur complet (`/api/users/me/`,
pas seulement son `role` comme avant) et le transmet à
`AdminDashboard.jsx`, qui affiche un petit chip (avatar dégradé ambre +
nom + rôle + identifiant) juste au-dessus de "Changer d'écran" /
"Déconnexion" dans la sidebar.

## Points d'attention pour la suite du développement

- **AUTH_USER_MODEL** doit être configuré **avant** la toute première migration.
  Si un projet Django existe déjà avec des migrations sur `auth.User`, il
  faudra repartir d'une base propre ou faire une migration de données dédiée.
- **Isolation multi-tenant** : `TenantScopedModel` impose un champ `tenant` sur
  chaque modèle métier, mais ne filtre pas automatiquement les querysets.
  Prévoir un middleware ou un mixin de ViewSet DRF qui filtre systématiquement
  par `request.user.tenant` (ou par sous-domaine/en-tête selon la stratégie
  retenue).
- **`Station` et `Modifier`** doivent être créés en même temps que le premier
  `Tenant` (onboarding). Prévoir un script/fixture de données de démonstration.

## Phase 0 — Socle (fait)

> Numérotation alignée sur le *Cahier des charges — Application KDS* §7
> (Phase 0 : "Structure backend Django multi-tenant, modèle de données de
> base, authentification JWT + PIN" → livrable "API fonctionnelle avec
> gestion des tenants"). Ce qu'on appelait "Phase 1" dans une itération
> précédente de ce README correspond en réalité à la fin de cette Phase 0.

- **Serializers DRF** pour tous les modèles (`kds_core/serializers.py`).
  Base commune `TenantScopedSerializer` : toute relation (FK/M2M) vers un
  modèle rattaché à un tenant est automatiquement restreinte au tenant de
  l'utilisateur courant — impossible de référencer par ID la ressource
  d'un autre établissement, même en le devinant. Le champ `tenant` est
  toujours en lecture seule côté API (jamais fourni par le client).
- **ViewSets + router DRF** (`kds_core/views.py`, `kds_core/urls.py`),
  montés sous `/api/`. Isolation tenant centralisée dans un mixin unique,
  `TenantScopedViewSetMixin` (`get_queryset` filtré + `perform_create` qui
  injecte le tenant), appliqué à chaque ViewSet plutôt que répété partout.
  Permission `IsTenantMember` (`kds_core/permissions.py`) : un utilisateur
  authentifié mais sans tenant (ex. superuser `/admin/`) reçoit un 403
  explicite plutôt qu'une liste vide silencieuse.
  `TenantViewSet` est en lecture/mise à jour seule (pas de create/delete
  via l'API — l'onboarding d'un tenant est un processus à part) et ne
  retourne jamais que l'établissement de l'utilisateur courant.
  `TicketStatusLogViewSet` est en lecture seule (le journal sera alimenté
  par un signal, cf. Phase 2 point 6 ci-dessous).
- **Auth JWT** via `djangorestframework-simplejwt` :
  `POST /api/auth/login/` (username + password → `access` + `refresh`),
  `POST /api/auth/refresh/`. Durée de vie par défaut : 5 min (access) /
  1 jour (refresh) — à ajuster via `SIMPLE_JWT` dans `settings.py` si besoin.
- **Auth PIN** (cf. §6.4 "connexion rapide écran cuisine") via
  `kds_core/auth_views.py` :
  `GET /api/kiosk/staff/?tenant=<slug>&station=<uuid optionnel>` — liste
  publique (sans authentification, comme le menu QR client) des noms/rôles
  du personnel d'un tenant pour l'écran de sélection tactile ("qui es-tu ?"),
  sans aucune donnée sensible (pas d'email, pas de PIN).
  `POST /api/auth/pin-login/` (`username` + `pin` → mêmes tokens JWT que le
  login classique) — alternative au username/password pour les rôles
  cuisinier/serveur.
- **Jeu de données de démo**, idempotent : `python manage.py seed_demo`
  crée un tenant « Restaurant Démo », 5 stations (Entrées, Plats,
  Desserts, Boissons, Expo), 4 catégories façon carte de restaurant
  (Entrées, Plats, Desserts, Boissons — 2 plats chacune), 3 tables, un
  manager `demo` / `demo1234` (login classique) et un cuisinier
  `cuisine1` / PIN `1234` (login PIN, assigné au poste Plats).
  **Un poste cuisine correspond 1:1 à une catégorie de la carte** — Expo
  reste à part, ce n'est pas une catégorie mais un écran de contrôle
  final. Avant ça, la carte (Entrées/Plats/Desserts/Boissons) partageait
  seulement 3 postes physiques nommés d'après le matériel (Grill, Bar,
  Froid — "Froid" préparait à la fois Entrées et Desserts) : un nom de
  poste comme "Grill" n'avait plus de sens dès que la carte a dépassé les
  grillades, donc `seed_demo._migrer_anciens_postes` renomme ces postes
  en place (préserve les FK existantes : `station_assignee` du
  cuisinier, `MenuItem.station`...) et sépare "Froid" en deux postes
  dédiés Entrées/Desserts. Idempotent, ne s'exécute qu'une fois. La
  catégorie "Grillades" d'origine (avant l'élargissement de la carte) est
  migrée de la même façon vers "Plats".

### Endpoints disponibles

```
POST /api/auth/login/            { "username": "demo", "password": "demo1234" }
POST /api/auth/refresh/          { "refresh": "<token>" }
POST /api/auth/pin-login/        { "username": "cuisine1", "pin": "1234" }
GET  /api/kiosk/staff/?tenant=demo-restaurant     (public, sélecteur PIN)

/api/tenant/                     (lecture + update, tenant courant uniquement)
/api/stations/                            expose est_en_ligne (bool, présence temps réel)
/api/stations/<id>/aggregation/           GET   regroupement d'ingrédients à préparer (§5.2)
/api/stations/<id>/reassigner/            POST  redondance écran : réaffecte les tickets actifs
/api/menu-categories/
/api/modifiers/
/api/menu-items/
/api/tables/
/api/tables/<id>/liberer/                 POST  libération manuelle de secours (staff)
/api/users/
/api/orders/                              statut_paiement/mode_paiement modifiables (PATCH, staff)
/api/orders/<id>/add-items/               POST  routage automatique multi-poste (§5.1)
/api/orders/<id>/cancel/                  POST  annule la commande + cascade tickets/lignes actifs
/api/order-tickets/
/api/order-tickets/<id>/fire/             POST  libère un ticket retenu (Fire/Hold)
/api/order-tickets/<id>/bump/             POST  avance au statut suivant
/api/order-tickets/<id>/toggle-rush/      POST  marque/démarque en urgence
/api/order-items/
/api/order-items/<id>/split/              POST  isole une ligne dans un nouveau ticket
/api/ticket-status-logs/         (lecture seule)
/api/pos-integrations/                    staff (JWT) — gestion des clés API POS

ws://.../ws/kds/<station_uuid>/?token=<access>   écran poste (temps réel)
ws://.../ws/kds/master/?token=<access>           écran Master/Expéditeur (temps réel)

POST /api/pos/orders/            Authorization: Api-Key <id>.<secret>   commande entrante POS (§5.5)
POST /api/pos/orders/pay/        Authorization: Api-Key <id>.<secret>   notification de paiement (§5.5)
POST /api/pos/orders/cancel/     Authorization: Api-Key <id>.<secret>   notification d'annulation (§5.5)

GET  /api/qr/<qr_code_token>/menu/                 public — menu digital (§5.6)
POST /api/qr/<qr_code_token>/orders/create/        public — prise de commande client (items[].service_immediat: bool)
GET  /api/qr/<qr_code_token>/orders/               public — suivi de commande (visite en cours)
POST /api/qr/<qr_code_token>/appel-serveur/        public — bouton d'appel serveur
```

### Tester le flux complet Order → OrderTicket → OrderItem

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"demo1234"}' | python -c "import sys,json;print(json.load(sys.stdin)['access'])")

# 2. Récupérer une table et une station (ou lister /api/tables/, /api/stations/)
# 3. Créer une commande
curl -X POST http://127.0.0.1:8000/api/orders/ \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"table": "<uuid_table>", "source": "salle"}'

# 4. Créer un ticket pour une station, rattaché à cette commande
curl -X POST http://127.0.0.1:8000/api/order-tickets/ \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"order": "<uuid_order>", "station": "<uuid_station>"}'

# 5. Ajouter une ligne de commande (plat + quantité) sur ce ticket
curl -X POST http://127.0.0.1:8000/api/order-items/ \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ticket": "<uuid_ticket>", "plat": "<uuid_plat>", "quantite": 2}'
```

Isolation vérifiée manuellement : un utilisateur d'un autre tenant reçoit
une liste vide, un 404 sur accès direct par ID, et un 400 s'il tente de
référencer une ressource d'un tenant qui n'est pas le sien via une clé
étrangère (`order`, `station`, `ticket`, `plat`...).

## Roadmap (cf. cahier des charges §7)

| Phase | Contenu | Statut |
|---|---|---|
| **0 — Socle** | Backend Django multi-tenant, modèle de données, JWT + PIN | ✅ fait |
| **1 — KDS cœur** | Écrans Master + poste unique, routage simple, statuts, WebSocket temps réel | ✅ fait (backend + écran Master + écran poste unique) |
| **2 — Multi-poste & routage avancé** | Multi-postes, regroupement d'ingrédients, code couleur temporel, Fire/Hold, rush | ✅ backend fait |
| **3 — Intégration caisse** | API sync POS, commandes entrantes, alertes serveur | ✅ backend fait |
| **4 — QR Code client** | Menu digital, commande client, appel serveur, suivi commande | ✅ fait (backend + interface client) |
| **5 — Offline & résilience** | PWA, IndexedDB, réconciliation, impression de secours, redondance écran | ✅ fait (réconciliation cuisine, redondance écran, PWA/IndexedDB client, impression de secours + caisse via aperçu HTML/dialogue d'impression navigateur — marche avec n'importe quelle imprimante installée sur le poste) |
| **6 — Statistiques & admin** | Dashboard, rapports, back-office thème/logo/couleurs | ✅ fait (backend + tableau de bord frontend : rapports + gestion menu/postes/utilisateurs) |
| 7 — Omnicanal (V2) | Yango Food, Glovo, paiement QR | à venir |

### Phase 1 — WebSocket temps réel (backend, fait)

Décision : **Django Channels** plutôt que Socket.io/Node (cf. §3.1) — déjà
câblé depuis la Phase 0 (`channels`, `channels-redis`, `daphne`,
`CHANNEL_LAYERS`), un seul processus à héberger, même besoin fonctionnel
satisfait (§5.3). Le frontend (écrans React Master/poste) est traité comme
une étape séparée, non commencée.

- **`kds_core/consumers.py`** — `KDSConsumer`, un canal par écran :
  `ws://.../ws/kds/<scope_id>/` où `<scope_id>` est l'UUID d'une `Station`
  (écran poste, ne reçoit que les tickets de CE poste) ou le mot-clé
  `master` (écran Master/Expéditeur, reçoit tous les tickets du tenant,
  tous postes confondus). Connexion refusée (code `4401`) si non
  authentifié ou sans tenant — même garde-fou que le reste de l'API.
- **`kds_core/channels_auth.py`** — `JWTAuthMiddleware` : authentifie le
  handshake WebSocket via `?token=<access_token>` en query string (un
  navigateur ne peut pas fixer de header `Authorization` sur un WebSocket
  natif).
- **`kds_core/signals.py`** — sur tout `post_save` d'`OrderTicket` :
  1) alimente automatiquement `TicketStatusLog` (ancien/nouveau statut,
  utilisateur courant) si le statut a changé ou à la création ;
  2) diffuse un événement `{"event": "created"|"updated", "ticket": {...}}`
  aux groupes `kds_{tenant_id}_{station_id}` **et** `kds_{tenant_id}_master`
  simultanément, pour que l'écran poste ET l'écran Master soient notifiés.
- **`kds_core/middleware.py`** — `CurrentUserMiddleware` : rend
  `request.user` accessible depuis le signal (exécuté hors du cycle
  requête/vue) via un thread-local, sans avoir à le faire suivre
  explicitement à travers chaque ViewSet.

Testé de bout en bout via `channels.testing.WebsocketCommunicator` (écran
poste + écran master connectés, connexion anonyme refusée, réception des
événements `created`/`updated` sur les deux canaux) et via de vraies
requêtes HTTP authentifiées (l'utilisateur qui modifie un ticket apparaît
bien comme `utilisateur` dans les entrées `TicketStatusLog` générées).

#### Rattrapage à la (re)connexion (§6.5 "sans perte de commande")

Scénario identifié en Phase 4 : la connexion internet du **restaurant**
tombe (routeur, panne FAI) — mais un client peut très bien passer commande
via **sa propre 4G**, qui atteint sans problème l'API cloud. La commande
est bien enregistrée, mais l'écran cuisine, lui, est déconnecté du
WebSocket : sans rattrapage, il ne l'aurait jamais vue, même une fois le
réseau du restaurant rétabli (le canal ne pousse que les événements
*futurs*, pas ce qui s'est passé pendant la coupure).

Correctif dans `KDSConsumer.connect()` : à **chaque** connexion (la
première comme une reconnexion), l'écran reçoit d'abord un instantané
(`{"event": "sync", "tickets": [...]}`) de tous les tickets actuellement
actifs de son périmètre (poste ou tout le tenant pour `master`), avant de
continuer à écouter le flux en direct. Les tickets retenus (Hold) et déjà
`servi`/`annulé` sont exclus, comme pour la diffusion normale.

Confirmation client vs confirmation cuisine — deux mécanismes distincts :
- **Client** : la réponse HTTP `201` de `POST /api/qr/<token>/orders/create/`
  *est* la confirmation, obtenue indépendamment de l'état du réseau du
  restaurant (le client parle au cloud, pas au réseau local).
- **Cuisine** : désormais garantie par ce rattrapage — que l'écran ait raté
  l'événement en direct ou qu'il vienne tout juste de se reconnecter après
  une panne, il voit l'état réel en base au plus tard à sa prochaine
  connexion.

Testé de bout en bout, scénario complet : écran connecté → déconnexion
(panne simulée) → commande créée pendant la coupure → reconnexion → le
ticket apparaît immédiatement dans l'instantané de rattrapage.

Ce qui reste explicitement à la Phase 5 (§5.5, "point critique à spécifier
avant développement") : le mode dégradé côté **client** lui-même (PWA,
IndexedDB, file d'attente de synchronisation si le client n'a lui-même
aucune connexion), l'impression de secours, et la redondance d'écran en
cas de panne matérielle d'un poste.

**Reste pour clore la Phase 1** : les écrans Master + poste unique côté
frontend (React/Vite/Tailwind, §3.1) — non commencés.

### Phase 2 — Multi-poste & routage avancé (backend, fait)

- **Routage intelligent (§5.1)** — `POST /api/orders/<id>/add-items/` avec
  `{"items": [{"plat": "<uuid>", "quantite": 2, "modificateurs": [...], "commentaire_libre": "..."}]}` :
  chaque ligne est routée automatiquement vers le ticket du poste concerné
  d'après `MenuItem.station`, sans que le client ait besoin de connaître ni
  choisir le poste. Un ticket déjà actif (pas encore `servi`) pour ce poste
  sur cette commande est réutilisé plutôt que d'en recréer un. C'est
  désormais la façon recommandée d'ajouter des lignes à une commande (la
  création manuelle `OrderTicket`/`OrderItem` en 2 appels séparés, utilisée
  en Phase 0, reste disponible pour les cas particuliers).
- **Regroupement d'ingrédients (§5.2)** —
  `GET /api/stations/<id>/aggregation/` : vue agrégée de tous les plats
  identiques encore à préparer sur ce poste, toutes commandes confondues
  (`[{"plat": ..., "plat_nom": ..., "quantite_totale": 6, "nb_lignes": 3}]`),
  utile en heure de pointe pour préparer par lot.
- **Code couleur temporel (§5.1)** — propriété `code_couleur` sur
  `OrderTicket` (`vert`/`orange`/`rouge`/`null`), exposée en lecture seule
  dans `OrderTicketSerializer`. Calculée à partir de
  `Tenant.seuil_orange_minutes` / `seuil_rouge_minutes` et du temps écoulé
  depuis `heure_envoi_poste` ; `null` tant que le ticket n'a pas été
  envoyé (Hold) ou une fois servi.
- **Fire / Hold (§5.1)** — `is_held=true` à la création (directe ou via
  `add-items`) retient le ticket : pas d'horodatage `heure_envoi_poste`,
  et **rien n'est diffusé sur les WebSocket** tant qu'il n'a pas été libéré
  (ni écran poste, ni Master). `POST /api/order-tickets/<id>/fire/` le
  libère : il devient visible partout, traité comme un événement `created`
  côté WebSocket même si c'est techniquement une mise à jour en base.
- **Priorité / Rush (§5.1)** — `POST /api/order-tickets/<id>/toggle-rush/`,
  raccourci "un tap" en plus du `PATCH is_rush` classique.
- **Statuts en un tap (§5.3)** — `POST /api/order-tickets/<id>/bump/` fait
  avancer le ticket au statut suivant (en attente → en préparation → prêt
  → servi) et horodate automatiquement le champ correspondant
  (`heure_debut_preparation`/`heure_pret`/`heure_servi`) — cet horodatage
  est en fait posé par un signal `pre_save` sur `OrderTicket`, donc il reste
  cohérent quel que soit le chemin utilisé pour changer le statut (`bump`,
  `PATCH` direct, `/admin/`...), pas seulement via l'action `bump`.
- **Split ticket (§5.1)** — `POST /api/order-items/<id>/split/` sort une
  ligne de son ticket pour la placer seule dans un nouveau ticket (même
  commande, même poste) — pour la renvoyer en préparation indépendamment
  sans dupliquer tout le reste (ex : un plat retourné).
- **Passage automatique du statut `Order`** (item roadmap §5.1, backlog
  Phase 1 précédemment) — `kds_core/signals.py` recalcule `Order.statut`
  après chaque changement de ticket : `prête` quand tous les tickets sont
  prêts (ou servis), `servie` quand tous sont servis, `en_préparation` dès
  qu'un poste a commencé. Une commande `annulée` n'est jamais réécrite.

**Écran Expo (§5.1)** n'a pas de logique dédiée séparée : un poste avec
`Station.is_expo=True` est un poste comme un autre côté API — son écran se
connecte simplement au canal `master` (déjà diffusé à tous les postes du
tenant) ou à son propre canal de poste selon l'usage voulu. Aucune règle
métier supplémentaire n'était nécessaire côté backend pour ce point.

Testé de bout en bout via curl (routage multi-poste, réutilisation de
ticket actif, bump avec horodatage et propagation du statut de commande,
rejet du bump sur ticket déjà servi, Fire/Hold avec vérification explicite
qu'aucun événement n'est diffusé pendant le Hold, agrégation, split).

### Phase 3 — Intégration caisse (backend, fait)

Un logiciel de caisse (POS) n'est pas un membre du personnel : il
s'authentifie par **clé API**, pas par JWT/PIN — nouveau mécanisme
d'authentification dédié, séparé du reste de l'API.

- **`kds_core/models/integrations.py`** — `PosIntegration` (tenant-scopé) :
  `label`, `webhook_url`, `is_active`, et `secret_hash` (jamais exposé,
  même principe que `User.pin_code`).
- **`kds_core/pos_auth.py`** — `PosApiKeyAuthentication` : authentifie via
  `Authorization: Api-Key <id>.<secret>` (`id` = UUID de la
  `PosIntegration`, pour un lookup direct en base plutôt qu'un scan de
  toutes les clés existantes ; `secret` vérifié par hachage). Renvoie un
  `PosPrincipal` — un objet léger imitant `request.user` (`.tenant`,
  `.tenant_id`, `.is_authenticated`) sans être un vrai `kds_core.User`,
  pour que `TenantScopedViewSetMixin`/`TenantScopedFieldsMixin`
  fonctionnent tels quels avec ce type de requête.
- **`POST /api/pos-integrations/`** (staff, JWT) — crée une clé ; la
  réponse ne contient le secret en clair (`api_key`) qu'**une seule fois**,
  à la création (même principe que les tokens Stripe/GitHub).
- **`POST /api/pos/orders/`** (clé API) — création d'une commande **en un
  seul appel** (`reference_externe`, `table_numero`, `items: [...]`),
  réutilisant `kds_core/services.py::route_items_to_tickets` — le même
  routage intelligent que `OrderViewSet.add_items` côté staff, pour ne pas
  dupliquer cette logique entre les deux points d'entrée.
- **`kds_core/pos_webhooks.py`** — remontée du statut vers la caisse
  (§5.5 "le statut prêt remonte en caisse") : quand `Order.statut` passe à
  `prête` ou `servie` (calculé par le même signal qu'en Phase 2), un
  `POST` JSON est envoyé à `PosIntegration.webhook_url` pour chaque
  intégration active du tenant. Envoi **synchrone et best-effort** : une
  caisse injoignable ne fait jamais échouer la requête d'origine (juste un
  `logger.warning`). **Limite connue** : pas de file d'attente ni de retry
  — aucune tâche asynchrone (Celery ou équivalent) n'est en place dans ce
  projet ; à revisiter si le volume ou la fiabilité l'exigent.

**Un bug trouvé en testant** : `get_current_user()` (middleware Phase 1)
renvoyait n'importe quel principal authentifié, y compris un `PosPrincipal`
— assigné à `TicketStatusLog.utilisateur` (`ForeignKey(User)`), ça levait
une `ValueError` sur toute commande créée via `/api/pos/orders/`. Corrigé
en restreignant `get_current_user()` aux instances réelles de
`kds_core.User` (`kds_core/middleware.py`).

Testé de bout en bout : mauvaise clé API (401), clé malformée sans lever
d'erreur 500, création de commande POS valide avec résolution de table par
numéro, puis bump jusqu'à "prêt" via l'API staff normale déclenchant
automatiquement le webhook — vérifié avec un récepteur HTTP local
recevant effectivement le payload attendu.

**Alertes serveur / pocket serveur (§5.5)** : pas de nouveau code
nécessaire — le "pocket serveur" est une interface web dédiée pour le
personnel de salle, qui se connecte comme n'importe quel écran Master
(`ws/kds/master/`, JWT) déjà construit en Phase 1 pour être notifié dès
qu'un ticket passe "prêt".

### Statut de paiement & libération automatique de table

Deux trous comblés dans le modèle, devenus bloquants pour la synchro POS :
`Order.Statut` (suivi préparation : nouvelle/en préparation/prête/servie)
ne disait rien du paiement, et rien ne libérait `RestaurantTable` après
service. Le paiement QR direct restant hors périmètre V1 (§2.3), la caisse
existante du restaurant reste la seule source de vérité de cette info —
pas de vraie transaction ici, juste un statut qu'elle nous notifie.

- **`Order.statut_paiement`** (`kds_core/models/orders.py`) —
  `en_attente` / `payee` / `annulee`, **indépendant** de `Order.statut`
  (préparation) : une commande peut être `servie` et pas encore payée, ou
  l'inverse (paiement d'avance). Plus `mode_paiement` (especes/mobile_money/
  carte/autre, pour les stats futures) et `heure_paiement` — auto-horodaté
  par un signal `pre_save` dès la première transition vers `payee` (même
  principe que les horodatages `OrderTicket` de la Phase 2 : cohérent quel
  que soit le chemin de modification, pas seulement l'endpoint dédié).
- **`POST /api/pos/orders/pay/`** (clé API) — la caisse notifie un
  paiement, en identifiant la commande par `order` (UUID renvoyé à la
  création) **ou** `reference_externe` (si la caisse n'a conservé que sa
  propre référence). 404 si introuvable dans le tenant de la clé API
  utilisée (même isolation stricte que le reste de l'API — testé
  explicitement : la clé d'un autre tenant ne peut ni payer une commande
  par UUID ni la retrouver par `reference_externe`).
- **Staff (JWT)** peut aussi marquer un paiement manuellement : `statut_paiement`
  et `mode_paiement` sont des champs normaux, modifiables via
  `PATCH /api/orders/<id>/` (`heure_paiement` reste toujours en lecture
  seule, auto-horodaté).
- **Libération automatique de la table** (`kds_core/signals.py::_liberer_table_si_tout_paye`,
  post_save sur `Order`) — dès qu'une commande passe à `payee`, la table
  associée repasse `libre`, **mais seulement si TOUTES ses commandes
  actives** (hors `annulée`) **sont elles aussi payées** — gère le cas de
  plusieurs commandes successives sur une même visite sans libérer trop tôt.
  Testé explicitement : payer une 1ère commande sur une table à 2 commandes
  ne la libère pas, payer la 2ème la libère.
- **`POST /api/tables/<id>/liberer/`** (staff, JWT) — libération manuelle
  de secours, indépendante du paiement, pour les cas où la caisse ne
  notifie pas correctement (panne, oubli) — sans ça une commande mal
  synchronisée bloquerait la table indéfiniment.

### Annulation de commande côté caisse

Dernier trou de la boucle "commande → cuisine → caisse" : rien ne notifiait
la cuisine si la caisse annulait une commande (client parti, erreur de
saisie) — les tickets déjà envoyés seraient restés actifs sans que la
cuisine sache s'arrêter. Ajout d'un statut `annulé` à `OrderTicket.Statut`
(absent jusqu'ici — migration `0004`) pour que l'annulation soit un
événement de premier ordre, visible sur les écrans comme n'importe quel
changement de statut.

- **`kds_core/services.py::cancel_order`** — service partagé (staff et
  POS) : passe `Order.statut` à `annulée`, puis cascade sur les tickets
  encore actifs (jamais un ticket déjà `servi` — le plat est en salle,
  trop tard) : `OrderTicket.statut = annulé` (déclenche le signal
  existant → log `TicketStatusLog` + diffusion WebSocket immédiate aux
  écrans concernés, exactement comme un `bump`) et
  `OrderItem.statut_ligne = annulé` avec `motif_annulation` (le champ
  existait déjà dans le modèle, pensé pour ça — alimente le futur suivi
  gaspillage/annulations, §5.4). Idempotent : annuler une commande déjà
  annulée ne fait rien.
- **`POST /api/pos/orders/cancel/`** (clé API) et
  **`POST /api/orders/<id>/cancel/`** (staff, JWT) — même service, deux
  points d'entrée symétriques à `pay`/`add-items`. Identification par
  `order` ou `reference_externe`, comme `/pay/` (factorisé dans
  `PosOrderLookupSerializer`, base commune aux deux serializers).
- **Effet de bord déjà correct sans rien changer** : `_sync_order_statut`
  ignore désormais les tickets `annulé` dans son calcul du statut agrégé
  (sinon un ticket servi + un annulé aurait fait redescendre la commande à
  "en préparation" au lieu de la considérer traitée — bug trouvé et
  corrigé en même temps que l'ajout du statut) ; et la libération de table
  excluait déjà les commandes `annulée` de son calcul "toutes payées"
  depuis le point précédent, donc rien à changer là.

Testé de bout en bout : commande à 2 tickets (un poussé jusqu'à `servi`,
l'autre laissé actif) → annulation → le ticket servi reste intact, l'actif
passe `annulé` avec ses lignes marquées et motivées, réannulation
idempotente (200, pas d'erreur), 400 sans identifiant, 404 si introuvable,
isolation cross-tenant vérifiée (la clé d'un autre tenant ne peut pas
annuler une commande qui n'est pas la sienne).

### Phase 4 — QR code client (backend, fait)

Accès **public** (`AllowAny`), scopé par `RestaurantTable.qr_code_token` —
même modèle de confiance que `KioskStaffListView` (Phase 0) : pas de
compte client, le token imprimé sur la table (carton, sticker) fait office
de périmètre de confiance. Fichiers : `kds_core/qr_views.py`, section
dédiée dans `kds_core/serializers.py`.

- **`GET /api/qr/<token>/menu/`** — menu digital (§5.6) : config marque
  blanche du tenant (logo, couleurs, devise, langue — §1.4) + catégories +
  plats. Un plat en rupture ("86'd", `statut=rupture`) ou inactif disparaît
  automatiquement, comme en caisse (§5.2). Filtres optionnels en query
  params : `?exclure_allergene=arachide` (répétable), `?regime=vegetarien`
  — s'appuient sur les champs `MenuItem.allergenes`/`regimes` déjà présents
  depuis la Phase 0, aucun nouveau champ nécessaire.
- **`POST /api/qr/<token>/orders/create/`** — prise de commande (§5.6),
  réutilise `services.route_items_to_tickets` (même routage intelligent
  que staff/POS). Marque la table `occupée` si elle était `libre` — ferme
  la boucle avec la libération automatique au paiement complet (Phase 3) :
  `libre` → (commande QR) → `occupée` → (tout payé) → `libre`.
- **`GET /api/qr/<token>/orders/`** — suivi de commande (§5.6, "reçue →
  en préparation → prête"), par polling (pas de WebSocket public pour
  l'instant — la connexion `ws/kds/...` exige un JWT staff). Répond
  `{"commandes": [...], "cuisine_en_ligne": bool, "message_urgence": ...}`
  — ne renvoie que les commandes **non payées** de la table : une fois
  payée, une commande sort de la liste — sans ça, le client suivant
  scannant le même QR code (le token est fixe par table, pas par visite)
  verrait les commandes déjà soldées du client précédent.
- **`POST /api/qr/<token>/appel-serveur/`** — bouton d'appel (§5.6) : passe
  la table en `appel_serveur` et diffuse une alerte temps réel au canal
  `ws/kds/master/` déjà existant (nouveau type d'événement `table.event` /
  `appel_serveur`, géré par un nouveau handler `table_event` sur
  `KDSConsumer` — le "pocket serveur" mentionné au §5.5 est un client de
  plus sur ce même canal Master).
- **Isolation tenant explicite, pas automatique** : contrairement au reste
  de l'API, les serializers QR n'héritent PAS de `TenantScopedFieldsMixin`
  (qui s'appuie sur `request.user.tenant` — inexistant en accès anonyme,
  `request.user` est un `AnonymousUser` sans `.tenant`). La vérification
  qu'un `plat`/`modificateur` référencé appartient bien au tenant de la
  table scannée est donc faite à la main dans `QrOrderCreateView`, avec un
  400 explicite sinon — testé.

Deux comportements ajoutés sans qu'ils soient explicitement demandés, mais
nécessaires pour que la boucle QR ait un sens : l'occupation automatique de
table à la première commande, et l'exclusion des commandes payées du suivi
(confidentialité entre deux visites successives sur la même table/QR).

Testé de bout en bout : menu avec/sans filtres allergène et régime, plat en
rupture absent, commande créée avec routage multi-poste automatique, table
passée `occupée`, appel serveur reçu en temps réel sur le canal Master
(vérifié via `WebsocketCommunicator`), rejet 400 d'un plat d'un autre
tenant, 404 sur token QR inconnu, disparition d'une commande payée du
suivi + libération automatique de la table qui en découle.

### Suivi plat par plat + "servir maintenant / avec le reste" (§5.6)

Objectif explicite : rassurer le client en lui montrant la progression de
CHAQUE plat, et lui laisser un peu de contrôle sur le rythme de service
(ex: le vin peut sortir immédiatement, ou attendre le plat principal),
sans qu'il ait à réclamer quoi que ce soit. Deux briques, un bug corrigé :

- **Bug corrigé : `OrderItem.statut_ligne` ne suivait jamais le ticket.**
  Le champ existait depuis la Phase 0 mais rien ne le mettait à jour
  quand un ticket avançait — il restait bloqué à `en_attente`
  indéfiniment. `kds_core/signals.py::_sync_lignes_statut` répercute
  désormais le statut du ticket sur ses lignes à chaque changement (sauf
  lignes déjà `annulé`, jamais réécrites). Comme un plat est rattaché à
  UN ticket, et que des plats de postes différents finissent naturellement
  sur des tickets différents, ça donne exactement le comportement
  recherché : "1/2 poulet prêt" pendant que "soupe en préparation" —
  sans rien inventer de nouveau, juste en connectant ce qui existait déjà.
- **`service_immediat` (défaut `True`)** — nouveau champ sur chaque ligne
  du body `POST /api/qr/<token>/orders/create/`. Réutilise le mécanisme
  Fire/Hold existant (§5.1, Phase 2), mais choisi par le **client** à la
  commande plutôt que par le staff après coup : un plat marqué
  `service_immediat: false` part sur un ticket **retenu** (`is_held`),
  même s'il partage le poste d'un autre plat immédiat — `services.py::route_items_to_tickets`
  route désormais par **(poste, retenu)**, pas seulement par poste.
- **Libération automatique** (`signals.py::_auto_fire_tickets_retenus_si_reste_pret`,
  appelée à chaque sauvegarde de ticket) — dès que tous les tickets NON
  retenus d'une commande sont prêts/servis, les tickets encore retenus se
  lancent automatiquement en cuisine. Aucune action requise ni du client
  ni du staff — c'est le point demandé explicitement ("une fois qu'un
  élément est prêt, l'option devient disponible... automatiquement").
  Réutilise le `_broadcast` existant : un ticket libéré est traité comme
  un événement `created` (déjà vrai depuis le `fire()` manuel de la
  Phase 2), donc l'écran du poste concerné le voit apparaître à
  l'instant précis où il se libère, pas seulement à la prochaine
  reconnexion.

Testé de bout en bout, scénario exact demandé : commande QR avec 1/2
poulet (Grill, immédiat), soupe (poste Entrées, immédiat) et vin (Bar,
"avec le reste") → 3 tickets créés, le vin retenu et invisible côté
cuisine (`is_held: true`, pas d'heure d'envoi) → bump poulet à "prêt" →
le suivi client affiche poulet "prêt" / soupe "en_attente" / vin
"en_attente" → bump soupe à "prêt" (dernier ticket non-retenu) → le
ticket vin se libère automatiquement (`is_held` passe à `false`, heure
d'envoi renseignée) sans aucune action manuelle.

**Régression trouvée en usage réel (pas par un test automatisé) : une
commande composée UNIQUEMENT de plats "avec le reste" restait bloquée
pour toujours.** `_auto_fire_tickets_retenus_si_reste_pret` avait un
garde-fou `if not tickets_non_retenus.exists(): return` — "rien d'autre à
comparer, je ne fais rien" — qui est exactement l'inverse du bon
comportement : s'il n'y a rien à attendre, le ticket doit se lancer
**immédiatement**, pas rester invisible en cuisine indéfiniment. Repéré
parce qu'un utilisateur a passé une vraie commande d'un seul plat "avec
le reste" et n'a jamais vu son ticket apparaître côté cuisine. Corrigé en
supprimant ce garde-fou : `tickets_non_retenus.exclude(...).exists()` sur
une queryset déjà vide vaut naturellement `False`, donc `tout_pret` est
déjà correctement `True` dans ce cas sans qu'aucun cas particulier ne
soit nécessaire. Reteste : commande à un seul plat "avec le reste" → part
en cuisine tout de suite (`is_held: false`) ; commande mixte
immédiat + retenu → le retenu reste bien bloqué tant que l'immédiat n'est
pas prêt (comportement normal non cassé par le correctif).

### Tickets retenus invisibles + statut "prêt" pas assez granulaire (trouvés en usage réel)

Deux bugs liés, remontés par l'utilisateur en testant le poste Plats après
l'alignement postes ↔ catégories (§"postes cuisine = catégories" plus
haut), pas par les tests automatisés :

1. **Un ticket retenu (Fire/Hold) était totalement invisible en cuisine,
   y compris sur son propre poste.** `_broadcast` (signals.py) et
   `_get_active_tickets_snapshot` (consumers.py) excluaient tout ticket
   `is_held=True` de la diffusion temps réel ET du rattrapage de
   connexion. Conséquence concrète : un plat marqué "servir avec le
   reste" à la commande ne partait jamais en préparation avant que le
   reste de la commande soit déjà prêt — pour un plat lent (poulet
   braisé, 20 min), ça allonge le temps d'attente total au lieu de le
   raccourcir, l'inverse du but recherché. Le frontend (`TicketCard.jsx`)
   avait pourtant déjà un bouton "Lancer (Fire)" prévu pour ce cas — un
   bouton qu'on ne peut jamais voir ni cliquer sur une carte qui n'existe
   pas à l'écran. Corrigé en supprimant l'exclusion : un ticket retenu
   est désormais diffusé normalement (bordure grise + bouton "Lancer"),
   la cuisine peut donc le démarrer manuellement à tout moment, ou
   attendre la libération automatique existante.
2. **"Marquer prêt" faisait basculer TOUT le ticket d'un coup**, même
   quand plusieurs plats différents (ex: poulet braisé + brochette de
   bœuf) partageaient le même poste et donc le même ticket — impossible
   d'annoncer "le poulet est prêt" sans annoncer aussi les brochettes en
   même temps, alors qu'elles cuisent encore. Corrigé en déplaçant le
   passage "prêt" au niveau de la LIGNE, pas du ticket :
   - `POST /api/order-items/<id>/marquer-pret/` (nouvelle action,
     `OrderItemViewSet.marquer_pret`) marque une ligne précise comme
     prête, indépendamment des autres lignes du même ticket.
   - `signals.py::_sync_ticket_statut_depuis_lignes` (nouveau receiver
     sur `OrderItem`) fait passer le ticket lui-même à `prêt`
     automatiquement dès que TOUTES ses lignes actives (non annulées) le
     sont — c'est ce qui fait apparaître "Marquer servi" côté écran.
     Diffuse aussi l'état du ticket à chaque ligne marquée prête, même
     quand le ticket entier ne bascule pas encore, sinon l'écran ne
     verrait jamais un plat isolé passer prêt en temps réel.
   - `OrderTicketViewSet._BUMP_SUIVANT` perd la transition
     `en_préparation → prêt` : ce n'est plus un bump ticket-entier
     manuel, uniquement une conséquence automatique des lignes.
   - `TicketCard.jsx` : chaque ligne a son propre bouton "Prêt"
     (affiché tant que le ticket est `en_préparation`, désactivé une
     fois cliqué), le bas de la carte affiche "X/Y prêts" et un message
     d'attente tant que tout n'est pas prêt, plutôt qu'un bouton "Marquer
     prêt" qui aurait pu tout faire basculer d'un coup.

Testé de bout en bout (2 lignes, même poste) : Démarrer → 1ère ligne
marquée prête seule (l'autre reste "Prêt" cliquable, ticket toujours
`en_préparation`, "1/2 prêts") → 2ème ligne marquée prête → le ticket
bascule automatiquement `prêt` ("Marquer servi" apparaît) → Marquer
servi → le ticket disparaît des écrans actifs, la commande passe
`servie`.

### Notifications son + visuel, des deux côtés, à chaque étape de la commande

Demandé explicitement après coup : jusque-là, tous les changements de
statut étaient silencieux — il fallait regarder l'écran pour les
remarquer. Cinq transitions couvertes, son synthétique (Web Audio,
`frontend/src/notificationSound.js` — pas de fichier audio à héberger)
+ repère visuel, sans toucher au reste de l'architecture temps réel
existante :

- **Cuisine — nouveau ticket sur un poste** : badge "🆕 Nouveau" +
  pulsation sur la carte (`TicketCard.jsx`) pendant 6s, son à
  l'apparition. Détecté via l'événement `created` déjà distingué côté
  WebSocket (`useTicketsSocket.js` expose désormais `dernierTicketCree`
  en plus de `tickets`), jamais déclenché pour les tickets déjà présents
  au moment de la connexion (`sync` initial exclu explicitement).
- **Cuisine — appel serveur** : bandeau rouge déjà existant, son ajouté.
- **Client — un plat passe "prêt"** : toast "`<plat>` est prêt !".
- **Client — un TICKET passe "servi"** : toast "Votre commande
  arrive !" (le point explicitement demandé : "lorsque la cuisine
  signale SERVI").

  **Bug trouvé en usage réel (pas par un test automatisé), corrigé une
  fois de plus dans cette même fonctionnalité : le toast se basait sur
  `commande.statut === 'servie'`, qui ne passe "servie" que lorsque TOUS
  les tickets de TOUS les postes le sont** (`signals.py::_sync_order_statut`).
  Sur une commande multi-poste (ex: poulet sur Plats + bissap sur
  Boissons), marquer le ticket Plats "servi" ne déclenchait donc rien tant
  que le ticket Boissons restait "en attente" — silence total côté client
  alors que le plat était déjà en route vers la table. Repéré par
  l'utilisateur ("j'ai entendu le son [du plat prêt] mais ne vois
  toujours pas le message"), pas capturé par mon propre test parce qu'il
  ne portait que sur une commande à un seul poste. Corrigé en exposant le
  statut de chaque ticket au client (`QrOrderStatusSerializer.get_tickets`,
  juste `id`+`statut`) et en détectant la transition `ticket.statut →
  servi` **par ticket**, plutôt que d'attendre `commande.statut`.
- **Client — appel serveur confirmé** : message déjà existant, son ajouté.

**Badge "✓ Servi" permanent** (demandé après coup, en regardant une
commande déjà entièrement livrée) : le toast "Votre commande arrive !"
est éphémère (8s) — une fois disparu, rien ne distinguait plus "prêt et
en route" de "déjà servi", la fiche de suivi affichait "Prêt" pour
toujours, même des heures après. `OrderItem.StatutLigne` gagne une
valeur `SERVI` (migration `0005_alter_orderitem_statut_ligne` — juste
un choix de plus sur un `CharField`, pas de vrai changement de schéma),
répercutée automatiquement quand son ticket passe "servi"
(`STATUT_TICKET_VERS_LIGNE`, `signals.py::_sync_lignes_statut` — la
protection "ne jamais faire régresser une ligne déjà prête" ne
s'applique plus qu'à la cible "en préparation", pas à "servi" : à ce
stade TOUTES les lignes actives d'un ticket sont de toute façon déjà
"prêt", cf. `_sync_ticket_statut_depuis_lignes`). `TrackingView.jsx`
affiche ce nouveau statut avec un badge bleu distinct ("✓ Servi") du
badge vert "Prêt".

Le suivi client (§5.6) est en **polling REST** (pas de WebSocket public
côté QR), donc rien ne "pousse" une notification tout seul — c'est
`ClientApp.jsx::detecterEvenements` qui compare la réponse du poll
précédent à la nouvelle à chaque cycle de `fetchSuivi` (via un `useRef`,
pas du state, pour ne pas redéclencher l'effet de polling à chaque
poll) et détecte les transitions `statut_ligne → pret` (par ligne,
`items[].id`) et `ticket.statut → servi` (par ticket, `tickets[].id`).
Ces deux identifiants sont exposés spécifiquement pour ce diff —
`QrOrderStatusSerializer` n'avait jusque-là que des données affichables,
pas d'identité stable entre deux polls.

**Autoplay audio** : les navigateurs (surtout mobile) refusent de
démarrer un son avant un vrai geste utilisateur. `amorcerAudio()` est
appelé dans un clic réel dès que possible — `LoginScreen.jsx` (clic "Se
connecter" côté cuisine), `ajouterAuPanier`/`handleAppelServeur` côté
client — pour débloquer l'`AudioContext` avant qu'un son ne soit
réellement nécessaire. Si ça échoue quand même (contexte non débloqué,
navigateur qui bloque), `jouerBip`/`jouerDoubleBip` avalent l'erreur
silencieusement : un son manqué ne doit jamais faire planter l'écran.

**Bug trouvé en testant ces notifications (pas par un test automatisé) :
un nouveau ticket apparaissait un instant en cuisine sans AUCUN plat
dedans** — juste "Table X / En attente / Démarrer", le temps qu'un futur
changement de statut le rediffuse avec ses lignes. Cause :
`OrderTicket.objects.create()` déclenche sa diffusion temps réel
immédiatement (§5.3), donc avant que la boucle de
`services.py::route_items_to_tickets` ait eu la moindre chance de créer
la première `OrderItem` dessus — la toute première diffusion d'un ticket
neuf sérialisait donc systématiquement une liste de lignes vide. Invisible
jusqu'ici car les tests précédents ne capturaient jamais l'état exact au
moment de la création (toujours après un premier bump). Corrigé en
rediffusant explicitement chaque ticket touché (nouveau ou réutilisé) une
fois TOUTES ses lignes attachées, en fin de `route_items_to_tickets`.

Testé de bout en bout (2 navigateurs, cuisine + client, en parallèle) :
commande passée → badge "🆕 Nouveau" + plat visible immédiatement côté
Master → Démarrer → plat marqué prêt → toast "prêt" côté client (repéré
en ~5s, cadence du polling) → Marquer servi → toast "Votre commande
arrive !" côté client → appel serveur → bandeau + son des deux côtés.

### Deux messages hors-ligne distincts — ne pas les confondre

1. **Le téléphone du client n'a lui-même aucune connexion** (WiFi resto
   coupé et pas de 4G, par ex.) — la requête n'atteint jamais l'API,
   c'est donc entièrement une logique **frontend** (détection d'échec
   fetch), rien à faire côté backend. Texte déjà validé, à utiliser tel
   quel : « Connexion indisponible, Veuillez appeler un serveur ».

2. **Le client a sa propre 4G et atteint l'API sans problème, mais
   l'internet du restaurant (routeur/FAI) est en panne** — la commande
   est bien enregistrée en base, mais aucun écran cuisine ne peut la
   recevoir en temps réel tant que le restaurant reste coupé. Contrairement
   au cas 1, ceci est détectable **côté backend** au moment même de la
   commande — voir présence temps réel ci-dessous. Texte, renvoyé
   directement par l'API (champ `message_urgence`), à utiliser tel quel :
   « Connexion indisponible côté cuisine, veuillez appeler un serveur ».

#### Présence temps réel des écrans cuisine (`kds_core/presence.py`)

Question posée en cours de Phase 4 : à l'instant précis où le restaurant
n'a plus internet, comment les deux parties savent-elles qu'une commande
existe ? Réponse honnête : **aucun système cloud ne peut prévenir le
restaurant en temps réel sans connexion** — contrainte physique, pas un
manque de code. Ce qu'on peut faire : que le backend sache si un écran
cuisine est réellement joignable *au moment même* de la commande, et le
dire clairement au client plutôt que de laisser croire que tout est reçu.

- Chaque `KDSConsumer` (poste ou Master) envoie un signal de vie à la
  connexion, puis toutes les 20s tant qu'il reste connecté, dans un ZSET
  Redis par tenant (`channel_name -> horodatage`). Une entrée plus vieille
  que 45s est considérée hors-ligne — une déconnexion brutale (coupure
  réseau, sans fermeture propre du WebSocket) expire ainsi naturellement
  plutôt que de rester "en ligne" indéfiniment à tort.
- `presence.is_kitchen_online_sync(tenant_id)` est appelé dans
  `QrOrderCreateView`, `QrOrderStatusView` et `QrCallWaiterView` ; chaque
  réponse inclut désormais `cuisine_en_ligne` (bool) et `message_urgence`
  (le texte ci-dessus, ou `null` si tout va bien).
- **Best-effort, jamais bloquant** : toute erreur Redis dans
  `presence.py` est interceptée et journalée (`logger.warning`) — un
  hoquet réseau ne doit jamais faire échouer une commande client ni
  planter un cycle connexion/déconnexion WebSocket. Par prudence, une
  erreur de lecture répond `cuisine_en_ligne: false` plutôt que `true`.

**Bug de robustesse trouvé et corrigé en testant** : la première version
arrêtait la tâche de heartbeat via `.cancel()` à la déconnexion — si
l'annulation tombait pendant un appel Redis en cours, la connexion
partagée restait dans un état incohérent (réponse à moitié lue),
provoquant un timeout sur l'appel Redis *suivant*, sans rapport avec cet
écran. Corrigé en remplaçant l'annulation par un signal d'arrêt
(`asyncio.Event`) que la boucle de heartbeat consulte entre deux appels
complets — jamais interrompue en plein vol.

Testé de bout en bout : `cuisine_en_ligne: false` (avec le bon
`message_urgence`) sans aucun écran connecté, `true` (`message_urgence:
null`) pendant qu'un écran Master est connecté, retour à `false` après une
déconnexion propre — sur les trois endpoints (création, suivi, appel
serveur).

### Phase 5 — Redondance d'écran (backend, fait ; reste : impression de secours)

Seul morceau de la Phase 5 qui est du vrai backend exploitable sans
frontend — le reste (PWA, IndexedDB côté client) a été construit dans
un second temps (cf. section suivante), l'impression papier restant seule
en attente (matériel physique requis). La réconciliation cuisine (§5.5)
était déjà couverte par le rattrapage à la connexion de la Phase 4.

- **`kds_core/presence.py` étendu** : suit désormais la présence à deux
  niveaux — par tenant (existant, Phase 4) **et** par poste précis
  (nouveau). Chaque écran connecté (`ws/kds/<scope_id>/`) rafraîchit les
  deux compteurs ; un écran Master ne compte que pour le niveau tenant
  (il ne "tient" pas physiquement un poste).
- **`StationSerializer.est_en_ligne`** — vrai si au moins un écran
  surveille précisément CE poste dans les 45 dernières secondes. Permet à
  un manager de voir en un coup d'œil quel poste semble en panne.
- **`POST /api/stations/<id>/reassigner/`** — `{"vers": "<uuid_poste>"}` :
  réaffecte tous les tickets encore actifs (y compris retenus/Hold) du
  poste en panne vers un autre poste actif du même tenant. **Manuel**,
  jamais automatique — le staff décide, `est_en_ligne` l'informe. Chaque
  ticket réaffecté déclenche le signal existant (log + diffusion temps
  réel), donc le poste de destination le voit apparaître immédiatement ;
  si l'ancien poste revient en ligne, le rattrapage à la connexion
  (Phase 4) lui montre déjà le bon état — il ne "redécouvre" jamais un
  ticket qui ne lui appartient plus.

Testé de bout en bout : détection correcte poste en ligne (Bar, écran
connecté) vs hors ligne (Grill, jamais connecté), aucun événement reçu par
un poste tant qu'aucun ticket ne le concerne, réaffectation Grill → Bar
avec réception immédiate des 2 événements `updated` sur l'écran Bar et
mise à jour confirmée en base, rejet 400 si poste destination = poste
source, isolation cross-tenant vérifiée (impossible de réaffecter vers le
poste d'un autre établissement).

### Phase 5bis — PWA / IndexedDB côté client QR (§5.5, fait)

Objectif exact du cahier des charges : "sauvegarde locale (IndexedDB) des
commandes en cas de coupure internet, avec file d'attente de
synchronisation au retour du réseau" — et pas seulement "afficher un
message d'erreur", ce que le client faisait déjà depuis la Phase 4
(`EcranHorsLigne`, écran bloquant). L'écran bloquant reste, mais devient
l'exception (aucun menu jamais mis en cache) plutôt que la règle.

- **`frontend/src/client/offlineDb.js`** — wrapper IndexedDB minimal
  (pas de librairie), deux magasins : `menuCache` (dernier menu chargé
  avec succès par table) et `commandesEnAttente` (commandes non
  envoyées, clé = `idempotencyKey`).
- **Menu mis en cache à chaque chargement réussi**, relu si le
  chargement suivant échoue pour cause réseau (`ClientApp.jsx`) : le
  client continue de consulter le menu et composer son panier hors
  ligne, un bandeau ambre persistant ("📶 Hors ligne — menu en cache")
  remplaçant l'ancien écran bloquant tant qu'il reste quelque chose à
  montrer.
- **Commande hors ligne → file d'attente, pas échec.**
  `validerCommande` retombe sur `mettreEnFileCommande(...)` si
  `ErreurReseau` est levée : le panier est vidé, le client bascule sur
  "Ma commande" et y voit sa commande sous un badge distinct
  "En attente d'envoi (hors ligne)" — jamais un cul-de-sac, cf. la
  philosophie déjà posée en Phase 4 ("mettre le client à l'aise").
- **Synchronisation automatique** au montage (une commande a pu rester
  en file d'une session précédente) et sur l'événement navigateur
  `online`. Idempotente côté serveur : `Order.idempotency_key` (nouveau
  champ, migration `0006`) — généré côté client (`crypto.randomUUID()`)
  **une seule fois par tentative de commande**, rejoué tel quel si la
  commande doit être renvoyée depuis la file. `QrOrderCreateView`
  retourne la commande déjà créée (200) plutôt que d'en recréer une
  (201) s'il retrouve la même clé pour la même table — sans ça, une
  commande dont la réponse aurait été perdue pile au moment de la
  coupure (requête bien arrivée au serveur, réponse jamais reçue)
  se dupliquerait au retour réseau.
- **PWA** (`vite-plugin-pwa`, `vite.config.js`) — précache l'app shell
  (JS/CSS/HTML) via service worker, pour que l'app se recharge même
  sans réseau. Les requêtes API/WS ne passent volontairement pas par un
  cache Workbox générique : le menu et la file de commandes sont déjà
  gérés à la main via IndexedDB avec une logique de fraîcheur précise,
  un cache HTTP par-dessus ferait doublon. Manifest minimal (`name: "KDS"`
  générique — une vraie personnalisation par tenant nécessiterait un
  manifest généré dynamiquement par établissement, hors scope ici).
  **Piège rencontré en testant** : le service worker ne précache
  réellement les assets qu'après un vrai build (`npm run build` +
  `npm run preview`) — `devOptions.enabled: true` (`npm run dev`)
  n'enregistre qu'un SW factice qui ne sert à rien hors ligne, Vite en
  dev servant les modules à la demande plutôt que des fichiers statiques
  que Workbox peut précacher. Un premier test de rechargement complet
  hors ligne a échoué (`net::ERR_INTERNET_DISCONNECTED`) sur le serveur
  de dev avant de comprendre qu'il fallait tester contre un vrai build.

Testé de bout en bout contre un build de production réel (`vite build` +
`vite preview`, pas juste le serveur de dev), avec `context.setOffline(true)`
(Playwright, coupure réseau réelle, pas un mock) : première visite en
ligne (menu + app shell mis en cache) → coupure réseau → **rechargement
complet de la page entièrement hors ligne** → menu toujours affiché,
bandeau "Hors ligne" visible → commande passée hors ligne → mise en file,
affichée "En attente d'envoi" → retour en ligne
(`context.setOffline(false)`) → synchronisation automatique sans action du
client → commande retrouvée en base avec son `idempotency_key`, visible
dans "Ma commande" avec un statut normal ("En attente", total correct) →
bandeau hors ligne disparu. Aucune régression sur le flux en ligne normal
(commande immédiate testée après coup sur le serveur de dev habituel).

### Phase 6 — Statistiques & admin (backend, fait)

**Back-office thème/logo/couleurs** : déjà couvert depuis la Phase 0 — pas
de nouveau code. `PATCH /api/tenant/` permet déjà de modifier
`logo_url`, `couleur_primaire`, `couleur_secondaire`, `devise`,
`langue_defaut` (§1.4) ; la gestion des postes/menu/utilisateurs passe par
les ViewSets CRUD existants (`stations`, `menu-items`, `users`...).

**Nouveau : rapports de performance (§5.4)**, `kds_core/stats_views.py` —
5 endpoints en lecture seule, tenant-scopés, filtrables par période via
`?depuis=`/`?jusqu_a=` (ISO 8601, défaut : dernières 24h) :

```
GET /api/stats/temps-preparation/        durée moyenne poste (envoi → prêt)
GET /api/stats/heures-pointe/            nb de commandes par heure
GET /api/stats/plats-plus-lents/         durée moyenne par plat
GET /api/stats/gaspillage/               lignes annulées, groupées par plat + motif
GET /api/stats/productivite-employes/    durée moyenne par employé — réservé managers/admins
```

- **`plats-plus-lents`** : approximation assumée et documentée dans le
  code — la durée vient du *ticket* (pas d'horodatage par ligne
  individuelle dans le modèle), partagée entre toutes les lignes de ce
  ticket. Fiable pour un ticket mono-plat, indicatif sinon.
- **`productivite-employes`** : construit à partir de `TicketStatusLog`
  (déjà alimenté automatiquement depuis la Phase 1) — pour chaque passage
  à "prêt", l'utilisateur qui a fait le changement est crédité de la
  durée du ticket. Première fois qu'une restriction par **rôle** apparaît
  dans l'API (`IsManagerOrAdmin`, `kds_core/permissions.py`) : jusqu'ici
  seule l'appartenance au tenant (`IsTenantMember`) était vérifiée, tous
  les rôles traités à égalité — cf. §5.4 "accès restreint aux managers".
  Un cuisinier/serveur reçoit un 403 sur cet endpoint précis, mais garde
  accès aux 4 autres rapports.
- **`gaspillage`** : réutilise `OrderItem.statut_ligne`/`motif_annulation`,
  déjà alimentés par `services.cancel_order` depuis la Phase 3 — aucune
  donnée supplémentaire à collecter, juste à agréger.

Testé de bout en bout avec un jeu de données réaliste (tickets à durées
variées sur 2 postes, commandes à 3 heures différentes, une ligne annulée
avec motif) : les 5 rapports renvoient des agrégats corrects, un cuisinier
reçoit bien 403 sur `productivite-employes` (200 sur les autres), et le
filtre de période exclut correctement les données hors plage.

### Phase 5ter — Impression de secours + Caisse (§5.5, fait côté logiciel)

Dernier morceau de la Phase 5 : "impression papier de secours activable
si un écran tombe en panne pendant le service" (§5.5). En creusant le
sujet avec l'utilisateur, la demande s'est élargie à un vrai écran
Caisse (montant reçu, reçu client imprimable, ventes du jour) —
regroupés ici parce que les trois s'appuient sur le même module
d'impression.

**Premier essai, abandonné : impression réseau directe (ESC/POS).** La
toute première implémentation passait par `kds_core/impression.py`
(`python-escpos`, `escpos.printer.Network`, IP/port fixes en
`.env`) — un module backend qui parlait en direct à une seule
imprimante thermique (Epson TM-T88V) sur une IP figée. Deux problèmes
trouvés en testant, qui ont fait abandonner l'approche :
- **Piège `Network(...)` ne se connecte pas à la construction** — sans
  appel explicite à `.open()`, une imprimante débranchée ne déclenchait
  aucune erreur (testé avec l'imprimante physique éteinte).
- **Couplage à un modèle/IP unique** — l'utilisateur a fait remarquer
  que l'app doit marcher avec n'importe quelle imprimante, pas
  seulement la TM-T88V à une adresse fixe : *"l'impression doit ouvrir
  un aperçu qui permettra de sélectionner l'imprimante"*.

**Solution retenue : aperçu HTML + dialogue d'impression du navigateur**
(`frontend/src/print/imprimer.js`). `ouvrirApercuImpression(titre,
corpsHtml)` ouvre une petite fenêtre avec le ticket/reçu mis en forme
(style papier thermique, monospace, 72mm) et un bouton "Imprimer" qui
appelle `window.print()` — le navigateur affiche alors son dialogue
natif, qui liste **toutes** les imprimantes installées sur le poste
(USB, réseau, PDF...), quel que soit le modèle. Plus aucune
configuration côté serveur (pas d'IP, pas de port), et ça marche même
si le backend est injoignable puisque les données du ticket/de la
commande sont déjà en mémoire côté écran au moment du clic — aucun
appel réseau nécessaire pour imprimer.

- `construireTicketHTML(ticket, contexte)` — ticket cuisine de secours
  (table, plats + modificateurs + commentaire, rush), utilisé par le
  bouton 🖨️ sur chaque `TicketCard` (`KitchenScreen.jsx`).
- `construireRecuHTML(commande, paiement)` — une seule fonction
  adaptative plutôt que deux fonctions "facture" et "reçu" séparées :
  `paiement = null` → total + "A RÉGLER EN CAISSE" (ce que le serveur
  imprime pour apporter l'addition à table) ; `paiement = {
  modePaiement, montantRecu, monnaie }` → ajoute "Paiement" / "Reçu" /
  "Monnaie" (espèces) et "Servi par : {nom}" — répond aux deux demandes
  explicites de l'utilisateur (nom du serveur, montant reçu) sans
  dupliquer le code. Utilisée par `CaisseScreen.jsx`, à la fois pour le
  bouton "Facture" (avant paiement) et automatiquement après un
  encaissement réussi.

Conséquence côté backend : les trois actions dédiées à l'impression
(`OrderTicketViewSet.imprimer`, `StationViewSet.imprimer_secours`,
`OrderViewSet.imprimer_recu`) ainsi que `kds_core/impression.py` et
`PRINTER_HOST`/`PRINTER_PORT` (`.env`, `settings.py`) ont été
**retirés** — l'impression est désormais une pure affaire de frontend,
à partir des données déjà chargées à l'écran. `StationViewSet.
imprimer_secours` n'avait de toute façon jamais été câblé côté
interface (aucune régression fonctionnelle, juste du code mort en
moins).

**Total partagé** : `services.calculer_total_commande(order)`, extrait de
`QrOrderStatusSerializer.get_total` (Phase 4) pour être réutilisé à
l'identique dans `OrderViewSet.encaisser` — une seule source de vérité
pour le calcul du total plutôt que plusieurs implémentations qui
pourraient diverger.

**`OrderViewSet.encaisser`** (`POST /api/orders/<id>/encaisser/`) —
mode de paiement + montant reçu (optionnel, défaut = total si omis pour
un paiement non-espèces), calcule/enregistre `montant_recu` et passe
`statut_paiement` à `payee`. Seule action de `OrderViewSet` protégée par
`IsManagerOrAdmin` — décision produit explicite de l'utilisateur, cf.
écran Caisse ci-dessous.

**Écran Caisse (`frontend/src/CaisseScreen.jsx`)** — liste des commandes
non payées, avec un vrai split de rôle repris de la conversation avec
l'utilisateur : la première proposition ("serveurs + managers + admins")
a été explicitement corrigée — *"rétirer le serveur on verra son cas
plus tard, le serveur doit pouvoir juste donner le montant de la facture
et les détails de la commande"*. Résultat, deux niveaux distincts sur le
même écran :
- **Tout le staff (serveur compris)** : bouton "🖨️ Facture" — imprime le
  montant dû + détail, sans toucher au paiement.
- **Manager/admin uniquement** : bouton "💰 Encaisser" en plus — formulaire
  inline (mode de paiement, montant reçu en espèces, monnaie calculée en
  direct), déclenche automatiquement l'impression du reçu après
  validation.

Le gate frontend (`ROLES_ENCAISSEMENT = ['manager', 'admin']` dans
`CaisseScreen.jsx`) reflète exactement le gate backend
(`OrderViewSet.get_permissions`) — aucune action serveur ne peut
contourner la restriction même en appelant l'API directement.

**Rapport Ventes du jour** — `VentesParJourView`
(`GET /api/stats/ventes/?date=YYYY-MM-DD`, réservé manager/admin même
logique que `productivite-employes` : le chiffre d'affaires est une
donnée sensible), ajouté en carte dans l'onglet Rapports
(`RapportsTab.jsx`) avec un sélecteur de date. Basé sur
`heure_paiement`, pas `created_at` : une commande prise tard le soir et
payée après minuit compte sur le jour où l'argent est réellement rentré
— c'est ce que veut dire "les ventes du 13 juillet" pour quelqu'un qui
fait sa caisse.

**Testé de bout en bout (Playwright)** : encaissement manager (montant
reçu 5000F sur une addition à 4000F → monnaie 1000F calculée
correctement, commande disparaît de la liste des impayés, message de
confirmation affiché) ; vue serveur (compte PIN dédié ajouté à
`seed_demo.py`) confirmée limitée au bouton Facture, badge "Facture
uniquement — encaissement réservé aux managers" affiché, aucun bouton
Encaisser dans le DOM. Le rapport Ventes du jour reflète correctement
l'encaissement de test (revert manuel ensuite pour ne pas polluer le
jeu de données de démo). Aperçu d'impression vérifié pour les trois cas
— ticket cuisine, facture non payée ("A RÉGLER EN CAISSE"), reçu après
encaissement (Paiement/Reçu/Monnaie) — la fenêtre s'ouvre instantanément
dans les trois cas, sans latence puisqu'aucun appel réseau n'est
impliqué.

**Bug trouvé en cours de route, avant le changement d'architecture** :
avec l'ancienne impression réseau directe, le bouton "Facture" semblait
"ne pas répondre" — en réalité la requête partait bien, mais
l'imprimante étant injoignable, il fallait ~5s avant l'erreur, sans
aucun indice visuel entre-temps (pas de spinner, bouton pas désactivé).
Le passage à l'aperçu HTML local supprime le problème à la racine :
plus d'appel réseau, donc plus d'attente.

**Deuxième bug trouvé, une fois en usage réel** : la fenêtre d'aperçu
s'affichait parfois **blanche** — `window.open('', '_blank', ...)` suivi
de `document.write(...)` ouvre d'abord une fenêtre sur "about:blank",
puis écrit le contenu par-dessus ; si le navigateur termine sa propre
navigation vers "about:blank" *après* ce write, il écrase silencieusement
le contenu (pas d'erreur JS, juste une page vide). Corrigé en construisant
une Blob URL (`URL.createObjectURL(new Blob([html], {type:
'text/html'}))`) et en naviguant directement dessus — un document déjà
complet dès l'ouverture, donc plus de course possible entre deux
navigations.

**En-tête facture/reçu + traçabilité caisse** (§5.5, demandé après coup
avec un modèle de ticket de référence) : la facture (avant paiement)
n'affichait que le détail des plats, sans rien identifier
l'établissement — corrigé en donnant aux deux documents (facture ET
reçu) le même en-tête, construit par `construireEnTete(tenant)` dans
`print/imprimer.js` : logo (si `tenant.logo_url` est renseigné), nom de
l'établissement, adresse, téléphone. Nécessite deux nouveaux champs sur
`Tenant` — **`telephone`** et **`adresse`** (migration `0008`, exposés
par `TenantSerializer`) — à renseigner par établissement via `/admin/`
(pas encore d'écran dédié côté tableau de bord ; `TenantAdmin` expose
déjà tous les champs du modèle sans configuration supplémentaire).

Le corps du document diffère en revanche entre les deux, sur demande
explicite (modèle de ticket fourni par l'utilisateur, cf. capture) :
- **Facture** (non payée) : N° Table, Serveur, Date, puis articles et
  total — inchangé par rapport à avant.
- **Reçu** (après `encaisser`) : Date, **Ticket N°**, Serveur,
  **Caissier**, Règlement, puis le détail article par article avec prix
  unitaire (`Qté × P.U` / `Montant`), total, Reçu/Monnaie rendue, et les
  mentions "Merci de votre visite" / "Conservez ce ticket pour tout
  litige".

Deux nouveaux champs sur `Order` pour ça (migration `0008`) :
- **`numero_ticket`** (`PositiveIntegerField`, formaté `TC-000056` côté
  frontend) — compteur séquentiel **par tenant**, attribué dans
  `OrderViewSet.encaisser` à l'intérieur d'une transaction qui verrouille
  la ligne `Tenant` (`select_for_update`) le temps de lire le max
  existant et l'incrémenter, pour éviter que deux encaissements
  concurrents se voient attribuer le même numéro. Pas de table de
  séquence dédiée : le volume attendu (un petit établissement, pas une
  plateforme de paiement à fort débit) ne justifie pas la complexité
  supplémentaire.
- **`caissier`** (FK vers `User`, `SET_NULL`) — renseigné automatiquement
  avec `request.user` au moment de l'encaissement, exposé en lecture
  seule via `caissier_nom` (même pattern que `serveur_nom`).

Le champ "Service" du modèle fourni (zone/destination) a été laissé de
côté à la demande de l'utilisateur — aucune notion équivalente dans les
données actuelles de l'app (pas de zones/salles, pas de vente à
emporter), pas de champ inventé pour le remplir artificiellement.

### Phase 5quater — Écran Service dédié serveur (§5.1/§5.6, fait)

Demandé en préparant le déploiement chez un client réel (réseau local,
serveurs sur téléphone) : jusqu'ici, "Marquer servi" n'existait que comme
dernier état du bouton bump sur l'écran cuisine complet (Master/Poste) —
n'importe quel compte du tenant pouvait aussi démarrer/bumper/rush/
imprimer, pas seulement confirmer le service. Un serveur sur son
téléphone ne doit avoir accès qu'à UNE action.

**Nouvel écran `ServeurScreen.jsx`** (mobile-first, une colonne, gros
boutons tactiles) — réutilise `useTicketsSocket('master')` (déjà existant,
temps réel) plutôt qu'un nouveau canal WebSocket, filtré aux tickets
`pret`, regroupés par **commande** (`order`, pas `ticket`) — une commande
peut avoir plusieurs tickets (un par poste, ex: cuisine + bar), donc un
geste "tout servir" doit couvrir tous les postes de la table à la fois,
pas juste un ticket.

**Deux nouvelles actions backend**, complémentaires à l'existant :
- `POST /api/order-items/<id>/marquer-servi/` — confirme UN plat, dès
  qu'IL est prêt (`statut_ligne == pret`), sans attendre le reste du
  ticket. Avant cet ajout, "servi" n'existait qu'au niveau du ticket
  entier (`OrderTicketViewSet.bump`) — la granularité plat-par-plat
  s'arrêtait à "prêt" (`marquer_pret`, Phase 4), jamais jusqu'à "servi".
- `POST /api/orders/<id>/marquer-servi/` — "tout servir d'un coup" :
  bascule tous les tickets **actuellement prêts** de la commande à
  `servi`, ignore silencieusement ceux pas encore prêts (un serveur doit
  pouvoir valider ce qui est prêt maintenant et revenir plus tard pour
  le reste, ex: le bar est prêt, pas encore la cuisine).

**Signal étendu** (`signals.py::_sync_ticket_statut_depuis_lignes`) pour
symétrie avec la logique déjà existante côté "prêt" : le ticket bascule
`servi` tout seul dès que toutes ses lignes actives le sont, **en
repassant par `pret` au passage** si ce n'était pas déjà fait (jamais de
saut direct `en_preparation` → `servi`) — sinon `heure_pret` ne serait
jamais horodaté et fausserait les rapports de temps de préparation
(Phase 6, `stats_views.py`).

**Routage par rôle** (`App.jsx`/`SelectionEcran.jsx`) : un compte
`serveur` ne voit plus "Écran Master" ni les postes dans le sélecteur —
seulement "Caisse" et "🍽️ Service" (nouveau prop `masquerEcransCuisine`).
Restriction **frontend uniquement** — les actions bump/fire/marquer-pret
restent ouvertes à `IsTenantMember` côté API comme avant (pas de nouvelle
permission backend), décision volontaire pour rester proportionné à la
demande plutôt que durcir toute l'API cuisine sans qu'on l'ait demandé.

**Bug trouvé en testant en conditions réelles (VPS de prod)** : le
premier redéploiement via le nouveau pipeline `git push vps` a cassé
l'écran client QR ("Connexion indisponible") — le `npm run build` avait
utilisé `frontend/.env` (dev local, `VITE_API_BASE_URL=http://localhost:8000`)
au lieu des vraies URLs de prod, invisible sur les écrans staff testés
juste avant (mais fatal pour l'écran client, qui tourne dans le
navigateur d'un vrai client, pas le mien). Corrigé en ajoutant
`frontend/.env.production` (URLs `https://kds.behanian.com`), utilisé
automatiquement par Vite en mode production — **toujours vérifier après
un build que les URLs baked-in sont les bonnes** (`grep -o
"kds.behanian.com" frontend/dist/assets/*.js`) avant de pousser.

Testé de bout en bout sur le VPS de prod (pas en local, Docker Desktop
indisponible au moment du test) : commande QR (Poulet braisé + Mojito,
2 postes différents) → démarrée et marquée prête côté Master → connexion
`serveur1` (PIN) → écran de sélection confirmé limité à Caisse/Service →
écran Service affiche bien les 2 plats prêts, groupés sous "Table 2" →
un plat confirmé servi individuellement, puis "Tout servir" pour le
reste → vérifié en base : ticket et lignes bien passés `servi`, aucune
autre commande de la table affectée. Données de test nettoyées après
coup.

### Déploiement VPS (production réelle, §5.5 "résilience réseau")

Déployé chez un client (VPS Ubuntu 24.04 partagé avec une app hôtelière
existante) pour une démo — cf. `DEPLOY.md` à la racine pour le détail
complet (infrastructure, flux `git push vps main`, commandes utiles).
Points clés :

- **Isolation totale** de l'app hôtelière déjà en place sur le même
  serveur : dossier séparé (`/opt/kds-app`), base PostgreSQL séparée
  (même cluster, DB/utilisateur dédiés), port séparé (`8001` vs `8000`),
  fichier Nginx séparé, certificat SSL séparé (`kds.behanian.com`).
- **Service backend en mode utilisateur systemd** (`systemctl --user`),
  pas service système — décision prise après avoir découvert que le
  système de synchronisation existant du client (sync DB + déploiement
  de son app hôtelière, toutes les 6h) réinitialise périodiquement
  `/etc/sudoers.d/`, ce qui aurait rendu un `sudo systemctl restart`
  dans le hook de déploiement silencieusement peu fiable. Un service
  utilisateur (avec `loginctl enable-linger`) ne dépend d'aucun accès
  sudo, jamais — insensible à ce mécanisme externe qu'il n'était de
  toute façon pas question de modifier.
- **Déploiement en un `git push`** : dépôt bare sur le VPS
  (`~/kds-deploy.git`) avec hook `post-receive` (checkout, `pip
  install`, migrations, `collectstatic`, redémarrage du service) — GitHub
  (`MFourierk/kds-app`) sert en parallèle pour l'historique/la
  collaboration, pas pour le déploiement lui-même.
- **Frontend construit en local**, jamais sur le VPS (pas de Node.js
  installé sur le serveur de prod, volontairement, pour ne pas alourdir
  une machine qui héberge déjà une autre app) — `frontend/dist/` est donc
  exceptionnellement **versionné** dans Git (contrairement à la
  convention habituelle), avec le piège ci-dessus (Phase 5quater) sur les
  variables d'environnement à surveiller à chaque build.
- **`kds.behanian.com` est temporaire** — sous-domaine d'un client
  emprunté uniquement pour cette démo, à retirer proprement une fois la
  présentation faite (cf. avertissement dans `DEPLOY.md`).

**Piste explicitement ouverte, pas encore construite** : pour une
installation chez un client final avec exigence de continuité de service
même sans internet (réseau WiFi local uniquement), le backend devra
tourner **sur place** (ex: la machine Master elle-même, via
`docker-compose.yml` déjà présent dans le projet), pas sur un VPS
distant — une coupure internet rend un backend cloud injoignable quel
que soit l'état du réseau local. Ce n'est pas le scénario du VPS actuel
(hébergement distant pour démo), qui reste adapté pour présenter l'app à
distance mais pas pour une exploitation offline-first en salle.

### Phase 5quinquies — Durcissement compte Admin, traçabilité service, paiements mobiles (§5.4/§5.5/§6.4)

Cinq corrections demandées ensemble après le déploiement VPS, en préparant
la présentation au collaborateur :

**1. Compte Admin protégé** — `UserViewSet.update`/`partial_update`/
`destroy`/`set_pin` refusent désormais toute action sur un compte
`is_superuser=True` (403, quel que soit qui la demande, manager ou même
un autre admin). Choix volontaire de se baser sur `is_superuser` plutôt
que sur le nom d'utilisateur "Admin" en dur — plus robuste, couvre aussi
un futur second superutilisateur créé de la même façon. `is_superuser`
était jusqu'ici totalement absent de `UserSerializer` ("jamais exposé,
pour ne pas ouvrir d'escalade de privilèges") ; ajouté en lecture SEULE
(`read_only_fields`) — le frontend (`GestionUtilisateurs.jsx`) en a besoin
pour griser la ligne ("🔒 Compte système — protégé"), aucun risque
d'escalade puisqu'il ne peut jamais être écrit par ce serializer, et les
overrides de vue bloquent de toute façon l'action indépendamment de ce
qu'un client enverrait.

**2. Suppression de commande réservée au rôle admin** — nouvelle
permission `IsAdmin` (`permissions.py`, rôle strictement `admin`, pas
`manager` — distinct d'`IsManagerOrAdmin` déjà existant), branchée sur
`OrderViewSet.get_permissions()` pour l'action `destroy` uniquement.
Volontairement basé sur le **rôle**, pas sur `is_superuser` — un tenant
peut avoir plusieurs comptes `role=admin` (associé, comptable...), la
protection du point 1 est une notion différente (LE compte système
unique) de celle-ci (n'importe quel admin métier).

**3. Traçabilité du service** — nouveau champ `OrderItem.servi_par`
(FK `User`, `SET_NULL`, migration `0010`). Posé à deux endroits pour
couvrir les deux chemins qui mènent à "servi" :
- `OrderItemViewSet.marquer_servi` (écran Service dédié, Phase 5quater)
  pose directement `item.servi_par = request.user`.
- `signals.py::_sync_lignes_statut` (cascade ticket → lignes, utilisée
  par le bump ticket-entier classique de l'écran cuisine) pose
  `servi_par = get_current_user()` sur les lignes qu'elle fait
  effectivement passer à "servi" — l'exclusion déjà existante
  (`exclude(statut_ligne__in=exclusions)`) protège naturellement les
  lignes déjà servies individuellement (donc déjà attribuées) d'un
  écrasement lors d'une promotion automatique de ticket.
- Vérifié : un plat marqué "prêt" par un compte puis "servi" par un
  **autre** compte enregistre bien le second, pas le premier — la
  traçabilité suit qui a réellement fait le geste de service, pas la
  préparation.
- Exposé en lecture via `servi_par_nom` (`OrderItemSerializer`, même
  pattern que `serveur_nom`/`caissier_nom`) — pas encore affiché dans
  une UI de reporting dédiée, mais la donnée est capturée dès maintenant
  ("pour un suivi", explicitement demandé) plutôt que perdue faute
  d'avoir été enregistrée au moment du geste.

**4. Bouton de connexion renommé** — "Cuisine (PIN)" → "Service"
(`LoginScreen.jsx`), purement cosmétique : ce mode de connexion sert
autant aux serveurs qu'aux cuisiniers (PIN, écran tactile), "Service"
est un terme plus neutre que "Cuisine" pour les deux profils.

**5. Modes de paiement mobiles précisés** — `Order.ModePaiement` : le
choix générique `mobile_money` est remplacé par trois choix distincts,
`wave`/`orange_money`/`momo` (migration `0011`, `Espèces`/`Carte`/
`Autre` inchangés). Mis à jour partout où les libellés étaient
dupliqués (`print/imprimer.js::LIBELLE_MODE_PAIEMENT`, seule source
maintenant — `RapportsTab.jsx` importe la même constante au lieu d'en
garder une copie séparée, corrigé au passage pour éviter que les deux
dérivent). *(Affichage des pastilles revu une nouvelle fois juste après
— cf. section suivante, "Mobile Money" replié derrière une catégorie.)*

Testé de bout en bout en local avant déploiement (comptes `demo`
manager et un compte `admin2` temporaire `role=admin` non-superutilisateur,
pour bien distinguer les deux notions du point 1 vs point 2) :
tentative de désactivation du compte Admin par un manager → 403 avec le
bon message ; suppression de commande par un manager → 403, par un
compte admin (rôle, pas superutilisateur) → 204 ; plat marqué prêt par
`demo`, servi par un autre compte → `servi_par_nom` correctement
attribué au second ; pastilles Wave/Orange Money/Momo visibles sur
l'écran Caisse, "Mobile Money" disparu partout. Déployé sur le VPS
(`git push vps main`), migrations appliquées automatiquement par le
hook, vérifié en ligne après coup. Compte de test `admin2` et données
de test nettoyés après les vérifications.

### Phase 5sexies — Retours après démo : cache PWA, écran de sélection simplifié, Mobile Money replié

Cinq retours groupés après un premier tour d'usage réel sur le VPS,
certains révélant un vrai bug plutôt qu'une simple préférence :

**1. Bug de cache PWA — pas un problème de déploiement.** Le
collaborateur voyait encore "Cuisine (PIN)" après le déploiement du
renommage en "Service" (Phase 5quinquies). Vérifié directement : le
bundle JS servi par le VPS contenait déjà "Service" et plus "Cuisine
(PIN)" — le déploiement était correct, c'est le **service worker déjà
installé côté navigateur** qui continuait de servir l'ancien app shell
en cache (`registerType: 'autoUpdate'` seul ne force pas l'activation
immédiate du nouveau SW — l'ancien reste aux commandes tant que tous les
onglets ne sont pas fermés). Corrigé dans `vite.config.js` :
`workbox: { skipWaiting: true, clientsClaim: true }`, qui fait prendre
le contrôle par le nouveau SW dès son installation. Un utilisateur déjà
sur un SW antérieur à ce correctif doit encore recharger une fois "en
dur" (Ctrl+Maj+R) pour en sortir ; tous les déploiements suivants
s'appliqueront sans ça.

**2 et 3. Écran de sélection simplifié.** Les boutons "Poste X"
individuels ont été retirés de `SelectionEcran.jsx` — "Écran Master"
voit déjà tous les postes, un doublon inutile pour qui atterrit sur cet
écran (manager/admin sans poste assigné ; un cuisinier avec poste
assigné ne voit de toute façon jamais cet écran, routé directement).
"Service" (Phase 5quater) n'est plus proposé qu'au rôle **serveur**
(`ROLES_SERVICE = ['serveur']` dans `App.jsx`, au lieu de `['serveur',
'manager', 'admin']`) — un manager/admin a déjà Master et Caisse,
strictement plus complets. Un serveur ne voit donc plus que "Caisse" et
"Service" sur cet écran ; un manager/admin voit "Tableau de bord",
"Caisse", "Écran Master" — plus aucun doublon des deux côtés.

**5 (suite). Mobile Money replié derrière une catégorie.** Les 6
pastilles à plat (Espèces/Wave/Orange Money/Momo/Carte/Autre,
Phase 5quinquies) redeviennent 4 catégories au premier niveau
(Espèces/Mobile Money/Carte/Autre) — cliquer "Mobile Money" révèle une
deuxième rangée avec les 3 opérateurs (Wave présélectionné par défaut,
modifiable). `Order.ModePaiement` n'a **pas** de valeur "mobile_money"
générique (retirée en Phase 5quinquies) — c'est purement un regroupement
d'affichage côté `CaisseScreen.jsx`, `modePaiement` reste toujours l'un
des 3 opérateurs concrets une fois choisi, jamais une catégorie
intermédiaire envoyée au backend.

Testé de bout en bout en local (comptes `demo` et `serveur1`
reconstitués via `seed_demo` après un redémarrage de Docker Desktop qui
avait fait perdre l'état de la base locale) : écran de sélection manager
sans bouton "Poste"/"Service" ; écran de sélection serveur limité à
Caisse/Service, Master absent ; catégorie "Mobile Money" repliée par
défaut, Wave/Orange Money/Momo révélés au clic. Déployé (`git push vps
main`), bundle et service worker servis vérifiés directement par
`curl` (présence de "Service", absence de "Cuisine (PIN)",
`skipWaiting`/`clientsClaim` bien dans le `sw.js` généré).

### Phase 5septies — Retours mobile + écran "Prendre commande" (§5.1/§5.6)

Trois corrections/ajouts après un test en conditions réelles sur un vrai téléphone (pas juste le viewport simulé de Playwright) :

**Bug réel trouvé sur mobile** : le badge "Facture uniquement — encaissement réservé aux managers" (`CaisseScreen.jsx`, vue serveur) utilisait `rounded-full` — correct pour un texte court en pilule, mais ce badge est volontairement long. Sur un écran étroit, le texte enroulé sur plusieurs lignes à l'intérieur d'un `rounded-full` donne un **cercle qui écrase le titre** plutôt qu'un rectangle arrondi lisible (`border-radius: 9999px` sur un élément haut et multi-lignes forme un blob, pas un badge). Corrigé (`rounded-lg`) et disposition revue sur les trois écrans concernés (Caisse/Service/Cuisine) : titre seul sur sa ligne, tous les boutons/badges regroupés sur une ligne séparée en dessous — demandé explicitement pour éviter tout risque de recouvrement, quelle que soit la largeur du contenu du badge.

**Nouvel écran "📝 Prendre commande"** (`PrendreCommandeScreen.jsx`) — réponse directe à une question de résilience réseau : les clients scannent le QR avec leur **propre** connexion mobile (pas le WiFi du restaurant), donc même avec un serveur hébergé localement chez le client (cf. discussion architecture), une coupure internet du restaurant empêche un client d'atteindre l'app pour passer commande — alors que le personnel, connecté au WiFi local, continue d'atteindre le serveur normalement. Cet écran permet au personnel de prendre la commande à la place du client dans ce cas (et en usage courant aussi, simplement).

- **Backend** : nouvelle action `POST /api/orders/prendre-commande/` (`OrderViewSet`, action de liste puisqu'elle crée une nouvelle commande) — réutilise **telle quelle** `services.route_items_to_tickets`, la même fonction de routage que le flux QR client et `add-items` (aucune logique dupliquée). Différence avec le flux QR : authentifié, `Order.serveur = request.user` posé automatiquement (le flux QR anonyme ne le renseigne jamais), table imposée directement (pas de token QR à résoudre). Nouveaux serializers `StaffOrderItemLineSerializer` (étend `AddOrderItemLineSerializer`, ajoute `service_immediat` — absent de l'original car pensé pour un ajout POS simple) et `StaffOrderCreateSerializer` (`TenantScopedFieldsMixin`, donc la table proposée est déjà filtrée au tenant sans vérification manuelle).
- **Frontend** : sélection de table (grille avec statut Libre/Occupée) → menu groupé par catégorie (même source que l'écran Menu admin, `/api/menu-items/`+`/api/menu-categories/`) → panier persistant en bas d'écran (quantité +/-, bascule "Dès que prêt / Avec le reste" par ligne comme le client QR) → envoi. Accessible à `serveur`/`manager`/`admin` (`ROLES_PRENDRE_COMMANDE` dans `App.jsx`) — contrairement à "Service", pas réservé aux seuls serveurs : n'importe quel membre du staff peut avoir besoin de prendre une commande.

Testé de bout en bout en local : commande prise pour une table via ce nouvel écran → vérifié en base que `Order.serveur` pointe le bon compte, `source='salle'`, et que les tickets sont correctement répartis par poste (un ticket Plats, un ticket Boissons pour une commande mixte) — routage identique à ce que produirait le même panier via le flux QR client. Déployé, bundle vérifié par `curl`.

### Phase licence — Système d'abonnement (maître/client)

Problème d'affaires, pas technique au départ : une installation cliente
peut tourner sur un serveur **local, chez le client** (cf. discussion
architecture/résilience réseau plus haut) — sans dépendance cloud
permanente, comment s'assurer que le client reste à jour dans ses
paiements, sans pour autant rendre l'app inutilisable au moindre souci
réseau ? Modèle retenu : sanctions **graduées et tolérantes à
l'offline** plutôt qu'un blocage brutal au premier jour de retard —
bandeau d'avertissement (jour 1) → rapports désactivés (15 jours) →
blocage complet (45 jours), cf. `kds_core/models/licence.py`
(`JOURS_AVANT_RETARD_PROLONGE`, `JOURS_AVANT_SUSPENSION`).

Architecture maître/client à plat sur la même codebase (un seul
déploiement Django peut jouer l'un ou l'autre rôle selon `.env`,
`EST_SERVEUR_MAITRE`) :

- **`LicenceClient`** (existe seulement côté serveur **maître** — le VPS
  central) : un enregistrement par installation cliente
  (`identifiant`/`cle_api` générée automatiquement/`date_prochaine_echeance`).
  Le `statut` (`actif`/`retard`/`retard_prolonge`/`suspendu`) est une
  **propriété calculée** à partir de `date_prochaine_echeance`, jamais
  stockée — pas de tâche cron nécessaire côté maître pour "faire
  vieillir" un statut, il se recalcule à chaque lecture.
- **`EtatLicenceLocal`** (singleton, existe côté **chaque installation**,
  y compris le maître lui-même) : cache local du dernier statut connu.
  C'est ce cache, pas un appel réseau, que consultent les permissions/
  middleware à chaque requête — une installation cliente reste pleinement
  fonctionnelle entre deux pointages, et un pointage raté (panne réseau)
  ne dégrade jamais brutalement le service, il laisse simplement le
  dernier statut connu en place.
- **`POST /api/licence/pointage/`** (`LicencePointageView`, `AllowAny`
  mais authentifié par secret partagé `identifiant`+`cle_api` en body —
  pas de session utilisateur, c'est un appel machine-à-machine) :
  n'existe que côté maître (404 sinon, `settings.EST_SERVEUR_MAITRE`),
  renvoie le `statut` calculé du `LicenceClient` correspondant.
- **`GET /api/licence/statut/`** (`LicenceStatutView`, staff authentifié) :
  côté maître renvoie toujours `actif` (le maître ne se facture pas
  lui-même) ; côté client renvoie `EtatLicenceLocal.instance()`. C'est ce
  que consomme le frontend.
- **`manage.py verifier_licence`** : commande de pointage côté client,
  faite pour tourner en tâche planifiée (timer systemd utilisateur,
  cf. `DEPLOY.md`) — best-effort, capture `RequestException` et ne
  plante jamais (une installation cliente ne doit jamais être mise en
  échec par une commande de fond), no-op silencieux si
  `EST_SERVEUR_MAITRE=True` ou si les réglages licence sont vides (permet
  de déployer le même code partout sans configuration conditionnelle).
- **Application des restrictions** : `LicenceRapportsAutorises`
  (`permissions.py`, ajouté aux 5 vues de `stats_views.py` — deux d'entre
  elles, `ProductiviteEmployesView`/`VentesParJourView`, déclarent leur
  propre `permission_classes` et n'héritent pas de celle de la classe de
  base, ajouté explicitement aux deux) bloque uniquement les rapports à
  partir de `retard_prolonge`. `LicenceEnforcementMiddleware`
  (`middleware.py`) bloque tout `/api/` (sauf `/api/auth/`,
  `/api/licence/`, `/media/`, `/static/` — jamais l'authentification ou
  le pointage lui-même) avec un 402 explicite à partir de `suspendu`.
- **Frontend** (`App.jsx`) : `fetchLicenceStatut()` appelé en best-effort
  au même moment que `fetchMe()` (une erreur réseau reste sur `actif` par
  défaut plutôt que de bloquer l'app sur un détail de licence).
  `EcranSuspendu` remplace tout l'écran au statut `suspendu` (🔒, message,
  bouton déconnexion). `BanniereLicence` (bandeau ambre en haut) s'affiche
  aux statuts `retard`/`retard_prolonge`, visible seulement
  `manager`/`admin` (`ROLES_BANNIERE_LICENCE`) — un serveur/cuisinier n'a
  rien à faire d'une question d'abonnement.

**Limite assumée, communiquée explicitement** : ce système décourage un
retard de bonne foi et automatise le suivi, mais un client techniquement
sophistiqué avec un accès root à son propre serveur peut le contourner
(modifier `EtatLicenceLocal` en base, désactiver le timer...). Pas conçu
comme une protection anti-piratage béton — à combiner avec des mesures
contractuelles/matérielles si un client se montre réellement de mauvaise
foi. Le vrai traitement des paiements (au lieu d'une simple date
d'échéance saisie manuellement côté admin) reste une mise à jour future,
explicitement différée.

Testé de bout en bout en local (le même processus Django jouant tour à
tour maître puis client, `.env` modifié entre les deux — un redémarrage
du serveur dev est nécessaire à chaque changement, Django ne relit `.env`
qu'au démarrage) : pointage maître valide les identifiants et renvoie le
bon statut calculé ; `verifier_licence` met à jour le cache local ;
`LicenceRapportsAutorises` renvoie bien 403 sur les rapports à
`retard_prolonge` sans affecter le reste de l'API ; le middleware renvoie
bien 402 sur `/api/orders/` à `suspendu` tout en laissant passer
`/api/licence/statut/` et `/api/auth/login/` (vérifié par `curl` avec un
vrai JWT). Rendu frontend confirmé par Playwright pour les deux états
(`EcranSuspendu` et `BanniereLicence`, connecté `demo`/`demo1234`, rôle
manager). Données de test (`.env`, `LicenceClient` de test,
`EtatLicenceLocal`) nettoyées après coup — voir `DEPLOY.md` pour la
configuration réelle maître (VPS)/client.

### Phase installer — Paquet d'installation client (Docker, hors ligne)

Suite directe de la phase licence : une fois le mécanisme d'abonnement en
place, il fallait un moyen réel d'installer une nouvelle instance chez un
client — sur son propre serveur local, potentiellement **sans aucun accès
internet sur place** (clé USB). Détail complet (architecture Docker,
`setup_tenant`, construction/distribution du paquet, séquence d'installation)
dans `DEPLOY.md`, section "Paquet d'installation client" — ce README ne
documente que ce qui a changé côté code applicatif pour le rendre possible :

- **Frontend build-once, deploy-anywhere** : le frontend ne peut plus
  embarquer une URL d'API absolue (`VITE_API_BASE_URL`/`VITE_WS_BASE_URL`) —
  contrairement au build VPS (une seule IP/domaine connu), ce paquet est
  construit **une fois** puis installé chez des clients ayant chacun une IP
  LAN différente. `api.js`/`clientApi.js` retombent maintenant sur des appels
  relatifs (même origine que la page servie) quand ces variables sont vides ;
  `wsBaseUrl()` dérive `ws://`/`wss://` depuis `window.location` plutôt qu'une
  valeur figée. Le slug du tenant (`VITE_TENANT_SLUG`, utilisé par la
  connexion PIN kiosque) pose un problème différent — pas une URL, une vraie
  valeur par client, décidée seulement à l'installation — résolu par un petit
  mécanisme de configuration au runtime (`frontend/public/env-config.js`,
  réécrit par le conteneur nginx au démarrage) plutôt qu'au build.
- **`manage.py setup_tenant`** (nouvelle commande) : onboarding non
  interactif d'un vrai client — crée un `Tenant` + un premier compte admin,
  rien de plus (contrairement à `seed_demo`, qui scaffold un jeu de données
  complet). Le client configure sa vraie carte/postes/équipe lui-même via le
  tableau de bord existant (Phase 6) après sa première connexion.
- **`USE_HTTPS_REVERSE_PROXY`** (nouveau réglage) : `SECURE_PROXY_SSL_HEADER`/
  `CSRF_TRUSTED_ORIGINS` supposaient jusqu'ici un Nginx qui termine du vrai
  TLS (vrai pour le VPS, faux pour une installation cliente en HTTP simple
  sur un LAN sans domaine public — y forcer `https://` aurait fait échouer le
  login Django admin). Défaut `True`, comportement du VPS inchangé.

Se référer au document *Cahier des charges — Application KDS* (sections 4 à 7)
pour le détail fonctionnel de chaque module.
