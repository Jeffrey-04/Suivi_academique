/*
 * Menus de navigation par rôle.
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
                { id: 'accounts', label: 'Comptes', icon: 'bi-shield-lock', href: 'pages/chef/comptes.html' },
            ],
        },
        {
            title: 'Pédagogie',
            items: [
                { id: 'subjects', label: 'Matières', icon: 'bi-book', href: 'pages/chef/matieres.html' },
                { id: 'grades', label: 'Notes', icon: 'bi-pencil-square', href: 'pages/chef/notes.html' },
                { id: 'bulletins', label: 'Bulletins', icon: 'bi-file-earmark-text', href: 'pages/chef/bulletins.html' },
            ],
        },
        {
            title: 'Suivi des enseignants',
            items: [
                { id: 'hours', label: 'Heures', icon: 'bi-clock-history', href: 'pages/chef/heures.html' },
                { id: 'attendance', label: 'Présences', icon: 'bi-calendar-check', href: 'pages/chef/presences.html' },
            ],
        },
        {
            title: 'Calendrier',
            items: [{ id: 'calendar', label: 'Calendrier', icon: 'bi-calendar-event', href: 'pages/chef/calendrier.html' }],
        },
    ],

    enseignant: [
        {
            title: 'Menu',
            items: [{ id: 'dashboard', label: 'Tableau de bord', icon: 'bi-grid-fill', href: 'pages/enseignant/dashboard.html' }],
        },
        {
            title: 'Enseignement',
            items: [
                { id: 'subjects', label: 'Mes matières', icon: 'bi-book', href: 'pages/enseignant/matieres.html' },
                { id: 'grades', label: 'Saisie des notes', icon: 'bi-pencil-square', href: 'pages/enseignant/saisie-notes.html' },
            ],
        },
        {
            title: 'Séances',
            items: [
                { id: 'checkin', label: 'Marquer ma présence', icon: 'bi-geo-alt', href: 'pages/enseignant/marquer-presence.html' },
                { id: 'declare', label: 'Déclarer une séance', icon: 'bi-plus-circle', href: 'pages/enseignant/declarer-seance.html' },
                { id: 'sessions', label: 'Mes séances', icon: 'bi-clock-history', href: 'pages/enseignant/seances.html' },
            ],
        },
        {
            title: 'Calendrier',
            items: [{ id: 'calendar', label: 'Calendrier', icon: 'bi-calendar-event', href: 'pages/enseignant/calendrier.html' }],
        },
    ],

    etudiant: [
        {
            title: 'Menu',
            items: [{ id: 'dashboard', label: 'Tableau de bord', icon: 'bi-grid-fill', href: 'pages/etudiant/dashboard.html' }],
        },
        {
            title: 'Scolarité',
            items: [
                { id: 'grades', label: 'Mes notes', icon: 'bi-pencil-square', href: 'pages/etudiant/notes.html' },
                { id: 'bulletin', label: 'Mon bulletin', icon: 'bi-file-earmark-text', href: 'pages/etudiant/bulletin.html' },
            ],
        },
        {
            title: 'Calendrier',
            items: [{ id: 'calendar', label: 'Calendrier', icon: 'bi-calendar-event', href: 'pages/etudiant/calendrier.html' }],
        },
    ],
};

/** Raccourcis du bouton "Créer" de la barre du haut. */
export const QUICK_ACTIONS = {
    chef: [
        { label: 'Nouvel étudiant', icon: 'bi-person-plus', href: 'pages/chef/etudiants.html?new=1' },
        { label: 'Nouvel enseignant', icon: 'bi-person-workspace', href: 'pages/chef/enseignants.html?new=1' },
        { label: 'Nouvelle matière', icon: 'bi-book', href: 'pages/chef/matieres.html?new=1' },
        { label: 'Enregistrer une absence', icon: 'bi-person-x', href: 'pages/chef/presences.html?new=1' },
        { label: 'Nouveau rappel', icon: 'bi-bell', href: 'pages/chef/calendrier.html?new=1' },
    ],
    enseignant: [
        { label: 'Saisir des notes', icon: 'bi-pencil-square', href: 'pages/enseignant/saisie-notes.html' },
        { label: 'Marquer ma présence', icon: 'bi-geo-alt', href: 'pages/enseignant/marquer-presence.html' },
        { label: 'Déclarer une séance', icon: 'bi-plus-circle', href: 'pages/enseignant/declarer-seance.html' },
    ],
    etudiant: [],
};
