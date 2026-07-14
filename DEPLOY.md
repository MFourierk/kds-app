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

## Commandes utiles côté serveur

```bash
# Logs du service (journal utilisateur, pas sudo journalctl)
journalctl --user -u kds-daphne.service -f

# Statut
systemctl --user status kds-daphne.service

# Redémarrage manuel (rarement nécessaire, le hook le fait déjà)
systemctl --user restart kds-daphne.service
```
