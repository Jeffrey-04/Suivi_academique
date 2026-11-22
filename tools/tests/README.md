# Vérifications automatiques

Scripts Node (≥ 22) qui contrôlent l'application **contre l'API réelle**. Aucune dépendance à installer.

## Tout lancer

```bash
# Base MySQL/MariaDB VIDE accessible (elle est réinitialisée à chaque suite !)
DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=suivi_academique DB_USER=root DB_PASS= node tools/tests/run-all.mjs
node tools/tests/run-all.mjs --quick     # sans les suites navigateur
```

`run-all.mjs` démarre lui-même les serveurs PHP nécessaires (principal, cron avec jeton, base injoignable), rejoue chaque suite et affiche un bilan.

## Les suites

| Fichier | Vérifie |
|---|---|
| `check-imports.mjs` | **contrôle statique** : chaque `import` du frontend et chaque `<script>` / `<link>` des pages pointe vers un fichier existant, et chaque nom importé est bien exporté |
| `api-parity.mjs` | **74 lectures** : la réponse de l'API est identique au résultat des services du frontend en mode simulé (formes JSON, valeurs, calculs, emploi du temps et statuts des occurrences) |
| `api-authz.mjs` | **92 routes × (anonyme, chef)** : tout est refusé à l'anonyme sauf `/config` et la connexion ; les routes supprimées avec les anciens rôles (comptes, pointage) répondent 404 |
| `api-writes.mjs` | **54 écritures refusées** : mêmes messages et mêmes champs d'erreur que le frontend (personnes, matières, notes, séances, événements, compte, **emploi du temps** : conflits, occurrences, règles des matières) |
| `api-flow.mjs` | **scénarios d'écriture** (personnes, notes saisies par le chef, bulletins, séances, **cycle d'un créneau** : créer, confirmer, absence, annuler, rétablir, modifier, supprimer ; événements, compte) comparés au mode simulé |
| `api-security.mjs` | injection SQL, fichiers internes, CORS / CSRF, limitation des connexions, erreurs, **compte unique** (aucun compte pour les fiches), cron |
| `sweep.mjs` | **toutes les pages du chef** dans Chrome : console sans erreur, accessibilité de base, mobile sans défilement horizontal, panne de l'API ; `sweep.mjs mock` : mode démonstration sans serveur |
| `ui-chef.mjs` | parcours de bout en bout dans Chrome (personnes sans compte, bulletins, **saisie et validation des notes**, séances, **emploi du temps** : confirmer, absence, annuler, créneaux et conflits, calendrier, profil) |

Les suites navigateur utilisent Chrome (`CHROME_BIN` pour changer le chemin) en mode sans fenêtre.

## Autres contrôles

```bash
php backend/tests/reference-check.php      # valeurs de référence : moyennes, bulletins, heures, événements
```

## Lancer une suite seule

Serveur : `php -S localhost:8000 -t . tools/dev-router.php` (variables `DB_*` si besoin), base initialisée par `php backend/database/seed.php`, puis par exemple `node tools/tests/api-parity.mjs`.
