/*
 * Petits gabarits HTML réutilisables. Toute donnée insérée passe par esc().
 * Les classes viennent de main.css (sections 8 et 25).
 */

import { url } from '../config.js';
import { EVENT_TYPES, eventType } from './event-types.js';
import { esc, dayOfMonth, formatDateRange, formatGrade, formatNumber, fullName, monthShort } from './format.js';

export { EVENT_TYPES, eventType };

/** Classes Bootstrap pour une pastille d'icône de notification, selon le ton. */
export const TONE_BG = {
    green: 'bg-success text-white',
    orange: 'bg-warning text-dark',
    red: 'bg-danger text-white',
    neutral: 'bg-secondary text-white',
};

/** Carte de statistique (colonne de grille incluse). hint est du texte, pas du HTML. */
export function statCard({ label, value, icon, hint = '', col = 'col-sm-6 col-xl-4' }) {
    return `
    <div class="${col}">
      <div class="card card-stat">
        <div class="card-header">
          <span class="stat-label">${esc(label)}</span>
          <span class="stat-icon"><i class="bi ${esc(icon)}"></i></span>
        </div>
        <div class="stat-value">${esc(value)}</div>
        <div class="stat-hint">${esc(hint)}</div>
      </div>
    </div>`;
}

/**
 * Liste d'événements (date, titre, lieu, type).
 * calendarUrl : page calendrier du rôle ; chaque ligne devient alors un lien vers la fiche de l'événement.
 */
export function eventList(events, { calendarUrl } = {}) {
    if (!events.length) return emptyState('Aucune échéance à venir.', 'bi-calendar-x');
    const items = events.map((e) => {
        const type = eventType(e.type);
        const where = e.location ? ` · ${esc(e.location)}` : '';
        const time = e.startTime ? ` · ${esc(e.startTime)}–${esc(e.endTime)}` : '';
        return `
      <li class="event-item${calendarUrl ? ' is-link' : ''}">
        <div class="event-date"><span class="event-day">${dayOfMonth(e.start)}</span><span class="event-month">${esc(monthShort(e.start))}</span></div>
        <div class="event-body">
          <div class="event-title">${calendarUrl ? `<a class="event-link stretched-link" href="${esc(eventUrl(calendarUrl, e.id))}">${esc(e.title)}</a>` : esc(e.title)}</div>
          <div class="event-meta">${esc(formatDateRange(e.start, e.end))}${time}${where}</div>
        </div>
        <span class="event-badge event-badge-${type.tone}"><i class="bi ${type.icon}"></i><span>${esc(type.label)}</span></span>
      </li>`;
    });
    return `<ul class="event-list">${items.join('')}</ul>`;
}

/** Lien vers la fiche d'un événement sur la page calendrier. */
export const eventUrl = (calendarUrl, id) => `${calendarUrl}?event=${encodeURIComponent(id)}`;

export function emptyState(message, icon = 'bi-inbox') {
    return `<div class="empty-state"><i class="bi ${esc(icon)}"></i><p>${esc(message)}</p></div>`;
}

export function errorState(message = 'Impossible de charger les données.') {
    return `<div class="alert alert-danger mb-0" role="alert"><i class="bi bi-exclamation-triangle me-2"></i>${esc(message)}</div>`;
}

/**
 * Remplit un conteneur avec un état de chargement, puis avec le résultat ou une erreur.
 * Retourne les données chargées (undefined en cas d'erreur ou de réponse périmée) pour initialiser ensuite les graphiques.
 * isCurrent (optionnel) : fonction qui dit si ce rendu est toujours le dernier demandé (ex. l'utilisateur a changé
 * de période entre-temps) ; sinon la réponse est ignorée sans toucher au DOM.
 */
export async function renderInto(container, loader, render, isCurrent = () => true) {
    container.innerHTML = '<div class="empty-state" aria-busy="true"><div class="spinner-border spinner-border-sm" role="status"></div><p>Chargement…</p></div>';
    try {
        const data = await loader();
        if (!isCurrent()) return undefined;
        container.innerHTML = render(data);
        applyDynamicWidths(container);
        return data;
    } catch (error) {
        console.error(error);
        if (isCurrent()) container.innerHTML = errorState();
        return undefined;
    }
}

/** Applique les largeurs dynamiques [data-pct] (barres de progression) sans style en ligne dans le HTML. */
export function applyDynamicWidths(root) {
    root.querySelectorAll('[data-pct]').forEach((el) => {
        el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.pct)))}%`;
    });
}

// ---- Composants du tableau de bord (balisage du template) ----------------------------------

const ARROWS = { up: 'bi-arrow-up-right', down: 'bi-arrow-down-left', flat: 'bi-arrow-right' };

/** Libellé de comparaison pour une tendance hebdomadaire (trend().window = nombre de semaines comparées). */
export const sinceWeeks = (weeks) => (weeks === 1 ? 'vs la semaine précédente' : `vs les ${weeks} semaines précédentes`);

/**
 * Décrit une tendance pour trendCard.
 * value : variation (null si pas de période de comparaison) ; goodWhen : sens favorable ('up' ou 'down').
 * Ex. describeTrend({ direction: 'up', value: 4.2, unit: '%', since: 'vs 4 semaines précédentes' })
 */
export function describeTrend({ direction, value, unit = '%', goodWhen = 'up', since = '' }) {
    if (value === null || value === undefined) return { direction: 'flat', good: true, text: 'Pas encore de comparaison' };
    if (direction === 'flat') return { direction, good: true, text: `Stable ${since}`.trim() };
    const sign = value > 0 ? '+' : '−';
    return { direction, good: direction === goodWhen, text: `${sign}${formatNumber(Math.abs(value), 1)} ${unit} ${since}`.trim() };
}

/**
 * Carte KPI avec tendance et courbe (« Net Income » / « Total Return » du template).
 * Une tendance favorable s'affiche en vert, défavorable en rouge ; la flèche suit le sens réel de la variation.
 * Le conteneur de la courbe a l'id spark-<id> : l'initialiser ensuite avec sparkline('#spark-<id>', …).
 */
export function trendCard({ id, label, icon, value, trend, hint = '', col = 'col-md-4' }) {
    const tone = trend.direction === 'flat' ? 'trend-flat' : trend.good ? 'trend-up' : 'trend-down';
    return `
    <div class="${col}">
      <div class="card card-stat d-flex flex-column justify-content-between">
        <div>
          <div class="card-header">
            <span class="stat-label">${esc(label)}</span>
            <span class="stat-icon"><i class="bi ${esc(icon)}"></i></span>
          </div>
          <div class="stat-value">${esc(value)}</div>
          <div class="trend-badge ${tone}">
            <i class="bi ${ARROWS[trend.direction]}"></i>
            <span>${esc(trend.text)}</span>
          </div>${hint ? `\n          <div class="stat-hint mt-1">${esc(hint)}</div>` : ''}
        </div>
        <div class="sparkline-container sparkline-card-footer"><div id="spark-${esc(id)}"></div></div>
      </div>
    </div>`;
}

const STAR_SHAPE = `
  <g transform="translate(50,50)">
    <rect x="-6" y="-45" width="12" height="90" rx="6" ry="6" fill="#B4F105" />
    <rect x="-6" y="-45" width="12" height="90" rx="6" ry="6" fill="#B4F105" transform="rotate(60)" />
    <rect x="-6" y="-45" width="12" height="90" rx="6" ry="6" fill="#B4F105" transform="rotate(120)" />
  </g>`;

/** Bannière verte de mise en avant (« Update » du template). Sans lien si `link` est absent. */
export function alertCard({ badge, date, text, link }) {
    const anchor = link
        ? `<a href="${esc(link.href ?? '#')}" class="alert-green-link z-index-2${link.soon ? ' is-soon' : ''}"${link.soon ? ' aria-disabled="true" title="Bientôt disponible"' : ''}><span>${esc(link.label)}</span><i class="bi bi-arrow-right"></i></a>`
        : '';
    return `
    <div class="card alert-green-card">
      <div class="position-relative z-index-2">
        <span class="alert-green-badge">${esc(badge)}</span>
        <div class="alert-green-date">${esc(date)}</div>
        <div class="alert-green-text">${esc(text)}</div>
      </div>${anchor}
      <svg class="alert-green-bg-shape" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${STAR_SHAPE}</svg>
    </div>`;
}

/**
 * Bannière d'appel à l'action (« Level up » du template).
 * button : { label, href } (lien actif), { label, soon: true } (désactivé) ; absent = pas de bouton.
 */
export function promoCard({ title, desc, button }) {
    let action = '';
    if (button?.href) action = `<a class="btn-promo" href="${esc(button.href)}">${esc(button.label)}</a>`;
    else if (button) action = `<button class="btn-promo is-soon" type="button" disabled title="Bientôt disponible">${esc(button.label)}</button>`;
    return `
    <div class="promo-banner-card">
      <svg class="promo-banner-bg-shape" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${STAR_SHAPE}</svg>
      <h3 class="promo-title">${esc(title)}</h3>
      <p class="promo-desc">${esc(desc)}</p>${action}
    </div>`;
}

/** Barres de progression (« Product Overview »). rows : [{ label, value, percent, tone: 'ok' | 'warn' | 'soft' }] */
export function progressList(rows, emptyMessage = 'Rien à afficher.') {
    if (!rows.length) return emptyState(emptyMessage, 'bi-bar-chart');
    const toneClass = { ok: 'bg-lime-accent', warn: 'bg-brand-orange', soft: 'bg-lime-accent opacity-50' };
    return rows.map((r) => `
      <div class="progress-container">
        <div class="progress-label-row">
          <span class="progress-label">${esc(r.label)}</span>
          <span class="progress-value">${esc(r.value)}</span>
        </div>
        <div class="progress" role="progressbar" aria-label="${esc(r.label)}" aria-valuenow="${Math.round(r.percent)}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-bar ${toneClass[r.tone ?? 'ok']}" data-pct="${Math.round(r.percent)}"></div>
        </div>
      </div>`).join('');
}

/** Liste d'activités (« Transaction »). rows : [{ icon, title, subtitle, amount, amountClass }] */
export function activityList(rows, emptyMessage = 'Aucune activité.') {
    if (!rows.length) return emptyState(emptyMessage, 'bi-check-circle');
    return `<div class="transaction-list">${rows.map((r) => `
      <div class="transaction-item">
        <div class="transaction-icon bg-forest-light text-lime"><i class="bi ${esc(r.icon)}"></i></div>
        <div class="transaction-info">
          <div class="transaction-name">${esc(r.title)}</div>
          <div class="transaction-date">${esc(r.subtitle)}</div>
        </div>
        <div class="transaction-amount ${esc(r.amountClass ?? 'text-main')}">${esc(r.amount)}</div>
      </div>`).join('')}</div>`;
}

/** Légende HTML sous un graphique. items : [{ label, dot (classe .bg-*), count? }] */
export function chartLegend(items, { wrap = false } = {}) {
    return `<div class="chart-legends-container${wrap ? ' chart-legends-wrap' : ''}">${items.map((i) => `
      <div class="chart-legend-item">
        <span class="legend-dot ${esc(i.dot)}"></span>
        <span class="text-muted-green">${esc(i.label)}${i.count !== undefined ? ` <strong class="text-main">${esc(i.count)}</strong>` : ''}</span>
      </div>`).join('')}</div>`;
}

// ---- Tableaux ---------------------------------------------------------------------------------

/** Cellule « personne » d'un tableau : photo, nom complet, ligne secondaire (balisage du template). */
export function userCell(person, subtitle = '') {
    return `
      <div class="table-user-cell">
        <img src="${esc(url(person.photo))}" alt="" class="table-user-avatar js-avatar" loading="lazy">
        <div>
          <div class="table-user-name">${esc(fullName(person))}</div>
          <div class="table-user-sub">${esc(subtitle)}</div>
        </div>
      </div>`;
}

/**
 * Tableau « Détail par matière » d'un relevé (lignes de buildReport enrichies de classAverage).
 * Statut : Validée (>= 10), Sous la moyenne (< 10) ou Incomplète (note manquante).
 */
/** condensed : sur petit écran, ne garde que matière, moyenne et statut (tableau de bord) ; sinon le tableau défile. */
export function subjectTable(lines, { condensed = false } = {}) {
    const md = condensed ? ' class="d-none d-md-table-cell"' : '';
    const sm = condensed ? ' class="d-none d-sm-table-cell"' : '';
    const status = (line) => {
        if (line.average === null) return '<span class="badge-table pending">Incomplète</span>';
        return line.average >= 10 ? '<span class="badge-table success">Validée</span>' : `<span class="badge-table failed">${condensed ? '<span class="d-none d-sm-inline">Sous la moyenne</span><span class="d-sm-none">Sous 10</span>' : 'Sous la moyenne'}</span>`;
    };
    const showRattrapage = lines.some((l) => l.rattrapage !== null && l.rattrapage !== undefined);
    const rows = lines.map((l) => `
        <tr>
          <td><div class="table-product-name">${esc(l.name)}</div><div class="table-user-sub">${esc(l.code)}</div></td>
          <td${md}>${esc(l.coefficient)}</td>
          <td${sm}>${formatGrade(l.cc)}</td>
          <td${sm}>${formatGrade(l.exam)}</td>
          ${showRattrapage ? `<td${sm}>${formatGrade(l.rattrapage)}</td>` : ''}
          <td class="table-amount">${formatGrade(l.average)}</td>
          <td${md}>${formatGrade(l.classAverage)}</td>
          <td>${status(l)}</td>
        </tr>`).join('');
    return `
      <div class="table-responsive">
        <table class="table-custom is-compact">
          <thead>
            <tr><th>Matière</th><th${md} title="Coefficient">Coef.</th><th${sm} title="Contrôle continu">CC</th><th${sm}>Examen</th>${showRattrapage ? `<th${sm}>Rattrapage</th>` : ''}<th>Moyenne</th><th${md} title="Moyenne de la classe">Classe</th><th>Statut</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
}
