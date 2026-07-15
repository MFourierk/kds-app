# Déploiement — VPS behanian (kds.behanian.com)

## Flux normal : une correction → un déploiement

```bash
# 1. Construire le frontend (obligatoire si src/ a changé — pas de Node.js sur le VPS)
cd frontend && npm run build && cd ..

# 2. Commit + push
git add -A
git commit -m "..."
git push origin main   # GitHub — historique, collaboration
git push vps main      # VPS — déploiement effectif
```

`git push vps main` déclenche automatiquement, côté serveur (`~/kds-deploy.git/hooks/post-receive`) :
1. Checkout du code vers `/opt/kds-app`
2. `pip install -r requirements.txt`
3. `manage.py migrate`
4. `manage.py collectstatic`
5. Redémarrage du service (`systemctl --user restart kds-daphne.service`)

Aucun mot de passe, aucun sudo — le service tourne en **service utilisateur systemd**
(`~/.config/systemd/user/kds-daphne.service`, lingering activé pour `behanian`).

## Ce qui n'est JAMAIS écrasé par un déploiement

Ces chemins sont dans `.gitignore` — un `git push vps` ne les touche jamais :
- `.env` (secrets — à éditer directement sur le serveur si besoin)
- `media/` (logos/photos uploadés depuis l'app)
- `staticfiles/` (régénéré par `collectstatic`, pas versionné)
- `venv/`

## Remotes Git

- `origin` → https://github.com/MFourierk/kds-app.git (historique, collaboration)
- `vps` → `ssh://behanian@89.167.66.194/home/behanian/kds-deploy.git` (déploiement)

## Infrastructure (VPS Ubuntu 24.04, partagé avec l'app hôtelière `/opt/behanian`)

| Élément | Valeur |
|---|---|
| Code | `/opt/kds-app` |
| Base de données | PostgreSQL 17 (cluster partagé), DB/user dédiés au KDS |
| Cache/WS | Redis (installé pour ce projet) |
| Backend | Daphne (ASGI), `127.0.0.1:8001`, service **utilisateur** systemd |
| Frontend | Statique, servi par Nginx depuis `/opt/kds-app/frontend/dist` |
| Domaine | `kds.behanian.com` (sous-domaine temporaire — à retirer en fin de mission, cf. note ci-dessous) |
| SSL | Certbot/Let's Encrypt, certificat dédié à `kds.behanian.com` |

Isolation totale de l'app hôtelière existante : dossier séparé, base séparée,
service séparé, port séparé (`8000` = hôtelier, `8001` = KDS), fichier Nginx séparé.

## ⚠️ kds.behanian.com est un domaine client, temporaire

Le sous-domaine a été ajouté sur `behanian.com` uniquement pour cette démo — à
retirer proprement une fois la présentation faite (DNS chez le registrar, config
Nginx `/etc/nginx/sites-available/kds`, certificat Certbot). Ne pas le laisser
traîner en prod sur le domaine d'un client.

## Système de licence (abonnement)

Le VPS est le **serveur maître** — c'est lui qui héberge les `LicenceClient`
(un par installation cliente) et répond aux pointages. Chaque installation
cliente (ex: un serveur local chez un restaurant) pointe périodiquement
auprès du maître pour confirmer que son abonnement est à jour.

### Côté maître (ce VPS)

`.env` : `EST_SERVEUR_MAITRE=True` (les variables `LICENCE_MASTER_URL` /
`LICENCE_IDENTIFIANT` / `LICENCE_CLE_API` restent vides — le maître ne pointe
pas auprès de lui-même).

Créer un client : Django admin → **Licence clients** → nouveau
`LicenceClient` (identifiant, nom, date de prochaine échéance). `cle_api` est
généré automatiquement à la sauvegarde — c'est cette valeur (avec
`identifiant`) qu'il faut transmettre à l'installation cliente.

### Côté client (installation locale chez un restaurant)

`.env` :
```
EST_SERVEUR_MAITRE=False
LICENCE_MASTER_URL=https://kds.behanian.com
LICENCE_IDENTIFIANT=<identifiant du LicenceClient>
LICENCE_CLE_API=<cle_api du LicenceClient>
```

Pointage périodique via `manage.py verifier_licence` (best-effort — ne
bloque jamais l'app en cas d'échec réseau, met juste à jour le statut mis en
cache localement `EtatLicenceLocal`). À planifier avec un timer systemd
utilisateur (même logique que `kds-daphne.service`, pas de sudo) :

```ini
# ~/.config/systemd/user/kds-licence-check.service
[Unit]
Description=Pointage licence KDS

[Service]
Type=oneshot
WorkingDirectory=/opt/kds-app
ExecStart=/opt/kds-app/venv/bin/python manage.py verifier_licence
```

```ini
# ~/.config/systemd/user/kds-licence-check.timer
[Unit]
Description=Pointage licence KDS toutes les 6h

[Timer]
OnBootSec=5min
OnUnitActiveSec=6h

[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now kds-licence-check.timer
```

### Paliers de sanction (§licence)

| Retard | Statut | Effet |
|---|---|---|
| 0 jour | `actif` | Rien |
| 1–14 jours | `retard` | Bandeau d'avertissement (manager/admin) |
| 15–44 jours | `retard_prolonge` | + rapports (`/api/stats/*`) désactivés (403) |
| ≥ 45 jours | `suspendu` | Accès API bloqué (402), écran de blocage plein écran |

## Paquet d'installation client (Docker, hors ligne)

**Mécanisme séparé de `git push vps`** : celui-ci met à jour l'app *de ce
VPS*. Le paquet décrit ici sert à installer une **nouvelle instance
indépendante**, chez un client, sur son propre serveur local — typiquement
sans accès internet sur place (cf. §licence, chaque installation cliente
pointe périodiquement vers ce VPS, mais reste pleinement fonctionnelle entre
deux pointages).

Toute la mécanique est sous `deploy/client-package/` : deux images Docker
(backend Django/Daphne, frontend nginx) construites une seule fois puis
`docker save`/`docker load` — pas de paquet système à récupérer sur place,
robuste aux différences de version d'Ubuntu d'un site client à l'autre.

### Construire le paquet (sur la machine de l'opérateur — Docker Desktop + Node, jamais sur le VPS)

```bash
./scripts/build-client-package.sh
```

Produit `dist-client-package/kds-client-<version>.tar.gz` — build frontend
(profil `client-package`, URLs relatives, cf. `frontend/.env.client-package`),
build + `docker save` des deux images, assemblage avec `install.sh` et un
gabarit `.env`.

### Distribuer le paquet

- **Via le VPS** : `scp` le `.tar.gz` vers `~/kds-client-packages/` (dossier
  dédié, distinct de `~/kds-deploy.git`) — l'opérateur peut ensuite le
  récupérer en SSH depuis n'importe où.
- **Via clé USB** : copier directement le `.tar.gz`, aucun VPS impliqué —
  seule option si le site client n'a ni internet ni accès au VPS au moment
  de l'installation.

### Installer chez le client

Prérequis unique : Docker Engine déjà installé sur la machine cible (fait au
bureau, avec internet, `curl -fsSL https://get.docker.com | sh` — jamais
fait par le paquet lui-même).

```bash
tar xzf kds-client-<version>.tar.gz
cd kds-client-<version>
./install.sh
```

`install.sh` charge les images, demande le nom de l'établissement, le
premier compte admin, et l'identifiant/clé API de licence (créés au
préalable via `/admin/` sur ce VPS, cf. §licence ci-dessus — aucune
vérification réseau à cette étape). Aucun besoin d'internet du début à la
fin ; la vérification de licence (`verifier_licence`, conteneur
`licence-checker`) se synchronisera automatiquement dès que la connexion
sera rétablie, sans action supplémentaire.

Une fois installé, le client configure lui-même sa vraie carte/postes/équipe
via le tableau de bord (onglets Menu/Postes/Équipe/Établissement, déjà
construits) — le paquet ne crée que le tenant et le premier compte admin
(`manage.py setup_tenant`), volontairement rien de plus.

## Commandes utiles côté serveur

```bash
# Logs du service (journal utilisateur, pas sudo journalctl)
journalctl --user -u kds-daphne.service -f

# Statut
systemctl --user status kds-daphne.service

# Redémarrage manuel (rarement nécessaire, le hook le fait déjà)
systemctl --user restart kds-daphne.service
```
