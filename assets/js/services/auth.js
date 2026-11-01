/*
 * Authentification SIMULÉE : vérifie users.json et garde la session dans sessionStorage.
 * Ce n'est pas de la sécurité (mots de passe en clair dans le mock) : la vraie authentification
 * viendra du backend PHP.
 */

import { config, ROLES } from '../config.js';
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
        const session = this.getSession();
        if (!session) return null;
        const user = (await list('users')).find((u) => u.id === session.userId);
        return user && user.active !== false ? publicUser(user) : null; // compte désactivé : la session tombe
    },

    /** Retourne l'utilisateur connecté, ou lève une Error au message affichable. */
    async login(email, password) {
        const wanted = String(email).trim().toLowerCase();
        const user = (await list('users')).find((u) => u.email.toLowerCase() === wanted && u.password === password);
        if (!user) throw new Error('E-mail ou mot de passe incorrect.');
        if (user.active === false) throw new Error('Ce compte est désactivé. Contactez le chef de département.');
        writeSession({ userId: user.id, role: user.role });
        return publicUser(user);
    },

    logout() {
        try { sessionStorage.removeItem(config.SESSION_KEY); } catch { /* rien à nettoyer */ }
    },

    /** Comptes proposés sur la page de connexion (mode démo uniquement). */
    async demoAccounts() {
        if (!config.USE_MOCK) return [];
        const order = Object.keys(ROLES);
        return (await list('users'))
            .filter((u) => u.demo)
            .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
            .map((u) => ({ ...publicUser(u), password: u.password })); // le mot de passe sert à pré-remplir le formulaire
    },
};
