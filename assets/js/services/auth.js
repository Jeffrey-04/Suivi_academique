/*
 * Authentification.
 *  - Mode API : le serveur ouvre une session (cookie HttpOnly) ; sessionStorage ne garde que { userId, role } comme indicateur
 *    « connecté » synchrone pour les gardes de page (la vérité reste le serveur : GET /auth/me).
 *  - Mode simulé : vérifie users.json (mots de passe en clair, aucune sécurité) et garde la session dans sessionStorage.
 */

import { config, ROLES } from '../config.js';
import { request } from './api.js';
import { list } from './data.js';

const publicUser = ({ password, ...user }) => user; // ne jamais exposer le mot de passe aux pages

function writeSession(session) {
    try { sessionStorage.setItem(config.SESSION_KEY, JSON.stringify(session)); } catch { /* ignoré : connexion non persistée */ }
}

export const AuthService = {
    /** Session courante { userId, role } ou null. Synchrone pour pouvoir garder les pages simples. */
    getSession() {
        try {
            const raw = sessionStorage.getItem(config.SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },

    async currentUser() {
        if (!config.USE_MOCK) {
            try {
                const user = await request('GET', '/auth/me', { auth: false });
                writeSession({ userId: user.id, role: user.role });
                return user;
            } catch (error) {
                if (error.status === 401) {
                    try { sessionStorage.removeItem(config.SESSION_KEY); } catch { /* rien à nettoyer */ }
                    return null; // session expirée, compte désactivé…
                }
                throw error;
            }
        }
        const session = this.getSession();
        if (!session) return null;
        const user = (await list('users')).find((u) => u.id === session.userId);
        return user && user.active !== false ? publicUser(user) : null; // compte désactivé : la session tombe
    },

    /** Retourne l'utilisateur connecté, ou lève une Error au message affichable. */
    async login(email, password) {
        if (!config.USE_MOCK) {
            const user = await request('POST', '/auth/login', { body: { email, password }, auth: false });
            writeSession({ userId: user.id, role: user.role });
            return user;
        }
        const wanted = String(email).trim().toLowerCase();
        const user = (await list('users')).find((u) => u.email.toLowerCase() === wanted && u.password === password);
        if (!user) throw new Error('E-mail ou mot de passe incorrect.');
        if (user.active === false) throw new Error('Ce compte est désactivé. Contactez le chef de département.');
        writeSession({ userId: user.id, role: user.role });
        return publicUser(user);
    },

    logout() {
        try { sessionStorage.removeItem(config.SESSION_KEY); } catch { /* rien à nettoyer */ }
        if (!config.USE_MOCK) {
            // keepalive : la requête aboutit même si la page change aussitôt après (redirection vers la connexion)
            fetch(`${config.API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include', keepalive: true, headers: { Accept: 'application/json' } }).catch(() => {});
        }
    },

    /** Comptes proposés sur la page de connexion (mode démo uniquement). */
    async demoAccounts() {
        if (!config.USE_MOCK) return config.DEMO ? config.DEMO_ACCOUNTS : []; // comptes de démonstration seulement sur une instance « demo »
        const order = Object.keys(ROLES);
        return (await list('users'))
            .filter((u) => u.demo)
            .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
            .map((u) => ({ ...publicUser(u), password: u.password })); // le mot de passe sert à pré-remplir le formulaire
    },
};
