/*
 * Suivi des enseignants : séances (présences, absences) et heures.
 *
 * Règles de gestion des séances (projet.md §7) :
 *  - l'enseignant DÉCLARE les séances qu'il a effectuées (statut « présent ») ;
 *  - le chef de département ENREGISTRE les absences (l'enseignant ne se déclare pas absent) et peut corriger ou retirer toute séance ;
 *  - une séance ne peut pas être dans le futur, ni avant le début du semestre, ni chevaucher une autre séance du même enseignant
 *    ou de la même classe le même jour ;
 *  - l'enseignant ne corrige / retire que ses propres déclarations, pendant SESSION_EDIT_DAYS jours ;
 *  - heures réalisées = durée des séances « présent » ; les pages affichent l'objet hoursSummary tel quel.
 * Ces contrôles sont refaits ici car le backend devra les refaire : l'interface ne fait que les refléter.
 */

import { config } from '../config.js';
import { hoursSummary, presenceRate, round2, sessionHours } from '../utils/calculs.js';
import { diffDays, formatDate, todayISO } from '../utils/format.js';
import { list, replaceAll } from './data.js';
import { ValidationError } from './errors.js';
import { idSequence } from './ids.js';
import { ReferenceService } from './people.js';

const period = () => `${config.CURRENT_SEMESTER}-${config.ACADEMIC_YEAR}`;
const text = (value) => String(value ?? '').trim();
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const overlaps = (a, b) => minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime);
export const SESSION_STATUS = { present: 'Présent', absent: 'Absent' };

/** L'acteur peut-il corriger ou retirer cette séance ? (utilisé par les pages pour afficher ou non les actions) */
export function canModifySession(session, actor, today = todayISO()) {
    if (!actor) return false;
    if (actor.role === 'chef') return true;
    return actor.role === 'enseignant' && session.teacherId === actor.profileId && session.status === 'present'
        && session.declaredBy === actor.id && diffDays(session.date, today) <= config.SESSION_EDIT_DAYS;
}

/**
 * Valide une séance. forcedTeacherId : si fourni (enseignant), la matière doit lui appartenir.
 * Retourne { errors, subject, hours }.
 */
function validateSession(input, { subjects, sessions, teachers }, { ownId = null, forcedTeacherId = null } = {}) {
    const errors = {};
    const subject = subjects.find((s) => s.id === input.subjectId) ?? null;
    if (!subject) errors.subjectId = 'Choisissez une matière.';
    else if (!subject.teacherId) errors.subjectId = "Cette matière n'a pas d'enseignant attribué.";
    else if (forcedTeacherId && subject.teacherId !== forcedTeacherId) errors.subjectId = "Cette matière ne vous est pas attribuée.";

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
        let items = await list('sessions');
        if (teacherId) items = items.filter((s) => s.teacherId === teacherId);
        if (subjectId) items = items.filter((s) => s.subjectId === subjectId);
        if (status) items = items.filter((s) => s.status === status);
        if (from) items = items.filter((s) => s.date >= from);
        if (to) items = items.filter((s) => s.date <= to);
        return items;
    },

    async get(id) {
        return (await list('sessions')).find((s) => s.id === id) ?? null;
    },

    /** Séances enrichies (durée, enseignant, matière, classe), de la plus récente à la plus ancienne. */
    async detailed(filters = {}) {
        const [sessions, teachers, subjects, classes, checkins] = await Promise.all([this.list(filters), list('teachers'), list('subjects'), ReferenceService.classes(), list('checkins')]);
        const marked = new Set(checkins.map((c) => `${c.teacherId}|${c.subjectId}|${c.date}`)); // présences géolocalisées
        const teacherById = new Map(teachers.map((t) => [t.id, t]));
        const subjectById = new Map(subjects.map((s) => [s.id, s]));
        const classById = new Map(classes.map((c) => [c.id, c]));
        return sessions
            .map((s) => {
                const subject = subjectById.get(s.subjectId);
                return { ...s, hours: sessionHours(s), teacher: teacherById.get(s.teacherId), subject, cls: classById.get(subject?.levelId), verified: s.status === 'present' && marked.has(`${s.teacherId}|${s.subjectId}|${s.date}`) };
            })
            .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
    },

    /** Compteurs { total, present, absent, rate, hours (réalisées), scheduledHours } sur la période demandée. */
    async stats(filters = {}) {
        const sessions = await this.list(filters);
        const present = sessions.filter((s) => s.status === 'present');
        const hours = (items) => round2(items.reduce((total, s) => total + sessionHours(s), 0));
        return {
            total: sessions.length, present: present.length, absent: sessions.length - present.length,
            rate: presenceRate(sessions), hours: hours(present), scheduledHours: hours(sessions),
        };
    },

    /** L'enseignant déclare une séance qu'il a effectuée. */
    async declare(input, actor) {
        if (actor?.role !== 'enseignant') throw new ValidationError("Seul l'enseignant peut déclarer ses séances.");
        const ctx = await loadContext();
        const { errors, subject, date, start, end } = validateSession(input, ctx, { forcedTeacherId: actor.profileId });
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

    /** Corrige une séance : le chef peut tout modifier (y compris le statut) ; l'enseignant ses propres déclarations récentes. */
    async update(id, input, actor) {
        const ctx = await loadContext();
        const session = ctx.sessions.find((s) => s.id === id);
        if (!session) throw new ValidationError('Séance introuvable.');
        if (!canModifySession(session, actor)) {
            throw new ValidationError(actor?.role === 'enseignant'
                ? `Vous ne pouvez corriger que vos déclarations des ${config.SESSION_EDIT_DAYS} derniers jours.`
                : "Vous n'avez pas le droit de modifier cette séance.");
        }
        const { errors, subject, date, start, end } = validateSession(input, ctx, { ownId: id, forcedTeacherId: actor.role === 'enseignant' ? actor.profileId : null });
        const status = actor.role === 'chef' ? input.status : 'present';
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
        const sessions = await list('sessions');
        const session = sessions.find((s) => s.id === id);
        if (!session) throw new ValidationError('Séance introuvable.');
        if (!canModifySession(session, actor)) throw new ValidationError("Vous n'avez pas le droit de retirer cette séance.");
        await replaceAll('sessions', sessions.filter((s) => s.id !== id));
    },
};

export const HoursService = {
    async summary(teacherId) {
        const [teachers, subjects, sessions] = await Promise.all([list('teachers'), list('subjects'), list('sessions')]);
        const teacher = teachers.find((t) => t.id === teacherId);
        return teacher ? hoursSummary({ teacher, subjects, sessions, period: period() }) : null;
    },

    async summaries() {
        const [teachers, subjects, sessions] = await Promise.all([list('teachers'), list('subjects'), list('sessions')]);
        return teachers.map((teacher) => hoursSummary({ teacher, subjects, sessions, period: period() }));
    },
};
