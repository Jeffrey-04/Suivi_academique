/*
 * Accès brut aux collections : SEUL fichier qui sait si les données viennent du mock ou du backend.
 * Les services métier (students.js, grades.js...) s'appuient uniquement sur list() / replaceAll().
 *
 * Mode mock : lit assets/mock/<collection>.json ; les écritures vont dans localStorage
 *             (clé "school:<collection>") et priment sur le JSON d'origine, qui reste intact.
 * Mode API  : GET <API_BASE_URL>/<collection>  (écritures à implémenter à l'arrivée du backend).
 */

import { config, url } from '../config.js';

const seedCache = new Map();

async function loadSeed(name) {
    if (!seedCache.has(name)) {
        const res = await fetch(url(`assets/mock/${name}.json`));
        if (!res.ok) throw new Error(`Données mock introuvables : ${name}.json (${res.status})`);
        seedCache.set(name, await res.json());
    }
    return seedCache.get(name);
}

function readLocal(name) {
    try {
        const raw = localStorage.getItem(config.STORAGE_PREFIX + name);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null; // stockage indisponible ou corrompu : on retombe sur le JSON d'origine
    }
}

async function apiList(name) {
    const res = await fetch(`${config.API_BASE_URL}/${name}`, { headers: { Accept: 'application/json' }, credentials: 'include' });
    if (!res.ok) throw new Error(`Erreur API ${name} (${res.status})`);
    const body = await res.json();
    return Array.isArray(body) ? body : body.data;
}

/** Retourne une copie de la collection (les appelants peuvent la modifier sans effet de bord). */
export async function list(name) {
    if (!config.USE_MOCK) return apiList(name);
    return structuredClone(readLocal(name) ?? (await loadSeed(name)));
}

/** Remplace toute la collection (mode mock : localStorage). */
export async function replaceAll(name, items) {
    if (!config.USE_MOCK) throw new Error("Écriture API non implémentée : à brancher avec le backend PHP.");
    try {
        localStorage.setItem(config.STORAGE_PREFIX + name, JSON.stringify(items));
    } catch {
        throw new Error("Impossible d'enregistrer : le stockage du navigateur est indisponible.");
    }
}

/** Supprime toutes les modifications locales : les JSON d'origine redeviennent la référence. */
export function resetDemoData() {
    try {
        Object.keys(localStorage)
            .filter((k) => k.startsWith(config.STORAGE_PREFIX) && k !== config.SESSION_KEY)
            .forEach((k) => localStorage.removeItem(k));
    } catch {
        /* stockage indisponible : rien à réinitialiser */
    }
}
