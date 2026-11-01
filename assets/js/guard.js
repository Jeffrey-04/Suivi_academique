/*
 * Garde de rôle côté interface (confort d'usage, PAS de la sécurité : le backend devra
 * refuser lui-même les accès non autorisés).
 */

import { ROLES, url } from './config.js';
import { AuthService } from './services/index.js';

function redirect(target) {
    window.location.replace(target);
}

/**
 * Vérifie qu'un utilisateur est connecté et possède le rôle demandé.
 * Retourne l'utilisateur, ou null si une redirection est en cours
 * (login si non connecté, tableau de bord du bon rôle sinon).
 */
export async function requireRole(role) {
    const session = AuthService.getSession();
    if (!session) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        redirect(`${url('page-login.html')}?next=${next}`);
        return null;
    }
    const user = await AuthService.currentUser();
    if (!user) {
        AuthService.logout(); // session orpheline (utilisateur supprimé, données réinitialisées...)
        redirect(url('page-login.html'));
        return null;
    }
    if (role && user.role !== role) {
        redirect(url(ROLES[user.role].home));
        return null;
    }
    return user;
}
