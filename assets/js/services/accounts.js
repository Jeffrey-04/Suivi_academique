/*
 * Comptes utilisateurs, profil et réglages personnels.
 *
 * Règles de gestion (projet.md §8, « Comptes, profil et réglages ») :
 *  - chacun gère SON profil : e-mail (avec le mot de passe actuel), téléphone, photo, mot de passe, réglages ;
 *  - seul le chef de département liste les comptes, les active / désactive et réinitialise un mot de passe
 *    (jamais le sien : il passe par son profil) ; un compte désactivé ne peut plus se connecter, ses données sont conservées ;
 *  - un mot de passe réinitialisé (ou celui d'un compte tout juste créé) est TEMPORAIRE : `mustChangePassword` reste vrai
 *    jusqu'à ce que l'utilisateur en choisisse un nouveau ;
 *  - les réglages (`settings`) sont facultatifs : une valeur absente retombe sur les valeurs par défaut.
 * Ces contrôles sont refaits ici car le backend devra les refaire. En mode mock, les mots de passe sont en clair dans
 * localStorage : le backend stockera uniquement des empreintes (hash) et enverra le mot de passe temporaire.
 */

import { config } from '../config.js';
import { normalize } from '../utils/format.js';
import { list, replaceAll } from './data.js';
import { ValidationError } from './errors.js';
import { request, requestOrNull } from './api.js';

const enc = encodeURIComponent;

export const DEFAULT_PHOTO = 'assets/images/avatar.png';
export const PASSWORD_MIN = 8;
export const CALENDAR_VIEWS = { auto: 'Selon l\'écran', month: 'Mois', agenda: 'Agenda' };
const MAX_PHOTO_LENGTH = 300_000; // caractères du data URL (≈ 220 Ko d'image)

const text = (value) => String(value ?? '').trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ]{6,18}$/;
const publicUser = ({ password, ...user }) => user;

/** Réglages effectifs d'un utilisateur : valeurs enregistrées complétées par les valeurs par défaut. */
export function resolveSettings(user) {
    return {
        announcements: true, reminders: [...config.REMINDER_DAYS], calendarView: 'auto', sidebarCollapsed: false,
        ...(user?.settings ?? {}),
    };
}

function fail(errors, message = 'Veuillez corriger les champs signalés.') {
    if (Object.keys(errors).length) throw new ValidationError(message, errors);
}

function requireSelf(actor, userId) {
    if (!actor || actor.id !== userId) throw new ValidationError('Vous ne pouvez modifier que votre propre profil.');
}

function requireChef(actor, action) {
    if (actor?.role !== 'chef') throw new ValidationError(`Seul le chef de département peut ${action}.`);
}

async function findUser(users, userId) {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new ValidationError('Compte introuvable.');
    return user;
}

/** Mot de passe provisoire lisible (sans caractères ambigus 0/O, 1/l/I). */
function temporaryPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') + '7';
}

export const AccountService = {
    /** Profil complet de l'utilisateur : compte public + fiche étudiant / enseignant + réglages effectifs. */
    async profile(userId) {
        if (!config.USE_MOCK) return request('GET', '/me/profile'); // toujours le profil de l'utilisateur connecté
        const [users, students, teachers, levels, filieres] = await Promise.all([list('users'), list('students'), list('teachers'), list('levels'), list('filieres')]);
        const user = await findUser(users, userId);
        let person = null;
        let className = null;
        if (user.role === 'etudiant') {
            person = students.find((s) => s.id === user.profileId) ?? null;
            const level = levels.find((l) => l.id === person?.levelId);
            className = level ? `${level.name} · ${filieres.find((f) => f.id === level.filiereId)?.name ?? ''}` : null;
        } else if (user.role === 'enseignant') {
            person = teachers.find((t) => t.id === user.profileId) ?? null;
        }
        return { user: publicUser(user), person, className, settings: resolveSettings(user) };
    },

    /** Coordonnées : e-mail (mot de passe actuel exigé s'il change) et téléphone (étudiants / enseignants). */
    async updateContact(userId, input, actor) {
        if (!config.USE_MOCK) return request('PATCH', '/me/contact', { body: input });
        requireSelf(actor, userId);
        const [users, students, teachers] = await Promise.all([list('users'), list('students'), list('teachers')]);
        const user = await findUser(users, userId);
        const errors = {};
        const email = text(input.email).toLowerCase();
        if (!EMAIL.test(email)) errors.email = "L'adresse e-mail n'est pas valide.";
        else if (users.some((u) => u.id !== userId && u.email.toLowerCase() === email)) errors.email = 'Cette adresse e-mail est déjà utilisée.';
        const phone = text(input.phone);
        if (user.role !== 'chef' && phone && !PHONE.test(phone)) errors.phone = 'Numéro invalide (chiffres et espaces, ex. +237 677 12 34 56).';
        if (!errors.email && email !== user.email.toLowerCase() && input.currentPassword !== user.password) {
            errors.currentPassword = 'Mot de passe actuel requis pour changer l\'adresse e-mail.';
        }
        fail(errors);

        user.email = email;
        const person = (user.role === 'etudiant' ? students : user.role === 'enseignant' ? teachers : []).find((p) => p.id === user.profileId);
        if (person) Object.assign(person, { email, phone });
        await Promise.all([replaceAll('users', users), replaceAll('students', students), replaceAll('teachers', teachers)]);
        return publicUser(user);
    },

    /** Photo : data URL d'une image (déjà réduite par l'interface) ou null pour revenir à l'image par défaut. */
    async updatePhoto(userId, dataUrl, actor) {
        if (!config.USE_MOCK) return request('PUT', '/me/photo', { body: { photo: dataUrl } });
        requireSelf(actor, userId);
        if (dataUrl !== null && !(/^data:image\/(png|jpeg|webp);base64,/.test(String(dataUrl)) && String(dataUrl).length <= MAX_PHOTO_LENGTH)) {
            throw new ValidationError('Image refusée : formats PNG, JPEG ou WebP, 200 Ko maximum.');
        }
        const [users, students, teachers] = await Promise.all([list('users'), list('students'), list('teachers')]);
        const user = await findUser(users, userId);
        const photo = dataUrl ?? DEFAULT_PHOTO;
        user.photo = photo;
        const person = (user.role === 'etudiant' ? students : user.role === 'enseignant' ? teachers : []).find((p) => p.id === user.profileId);
        if (person) person.photo = photo;
        await Promise.all([replaceAll('users', users), replaceAll('students', students), replaceAll('teachers', teachers)]);
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
                announcements: checked(input.announcements), reminders: [].concat(input.reminders ?? []).map(Number),
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
            announcements: input.announcements === true || input.announcements === '1',
            reminders: [...new Set(reminders)].sort((a, b) => b - a),
            calendarView: input.calendarView,
            sidebarCollapsed: input.sidebarCollapsed === true || input.sidebarCollapsed === '1',
        };
        await replaceAll('users', users);
        return user.settings;
    },

    // ---- Gestion des comptes (chef) ----------------------------------------------------------------

    /** Comptes avec un libellé d'identité (matricule, grade). Filtres : q (nom, e-mail), role, active (true/false). */
    async list({ q, role, active } = {}, actor) {
        if (!config.USE_MOCK) return request('GET', '/accounts', { query: { q, role, active } });
        requireChef(actor, 'consulter les comptes');
        const [users, students, teachers] = await Promise.all([list('users'), list('students'), list('teachers')]);
        const needle = normalize(text(q));
        return users
            .map((u) => ({
                ...publicUser(u),
                active: u.active !== false,
                mustChangePassword: Boolean(u.mustChangePassword),
                detail: u.role === 'etudiant' ? students.find((s) => s.id === u.profileId)?.matricule
                    : u.role === 'enseignant' ? teachers.find((t) => t.id === u.profileId)?.grade : 'Chef de département',
            }))
            .filter((u) => (!role || u.role === role) && (active === undefined || active === '' || u.active === (active === true || active === 'true'))
                && (!needle || normalize(`${u.firstName} ${u.lastName} ${u.email} ${u.detail ?? ''}`).includes(needle)));
    },

    /** Active ou désactive un compte. Le chef ne peut pas désactiver le sien. */
    async setActive(userId, active, actor) {
        if (!config.USE_MOCK) return request('PATCH', `/accounts/${enc(userId)}`, { body: { active: Boolean(active) } });
        requireChef(actor, 'activer ou désactiver un compte');
        if (userId === actor.id) throw new ValidationError('Vous ne pouvez pas désactiver votre propre compte.');
        const users = await list('users');
        const user = await findUser(users, userId);
        user.active = Boolean(active);
        await replaceAll('users', users);
        return publicUser(user);
    },

    /** Réinitialise le mot de passe : retourne le mot de passe temporaire, à communiquer à l'utilisateur (affiché une seule fois). */
    async resetPassword(userId, actor) {
        if (!config.USE_MOCK) return request('POST', `/accounts/${enc(userId)}/reset-password`, { body: {} });
        requireChef(actor, 'réinitialiser un mot de passe');
        if (userId === actor.id) throw new ValidationError('Pour changer votre mot de passe, passez par votre profil.');
        const users = await list('users');
        const user = await findUser(users, userId);
        const password = temporaryPassword();
        user.password = password;
        user.mustChangePassword = true;
        await replaceAll('users', users);
        return { user: publicUser(user), temporaryPassword: password };
    },
};
