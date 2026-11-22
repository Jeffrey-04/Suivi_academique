/*
 * Menu de navigation du chef de département (seul rôle de l'application).
 * - href est relatif à la racine du projet.
 * - soon: true = page pas encore réalisée : l'entrée s'affiche grisée avec "Bientôt".
 *   Retirer `soon` dès que la page existe.
 * - L'entrée dont l'id vaut "calendar" sert de cible aux notifications.
 */

export const MENUS = {
    chef: [
        {
            title: 'Menu',
            items: [{ id: 'dashboard', label: 'Tableau de bord', icon: 'bi-grid-fill', href: 'pages/chef/dashboard.html' }],
        },
        {
            title: 'Personnes',
            items: [
                { id: 'students', label: 'Étudiants', icon: 'bi-people-fill', href: 'pages/chef/etudiants.html' },
                { id: 'teachers', label: 'Enseignants', icon: 'bi-person-workspace', href: 'pages/chef/enseignants.html' },
            ],
        },
        {
            title: 'Pédagogie',
            items: [
                { id: 'subjects', label: 'Matières', icon: 'bi-book', href: 'pages/chef/matieres.html' },
                { id: 'grade-entry', label: 'Saisie des notes', icon: 'bi-pencil-square', href: 'pages/chef/saisie-notes.html' },
                { id: 'grades', label: 'Résultats', icon: 'bi-clipboard-data', href: 'pages/chef/notes.html' },
                { id: 'bulletins', label: 'Bulletins', icon: 'bi-file-earmark-text', href: 'pages/chef/bulletins.html' },
            ],
        },
        {
            title: 'Suivi des enseignants',
            items: [
                { id: 'timetable', label: 'Emploi du temps', icon: 'bi-calendar-week', href: 'pages/chef/emploi-du-temps.html' },
                { id: 'attendance', label: 'Séances', icon: 'bi-calendar-check', href: 'pages/chef/presences.html' },
                { id: 'hours', label: 'Heures', icon: 'bi-clock-history', href: 'pages/chef/heures.html' },
            ],
        },
        {
            title: 'Calendrier',
            items: [{ id: 'calendar', label: 'Calendrier', icon: 'bi-calendar-event', href: 'pages/chef/calendrier.html' }],
        },
    ],
};

/** Raccourcis du bouton "Créer" de la barre du haut. */
export const QUICK_ACTIONS = {
    chef: [
        { label: 'Nouvel étudiant', icon: 'bi-person-plus', href: 'pages/chef/etudiants.html?new=1' },
        { label: 'Nouvel enseignant', icon: 'bi-person-workspace', href: 'pages/chef/enseignants.html?new=1' },
        { label: 'Nouvelle matière', icon: 'bi-book', href: 'pages/chef/matieres.html?new=1' },
        { label: 'Nouveau créneau', icon: 'bi-calendar-week', href: 'pages/chef/emploi-du-temps.html?new=1' },
        { label: 'Déclarer une séance', icon: 'bi-plus-circle', href: 'pages/chef/presences.html?new=declare' },
        { label: 'Enregistrer une absence', icon: 'bi-person-x', href: 'pages/chef/presences.html?new=1' },
        { label: 'Nouveau rappel', icon: 'bi-bell', href: 'pages/chef/calendrier.html?new=1' },
    ],
};
