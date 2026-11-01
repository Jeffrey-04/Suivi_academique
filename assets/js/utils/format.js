/*
 * Formatage (dates, nombres, noms) et échappement HTML.
 * Les dates métier sont des chaînes ISO "YYYY-MM-DD" ; on évite new Date("YYYY-MM-DD")
 * (interprété en UTC) pour ne pas décaler d'un jour selon le fuseau.
 */

import { config } from '../config.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function parseDate(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function toISODate(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Aujourd'hui (minuit local) : date simulée en mode mock, vraie date sinon. */
export function today() {
    if (config.USE_MOCK && config.MOCK_TODAY) return parseDate(config.MOCK_TODAY);
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function todayISO() {
    return toISODate(today());
}

export function addDays(iso, days) {
    const d = parseDate(iso);
    d.setDate(d.getDate() + days);
    return toISODate(d);
}

/** Nombre de jours entre deux dates ISO (b - a). */
export function diffDays(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

/** 25/01/2027 */
export function formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
}

/** 25 janvier 2027 */
export function formatDateLong(iso) {
    if (!iso) return '—';
    const d = parseDate(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Plage lisible : "16 – 20 nov. 2026" ou "28 janv. 2027". */
export function formatDateRange(start, end) {
    const a = parseDate(start);
    if (!end || end === start) return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()}`;
    const b = parseDate(end);
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
        return `${a.getDate()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
    }
    return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
}

/** Jour de la semaine abrégé : « lun. », « mar. »… */
export function weekdayShort(iso) {
    return ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][parseDate(iso).getDay()];
}

export function monthShort(iso) {
    return MONTHS_SHORT[parseDate(iso).getMonth()];
}

export function dayOfMonth(iso) {
    return parseDate(iso).getDate();
}

/** "il y a 3 j", "dans 4 j", "aujourd'hui" par rapport à today(). */
export function relativeDay(iso) {
    const n = diffDays(todayISO(), String(iso).slice(0, 10));
    if (n === 0) return "aujourd'hui";
    if (n === 1) return 'demain';
    if (n === -1) return 'hier';
    return n > 0 ? `dans ${n} j` : `il y a ${-n} j`;
}

export function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return Number(value).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Note ou moyenne sur 20 : "12,50" ou "—" si absente. */
export function formatGrade(value) {
    return formatNumber(value, 2);
}

/** Heures décimales : 2,5 -> "2 h 30" ; 30 -> "30 h". */
export function formatHours(hours) {
    if (hours === null || hours === undefined) return '—';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Âge en années révolues à la date « aujourd'hui » de l'application. */
export function ageOf(birthIso) {
    const birth = parseDate(birthIso);
    const now = today();
    return now.getFullYear() - birth.getFullYear() - (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate()) ? 1 : 0);
}

export function fullName(person) {
    return person ? `${person.firstName} ${person.lastName}` : '';
}

export function initials(person) {
    return person ? `${person.firstName[0] || ''}${person.lastName[0] || ''}`.toUpperCase() : '';
}

/** Minuscules sans accents, pour les recherches (« hervé » trouve « Herve »). */
export function normalize(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Échappe une valeur avant insertion dans du HTML (innerHTML / gabarits). */
export function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
