/*
 * Client HTTP du backend PHP : le SEUL endroit qui appelle fetch() pour les données métier en mode API.
 *
 *  - JSON en entrée et en sortie, cookie de session (credentials: 'include') ;
 *  - 422 / 409 → ValidationError(message, fields) : les formulaires affichent chaque message sous son champ ;
 *  - 401 → session terminée : retour à la page de connexion (sauf pour les appels d'authentification) ;
 *  - autres erreurs → Error(message du serveur) ; l'erreur porte `status`.
 */

import { config, url } from '../config.js';
import { ValidationError } from './errors.js';

/** Paramètres d'URL : valeurs vides ignorées, tableaux joints par des virgules. */
function queryString(query) {
    const params = new URLSearchParams();
    Object.entries(query ?? {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    });
    const text = params.toString();
    return text ? `?${text}` : '';
}

function failWith(error, status) {
    error.status = status;
    return error;
}

function sessionEnded() {
    if (typeof window === 'undefined') return;
    try { sessionStorage.removeItem(config.SESSION_KEY); } catch { /* rien à nettoyer */ }
    const here = window.location.pathname + window.location.search;
    if (!window.location.pathname.endsWith('page-login.html')) {
        window.location.replace(`${url('page-login.html')}?next=${encodeURIComponent(here)}`);
    }
}

/**
 * @param {string} method GET | POST | PUT | PATCH | DELETE
 * @param {string} path chemin de l'API (ex. '/students/stu-018')
 * @param {{ query?: object, body?: object, auth?: boolean }} [options] auth: false pour les appels d'authentification (pas de redirection sur 401)
 * @returns {Promise<any>} corps JSON (null pour 204)
 */
export async function request(method, path, { query, body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
        res = await fetch(`${config.API_BASE_URL}${path}${queryString(query)}`, {
            method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw failWith(new Error('Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.'), 0);
    }

    let payload = null;
    if (res.status !== 204) {
        const text = await res.text();
        try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    }
    if (res.ok) return payload;

    const message = payload?.message ?? `Une erreur est survenue (${res.status}).`;
    if (res.status === 401 && auth) {
        sessionEnded();
        throw failWith(new Error(message), 401);
    }
    if (res.status === 422 || res.status === 409) throw failWith(new ValidationError(message, payload?.fields ?? {}), res.status);
    throw failWith(new Error(message), res.status);
}

/** Comme request(), mais retourne null quand la ressource n'existe pas (404) : pour les lectures « get » des services. */
export async function requestOrNull(method, path, options) {
    try {
        return await request(method, path, options);
    } catch (error) {
        if (error.status === 404) return null;
        throw error;
    }
}
