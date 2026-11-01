# Suivi Académique

![Open source](https://img.shields.io/badge/open%20source-oui-brightgreen)
![Licence MIT](https://img.shields.io/badge/licence-MIT-blue)
![Dépôt public](https://img.shields.io/badge/d%C3%A9p%C3%B4t-public-lightgrey)
![Frontend](https://img.shields.io/badge/frontend-HTML%20%C2%B7%20Bootstrap%205%20%C2%B7%20JS%20natif-informational)

**Application web de suivi académique départemental** : notes, bulletins, heures et présences des enseignants, calendrier et rappels. Trois espaces selon le rôle : **chef de département**, **enseignant** et **étudiant**.

> ## 🌍 Projet open source
> Ce dépôt est **public** et le code est **libre** (licence [MIT](LICENSE)) : vous pouvez le lire, l'utiliser, le modifier, le redistribuer et vous en inspirer, y compris pour un usage commercial, en conservant la mention de copyright. Les idées, corrections et contributions sont les bienvenues (voir [Contribuer](#contribuer)).

**Créateur : [Jeffrey Choguen](https://jeffreychoguen.cloud)** · [jeffreychoguen.cloud](https://jeffreychoguen.cloud)

---

## Sommaire

- [Ce que fait l'application](#ce-que-fait-lapplication)
- [Lancer le projet](#lancer-le-projet)
- [Comptes de démonstration](#comptes-de-démonstration)
- [Technologies](#technologies)
- [Structure du projet](#structure-du-projet)
- [État du projet et backend](#état-du-projet-et-backend)
- [Contribuer](#contribuer)
- [Licence et crédits](#licence-et-crédits)

## Ce que fait l'application

| Espace | Fonctionnalités principales |
|---|---|
| **Chef de département** | Tableau de bord (indicateurs, tendances, graphiques) · gestion des étudiants et des enseignants (fiches, ajout, modification, suppression, export) · matières et attributions · consultation des notes · **génération des bulletins** (relevés de notes au format camerounais, PDF unitaire ou groupé) · suivi des **heures** et des **présences** des enseignants · **calendrier** avec rappels et notifications · **gestion des comptes** (activation, réinitialisation de mot de passe) |
| **Enseignant** | Tableau de bord · ses matières · **saisie et validation des notes** (brouillon, validation, rattrapage) · **déclaration des séances** et historique · **« Marquer ma présence »** par géolocalisation · calendrier · profil et réglages |
| **Étudiant** | Tableau de bord (moyenne, progression, comparaison à la classe) · **notes validées** · **bulletin** (aperçu et téléchargement PDF) · calendrier · profil et réglages |

Transversal : exports **Excel (.xlsx) mis en forme**, CSV et agenda **.ics** · recherche rapide · rappels automatiques J-7 / J-1 · profil, photo et réglages personnels · interface en français, utilisable sur ordinateur et sur téléphone · bibliothèques embarquées (fonctionne **hors ligne**, sans installation npm).

## Lancer le projet

Aucune installation : pas de `npm`, pas de build. Il suffit de servir le dossier (les modules ES et les données de démonstration ne fonctionnent pas en `file://`) :

```bash
git clone https://github.com/Jeffrey-04/Suivi_academique.git
cd Suivi_academique
php -S localhost:8000        # ou : python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000/>.

## Comptes de démonstration

Mot de passe commun : **`demo1234`** (les comptes sont aussi proposés en un clic sur la page de connexion).

| Rôle | Adresse e-mail |
|---|---|
| Chef de département | `chef@dept-info.demo` |
| Enseignant | `herve.kamga@dept-info.demo` |
| Étudiant | `ulrich.foning@etu.dept-info.demo` |

Les données sont **fictives** et réalistes (3 filières, 54 étudiants, 14 enseignants, 45 matières, 870 séances…). La date du jour est **simulée** au 25/01/2027 pour que le jeu de données reste cohérent. Les modifications faites dans l'application sont conservées dans le navigateur ; le menu du profil propose « Réinitialiser la démo ».

## Technologies

- **HTML statique + JavaScript natif** (modules ES, sans framework ni bundler)
- **Bootstrap 5** et Bootstrap Icons
- **ApexCharts** (graphiques), **Flatpickr** (sélecteur de période)
- **ExcelJS** (export Excel) et **jsPDF** (bulletins PDF), chargés à la demande
- Police *Plus Jakarta Sans*

Toutes les bibliothèques sont copiées dans `assets/libs/` (versions et licences dans [assets/libs/README.md](assets/libs/README.md)).

## Structure du projet

```
School/
├── index.html · page-login.html · page-404.html
├── pages/{chef,enseignant,etudiant}/   # une page HTML par écran
├── assets/
│   ├── css/main.css                    # feuille de style unique, sections numérotées
│   ├── libs/                           # bibliothèques tierces (locales)
│   ├── mock/                           # données de démonstration (JSON)
│   └── js/
│       ├── services/                   # couche de données : mock ⇄ backend, règles de gestion
│       ├── utils/ · components/        # calculs, composants et utilitaires partagés
│       └── pages/                      # un module par page
└── tools/generate-mock.mjs             # génère les données de démonstration
```

Les pages ne lisent jamais les données directement : elles passent par `assets/js/services/`. C'est ce qui permettra de brancher un vrai backend sans toucher aux écrans.

## État du projet et backend

- **Frontend complet** pour les trois rôles, alimenté par des **données simulées** (aucun appel réseau réel, aucun code serveur).
- Le **backend PHP** sera branché ensuite : les écrans passent uniquement par la couche de services (`assets/js/services/`), c'est elle qu'il suffira d'adapter ; aucune page n'est à modifier.
- ⚠️ **Démonstration uniquement** : l'authentification est simulée et les mots de passe de démonstration sont en clair. La vraie sécurité (authentification, droits, contrôles) doit être assurée par le serveur ; l'établissement et le doyen figurant sur les relevés sont **fictifs**.

Régénérer les données de démonstration après modification du générateur :

```bash
node tools/generate-mock.mjs
```

## Contribuer

Les contributions sont les bienvenues : signaler un problème, proposer une amélioration, corriger une faute, ajouter une fonctionnalité. Avant de proposer une modification :

1. Parcourir la [structure du projet](#structure-du-projet) : un écran = une page HTML + un module dans `assets/js/pages/` ; la logique métier vit dans `assets/js/services/` et `assets/js/utils/calculs.js`.
2. Respecter les principes : **interface en français, code en anglais**, aucun style en ligne, pas de variable globale, composants existants réutilisés, **pages sans accès direct aux données** (passer par les services).
3. Ne pas modifier `assets/mock/*.json` à la main : modifier `tools/generate-mock.mjs` puis le relancer.
4. Vérifier dans le navigateur : console sans erreur, rendu ordinateur **et** téléphone, les trois rôles.

Ouvrez une *issue* pour discuter d'un changement important avant de le développer.

## Licence et crédits

Distribué sous licence **[MIT](LICENSE)** : © 2026 **[Jeffrey Choguen](https://jeffreychoguen.cloud)**.

Crédits et licences des composants réutilisés :

- **Spark Admin** (mise en page et feuille de style d'origine) : © [Spark Admin Dev](https://sparkadminpro.gumroad.com/), licence MIT, distribué par [ThemeWagon](https://themewagon.com/themes/spark-admin/). Le texte du copyright d'origine est conservé dans [LICENSE](LICENSE).
- **Bootstrap**, **Bootstrap Icons**, **ApexCharts**, **Flatpickr**, **ExcelJS**, **jsPDF** : licence MIT (détail dans [assets/libs/README.md](assets/libs/README.md)).
- Police **Plus Jakarta Sans** : licence SIL Open Font License, chargée depuis Google Fonts.

---

<p align="center">Fait avec soin par <a href="https://jeffreychoguen.cloud"><strong>Jeffrey Choguen</strong></a> · open source, pour tous.</p>
