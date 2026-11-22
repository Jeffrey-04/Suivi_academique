/*
 * Calendrier (événements / rappels) et notifications.
 *
 * Règles de gestion (projet.md §7) :
 *  - seul le chef de département (unique utilisateur) crée, modifie, supprime et consulte les événements ;
 *  - un événement tient dans l'année universitaire en cours ; la date de fin est facultative (événement d'un jour) ;
 *    les horaires n'existent que pour un événement d'un seul jour ;
 *  - le chef est le seul destinataire : ses rappels automatiques (J-7, J-1, config.REMINDER_DAYS) sont générés ici en mode
 *    simulé (`syncReminders`) ; avec le backend, c'est la tâche planifiée cron/reminders.php ;
 *  - supprimer un événement supprime ses notifications.
 * Ces contrôles sont refaits ici car le backend devra les refaire : l'interface ne fait que les refléter.
 */

import { config } from '../config.js';
import { EVENT_TYPES } from '../utils/event-types.js';
import { addDays, diffDays, formatDate, todayISO } from '../utils/format.js';
import { list, replaceAll } from './data.js';
import { ValidationError } from './errors.js';
import { resolveSettings } from './accounts.js';
import { idSequence, nextId } from './ids.js';
import { request, requestOrNull } from './api.js';

const enc = encodeURIComponent;

const text = (value) => String(value ?? '').trim();
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value) => DATE.test(value) && !Number.isNaN(Date.parse(value));

/** Bornes de l'année universitaire en cours (septembre → août). */
export function academicYearBounds() {
    const first = Number(config.ACADEMIC_YEAR.slice(0, 4));
    return { from: `${first}-09-01`, to: `${first + 1}-08-31` };
}

/** Valide et normalise un événement ; retourne les champs à enregistrer. */
function validateEvent(input) {
    const errors = {};
    const type = text(input.type);
    if (!EVENT_TYPES[type]) errors.type = "Choisissez le type d'événement.";

    const title = text(input.title);
    if (title.length < 3) errors.title = 'Indiquez un titre (3 caractères minimum).';
    else if (title.length > 120) errors.title = 'Le titre ne doit pas dépasser 120 caractères.';

    const bounds = academicYearBounds();
    const start = text(input.start);
    if (!isDate(start)) errors.start = 'Indiquez la date de début.';
    else if (start < bounds.from || start > bounds.to) {
        errors.start = `La date doit être dans l'année universitaire ${config.ACADEMIC_YEAR} (${formatDate(bounds.from)} – ${formatDate(bounds.to)}).`;
    }

    let end = text(input.end) || null;
    if (end && !isDate(end)) errors.end = 'Date de fin invalide.';
    else if (end && !errors.start && end < start) errors.end = 'La date de fin doit être postérieure ou égale à la date de début.';
    else if (end && end > bounds.to) errors.end = `La date de fin dépasse l'année universitaire (${formatDate(bounds.to)}).`;
    if (end === start) end = null; // un événement d'un jour n'a pas de date de fin

    let startTime = text(input.startTime) || null;
    let endTime = text(input.endTime) || null;
    if (startTime && !TIME.test(startTime)) errors.startTime = "Heure de début invalide (HH:MM).";
    if (endTime && !TIME.test(endTime)) errors.endTime = "Heure de fin invalide (HH:MM).";
    if (end && (startTime || endTime)) {
        errors.startTime = "Les horaires ne s'appliquent qu'à un événement d'un seul jour.";
    } else if (!errors.startTime && !errors.endTime) {
        if (endTime && !startTime) errors.startTime = "Indiquez l'heure de début.";
        else if (startTime && endTime && endTime <= startTime) errors.endTime = "L'heure de fin doit être postérieure à l'heure de début.";
    }
    if (end) { startTime = null; endTime = null; }

    const location = text(input.location);
    if (location.length > 80) errors.location = 'Le lieu ne doit pas dépasser 80 caractères.';
    const description = text(input.description);
    if (description.length > 500) errors.description = 'La description ne doit pas dépasser 500 caractères.';

    if (Object.keys(errors).length) throw new ValidationError("Corrigez les champs signalés.", errors);
    return { type, title, start, end, startTime, endTime, location: location || null, description: description || null };
}

function requireChef(actor, action) {
    if (actor?.role !== 'chef') throw new ValidationError(`Seul le chef de département peut ${action} un événement.`);
}

export const EventService = {
    /** filters : { types, from, to } ; garde les événements qui chevauchent [from, to] (dates ISO) */
    async list({ types, from, to } = {}) {
        if (!config.USE_MOCK) return request('GET', '/events', { query: { types, from, to } });
        let items = await list('events');
        if (types) items = items.filter((e) => types.includes(e.type));
        if (from) items = items.filter((e) => (e.end ?? e.start) >= from);
        if (to) items = items.filter((e) => e.start <= to);
        return items.sort((a, b) => a.start.localeCompare(b.start) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    },

    /** Un événement par id (null s'il n'existe pas). */
    async get(id) {
        if (!config.USE_MOCK) return requestOrNull('GET', `/events/${enc(id)}`);
        return (await list('events')).find((e) => e.id === id) ?? null;
    },

    /** Prochains événements (en cours ou à venir), triés par date de début. */
    upcoming({ types, limit = 5 } = {}) {
        return this.list({ types, from: todayISO() }).then((items) => items.slice(0, limit));
    },

    /** Une session de rattrapage est-elle encore à venir ? (détermine le résultat « Rattrapage ») */
    async rattrapageOpen() {
        if (!config.USE_MOCK) return (await request('GET', '/events/rattrapage-open')).open;
        return (await list('events')).some((e) => e.type === 'rattrapage' && e.start > todayISO());
    },

    /** Crée un événement (chef). Retourne l'événement créé. */
    async create(input, actor) {
        if (!config.USE_MOCK) return request('POST', '/events', { body: input });
        requireChef(actor, 'créer');
        const fields = validateEvent(input);
        const events = await list('events');
        const event = { id: nextId('evt', events), ...fields, createdBy: actor.id, createdAt: todayISO() };
        await replaceAll('events', [...events, event]);
        return event;
    },

    /** Modifie un événement (chef). Retourne l'événement modifié. */
    async update(id, input, actor) {
        if (!config.USE_MOCK) return request('PUT', `/events/${enc(id)}`, { body: input });
        requireChef(actor, 'modifier');
        const events = await list('events');
        const index = events.findIndex((e) => e.id === id);
        if (index < 0) throw new ValidationError('Événement introuvable.');
        const event = { ...events[index], ...validateEvent(input) };
        events[index] = event;
        await replaceAll('events', events);
        return event;
    },

    /** Supprime un événement (chef) et ses notifications. */
    async remove(id, actor) {
        if (!config.USE_MOCK) { await request('DELETE', `/events/${enc(id)}`); return; }
        requireChef(actor, 'supprimer');
        const [events, notifications] = await Promise.all([list('events'), list('notifications')]);
        if (!events.some((e) => e.id === id)) throw new ValidationError('Événement introuvable.');
        await replaceAll('events', events.filter((e) => e.id !== id));
        await replaceAll('notifications', notifications.filter((n) => n.eventId !== id));
    },

    /** Nombre de notifications liées à un événement (annoncé avant suppression). */
    async notificationCount(id) {
        if (!config.USE_MOCK) return (await request('GET', `/events/${enc(id)}/notification-count`)).count;
        return (await list('notifications')).filter((n) => n.eventId === id).length;
    },
};

export const NotificationService = {
    /** Notifications d'un utilisateur, de la plus récente à la plus ancienne, avec l'événement associé. */
    async listForUser(userId, limit = 5) {
        if (!config.USE_MOCK) return request('GET', '/notifications', { query: { limit } });
        const [notifications, events] = await Promise.all([list('notifications'), list('events')]);
        return notifications
            .filter((n) => n.userId === userId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
            .slice(0, limit)
            .map((n) => ({ ...n, event: events.find((e) => e.id === n.eventId) ?? null }));
    },

    async unreadCount(userId) {
        if (!config.USE_MOCK) return (await request('GET', '/notifications/unread-count')).count;
        return (await list('notifications')).filter((n) => n.userId === userId && !n.read).length;
    },

    async markRead(id, userId) {
        if (!config.USE_MOCK) { await request('POST', `/notifications/${enc(id)}/read`, { body: {} }); return; }
        const all = await list('notifications');
        const target = all.find((n) => n.id === id && n.userId === userId);
        if (!target || target.read) return;
        target.read = true;
        await replaceAll('notifications', all);
    },

    /**
     * Génère les rappels automatiques de l'utilisateur (J-7, J-1…) pour les événements à venir.
     * Idempotent : un rappel par (utilisateur, événement, échéance). Les notifications d'origine sans `stage`
     * comptent comme le rappel le plus lointain. Mode simulé uniquement : avec le backend, c'est une tâche planifiée.
     */
    async syncReminders(user) {
        if (!config.USE_MOCK) return 0; // avec le backend : tâche planifiée côté serveur (cron/reminders.php)
        const days = [...resolveSettings(user).reminders].sort((a, b) => a - b); // échéances choisies par l'utilisateur, du plus proche au plus lointain
        if (!days.length) return 0;
        const today = todayISO();
        const [events, notifications] = await Promise.all([list('events'), list('notifications')]);
        const next = idSequence('ntf', notifications, 4);
        const added = [];
        for (const event of events) {
            const left = diffDays(today, event.start);
            const stage = left < 0 ? undefined : days.find((d) => left <= d);
            if (stage === undefined) continue;
            const due = addDays(event.start, -stage);
            const known = notifications.some((n) => n.userId === user.id && n.eventId === event.id && (n.stage ?? days[days.length - 1]) <= stage);
            if (known) continue;
            added.push({
                id: next(), userId: user.id, eventId: event.id, kind: 'reminder', stage, message: event.title,
                read: false, createdAt: `${due}T07:00:00`,
            });
        }
        if (added.length) await replaceAll('notifications', [...notifications, ...added]);
        return added.length;
    },

    async markAllRead(userId) {
        if (!config.USE_MOCK) { await request('POST', '/notifications/read-all', { body: {} }); return; }
        const all = await list('notifications');
        all.forEach((n) => { if (n.userId === userId) n.read = true; });
        await replaceAll('notifications', all);
    },
};
