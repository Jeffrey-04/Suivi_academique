# Vérifications automatiques

Scripts Node (≥ 22) qui contrôlent l'application **contre l'API réelle**. Aucune dépendance à installer.

## Tout lancer

```bash
# Base MySQL/MariaDB VIDE accessible (elle est réinitialisée à chaque suite !)
DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=suivi_academique DB_USER=root DB_PASS= node tools/tests/run-all.mjs
node tools/tests/run-all.mjs --quick     # sans les suites navigateur
```

`run-all.mjs` démarre lui-même les serveurs PHP nécessaires (principal, e-mails simulés, base injoignable), rejoue chaque suite et affiche un bilan.

## Les suites

| Fichier | Vérifie |
|---|---|
| `api-parity.mjs` | **69 lectures** : la réponse de l'API est identique au résultat des services du frontend en mode simulé (formes JSON, valeurs, calculs) |
| `api-authz.mjs` | **89 routes × 4 rôles** (anonyme, chef, enseignant, étudiant) : droits et périmètres |
| `api-writes.mjs` | **40 écritures refusées** : mêmes messages et mêmes champs d'erreur que le frontend |
| `api-flow.mjs` | **scénarios d'écriture** (personnes, notes, bulletins, séances, présence, événements, comptes) comparés au mode simulé |
| `api-security.mjs` | injection SQL, fichiers internes, CORS / CSRF, limitation des connexions, erreurs, mots de passe temporaires, e-mails (service simulé), cron, installateur |
| `sweep.mjs` | **toutes les pages des 3 rôles** dans Chrome : console sans erreur, accessibilité de base, mobile sans défilement horizontal, panne de l'API ; `sweep.mjs mock` : mode démonstration sans serveur |
| `ui-chef.mjs`, `ui-enseignant.mjs`, `ui-etudiant.mjs` | parcours de bout en bout dans Chrome (création de comptes, saisie et validation de notes, bulletins, présence géolocalisée, profil…) |

Les suites navigateur utilisent Chrome (`CHROME_BIN` pour changer le chemin) en mode sans fenêtre.

## Autres contrôles

```bash
php backend/tests/reference-check.php      # valeurs de référence : moyennes, bulletins, heures, événements
```

## Lancer une suite seule

Serveur : `php -S localhost:8000 -t . tools/dev-router.php` (variables `DB_*` si besoin), base initialisée par `php backend/database/seed.php`, puis par exemple `node tools/tests/api-parity.mjs`.
