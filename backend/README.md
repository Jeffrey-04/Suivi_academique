# Suivi Académique — Backend

API REST du projet **Suivi Académique**, en **PHP pur** (sans Composer) et **MySQL / MariaDB**. Elle gère l'authentification, les comptes et profils, les référentiels, les étudiants, les enseignants, les matières, les notes, les bulletins, les séances, la présence géolocalisée, le calendrier, les notifications, les rappels automatiques et les statistiques.

> Le backend vit **dans le même arbre que le frontend** : le site est servi à la racine et l'API à `/backend/api`. L'organisation est identique en local et en production, aucune URL n'est à régler.

## Documentation

- [Spécification OpenAPI 3](docs/openapi.yaml) (Swagger Editor : <https://editor.swagger.io/>) et [collection Postman](postman/Suivi-Academique-API.postman_collection.json) ;
- la liste des routes est définie dans `api/index.php` ; les règles de validation précises sont dans `src/Controllers/` ;
- `GET /backend/api/config` (public) renvoie la configuration utile au frontend : date du jour du serveur, année et semestre, identité de l'établissement, mode (`demo` / `production`).

## Prérequis

- PHP 8.1+ avec `pdo_mysql`, `mbstring`, `intl` (recommandé) et `curl` (envoi d'e-mails) ;
- une base MySQL 8+ ou MariaDB 10.3+ (collation `utf8mb4_unicode_ci`) ;
- Apache avec `mod_rewrite` (ou le serveur PHP intégré pour le développement).

## Développement local

```bash
# 1. Créer une base vide « suivi_academique » (utilisateur root sans mot de passe par défaut)
# 2. Installer le jeu de démonstration (efface la base) :
php backend/install.php --mode=demo
# 3. Servir le site (le routeur reproduit les règles de .htaccess) :
php -S localhost:8000 -t . tools/dev-router.php
```

Ouvrir <http://localhost:8000/>. Pour changer l'accès à la base, utilisez des variables d'environnement (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`) ou `config/config.local.php` (voir `config.local.php.example`).

Réinitialiser les données de démonstration à tout moment (développement) : `php backend/database/seed.php`.

## Installation sur un hébergement

Voir [`../GUIDE_INFINITYFREE.md`](../GUIDE_INFINITYFREE.md) (pas à pas, sans SSH). En résumé :

1. envoyer **tout le dépôt** à la racine du site (`htdocs/`) ;
2. créer la base MySQL, copier `config/config.local.php.example` en `config/config.local.php` et le remplir (base, **`install_key`**) ;
3. ouvrir `https://votre-site/backend/install.php`, choisir **Démonstration** ou **Production** ; la page se **verrouille** ensuite (`storage/install.lock`) ;
4. configurer le **cron des rappels** et, si souhaité, les **e-mails** (sections suivantes).

### Deux modes d'installation

| Mode | Contenu | Date du jour |
|---|---|---|
| **Démonstration** | jeu de données fictif complet (54 étudiants, 14 enseignants, 870 séances…), comptes de démonstration sur la page de connexion, position du campus simulable | simulée au 25/01/2027 |
| **Production** | base vierge, un seul compte chef de département (et, au choix, la structure filières / niveaux / UE) | vraie date du serveur |

### Rappels automatiques (J-7 / J-1)

`cron/reminders.php` crée les notifications de rappel. Deux façons de le lancer :

- **ligne de commande** (hébergement avec cron) : `php backend/cron/reminders.php` ;
- **URL** (hébergement gratuit sans cron, ex. InfinityFree) : définir `'cron_token'` dans `config.local.php`, puis faire appeler chaque jour `https://votre-site/backend/cron/reminders.php?token=JETON` par un service de cron externe gratuit (cron-job.org). Sans jeton configuré, l'URL n'existe pas (404).

### E-mails (mot de passe temporaire)

À la création ou à la réinitialisation d'un compte, un **mot de passe temporaire aléatoire** est généré, **affiché une seule fois au chef de département** et envoyé par e-mail si le service est configuré. Les hébergements gratuits bloquent `mail()` et SMTP : le backend utilise l'**API HTTP de Brevo** (300 e-mails/jour gratuits). Configuration : section `'mail'` de `config.local.php` (clé d'API, adresse d'expédition validée). Sans configuration, aucun e-mail n'est envoyé et le chef communique le mot de passe lui-même.

## Sécurité

- **Authentification** : session PHP, cookie `SUIVI_SESSID` (`HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS), 7 jours ; mots de passe hachés (bcrypt) ; **5 échecs de connexion par adresse en 15 minutes** bloquent les tentatives suivantes (HTTP 429).
- **Droits** : chaque route vérifie le rôle **et** le périmètre (un étudiant ne lit que ses données validées, un enseignant que ses matières et séances). Voir `Auth.php` et les contrôleurs.
- **Injection SQL** : requêtes préparées partout ; les noms de table ne viennent jamais de l'extérieur.
- **CORS / CSRF** : même origine uniquement par défaut ; liste blanche `cors.allowed_origins` pour un autre domaine ; les écritures venant d'une origine étrangère sont refusées.
- **Erreurs** : jamais de détail technique dans les réponses (message générique) ; le détail est dans `storage/logs/app.log`.
- **Fichiers** : `.htaccess` interdit l'accès web à tout sauf `api/`, `cron/reminders.php` (jeton) et `install.php` (verrouillé après usage). `storage/` n'est pas lisible depuis le web.
- **Installation** : `install.php` exige `install_key` depuis Internet et se verrouille ; une réinstallation demande de supprimer `storage/install.lock` sur le serveur.

## Structure

```text
api/index.php               Routes REST
api/.htaccess               Réécriture d'URL vers index.php
config/config.php           Configuration par défaut (+ variables d'environnement)
config/config.local.php     Surcharge privée (non versionnée)
database/schema.sql         Schéma (15 tables)
database/migrate.php        Création / mise à jour du schéma
database/seed.php           Réinitialisation avec le jeu de démonstration (développement)
src/                        Bootstrap, Router, Auth, Database, Response, Ids, Mailer, RateLimiter, Passwords, Installer, Calculations
src/Controllers/            Contrôleurs métier
cron/reminders.php          Rappels J-7 / J-1 (ligne de commande ou URL à jeton)
install.php                 Installateur (web ou ligne de commande), verrouillé après installation
storage/                    Journaux, verrou d'installation, mode de l'instance (non lisible depuis le web)
tests/                      Outils des tests (ligne de commande uniquement)
docs/, postman/             Documentation de l'API
```

## Vérifier

```bash
php backend/tests/reference-check.php            # valeurs de référence (moyennes, bulletins, heures…)
node tools/tests/run-all.mjs --quick             # lectures, droits, écritures, scénarios, sécurité (voir tools/tests/README.md)
```

## Licence et attribution

Le backend est distribué sous licence [MIT](LICENSE).

**Développeur Backend : TYITYI Liano**

- GitHub : <https://github.com/Liano-T>
- LinkedIn : <https://www.linkedin.com/in/liano-tyityi-411b38411/>
