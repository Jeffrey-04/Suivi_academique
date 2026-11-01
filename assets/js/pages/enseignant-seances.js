/*
 * Enseignant : historique de ses séances (effectuées et absences), heures réalisées, corrections.
 * Il peut corriger ou retirer ses propres déclarations pendant SESSION_EDIT_DAYS jours ; les absences enregistrées
 * par le chef et les séances plus anciennes sont en lecture seule (canModifySession).
 */

import { config } from '../config.js';
import { initPage } from '../layout.js';
import { mountExportMenu } from '../components/export-menu.js';
import { confirmDeleteSession, openSessionForm } from '../components/session-form.js';
import { SessionService, StatsService, canModifySession } from '../services/index.js';
import { trend } from '../utils/calculs.js';
import { cardSparkline } from '../utils/charts.js';
import { describeFilters, exportInfo } from '../utils/exporter.js';
import { esc, formatDate, formatHours, formatNumber, todayISO, weekdayShort } from '../utils/format.js';
import { initPeriodPicker } from '../utils/period.js';
import { bindSort, paginate, paginationFooter, sortRows, sortableTh } from '../utils/table.js';
import { describeTrend, emptyState, errorState, renderInto, sinceWeeks, statCard, trendCard } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 10;
const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ctx = await initPage({ role: 'enseignant', page: 'sessions' });

if (ctx) {
    const actor = { id: ctx.user.id, role: ctx.user.role, profileId: ctx.user.profileId };
    const state = { q: '', status: '', sort: { key: 'date', dir: 'desc' }, page: 1, highlight: null };
    let range = { from: config.SEMESTER_START, to: todayISO() };
    let rows = [];
    let chart = null;
    let run = 0;

    $('edit-hint').textContent = `Vous pouvez corriger ou retirer vos déclarations pendant ${config.SESSION_EDIT_DAYS} jours. Les absences sont enregistrées par le chef de département.`;

    const getters = {
        date: (r) => `${r.date} ${r.startTime}`,
        subject: (r) => r.subject.name,
        hours: (r) => r.hours,
        status: (r) => r.status,
    };

    const visibleRows = () => {
        const needle = normalize(state.q.trim());
        return sortRows(rows.filter((r) =>
            (!state.status || r.status === state.status) &&
            (!needle || normalize(`${r.subject.name} ${r.subject.code} ${r.note ?? ''}`).includes(needle))), getters[state.sort.key], state.sort.dir);
    };

    function render() {
        const all = visibleRows();
        if (state.highlight) {
            const index = all.findIndex((r) => r.id === state.highlight);
            if (index >= 0) state.page = Math.floor(index / PAGE_SIZE) + 1;
        }
        const page = paginate(all, state.page, PAGE_SIZE);
        state.page = page.page;
        $('page-subtitle').textContent = `${formatNumber(rows.length)} séance${rows.length > 1 ? 's' : ''} sur la période${all.length !== rows.length ? ` · ${formatNumber(all.length)} correspondent aux filtres` : ''}`;

        $('table-head').innerHTML = `<tr>
          ${sortableTh('Séance', 'date', state.sort)}
          ${sortableTh('Matière', 'subject', state.sort)}
          ${sortableTh('Durée', 'hours', state.sort)}
          ${sortableTh('Statut', 'status', state.sort)}
          <th class="text-center">Actions</th></tr>`;

        $('table-body').innerHTML = page.items.length ? page.items.map((r) => {
            const absent = r.status === 'absent';
            const editable = canModifySession(r, actor);
            const slot = (visible, html) => (visible ? html : '<span class="table-btn-action is-placeholder" aria-hidden="true"></span>');
            return `
            <tr data-id="${esc(r.id)}"${r.id === state.highlight ? ' class="row-flash"' : ''}>
              <td><div class="table-product-name">${esc(weekdayShort(r.date))} ${esc(formatDate(r.date))}</div><div class="table-user-sub">${esc(r.startTime)} - ${esc(r.endTime)}</div></td>
              <td><div class="table-product-name">${esc(r.subject.name)}</div><div class="table-user-sub">${esc(r.subject.code)} · ${esc(r.cls?.short ?? '')}</div></td>
              <td class="table-amount">${esc(formatHours(r.hours))}</td>
              <td><span class="badge-table ${absent ? 'failed' : 'success'}">${esc(absent ? 'Absence' : 'Effectuée')}</span>${r.verified ? ' <i class="bi bi-geo-alt-fill text-success" title="Présence géolocalisée" role="img" aria-label="Présence géolocalisée"></i>' : ''}${absent || r.note ? `<div class="table-user-sub">${esc(r.note ?? '')}</div>` : ''}</td>
              <td>
                <div class="d-flex justify-content-center gap-1">
                  ${slot(editable, `<button type="button" class="table-btn-action" data-action="edit" title="Corriger" aria-label="Corriger la séance du ${esc(formatDate(r.date))}"><i class="bi bi-pencil"></i></button>`)}
                  ${slot(editable, `<button type="button" class="table-btn-action delete" data-action="delete" title="Retirer" aria-label="Retirer la séance du ${esc(formatDate(r.date))}"><i class="bi bi-trash"></i></button>`)}
                </div>
              </td>
            </tr>`;
        }).join('') : `<tr><td colspan="5">${emptyState('Aucune séance sur cette période.', 'bi-calendar-x')}</td></tr>`;
        $('table-footer').innerHTML = paginationFooter(page, 'séances');
        state.highlight = null;
    }

    async function load() {
        const mine = ++run;
        chart?.destroy();
        chart = null;
        const params = { ...range, teacherId: actor.profileId };
        const [sessions, kpi] = await Promise.all([
            SessionService.detailed(params),
            renderInto($('kpis'), async () => {
                const [stats, weekly] = await Promise.all([SessionService.stats(params), StatsService.teachingWeekly(params)]);
                const hours = trend(weekly.map((w) => w.hours));
                return {
                    stats,
                    card: {
                        id: 'hours', label: 'Heures réalisées', icon: 'bi-clock-history', col: 'h-100', value: formatHours(stats.hours),
                        trend: describeTrend({ direction: hours.direction, value: hours.change, since: sinceWeeks(hours.window) }),
                        series: weekly.map((w) => w.hours), format: (v) => formatHours(v),
                    },
                };
            }, ({ stats, card }) =>
                statCard({ label: 'Séances effectuées', value: formatNumber(stats.present), icon: 'bi-check-circle', hint: `sur ${formatNumber(stats.total)} programmées`, col: 'col-sm-6 col-xl-4' }) +
                `<div class="col-sm-6 col-xl-4">${trendCard(card)}</div>` +
                statCard({ label: 'Absences', value: formatNumber(stats.absent), icon: 'bi-person-x', hint: stats.absent ? `${formatHours(stats.scheduledHours - stats.hours)} non assurées` : 'Aucune absence', col: 'col-sm-6 col-xl-4' }), () => mine === run),
        ]);
        if (mine !== run) return;
        if (kpi) chart = cardSparkline(kpi.card);
        rows = sessions;
        render();
    }

    let timer;
    $('search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; state.page = 1; render(); }, 120); });
    $('filter-status').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; render(); });
    bindSort($('table-head'), () => state.sort, (sort) => { state.sort = sort; state.page = 1; render(); });
    $('table-footer').addEventListener('click', (e) => {
        const link = e.target.closest('[data-page]');
        if (!link) return;
        e.preventDefault();
        state.page = Number(link.dataset.page);
        render();
    });
    $('table-body').addEventListener('click', async (e) => {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        const session = rows.find((r) => r.id === button.closest('tr').dataset.id);
        if (!session) return;
        if (button.dataset.action === 'edit') {
            const saved = await openSessionForm({ mode: 'edit', session, actor });
            if (saved) { state.highlight = saved.id; await load(); }
        } else if (await confirmDeleteSession(session, actor, `Votre séance de ${session.subject.name}`)) {
            await load();
        }
    });

    mountExportMenu($('export-menu'), {
        getSpec() {
            const data = visibleRows();
            if (!data.length) return null;
            return {
                filename: 'mes-seances',
                sheets: [{
                    name: 'Séances',
                    title: `Mes séances · ${ctx.user.firstName} ${ctx.user.lastName}`,
                    subtitle: exportInfo({
                        summary: `${formatNumber(data.length)} séance${data.length > 1 ? 's' : ''} du ${formatDate(range.from)} au ${formatDate(range.to)}`,
                        filters: describeFilters([['Recherche', $('search')], ['Statut', $('filter-status')]]),
                    }),
                    columns: [
                        { header: 'Date', type: 'date', width: 13 }, { header: 'Début', width: 9, align: 'center' }, { header: 'Fin', width: 9, align: 'center' },
                        { header: 'Matière', width: 38 }, { header: 'Code', width: 11 }, { header: 'Classe', width: 12, align: 'center' }, { header: 'Durée (h)', type: 'decimal', width: 11 },
                        { header: 'Statut', width: 13, align: 'center', tone: (v) => (v === 'Effectuée' ? 'good' : 'bad') }, { header: 'Motif / observation', width: 32 },
                    ],
                    rows: data.map((r) => [r.date, r.startTime, r.endTime, r.subject.name, r.subject.code, r.cls?.short ?? '', r.hours, r.status === 'absent' ? 'Absence' : 'Effectuée', r.note ?? '']),
                }],
            };
        },
    });

    initPeriodPicker({
        start: range.from, end: range.to, min: config.SEMESTER_START, max: todayISO(),
        onChange: (next) => { range = next; state.page = 1; load().catch(console.error); },
    });

    try {
        await load();
    } catch (error) {
        console.error(error);
        $('kpis').innerHTML = errorState();
    }
}

