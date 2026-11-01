/*
 * Grille mensuelle du calendrier (semaine commençant le lundi), sans accès au DOM : testable seul.
 * Les événements de plusieurs jours forment une bande continue : chacun garde la même ligne (« lane »)
 * sur toute la semaine, pour que les puces restent alignées d'un jour à l'autre.
 */

import { addDays, parseDate, toISODate } from './format.js';

export const MAX_LANES = 3; // lignes d'événements visibles par jour ; les suivantes sont résumées en « +N »

const pad = (n) => String(n).padStart(2, '0');
export const monthKey = (year, month) => `${year}-${pad(month + 1)}`;

/** Premier et dernier jour affichés (lundi de la 1re semaine → dimanche de la dernière). */
export function gridRange(year, month) {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7; // lundi = 0
    const start = addDays(toISODate(first), -offset);
    const last = new Date(year, month + 1, 0);
    const end = addDays(toISODate(last), 6 - ((last.getDay() + 6) % 7));
    return { start, end };
}

const endOf = (event) => event.end ?? event.start;

/**
 * Construit les semaines du mois.
 * @returns {Array<Array<{iso, day, inMonth, isToday, isWeekend, slots: Array<{event, pos, showTitle}|null>, more: number}>>}
 */
export function buildMonth(year, month, events, todayIso) {
    const { start, end } = gridRange(year, month);
    const ordered = [...events].sort((a, b) =>
        a.start.localeCompare(b.start) || endOf(b).localeCompare(endOf(a)) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title, 'fr'));
    const weeks = [];
    for (let weekStart = start; weekStart <= end; weekStart = addDays(weekStart, 7)) {
        const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
        const weekEnd = dates[6];
        const lanes = []; // lanes[i][dayIndex] = événement
        for (const event of ordered) {
            if (endOf(event) < weekStart || event.start > weekEnd) continue;
            const from = Math.max(0, dates.indexOf(event.start < weekStart ? weekStart : event.start));
            const to = endOf(event) > weekEnd ? 6 : dates.indexOf(endOf(event));
            let lane = lanes.find((l) => l.slice(from, to + 1).every((slot) => !slot));
            if (!lane) { lane = Array(7).fill(null); lanes.push(lane); }
            for (let d = from; d <= to; d++) lane[d] = event;
        }
        weeks.push(dates.map((iso, index) => {
            const date = parseDate(iso);
            const visible = lanes.slice(0, MAX_LANES).map((lane) => {
                const event = lane[index];
                if (!event) return null;
                const isStart = iso === event.start;
                const isEnd = iso === endOf(event);
                return { event, pos: isStart && isEnd ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'mid', showTitle: isStart || index === 0 };
            });
            while (visible.length && !visible[visible.length - 1]) visible.pop();
            return {
                iso, day: date.getDate(), inMonth: date.getMonth() === month,
                isToday: iso === todayIso, isWeekend: index >= 5,
                slots: visible,
                more: lanes.slice(MAX_LANES).filter((lane) => lane[index]).length,
            };
        }));
    }
    return weeks;
}

/** Événements qui couvrent un jour donné, dans l'ordre d'affichage. */
export function eventsOnDay(events, iso) {
    return events
        .filter((e) => e.start <= iso && endOf(e) >= iso)
        .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'fr'));
}
