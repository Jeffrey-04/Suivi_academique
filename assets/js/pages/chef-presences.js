/*
 * Chef : séances, présences et absences des enseignants (analyse, module 4).
 * Journal des séances du semestre : date, horaire, enseignant, matière, durée, statut présent / absent.
 * Le chef déclare les séances effectuées, enregistre les absences et peut corriger ou retirer toute séance
 * (les séances prévues par l'emploi du temps se confirment depuis la page « Emploi du temps »).
 * Le sélecteur de période filtre le journal.
 */

import { config } from '../config.js';
import { initPage } from '../layout.js';
import { mountExportMenu } from '../components/export-menu.js';
import { confirmDeleteSession, openSessionForm } from '../components/session-form.js';
import { SESSION_STATUS, SessionService, StatsService, TeacherService } from '../services/index.js';
import { trend } from '../utils/calculs.js';
import { cardSparkline } from '../utils/charts.js';
import { describeFilters, exportInfo } from '../utils/exporter.js';
import { esc, formatDate, formatHours, formatNumber, fullName, todayISO, weekdayShort } from '../utils/format.js';
import { initPeriodPicker } from '../utils/period.js';
import { bindSort, paginate, paginationFooter, sortRows, sortableTh } from '../utils/table.js';
import { describeTrend, emptyState, errorState, renderInto, sinceWeeks, statCard, trendCard, userCell } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 10;
const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ctx = await initPage({ role: 'chef', page: 'attendance' });

if (ctx) {
    const actor = { id: ctx.user.id, role: ctx.user.role };
    const state = { q: '', teacher: '', status: '', sort: { key: 'date', dir: 'desc' }, page: 1, highlight: null };
    let range = { from: config.SEMESTER_START, to: todayISO() };
    let rows = [];
    let kpiChart = null;
    let run = 0;

    const getters = {
        date: (r) => `${r.date} ${r.startTime}`,
        teacher: (r) => `${r.teacher.lastName} ${r.teacher.firstName}`,
        subject: (r) => r.subject.name,
        hours: (r) => r.hours,
        status: (r) => r.status,
    };

    const visibleRows = () => {
        const needle = normalize(state.q.trim());
        return sortRows(rows.filter((r) =>
            (!state.teacher || r.teacherId === state.teacher) &&
            (!state.status || r.status === state.status) &&
            (!needle || normalize(`${fullName(r.teacher)} ${r.subject.name} ${r.subject.code} ${r.note ?? ''}`).includes(needle))), getters[state.sort.key], state.sort.dir);
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
          ${sortableTh('Enseignant', 'teacher', state.sort)}
          ${sortableTh('Matière', 'subject', state.sort, { className: 'd-none d-lg-table-cell' })}
          ${sortableTh('Durée', 'hours', state.sort)}
          ${sortableTh('Statut', 'status', state.sort)}
          <th class="text-center">Actions</th></tr>`;

        $('table-body').innerHTML = page.items.length ? page.items.map((r) => {
            const absent = r.status === 'absent';
            return `
            <tr data-id="${esc(r.id)}"${r.id === state.highlight ? ' class="row-flash"' : ''}>
              <td><div class="table-product-name">${esc(weekdayShort(r.date))} ${esc(formatDate(r.date))}</div><div class="table-user-sub">${esc(r.startTime)} - ${esc(r.endTime)}</div></td>
              <td>${userCell(r.teacher, r.teacher.grade)}</td>
              <td class="d-none d-lg-table-cell"><div class="table-product-name">${esc(r.subject.name)}</div><div class="table-user-sub">${esc(r.subject.code)} · ${esc(r.cls?.short ?? '')}</div></td>
              <td class="table-amount">${esc(formatHours(r.hours))}</td>
              <td><span class="badge-table ${absent ? 'failed' : 'success'}">${esc(SESSION_STATUS[r.status])}</span><div class="table-user-sub">${esc(absent ? (r.note ?? 'Raison non communiquée') : (r.note ?? ''))}</div></td>
              <td>
                <div class="d-flex justify-content-center gap-1">
                  <button type="button" class="table-btn-action" data-action="edit" title="Corriger" aria-label="Corriger la séance du ${esc(formatDate(r.date))} de ${esc(fullName(r.teacher))}"><i class="bi bi-pencil"></i></button>
                  <button type="button" class="table-btn-action delete" data-action="delete" title="Retirer" aria-label="Retirer la séance du ${esc(formatDate(r.date))} de ${esc(fullName(r.teacher))}"><i class="bi bi-trash"></i></button>
                </div>
              </td>
            </tr>`;
        }).join('') : `<tr><td colspan="6">${emptyState('Aucune séance ne correspond à votre recherche.', 'bi-calendar-x')}
            <div class="text-center pb-3"><button type="button" class="btn-table-action" data-action="reset-filters">Réinitialiser les filtres</button></div></td></tr>`;

        $('table-footer').innerHTML = paginationFooter(page, 'séances');
        state.highlight = null;
    }

    async function loadKpis(mine) {
        kpiChart?.destroy();
        kpiChart = null;
        const isCurrent = () => mine === run;
        const card = await renderInto($('kpis'), async () => {
            const [stats, weekly] = await Promise.all([SessionService.stats(range), StatsService.teachingWeekly(range)]);
            const rate = trend(weekly.map((w) => w.rate), { mode: 'avg' });
            return {
                stats,
                card: {
                    id: 'rate', label: 'Taux de présence', icon: 'bi-person-check', col: 'h-100', value: stats.rate === null ? '—' : `${formatNumber(stats.rate, 1)} %`,
                    trend: describeTrend({ direction: rate.direction, value: rate.delta, unit: 'pt', since: sinceWeeks(rate.window) }),
                    series: weekly.map((w) => w.rate), format: (v) => `${formatNumber(v, 1)} %`,
                },
            };
        }, ({ stats, card: c }) =>
            statCard({ label: 'Séances', value: formatNumber(stats.total), icon: 'bi-calendar-week', hint: `${formatNumber(stats.scheduledHours)} h programmées`, col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'Présences', value: formatNumber(stats.present), icon: 'bi-person-check', hint: `${formatNumber(stats.hours)} h réalisées`, col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'Absences', value: formatNumber(stats.absent), icon: 'bi-person-x', hint: `${formatNumber(stats.scheduledHours - stats.hours)} h non assurées`, col: 'col-sm-6 col-xl-3' }) +
            `<div class="col-sm-6 col-xl-3">${trendCard(c)}</div>`, isCurrent);
        if (card) kpiChart = cardSparkline(card.card);
    }

    async function load() {
        const mine = ++run;
        const [sessions] = await Promise.all([SessionService.detailed(range), loadKpis(mine)]);
        if (mine !== run) return;
        rows = sessions;
        render();
    }

    // --- Interactions -----------------------------------------------------------------------------
    let timer;
    $('search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; state.page = 1; render(); }, 120); });
    $('filter-teacher').addEventListener('change', (e) => { state.teacher = e.target.value; state.page = 1; render(); });
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
        if (button.dataset.action === 'reset-filters') {
            Object.assign(state, { q: '', teacher: '', status: '', page: 1 });
            ['search', 'filter-teacher', 'filter-status'].forEach((id) => { $(id).value = ''; });
            render();
            return;
        }
        const session = rows.find((r) => r.id === button.closest('tr').dataset.id);
        if (!session) return;
        if (button.dataset.action === 'edit') {
            const saved = await openSessionForm({ mode: 'edit', session, actor });
            if (saved) { state.highlight = saved.id; await load(); }
        } else if (await confirmDeleteSession(session, actor, `La séance de ${fullName(session.teacher)}`)) {
            await load();
        }
    });

    async function addSession(mode) {
        const saved = await openSessionForm({ mode, actor });
        if (!saved) return;
        // La séance doit être visible : on élargit la période si besoin et on lève les filtres
        range = { from: range.from < saved.date ? range.from : saved.date, to: range.to > saved.date ? range.to : saved.date };
        Object.assign(state, { q: '', teacher: '', status: '', sort: { key: 'date', dir: 'desc' }, highlight: saved.id });
        ['search', 'filter-teacher', 'filter-status'].forEach((id) => { $(id).value = ''; });
        await load();
    }
    $('btn-declare').addEventListener('click', () => addSession('declare'));
    $('btn-add').addEventListener('click', () => addSession('absence'));

    mountExportMenu($('export-menu'), {
        getSpec() {
            const data = visibleRows();
            if (!data.length) return null;
            return {
                filename: 'seances',
                sheets: [{
                    name: 'Séances',
                    title: 'Séances, présences et absences des enseignants',
                    subtitle: exportInfo({
                        summary: `${formatNumber(data.length)} séance${data.length > 1 ? 's' : ''} du ${formatDate(range.from)} au ${formatDate(range.to)}`,
                        filters: describeFilters([['Recherche', $('search')], ['Enseignant', $('filter-teacher')], ['Statut', $('filter-status')]]),
                    }),
                    columns: [
                        { header: 'Date', type: 'date', width: 13 }, { header: 'Début', width: 9, align: 'center' }, { header: 'Fin', width: 9, align: 'center' },
                        { header: 'Enseignant', width: 26 }, { header: 'Matière', width: 36 }, { header: 'Code', width: 11 }, { header: 'Classe', width: 12, align: 'center' },
                        { header: 'Durée (h)', type: 'decimal', width: 11 },
                        { header: 'Statut', width: 12, align: 'center', tone: (v) => (v === 'Présent' ? 'good' : 'bad') },
                        { header: 'Motif / observation', width: 36 },
                    ],
                    rows: data.map((r) => [
                        r.date, r.startTime, r.endTime, fullName(r.teacher), r.subject.name, r.subject.code, r.cls?.short ?? '', r.hours,
                        SESSION_STATUS[r.status], r.note ?? '',
                    ]),
                }],
            };
        },
    });

    initPeriodPicker({
        start: range.from, end: range.to, min: config.SEMESTER_START, max: todayISO(),
        onChange: (next) => { range = next; state.page = 1; load().catch(console.error); },
    });

    // --- Démarrage ---------------------------------------------------------------------------------
    try {
        const teachers = await TeacherService.list();
        $('filter-teacher').innerHTML = '<option value="">Tous les enseignants</option>' +
            [...teachers].sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr')).map((t) => `<option value="${esc(t.id)}">${esc(fullName(t))}</option>`).join('');
        await load();
        const wanted = new URLSearchParams(window.location.search).get('new'); // raccourcis de la barre du haut
        if (wanted === '1' || wanted === 'declare') {
            window.history.replaceState(null, '', window.location.pathname);
            addSession(wanted === 'declare' ? 'declare' : 'absence');
        }
    } catch (error) {
        console.error(error);
        $('table-body').innerHTML = `<tr><td colspan="6">${errorState()}</td></tr>`;
    }
}

