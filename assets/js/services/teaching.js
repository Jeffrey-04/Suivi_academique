/*
 * Suivi des enseignants : séances (présences, absences) et heures.
 *
 * Règles de gestion des séances (projet.md §7) :
 *  - le chef de département (seul utilisateur) DÉCLARE les séances effectuées par un enseignant (statut « présent »),
 *    ENREGISTRE ses absences, et peut corriger ou retirer toute séance, sans limite de délai ;
 *  - la matière détermine l'enseignant ; une matière sans enseignant ne peut pas recevoir de séance ;
 *  - une séance ne peut pas être dans le futur, ni avant le début du semestre, ni chevaucher une autre séance du même enseignant
 *    ou de la même classe le même jour ;
 *  - heures réalisées = durée des séances « présent » ; les pages affichent l'objet hoursSummary tel quel.
 * Ces contrôles sont refaits ici car le backend devra les refaire : l'interface ne fait que les refléter.
 */

import { config } from '../config.js';
import { hoursSummary, presenceRate, round2, sessionHours } from '../utils/calculs.js';
import { formatDate, todayISO } from '../utils/format.js';
import { list, replaceAll } from './data.js';
import { ValidationError } from './errors.js';
import { idSequence } from './ids.js';
import { ReferenceService } from './people.js';
import { request, requestOrNull } from './api.js';

const enc = encodeURIComponent;

const period = () => `${config.CURRENT_SEMESTER}-${config.ACADEMIC_YEAR}`;
const text = (value) => String(value ?? '').trim();
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const overlaps = (a, b) => minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime);
export const SESSION_STATUS = { present: 'Présent', absent: 'Absent' };

/** Valide une séance. Retourne { errors, subject, hours, date, start, end }. */
function validateSession(input, { subjects, sessions, teachers }, { ownId = null } = {}) {
    const errors = {};
    const subject = subjects.find((s) => s.id === input.subjectId) ?? null;
    if (!subject) errors.subjectId = 'Choisissez une matière.';
    else if (!subject.teacherId) errors.subjectId = "Cette matière n'a pas d'enseignant attribué.";

    const date = text(input.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) errors.date = 'Indiquez la date de la séance.';
    else if (date > todayISO()) errors.date = 'Une séance ne peut pas être enregistrée dans le futur.';
    else if (date < config.SEMESTER_START) errors.date = `Date antérieure au début du semestre (${formatDate(config.SEMESTER_START)}).`;

    const start = text(input.startTime);
    const end = text(input.endTime);
    let hours = 0;
    if (!TIME.test(start)) errors.startTime = "Indiquez l'heure de début (HH:MM).";
    if (!TIME.test(end)) errors.endTime = "Indiquez l'heure de fin (HH:MM).";
    if (!errors.startTime && !errors.endTime) {
        hours = (minutes(end) - minutes(start)) / 60;
        if (hours <= 0) errors.endTime = "L'heure de fin doit être postérieure à l'heure de début.";
        else if (hours < 0.5) errors.endTime = 'Durée minimale : 30 minutes.';
        else if (hours > 8) errors.endTime = 'Durée maximale : 8 heures.';
    }
    if (text(input.note).length > 200) errors.note = 'Texte trop long (200 caractères maximum).';

    // Chevauchements le même jour : même enseignant, ou même classe (deux cours en même temps)
    if (subject?.teacherId && !errors.date && !errors.startTime && !errors.endTime && hours > 0) {
        const candidate = { startTime: start, endTime: end };
        const clash = sessions.filter((s) => s.id !== ownId && s.date === date && overlaps(s, candidate)).find((s) => {
            const other = subjects.find((x) => x.id === s.subjectId);
            return s.teacherId === subject.teacherId || (other && other.levelId === subject.levelId);
        });
        if (clash) {
            const other = subjects.find((x) => x.id === clash.subjectId);
            const teacher = teachers.find((t) => t.id === clash.teacherId);
            errors.startTime = clash.teacherId === subject.teacherId
                ? `Chevauche une autre séance de cet enseignant le ${formatDate(date)} : ${clash.startTime}-${clash.endTime} (${other?.code ?? '?'}).`
                : `La classe a déjà cours à cette heure : ${clash.startTime}-${clash.endTime} (${other?.code ?? '?'}, ${teacher ? `${teacher.firstName} ${teacher.lastName}` : 'autre enseignant'}).`;
        }
    }
    return { errors, subject, hours, date, start, end };
}

const fail = (errors, message = 'Veuillez corriger les champs signalés.') => {
    if (Object.keys(errors).length) throw new ValidationError(message, errors);
};

async function loadContext() {
    const [subjects, sessions, teachers] = await Promise.all([list('subjects'), list('sessions'), list('teachers')]);
    return { subjects, sessions, teachers };
}

export const SessionService = {
    /** filters : { teacherId, subjectId, status, from, to } (dates ISO, bornes incluses) */
    async list({ teacherId, subjectId, status, from, to } = {}) {
        if (!config.USE_MOCK) return request('GET', '/sessions', { query: { teacherId, subjectId, status, from, to } });
        let items = await list('sessions');
        if (teacherId) items = items.filter((s) => s.teacherId === teacherId);
        if (subjectId) items = items.filter((s) => s.subjectId === subjectId);
        if (status) items = items.filter((s) => s.status === status);
        if (from) items = items.filter((s) => s.date >= from);
        if (to) items = items.filter((s) => s.date <= to);
        return items;
    },

    async get(id) {
        if (!config.USE_MOCK) return requestOrNull('GET', `/sessions/${enc(id)}`);
        return (await list('sessions')).find((s) => s.id === id) ?? null;
    },

    /** Séances enrichies (durée, enseignant, matière, classe), de la plus récente à la plus ancienne. */
    async detailed(filters = {}) {
        if (!config.USE_MOCK) return request('GET', '/sessions/detailed', { query: filters });
        const [sessions, teachers, subjects, classes] = await Promise.all([this.list(filters), list('teachers'), list('subjects'), ReferenceService.classes()]);
        const teacherById = new Map(teachers.map((t) => [t.id, t]));
        const subjectById = new Map(subjects.map((s) => [s.id, s]));
        const classById = new Map(classes.map((c) => [c.id, c]));
        return sessions
            .map((s) => {
                const subject = subjectById.get(s.subjectId);
                return { ...s, hours: sessionHours(s), teacher: teacherById.get(s.teacherId), subject, cls: classById.get(subject?.levelId) };
            })
            .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
    },

    /** Compteurs { total, present, absent, rate, hours (réalisées), scheduledHours } sur la période demandée. */
    async stats(filters = {}) {
        if (!config.USE_MOCK) return request('GET', '/sessions/stats', { query: filters });
        const sessions = await this.list(filters);
        const present = sessions.filter((s) => s.status === 'present');
        const hours = (items) => round2(items.reduce((total, s) => total + sessionHours(s), 0));
        return {
            total: sessions.length, present: present.length, absent: sessions.length - present.length,
            rate: presenceRate(sessions), hours: hours(present), scheduledHours: hours(sessions),
        };
    },

    /** Le chef déclare une séance effectuée par l'enseignant de la matière (statut « présent »). */
    async declare(input, actor) {
        if (!config.USE_MOCK) return request('POST', '/sessions', { body: input });
        if (actor?.role !== 'chef') throw new ValidationError("Seul le chef de département peut déclarer une séance.");
        const ctx = await loadContext();
        const { errors, subject, date, start, end } = validateSession(input, ctx);
        fail(errors);
        const session = {
            id: idSequence('ses', ctx.sessions, 4)(), teacherId: subject.teacherId, subjectId: subject.id, date, startTime: start, endTime: end,
            status: 'present', declaredBy: actor.id, note: text(input.note) || null,
        };
        ctx.sessions.push(session);
        await replaceAll('sessions', ctx.sessions);
        return session;
    },

    /** Le chef enregistre l'absence d'un enseignant à une séance. */
    async recordAbsence(input, actor) {
        if (!config.USE_MOCK) return request('POST', '/sessions/absences', { body: input });
        if (actor?.role !== 'chef') throw new ValidationError("Seul le chef de département peut enregistrer une absence.");
        const ctx = await loadContext();
        const { errors, subject, date, start, end } = validateSession(input, ctx);
        fail(errors);
        const session = {
            id: idSequence('ses', ctx.sessions, 4)(), teacherId: subject.teacherId, subjectId: subject.id, date, startTime: start, endTime: end,
            status: 'absent', declaredBy: actor.id, note: text(input.note) || 'Raison non communiquée',
        };
        ctx.sessions.push(session);
        await replaceAll('sessions', ctx.sessions);
        return session;
    },

    /** Corrige une séance (le chef peut tout modifier, y compris le statut). */
    async update(id, input, actor) {
        if (!config.USE_MOCK) return request('PUT', `/sessions/${enc(id)}`, { body: input });
        if (actor?.role !== 'chef') throw new ValidationError("Vous n'avez pas le droit de modifier cette séance.");
        const ctx = await loadContext();
        const session = ctx.sessions.find((s) => s.id === id);
        if (!session) throw new ValidationError('Séance introuvable.');
        const { errors, subject, date, start, end } = validateSession(input, ctx, { ownId: id });
        const status = input.status ?? session.status;
        if (!SESSION_STATUS[status]) errors.status = 'Statut invalide.';
        fail(errors);
        Object.assign(session, {
            teacherId: subject.teacherId, subjectId: subject.id, date, startTime: start, endTime: end, status,
            note: text(input.note) || (status === 'absent' ? 'Raison non communiquée' : null),
        });
        await replaceAll('sessions', ctx.sessions);
        return session;
    },

    async remove(id, actor) {
        if (!config.USE_MOCK) { await request('DELETE', `/sessions/${enc(id)}`); return; }
        if (actor?.role !== 'chef') throw new ValidationError("Vous n'avez pas le droit de retirer cette séance.");
        const sessions = await list('sessions');
        if (!sessions.some((s) => s.id === id)) throw new ValidationError('Séance introuvable.');
        await replaceAll('sessions', sessions.filter((s) => s.id !== id));
    },
};

export const HoursService = {
    async summary(teacherId) {
        if (!config.USE_MOCK) return requestOrNull('GET', `/teachers/${enc(teacherId)}/hours`);
        const [teachers, subjects, sessions] = await Promise.all([list('teachers'), list('subjects'), list('sessions')]);
        const teacher = teachers.find((t) => t.id === teacherId);
        return teacher ? hoursSummary({ teacher, subjects, sessions, period: period() }) : null;
    },

    async summaries() {
        if (!config.USE_MOCK) return request('GET', '/hours');
        const [teachers, subjects, sessions] = await Promise.all([list('teachers'), list('subjects'), list('sessions')]);
        return teachers.map((teacher) => hoursSummary({ teacher, subjects, sessions, period: period() }));
    },
};
