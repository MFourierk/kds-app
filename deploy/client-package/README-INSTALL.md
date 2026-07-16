# Installation KDS — chez le client

Prérequis : Docker Engine déjà installé sur cette machine (fait au bureau,
avec internet — voir `curl -fsSL https://get.docker.com | sh`). Aucun autre
prérequis, aucun accès internet nécessaire à partir d'ici.

## Étapes

1. Copier tout ce dossier sur la machine (clé USB, ou déjà dessus).
2. Ouvrir un terminal dans ce dossier.
3. Lancer :
   ```
   ./install.sh
   ```
4. Répondre aux questions (nom de l'établissement, compte admin, identifiant
   et clé API de licence — fournis à l'avance par le prestataire).

À la fin, l'app est accessible depuis n'importe quel appareil du même
réseau local, à l'adresse affichée (`http://<IP de cette machine>/`).

Le personnel se connecte : compte admin en identifiant/mot de passe pour la
configuration (menu, postes, équipe — onglets du tableau de bord), puis
crée les comptes cuisinier/serveur (PIN) depuis "Équipe".

La vérification d'abonnement se fait automatiquement en arrière-plan, dès
que cette machine a accès à internet — rien à faire de plus.

## Mettre à jour plus tard

Depuis ce même dossier, quand une nouvelle version est disponible :
```
./update.sh
```
Va chercher automatiquement la dernière version publiée et l'applique —
aucun fichier à transférer à la main. Nécessite un accès internet au
moment de la mise à jour (sans, il l'indique simplement et ne fait rien).

## En cas de problème

```
docker compose -f docker-compose.client.yml logs -f
docker compose -f docker-compose.client.yml ps
```
