/*
 * Emploi du temps : créneaux hebdomadaires récurrents rattachés à une matière, et leurs occurrences datées.
 *
 * Règles de gestion (projet.md §7, « Emploi du temps ») — identiques à celles du backend (src/Timetable.php) :
 *  - un créneau = une matière + un jour (lundi → samedi) + une plage horaire + une salle facultative + une période de validité ;
 *    la matière fixe l'enseignant, la classe et le semestre : aucune incohérence possible, la grille suit une réattribution ;
 *  - pas de chevauchement le même jour pour le même enseignant, la même classe ou la même salle (sur la période commune) ;
 *  - une OCCURRENCE est un créneau à une date donnée ; son statut vient des séances enregistrées :
 *      « done » / « absent » : une séance de la même matière, le même jour, dont la plage chevauche le créneau ;
 *      « cancelled »         : annulée (jour férié, salle indisponible…), sauf si une séance a quand même été enregistrée ;
 *      « upcoming »          : date postérieure à aujourd'hui, rien d'enregistré ;
 *      « toConfirm »         : date passée (ou du jour), rien d'enregistré : le chef confirme la séance ou déclare l'absence ;
 *  - confirmer / déclarer une absence crée la séance avec les horaires du créneau, avec les contrôles de SessionService.
 */

import { config } from '../config.js';
import { addDays, diffDays, formatDate, todayISO } from '../utils/format.js';
import { list, replaceAll } from './data.js';
import { ValidationError } from './errors.js';
import { idSequence } from './ids.js';
import { request, requestOrNull } from './api.js';
import { SessionService } from './teaching.js';
import { academicYearBounds } from './calendar.js';

const enc = encodeURIComponent;

/** Libellés des jours (1 = lundi … 6 = samedi) pour l'affichage. */
export const WEEKDAYS = { 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi' };
const DAY_NAMES = { 1: 'lundi', 2: 'mardi', 3: 'mercredi', 4: 'jeudi', 5: 'vendredi', 6: 'samedi' }; // dans les messages
export const OCCURRENCE_STATUS = { upcoming: 'À venir', toConfirm: 'À confirmer', done: 'Effectuée', absent: 'Absence', cancelled: 'Annulée' };
export const MAX_SPAN_DAYS = 370;

const text = (value) => String(value ?? '').trim();
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const overlaps = (aStart, aEnd, bStart, bEnd) => minutes(aStart) < minutes(bEnd) && minutes(bStart) < minutes(aEnd);
const isDate = (value) => {
    if (!DATE.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
/** 1 = lundi … 7 = dimanche */
export const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7;

/** Y a-t-il au moins une date du jour de semaine donné dans la période commune ? */
function shareADate(fromA, untilA, fromB, untilB, weekday) {
    const from = fromA > fromB ? fromA : fromB;
    const to = untilA < untilB ? untilA : untilB;
    if (from > to) return false;
    return addDays(from, (weekday - weekdayOf(from) + 7) % 7) <= to;
}

function fail(errors, message = 'Veuillez corriger les champs signalés.') {
    if (Object.keys(errors).length) throw new ValidationError(message, errors);
}

/** Créneaux enrichis (enseignant, classe, semestre de la matière), triés par jour puis heure. */
function withSubject(slots, subjects) {
    const bySubject = new Map(subjects.map((s) => [s.id, s]));
    return slots
        .map((t) => {
            const subject = bySubject.get(t.subjectId);
            return {
                id: t.id, subjectId: t.subjectId, teacherId: subject?.teacherId ?? null, levelId: subject?.levelId ?? null, semester: subject?.semester ?? null,
                weekday: Number(t.weekday), startTime: t.startTime, endTime: t.endTime, room: t.room ?? null, validFrom: t.validFrom, validUntil: t.validUntil,
            };
        })
        .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
}

async function loadSlots(filters = {}) {
    const [slots, subjects] = await Promise.all([list('timetableSlots'), list('subjects')]);
    return withSubject(slots, subjects).filter((t) =>
        (!filters.teacherId || t.teacherId === filters.teacherId) && (!filters.levelId || t.levelId === filters.levelId) && (!filters.subjectId || t.subjectId === filters.subjectId));
}

/** Cherche un créneau en conflit (enseignant, classe ou salle). Retourne { field, message } ou null. */
function findConflict(cand, others, subjects, teachers) {
    const room = text(cand.room).toLowerCase();
    let classConflict = null;
    let roomConflict = null;
    for (const o of others) {
        if (o.weekday !== cand.weekday || !overlaps(cand.startTime, cand.endTime, o.startTime, o.endTime)
            || !shareADate(cand.validFrom, cand.validUntil, o.validFrom, o.validUntil, cand.weekday)) continue;
        const subject = subjects.find((s) => s.id === o.subjectId);
        const teacher = teachers.find((t) => t.id === subject?.teacherId);
        const when = `${DAY_NAMES[o.weekday] ?? ''} ${o.startTime}-${o.endTime}`;
        const code = subject?.code ?? '?';
        if (o.teacherId === cand.teacherId) return { field: 'startTime', message: `Chevauche un autre créneau de cet enseignant : ${when} (${code}).` };
        if (!classConflict && o.levelId === cand.levelId) {
            classConflict = { field: 'startTime', message: `La classe a déjà cours à cette heure : ${when} (${code}, ${teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() : ''}).` };
        }
        if (!roomConflict && room && text(o.room).toLowerCase() === room) {
            roomConflict = { field: 'room', message: `La salle « ${text(cand.room)} » est déjà occupée : ${when} (${code}).` };
        }
    }
    return classConflict ?? roomConflict;
}

/** Valide un créneau. Retourne les champs à enregistrer ; lève une ValidationError sinon. */
function validateSlot(input, { subjects, teachers, slots }, ownId = null) {
    const errors = {};
    const subjectId = text(input.subjectId);
    const subject = subjects.find((s) => s.id === subjectId) ?? null;
    if (!subject) errors.subjectId = 'Choisissez une matière.';
    else if (!subject.teacherId) errors.subjectId = "Cette matière n'a pas d'enseignant attribué.";

    const rawDay = input.weekday;
    const weekday = rawDay !== '' && rawDay !== null && rawDay !== undefined && Number.isFinite(Number(rawDay)) && Number.isInteger(Number(rawDay)) ? Number(rawDay) : 0;
    if (weekday < 1 || weekday > 6) errors.weekday = 'Choisissez un jour de la semaine (du lundi au samedi).';

    const start = text(input.startTime);
    const end = text(input.endTime);
    if (!TIME.test(start)) errors.startTime = "Indiquez l'heure de début (HH:MM).";
    if (!TIME.test(end)) errors.endTime = "Indiquez l'heure de fin (HH:MM).";
    if (!errors.startTime && !errors.endTime) {
        const hours = (minutes(end) - minutes(start)) / 60;
        if (hours <= 0) errors.endTime = "L'heure de fin doit être postérieure à l'heure de début.";
        else if (hours < 0.5) errors.endTime = 'Durée minimale : 30 minutes.';
        else if (hours > 8) errors.endTime = 'Durée maximale : 8 heures.';
    }

    const room = text(input.room);
    if ([...room].length > 40) errors.room = 'La salle ne doit pas dépasser 40 caractères.';

    const bounds = academicYearBounds();
    const from = text(input.validFrom);
    const until = text(input.validUntil);
    const outside = `La date doit être dans l'année universitaire ${config.ACADEMIC_YEAR} (${formatDate(bounds.from)} – ${formatDate(bounds.to)}).`;
    if (!isDate(from)) errors.validFrom = 'Indiquez le début de la période.';
    else if (from < bounds.from || from > bounds.to) errors.validFrom = outside;
    if (!isDate(until)) errors.validUntil = 'Indiquez la fin de la période.';
    else if (until < bounds.from || until > bounds.to) errors.validUntil = outside;
    else if (!errors.validFrom && until < from) errors.validUntil = 'La fin de la période doit être postérieure ou égale au début.';

    if (!Object.keys(errors).length) {
        const conflict = findConflict(
            { teacherId: subject.teacherId, levelId: subject.levelId, weekday, startTime: start, endTime: end, room, validFrom: from, validUntil: until },
            slots.filter((t) => t.id !== ownId), subjects, teachers,
        );
        if (conflict) errors[conflict.field] = conflict.message;
    }
    fail(errors);
    return { subjectId: subject.id, weekday, startTime: start, endTime: end, room: room || null, validFrom: from, validUntil: until };
}

/** Occurrences des créneaux entre deux dates incluses, avec leur statut. Logique identique à Timetable::occurrences (PHP). */
function buildOccurrences(slots, exceptions, sessions, today, from, to) {
    const cancelled = new Map(exceptions.map((e) => [`${e.slotId}|${e.date}`, e.reason ?? null]));
    const bySubjectDate = new Map();
    sessions.filter((s) => s.date >= from && s.date <= to).sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id)).forEach((s) => {
        const key = `${s.subjectId}|${s.date}`;
        bySubjectDate.set(key, [...(bySubjectDate.get(key) ?? []), s]);
    });
    const rows = [];
    for (const slot of slots) {
        if (slot.validFrom > to || slot.validUntil < from) continue;
        const first = slot.validFrom > from ? slot.validFrom : from;
        const last = slot.validUntil < to ? slot.validUntil : to;
        for (let date = addDays(first, (slot.weekday - weekdayOf(first) + 7) % 7); date <= last; date = addDays(date, 7)) {
            const session = (bySubjectDate.get(`${slot.subjectId}|${date}`) ?? []).find((s) => overlaps(slot.startTime, slot.endTime, s.startTime, s.endTime)) ?? null;
            const isCancelled = cancelled.has(`${slot.id}|${date}`);
            const status = session ? (session.status === 'present' ? 'done' : 'absent') : isCancelled ? 'cancelled' : date > today ? 'upcoming' : 'toConfirm';
            rows.push({
                id: `${slot.id}@${date}`, slotId: slot.id, date, weekday: slot.weekday, startTime: slot.startTime, endTime: slot.endTime, room: slot.room,
                subjectId: slot.subjectId, teacherId: slot.teacherId, levelId: slot.levelId, status, sessionId: session?.id ?? null,
                reason: status === 'cancelled' ? cancelled.get(`${slot.id}|${date}`) : null,
            });
        }
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.slotId.localeCompare(b.slotId));
}

/** Nombre de créneaux d'une matière (classe et semestre figés, suppression, usage). */
export async function countSlots(subjectId) {
    return (await list('timetableSlots')).filter((t) => t.subjectId === subjectId).length;
}

/** Le nouveau titulaire d'une matière a-t-il déjà cours à l'heure de ses créneaux ? Retourne un message d'erreur ou null. */
export async function teacherChangeConflict(subjectId, newTeacherId) {
    const all = await loadSlots();
    const mine = all.filter((t) => t.subjectId === subjectId);
    if (!mine.length) return null;
    for (const o of all.filter((t) => t.teacherId === newTeacherId && t.subjectId !== subjectId)) {
        for (const m of mine) {
            if (o.weekday === m.weekday && overlaps(m.startTime, m.endTime, o.startTime, o.endTime) && shareADate(m.validFrom, m.validUntil, o.validFrom, o.validUntil, m.weekday)) {
                return `Réattribution impossible : cet enseignant a déjà un créneau à la même heure (${DAY_NAMES[m.weekday] ?? ''} ${m.startTime}-${m.endTime}).`;
            }
        }
    }
    return null;
}

/** Occurrence d'un créneau à une date (confirmer, absence, annuler, rétablir). Retourne { slot, occurrence, error }. */
async function findOccurrence(slotId, date) {
    const slot = (await loadSlots()).find((t) => t.id === slotId) ?? null;
    if (!slot) return { slot: null, occurrence: null, error: 'Créneau introuvable.' };
    if (!isDate(date)) return { slot, occurrence: null, error: 'Indiquez la date de la séance.' };
    if (date < slot.validFrom || date > slot.validUntil || weekdayOf(date) !== slot.weekday) return { slot, occurrence: null, error: "Ce créneau n'a pas lieu à cette date." };
    const [exceptions, sessions] = await Promise.all([list('timetableExceptions'), list('sessions')]);
    const occurrence = buildOccurrences([slot], exceptions, sessions, todayISO(), date, date)[0] ?? null;
    return { slot, occurrence, error: occurrence ? null : "Ce créneau n'a pas lieu à cette date." };
}

function requireChef(actor) {
    if (actor?.role !== 'chef') throw new ValidationError("Seul le chef de département peut gérer l'emploi du temps.");
}

/** Enregistre la séance d'une occurrence : présente (confirmation) ou absente. Retourne la séance créée. */
async function recordOccurrence(input, actor, status) {
    requireChef(actor);
    const { occurrence, error } = await findOccurrence(text(input.slotId), text(input.date));
    if (error) throw new ValidationError(error);
    if (occurrence.status === 'done' || occurrence.status === 'absent') throw new ValidationError('Une séance est déjà enregistrée pour ce créneau à cette date.');
    if (occurrence.status === 'cancelled') throw new ValidationError("Ce créneau est annulé à cette date : rétablissez-le d'abord.");
    const session = { subjectId: occurrence.subjectId, date: occurrence.date, startTime: occurrence.startTime, endTime: occurrence.endTime, note: input.note ?? '' };
    try {
        return await (status === 'present' ? SessionService.declare(session, actor) : SessionService.recordAbsence(session, actor));
    } catch (e) {
        if (e instanceof ValidationError && e.fields) throw new ValidationError(Object.values(e.fields)[0], e.fields);
        throw e;
    }
}

export const TimetableService = {
    /** Créneaux. Filtres : teacherId, levelId, subjectId. */
    async slots({ teacherId, levelId, subjectId } = {}) {
        if (!config.USE_MOCK) return request('GET', '/timetable/slots', { query: { teacherId, levelId, subjectId } });
        return loadSlots({ teacherId, levelId, subjectId });
    },

    async slot(id) {
        if (!config.USE_MOCK) return requestOrNull('GET', `/timetable/slots/${enc(id)}`);
        return (await loadSlots()).find((t) => t.id === id) ?? null;
    },

    async createSlot(input, actor) {
        if (!config.USE_MOCK) return request('POST', '/timetable/slots', { body: input });
        requireChef(actor);
        const [rows, subjects, teachers] = await Promise.all([list('timetableSlots'), list('subjects'), list('teachers')]);
        const fields = validateSlot(input, { subjects, teachers, slots: withSubject(rows, subjects) });
        const slot = { id: idSequence('slt', rows, 3)(), ...fields };
        await replaceAll('timetableSlots', [...rows, slot]);
        return (await loadSlots()).find((t) => t.id === slot.id);
    },

    async updateSlot(id, input, actor) {
        if (!config.USE_MOCK) return request('PUT', `/timetable/slots/${enc(id)}`, { body: input });
        requireChef(actor);
        const [rows, subjects, teachers] = await Promise.all([list('timetableSlots'), list('subjects'), list('teachers')]);
        const index = rows.findIndex((t) => t.id === id);
        if (index < 0) throw new ValidationError('Créneau introuvable.');
        rows[index] = { id, ...validateSlot(input, { subjects, teachers, slots: withSubject(rows, subjects) }, id) };
        await replaceAll('timetableSlots', rows);
        return (await loadSlots()).find((t) => t.id === id);
    },

    /** Supprime un créneau et ses annulations ; les séances déjà enregistrées sont conservées. */
    async removeSlot(id, actor) {
        if (!config.USE_MOCK) { await request('DELETE', `/timetable/slots/${enc(id)}`); return; }
        requireChef(actor);
        const [rows, exceptions] = await Promise.all([list('timetableSlots'), list('timetableExceptions')]);
        if (!rows.some((t) => t.id === id)) throw new ValidationError('Créneau introuvable.');
        await replaceAll('timetableSlots', rows.filter((t) => t.id !== id));
        await replaceAll('timetableExceptions', exceptions.filter((e) => e.slotId !== id));
    },

    /** Occurrences sur [from, to] (par défaut la semaine en cours). Filtres : teacherId, levelId, subjectId, status. */
    async occurrences({ from, to, teacherId, levelId, subjectId, status } = {}) {
        if (!config.USE_MOCK) return request('GET', '/timetable/occurrences', { query: { from, to, teacherId, levelId, subjectId, status } });
        const today = todayISO();
        if (!from && !to) {
            from = addDays(today, 1 - weekdayOf(today));
            to = addDays(from, 6);
        }
        if (!isDate(from ?? '') || !isDate(to ?? '') || to < from) throw new ValidationError('Indiquez une période valide (from et to, AAAA-MM-JJ).');
        if (diffDays(from, to) > MAX_SPAN_DAYS) throw new ValidationError(`Période trop longue (${MAX_SPAN_DAYS} jours maximum).`);
        const [slots, exceptions, sessions] = await Promise.all([loadSlots({ teacherId, levelId, subjectId }), list('timetableExceptions'), list('sessions')]);
        const rows = buildOccurrences(slots, exceptions, sessions, today, from, to);
        return status ? rows.filter((o) => o.status === status) : rows;
    },

    /** Le chef confirme qu'une séance a eu lieu (statut « présent »). */
    async confirm(input, actor) {
        if (!config.USE_MOCK) return request('POST', '/timetable/occurrences/confirm', { body: input });
        return recordOccurrence(input, actor, 'present');
    },

    /** Le chef déclare l'absence de l'enseignant à cette occurrence. */
    async markAbsent(input, actor) {
        if (!config.USE_MOCK) return request('POST', '/timetable/occurrences/absence', { body: input });
        return recordOccurrence(input, actor, 'absent');
    },

    /** Annule une occurrence (jour férié, salle indisponible…). Retourne { slotId, date, reason }. */
    async cancel(input, actor) {
        if (!config.USE_MOCK) return request('POST', '/timetable/occurrences/cancel', { body: input });
        requireChef(actor);
        const { occurrence, error } = await findOccurrence(text(input.slotId), text(input.date));
        if (error) throw new ValidationError(error);
        if (occurrence.status === 'done' || occurrence.status === 'absent') throw new ValidationError("Une séance est déjà enregistrée à cette date : retirez-la d'abord.");
        if (occurrence.status === 'cancelled') throw new ValidationError('Ce créneau est déjà annulé à cette date.');
        const reason = text(input.reason);
        if ([...reason].length > 120) throw new ValidationError('Veuillez corriger les champs signalés.', { reason: 'Motif trop long (120 caractères maximum).' });
        const exceptions = await list('timetableExceptions');
        await replaceAll('timetableExceptions', [...exceptions, { slotId: occurrence.slotId, date: occurrence.date, reason: reason || null }]);
        return { slotId: occurrence.slotId, date: occurrence.date, reason: reason || null };
    },

    /** Rétablit une occurrence annulée. */
    async restore(input, actor) {
        if (!config.USE_MOCK) { await request('POST', '/timetable/occurrences/restore', { body: input }); return; }
        requireChef(actor);
        const exceptions = await list('timetableExceptions');
        const kept = exceptions.filter((e) => !(e.slotId === text(input.slotId) && e.date === text(input.date)));
        if (kept.length === exceptions.length) throw new ValidationError("Ce créneau n'est pas annulé à cette date.");
        await replaceAll('timetableExceptions', kept);
    },
};
