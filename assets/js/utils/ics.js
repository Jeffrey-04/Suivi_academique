/*
 * Export iCalendar (.ics, RFC 5545) : les événements s'importent tels quels dans Google Agenda, Outlook, Apple Calendrier.
 * Jour entier = DTSTART;VALUE=DATE avec une fin EXCLUSIVE (lendemain du dernier jour) ; avec horaires = heure « flottante » locale.
 */

import { config } from '../config.js';
import { eventType } from './event-types.js';
import { addDays } from './format.js';

const compact = (iso) => iso.replaceAll('-', '');
const clock = (hhmm) => `${hhmm.replace(':', '')}00`;

/** Échappement d'une valeur TEXT : \ ; , et retours à la ligne. */
const escapeText = (value) => String(value).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Pliage des lignes à 75 octets (UTF-8) maximum, suite précédée d'une espace. */
function fold(line) {
    const encoder = new TextEncoder();
    const parts = [];
    let current = '';
    let size = 0;
    for (const char of line) {
        const bytes = encoder.encode(char).length;
        if (size + bytes > (parts.length ? 74 : 75)) { parts.push(current); current = ''; size = 0; }
        current += char;
        size += bytes;
    }
    parts.push(current);
    return parts.join('\r\n ');
}

/** @param {Array} events @param {{ stamp?: string }} options stamp : AAAA-MM-JJ de génération (déterministe en test) */
export function buildIcs(events, { stamp } = {}) {
    const dtstamp = `${compact(stamp ?? new Date().toISOString().slice(0, 10))}T000000Z`;
    const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${config.APP_NAME}//FR`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(`${config.APP_NAME} ${config.ACADEMIC_YEAR}`)}`, 'X-WR-TIMEZONE:Africa/Douala',
    ];
    for (const event of events) {
        const timed = event.startTime && !event.end;
        lines.push('BEGIN:VEVENT', `UID:${event.id}@${config.ICS_DOMAIN ?? 'suivi-academique.local'}`, `DTSTAMP:${dtstamp}`);
        if (timed) {
            lines.push(`DTSTART:${compact(event.start)}T${clock(event.startTime)}`, `DTEND:${compact(event.start)}T${clock(event.endTime ?? event.startTime)}`);
        } else {
            lines.push(`DTSTART;VALUE=DATE:${compact(event.start)}`, `DTEND;VALUE=DATE:${compact(addDays(event.end ?? event.start, 1))}`);
        }
        lines.push(`SUMMARY:${escapeText(event.title)}`, `CATEGORIES:${escapeText(eventType(event.type).label)}`);
        if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
        if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(fold).join('\r\n')}\r\n`;
}
