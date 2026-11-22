/*
 * Compte du chef de département (seul utilisateur de l'application), profil et réglages personnels.
 *
 * Règles de gestion (projet.md §8, « Comptes, profil et réglages ») :
 *  - le chef gère SON profil : e-mail (avec le mot de passe actuel), photo, mot de passe, réglages ;
 *  - enseignants et étudiants n'ont pas de compte : ce sont des fiches gérées par le chef (voir people.js) ;
 *  - les réglages (`settings`) sont facultatifs : une valeur absente retombe sur les valeurs par défaut.
 * Ces contrôles sont refaits ici car le backend les refait aussi. En mode simulé, le mot de passe est en clair dans
 * localStorage : le backend stocke uniquement une empreinte (hash).
 */

import { config } from '../config.js';
import { list, replaceAll } from './data.js';
import { ValidationError } from './errors.js';
import { request } from './api.js';

export const DEFAULT_PHOTO = 'assets/images/avatar.png';
export const PASSWORD_MIN = 8;
export const CALENDAR_VIEWS = { auto: 'Selon l\'écran', month: 'Mois', agenda: 'Agenda' };
const MAX_PHOTO_LENGTH = 300_000; // caractères du data URL (≈ 220 Ko d'image)

const text = (value) => String(value ?? '').trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const publicUser = ({ password, ...user }) => user;

/** Réglages effectifs de l'utilisateur : valeurs enregistrées complétées par les valeurs par défaut. */
export function resolveSettings(user) {
    return {
        reminders: [...config.REMINDER_DAYS], calendarView: 'auto', sidebarCollapsed: false,
        ...(user?.settings ?? {}),
    };
}

function fail(errors, message = 'Veuillez corriger les champs signalés.') {
    if (Object.keys(errors).length) throw new ValidationError(message, errors);
}

function requireSelf(actor, userId) {
    if (!actor || actor.id !== userId) throw new ValidationError('Vous ne pouvez modifier que votre propre profil.');
}

async function findUser(users, userId) {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new ValidationError('Compte introuvable.');
    return user;
}

export const AccountService = {
    /** Profil de l'utilisateur : compte public + réglages effectifs. */
    async profile(userId) {
        if (!config.USE_MOCK) return request('GET', '/me/profile'); // toujours le profil de l'utilisateur connecté
        const user = await findUser(await list('users'), userId);
        return { user: publicUser(user), settings: resolveSettings(user) };
    },

    /** Coordonnées : e-mail (mot de passe actuel exigé s'il change). */
    async updateContact(userId, input, actor) {
        if (!config.USE_MOCK) return request('PATCH', '/me/contact', { body: input });
        requireSelf(actor, userId);
        const users = await list('users');
        const user = await findUser(users, userId);
        const errors = {};
        const email = text(input.email).toLowerCase();
        if (!EMAIL.test(email)) errors.email = "L'adresse e-mail n'est pas valide.";
        else if (users.some((u) => u.id !== userId && u.email.toLowerCase() === email)) errors.email = 'Cette adresse e-mail est déjà utilisée.';
        if (!errors.email && email !== user.email.toLowerCase() && input.currentPassword !== user.password) {
            errors.currentPassword = 'Mot de passe actuel requis pour changer l\'adresse e-mail.';
        }
        fail(errors);

        user.email = email;
        await replaceAll('users', users);
        return publicUser(user);
    },

    /** Photo : data URL d'une image (déjà réduite par l'interface) ou null pour revenir à l'image par défaut. */
    async updatePhoto(userId, dataUrl, actor) {
        if (!config.USE_MOCK) return request('PUT', '/me/photo', { body: { photo: dataUrl } });
        requireSelf(actor, userId);
        if (dataUrl !== null && !(/^data:image\/(png|jpeg|webp);base64,/.test(String(dataUrl)) && String(dataUrl).length <= MAX_PHOTO_LENGTH)) {
            throw new ValidationError('Image refusée : formats PNG, JPEG ou WebP, 200 Ko maximum.');
        }
        const users = await list('users');
        const user = await findUser(users, userId);
        user.photo = dataUrl ?? DEFAULT_PHOTO;
        await replaceAll('users', users);
        return publicUser(user);
    },

    async changePassword(userId, input, actor) {
        if (!config.USE_MOCK) { await request('PUT', '/me/password', { body: input }); return; }
        requireSelf(actor, userId);
        const users = await list('users');
        const user = await findUser(users, userId);
        const errors = {};
        const next = String(input.newPassword ?? '');
        if (input.currentPassword !== user.password) errors.currentPassword = 'Mot de passe actuel incorrect.';
        if (next.length < PASSWORD_MIN || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
            errors.newPassword = `Au moins ${PASSWORD_MIN} caractères, avec des lettres et des chiffres.`;
        } else if (next === user.password) errors.newPassword = "Choisissez un mot de passe différent de l'actuel.";
        if (next !== String(input.confirmPassword ?? '')) errors.confirmPassword = 'La confirmation ne correspond pas.';
        fail(errors);

        user.password = next;
        user.mustChangePassword = false;
        await replaceAll('users', users);
    },

    async updateSettings(userId, input, actor) {
        if (!config.USE_MOCK) {
            const checked = (v) => v === true || v === '1' || v === 'on'; // une case décochée est absente du formulaire
            return request('PUT', '/me/settings', { body: {
                reminders: [].concat(input.reminders ?? []).map(Number),
                calendarView: input.calendarView, sidebarCollapsed: checked(input.sidebarCollapsed),
            } });
        }
        requireSelf(actor, userId);
        const users = await list('users');
        const user = await findUser(users, userId);
        const errors = {};
        const reminders = [].concat(input.reminders ?? []).map(Number);
        if (reminders.some((d) => !config.REMINDER_DAYS.includes(d))) errors.reminders = 'Échéance de rappel inconnue.';
        if (!CALENDAR_VIEWS[input.calendarView]) errors.calendarView = 'Choisissez un affichage.';
        fail(errors);

        user.settings = {
            reminders: [...new Set(reminders)].sort((a, b) => b - a),
            calendarView: input.calendarView,
            sidebarCollapsed: input.sidebarCollapsed === true || input.sidebarCollapsed === '1',
        };
        await replaceAll('users', users);
        return user.settings;
    },
};
