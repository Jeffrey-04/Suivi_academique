/*
 * Configuration globale de l'application.
 *
 * Deux sources de données (voir services/data.js et services/api.js) :
 *  - le BACKEND PHP (mode par défaut) : l'API est à <racine du site>/backend/api ; au démarrage, GET /config fournit la date du
 *    jour du serveur, l'année et le semestre, l'identité de l'établissement… (source unique de vérité) ;
 *  - le mode SIMULÉ (démonstration sans serveur) : données de assets/mock/*.json + localStorage. Activation : ouvrir une page
 *    avec ?mock=1 (retour au backend : ?mock=0), ou localStorage 'school:mode' = 'mock'.
 */

// Racine du projet, déduite de l'emplacement de ce fichier (assets/js/config.js) :
// fonctionne quelle que soit la profondeur de la page qui l'importe.
export const ROOT = new URL('../../', import.meta.url).href;

/** URL absolue d'un chemin relatif à la racine du projet (ex. url('assets/mock/users.json')). */
export function url(path) {
    return new URL(path, ROOT).href;
}

const browser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';
function chosenMode() {
    if (globalThis.SCHOOL_MODE) return globalThis.SCHOOL_MODE; // tests (Node)
    if (!browser) return 'api';
    try {
        const asked = new URLSearchParams(window.location.search).get('mock');
        if (asked === '1') localStorage.setItem('school:mode', 'mock');
        if (asked === '0') localStorage.removeItem('school:mode');
        return localStorage.getItem('school:mode') === 'mock' ? 'mock' : 'api';
    } catch {
        return 'api';
    }
}

const mode = chosenMode();

export const config = {
    APP_NAME: 'Suivi Académique',
    DEPARTMENT: 'Département Informatique',

    // true : les services lisent assets/mock/*.json (+ localStorage pour les écritures) ; false : ils appellent le backend PHP
    USE_MOCK: mode === 'mock',
    API_BASE_URL: globalThis.SCHOOL_API_BASE ?? url('backend/api'),

    // Date « d'aujourd'hui » : simulée en mode mock pour que le jeu de données reste cohérent ; avec le backend,
    // c'est la date du serveur (SERVER_TODAY, reçue de GET /config : réelle en production, simulée en démonstration).
    MOCK_TODAY: '2027-01-25',
    SERVER_TODAY: null,
    DEMO: mode === 'mock', // instance de démonstration (compte de démo proposé sur la page de connexion)
    DEMO_ACCOUNTS: [],

    ACADEMIC_YEAR: '2026-2027',
    CURRENT_SEMESTER: 'S1',
    SEMESTER_START: '2026-09-14', // début des cours : borne basse des sélecteurs de période
    REMINDER_DAYS: [7, 1], // rappels automatiques : J-7 et J-1 avant le début d'un événement

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
    dean: { title: { fr: "Le Chef d'Établissement", en: 'The Dean / Director' }, name: 'Pr. Marcel Ekani' },
};

/**
 * Un seul rôle : le chef de département, seul utilisateur de l'application. Enseignants et étudiants sont des fiches
 * (données gérées par le chef), sans compte ni connexion.
 */
export const ROLES = {
    chef: { label: 'Chef de département', home: 'pages/chef/dashboard.html', profile: 'pages/chef/profil.html', icon: 'bi-person-badge' },
};

/** Applique la configuration du serveur (GET /config). Sans effet en mode simulé. */
export async function loadRemoteConfig() {
    if (config.USE_MOCK) return;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`${config.API_BASE_URL}/config`, { headers: { Accept: 'application/json' }, credentials: 'include', signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`GET /config : ${res.status}`);
        const r = await res.json();
        Object.assign(config, {
            APP_NAME: r.appName ?? config.APP_NAME, DEPARTMENT: r.department ?? config.DEPARTMENT, ACADEMIC_YEAR: r.academicYear ?? config.ACADEMIC_YEAR,
            CURRENT_SEMESTER: r.currentSemester ?? config.CURRENT_SEMESTER, SEMESTER_START: r.semesterStart ?? config.SEMESTER_START,
            REMINDER_DAYS: r.reminderDays ?? config.REMINDER_DAYS,
            SERVER_TODAY: r.today ?? null, DEMO: r.mode === 'demo', DEMO_ACCOUNTS: r.demoAccounts ?? [],
        });
        if (r.institution) Object.assign(INSTITUTION, r.institution);
    } catch (error) {
        console.error('Configuration du serveur indisponible, valeurs par défaut utilisées :', error);
    }
}

await loadRemoteConfig();
