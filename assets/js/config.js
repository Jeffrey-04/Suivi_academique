/*
 * Configuration globale de l'application.
 * Le passage mock -> backend PHP se fait ici (USE_MOCK / API_BASE_URL).
 */

export const config = {
    APP_NAME: 'Suivi Académique',
    DEPARTMENT: 'Département Informatique',

    // true : les services lisent assets/mock/*.json (+ localStorage pour les écritures)
    // false : les services appellent le backend PHP à API_BASE_URL
    USE_MOCK: true,
    API_BASE_URL: '/api',

    // Date "d'aujourd'hui" simulée, pour que le jeu de données reste cohérent quelle que soit
    // la vraie date de la machine. Mettre null pour utiliser la vraie date (obligatoire avec le backend).
    MOCK_TODAY: '2027-01-25',

    ACADEMIC_YEAR: '2026-2027',
    CURRENT_SEMESTER: 'S1',
    SEMESTER_START: '2026-09-14', // début des cours : borne basse des sélecteurs de période
    REMINDER_DAYS: [7, 1], // rappels automatiques : J-7 et J-1 avant le début d'un événement (hypothèse, modifiable)
    CHECKIN_MAX_ACCURACY: 100, // « Marquer ma présence » : précision GPS maximale acceptée, en mètres
    SESSION_EDIT_DAYS: 15, // délai pendant lequel un enseignant peut corriger ou retirer une séance qu'il a déclarée

    STORAGE_PREFIX: 'school:',
    SESSION_KEY: 'school:session',
};

/**
 * Identité de l'établissement, imprimée en en-tête et en signature des relevés de notes (bilingue FR / EN).
 * VALEURS FICTIVES DE DÉMONSTRATION : à remplacer par celles de l'établissement réel avant toute utilisation.
 * Aucun sceau, armoirie ni signature n'est reproduit : le logo du relevé est celui de l'application.
 */
export const INSTITUTION = {
    university: { fr: 'UNIVERSITÉ DE DÉMONSTRATION', en: 'DEMONSTRATION UNIVERSITY' },
    faculty: { fr: 'FACULTÉ DES SCIENCES ET TECHNIQUES', en: 'FACULTY OF SCIENCE AND TECHNOLOGY' },
    domain: { fr: 'SCIENCES ET TECHNOLOGIES', en: 'SCIENCE AND TECHNOLOGY' },
    // Position de l'établissement et rayon dans lequel une présence peut être marquée (valeurs de démonstration : le backend les fournira)
    location: { name: 'Campus de démonstration', lat: 3.8667, lng: 11.5167, radiusMeters: 300 },
    dean: { title: { fr: "Le Chef d'Établissement", en: 'The Dean / Director' }, name: 'Pr. Marcel Ekani' },
};

export const ROLES = {
    chef: { label: 'Chef de département', home: 'pages/chef/dashboard.html', profile: 'pages/chef/profil.html', icon: 'bi-person-badge' },
    enseignant: { label: 'Enseignant', home: 'pages/enseignant/dashboard.html', profile: 'pages/enseignant/profil.html', icon: 'bi-person-workspace' },
    etudiant: { label: 'Étudiant', home: 'pages/etudiant/dashboard.html', profile: 'pages/etudiant/profil.html', icon: 'bi-mortarboard' },
};

// Racine du projet, déduite de l'emplacement de ce fichier (assets/js/config.js) :
// fonctionne quelle que soit la profondeur de la page qui l'importe.
export const ROOT = new URL('../../', import.meta.url).href;

/** URL absolue d'un chemin relatif à la racine du projet (ex. url('assets/mock/users.json')). */
export function url(path) {
    return new URL(path, ROOT).href;
}
