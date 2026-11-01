# Bibliothèques tierces locales

Copiées telles quelles (sans modification) pour que l'application fonctionne hors ligne. Aucune installation npm n'est nécessaire.

| Dossier | Bibliothèque | Version | Licence | Usage |
|---|---|---|---|---|
| `bootstrap/` | Bootstrap | 5.3.8 | MIT | Mise en page et composants |
| `bootstrap-icons/` | Bootstrap Icons | 1.13.1 | MIT | Icônes |
| `apexcharts/` | ApexCharts | 5.16.0 | MIT | Graphiques |
| `flatpickr/` | Flatpickr | 4.6.13 | MIT | Sélecteur de période |
| `exceljs/` | ExcelJS | 4.4.0 | MIT | Export des classeurs Excel (.xlsx) mis en forme |
| `jspdf/` | jsPDF | 4.2.1 | MIT | Génération des bulletins en PDF |

ExcelJS et jsPDF sont **chargés à la demande** (au premier export ou téléchargement), jamais au chargement des pages : voir `assets/js/utils/loader.js`.
Empreintes SHA-512 des archives npm vérifiées au téléchargement.
