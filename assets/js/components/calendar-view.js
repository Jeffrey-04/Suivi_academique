/*
 * Rendu HTML du calendrier : grille mensuelle et vue agenda (liste). Aucune logique de données ici :
 * calendar-page.js fournit les événements déjà filtrés et branche les clics (attributs data-event / data-day).
 */

import { MAX_LANES, buildMonth } from '../utils/calendar-grid.js';
import { eventType } from '../utils/event-types.js';
import { dayOfMonth, esc, formatDate, formatDateLong, formatDateRange, monthShort, relativeDay } from '../utils/format.js';
import { emptyState } from '../utils/ui.js';

export const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** « Janvier 2027 » */
export function monthLabel(year, month) {
    const label = new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
}

const timeOf = (e) => (e.startTime ? `${e.startTime}${e.endTime ? `–${e.endTime}` : ''}` : '');
const describe = (e) => `${eventType(e.type).label} : ${e.title}, ${e.end ? `du ${formatDate(e.start)} au ${formatDate(e.end)}` : formatDate(e.start)}`;

function chip(slot) {
    if (!slot) return '<span class="cal-chip cal-chip-gap" aria-hidden="true"></span>';
    const { event, pos, showTitle } = slot;
    const tone = eventType(event.type).tone;
    const text = showTitle ? `${pos === 'single' && event.startTime ? `<span class="cal-chip-time">${esc(event.startTime)}</span> ` : ''}${esc(event.title)}` : '';
    return `<button type="button" class="cal-chip cal-chip-${tone} is-${pos}" data-event="${esc(event.id)}" aria-label="${esc(describe(event))}" title="${esc(event.title)}"><span class="cal-chip-text">${text}</span></button>`;
}

/**
 * Grille du mois. canCreate : le numéro du jour devient un bouton d'ajout (chef).
 * @param {Array} events événements déjà filtrés (types actifs)
 */
export function monthGrid({ year, month, events, today, canCreate }) {
    const weeks = buildMonth(year, month, events, today);
    const head = WEEKDAYS.map((d) => `<div class="cal-weekday" role="columnheader">${d}</div>`).join('');
    const body = weeks.map((week) => `
      <div class="cal-week" role="row">${week.map((d) => {
        const classes = ['cal-day', d.inMonth ? '' : 'is-outside', d.isToday ? 'is-today' : '', d.isWeekend ? 'is-weekend' : ''].filter(Boolean).join(' ');
        const num = canCreate && d.inMonth
            ? `<button type="button" class="cal-day-num cal-day-add" data-day-add="${d.iso}" aria-label="Ajouter un événement le ${esc(formatDateLong(d.iso))}">${d.day}</button>`
            : `<span class="cal-day-num"${d.isToday ? ' aria-current="date"' : ''}>${d.day}</span>`;
        const more = d.more ? `<button type="button" class="cal-more" data-day="${d.iso}">+${d.more} autre${d.more > 1 ? 's' : ''}</button>` : '';
        return `<div class="${classes}" role="gridcell" data-iso="${d.iso}"><div class="cal-day-head">${num}</div><div class="cal-slots">${d.slots.map(chip).join('')}${more}</div></div>`;
    }).join('')}</div>`).join('');
    return `<div class="cal-month" role="grid" aria-label="${esc(monthLabel(year, month))}" data-max-lanes="${MAX_LANES}">
      <div class="cal-weekdays" role="row">${head}</div>${body}</div>`;
}

/** Vue agenda : événements du mois sous forme de liste cliquable. */
export function agendaList({ events, emptyMessage }) {
    if (!events.length) return emptyState(emptyMessage, 'bi-calendar-x');
    return `<ul class="event-list cal-agenda">${events.map((e) => {
        const type = eventType(e.type);
        const meta = [formatDateRange(e.start, e.end), timeOf(e), e.location].filter(Boolean).map(esc).join(' · ');
        return `
      <li class="event-item is-clickable" data-event="${esc(e.id)}" tabindex="0" role="button" aria-label="${esc(describe(e))}">
        <div class="event-date"><span class="event-day">${dayOfMonth(e.start)}</span><span class="event-month">${esc(monthShort(e.start))}</span></div>
        <div class="event-body">
          <div class="event-title">${esc(e.title)}</div>
          <div class="event-meta">${meta} · ${esc(relativeDay(e.start))}</div>
        </div>
        <span class="event-badge event-badge-${type.tone}"><i class="bi ${type.icon}"></i><span>${esc(type.label)}</span></span>
      </li>`;
    }).join('')}</ul>`;
}

/** Corps de la modale « tous les événements du jour » : un bouton par événement (data-modal-action = id). */
export function dayEventsList(events) {
    return `<ul class="cal-day-list">${events.map((e) => {
        const type = eventType(e.type);
        return `<li><button type="button" class="cal-day-list-item" data-modal-action="${esc(e.id)}"><span class="event-badge event-badge-${type.tone}"><i class="bi ${type.icon}"></i></span><span class="cal-day-list-text"><strong>${esc(e.title)}</strong><small>${esc([timeOf(e), e.location].filter(Boolean).join(' · ') || type.label)}</small></span></button></li>`;
    }).join('')}</ul>`;
}

/** Boutons de filtre par type (légende cliquable). */
export function typeFilters(types, active) {
    return Object.entries(types).map(([key, t]) =>
        `<button type="button" class="cal-filter cal-filter-${t.tone}" data-type="${key}" aria-pressed="${active.has(key)}"><i class="bi ${t.icon}" aria-hidden="true"></i> ${esc(t.label)}</button>`).join('');
}
