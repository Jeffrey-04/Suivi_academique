/*
 * Utilitaires de tableau côté client : tri et pagination (balisage du template). L'export est dans exporter.js.
 * Avec le backend, tri / filtre / pagination passeront probablement côté serveur : seuls les appels changeront.
 */

import { esc, formatNumber } from './format.js';

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/** Tri stable ; les valeurs absentes (null/undefined/"") vont toujours en fin de liste. */
export function sortRows(rows, getValue, dir = 'asc') {
    const sign = dir === 'desc' ? -1 : 1;
    const empty = (v) => v === null || v === undefined || v === '';
    return [...rows].sort((a, b) => {
        const x = getValue(a);
        const y = getValue(b);
        if (empty(x) && empty(y)) return 0;
        if (empty(x)) return 1;
        if (empty(y)) return -1;
        return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y)));
    });
}

/** Cellule d'en-tête triable. sort : { key, dir }. */
export function sortableTh(label, key, sort, { className = '' } = {}) {
    const active = sort.key === key;
    const icon = !active ? 'bi-arrow-down-up' : sort.dir === 'asc' ? 'bi-sort-up' : 'bi-sort-down';
    const aria = !active ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending';
    return `<th class="is-sortable ${active ? 'is-sorted' : ''} ${className}" data-sort="${esc(key)}" aria-sort="${aria}" tabindex="0" role="columnheader">${esc(label)} <i class="bi ${icon}"></i></th>`;
}

/** Relie le tri (clic ou Entrée/Espace sur un en-tête) : retourne le nouvel état { key, dir } via onSort. */
export function bindSort(thead, getSort, onSort) {
    const toggle = (th) => {
        const key = th?.dataset.sort;
        if (!key) return;
        const current = getSort();
        onSort({ key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' });
    };
    thead.addEventListener('click', (e) => toggle(e.target.closest('[data-sort]')));
    thead.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e.target.closest('[data-sort]')); }
    });
}

export function paginate(items, page, size = 10) {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(Math.max(1, page), pages);
    const start = (current - 1) * size;
    return {
        items: items.slice(start, start + size),
        page: current, pages, total: items.length, size,
        from: items.length ? start + 1 : 0,
        to: Math.min(start + size, items.length),
    };
}

/** Numéros affichés : 1 … p-1 p p+1 … n */
function pageWindow(page, pages) {
    const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
    const result = [];
    [...keep].sort((a, b) => a - b).forEach((p, i, all) => {
        if (i && p - all[i - 1] > 1) result.push('…');
        result.push(p);
    });
    return result;
}

/** Pied de tableau (« Affichage de 1 à 10 sur 54 » + pagination). Les liens portent data-page. */
export function paginationFooter(p, noun = 'résultats') {
    const info = p.total
        ? `Affichage de ${formatNumber(p.from)} à ${formatNumber(p.to)} sur ${formatNumber(p.total)} ${noun}`
        : `Aucun ${noun.replace(/s$/, '')}`;
    const link = (target, content, { disabled = false, active = false, label } = {}) =>
        `<li class="page-item${active ? ' active' : ''}${disabled ? ' disabled' : ''}"><a class="page-link border-0" href="#" data-page="${target}"${label ? ` aria-label="${label}"` : ''}${active ? ' aria-current="page"' : ''}>${content}</a></li>`;
    const numbers = pageWindow(p.page, p.pages).map((n) =>
        (n === '…' ? '<li class="page-item disabled"><span class="page-link border-0">…</span></li>' : link(n, n, { active: n === p.page })));
    return `
      <div class="table-footer-control">
        <span class="table-pagination-info">${info}</span>
        ${p.pages > 1 ? `<nav aria-label="Pagination"><ul class="pagination mb-0 gap-1">
          ${link(p.page - 1, '<i class="bi bi-chevron-left"></i>', { disabled: p.page === 1, label: 'Page précédente' })}
          ${numbers.join('')}
          ${link(p.page + 1, '<i class="bi bi-chevron-right"></i>', { disabled: p.page === p.pages, label: 'Page suivante' })}
        </ul></nav>` : ''}
      </div>`;
}
