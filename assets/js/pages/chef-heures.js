/*
 * Chef : suivi des heures des enseignants (analyse, module 3).
 * Par enseignant : heures réalisées, programmées (réalisées + absences), absences ; et, sur le semestre complet,
 * volume dû, heures supplémentaires et manquantes (objet hoursSummary). Le sélecteur de période filtre les heures
 * réalisées / programmées ; les heures dues et supplémentaires restent celles du semestre.
 */

import { config, url } from '../config.js';
import { initPage } from '../layout.js';
import { mountExportMenu } from '../components/export-menu.js';
import { StatsService } from '../services/index.js';
import { trend } from '../utils/calculs.js';
import { CHART_COLORS, cardSparkline, groupedBars } from '../utils/charts.js';
import { exportInfo } from '../utils/exporter.js';
import { esc, formatDate, formatNumber, fullName, todayISO } from '../utils/format.js';
import { initPeriodPicker } from '../utils/period.js';
import { bindSort, sortRows, sortableTh } from '../utils/table.js';
import { applyDynamicWidths, describeTrend, emptyState, errorState, sinceWeeks, statCard, trendCard, userCell } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const h = (value) => `${formatNumber(value, Number.isInteger(value) ? 0 : 1)} h`;

const ctx = await initPage({ role: 'chef', page: 'hours' });

if (ctx) {
    const state = { sort: { key: 'name', dir: 'asc' } };
    let range = { from: config.SEMESTER_START, to: todayISO() };
    let overview = null;
    let charts = [];
    let run = 0;

    const getters = {
        name: (r) => `${r.teacher.lastName} ${r.teacher.firstName}`,
        done: (r) => r.done,
        scheduled: (r) => r.scheduled,
        rate: (r) => r.rate,
        absences: (r) => r.absences,
        contract: (r) => r.contract,
        overtime: (r) => r.overtime,
    };

    function renderTable() {
        $('table-head').innerHTML = `<tr>
          ${sortableTh('Enseignant', 'name', state.sort)}
          ${sortableTh('Réalisées', 'done', state.sort)}
          ${sortableTh('Réalisation', 'rate', state.sort)}
          ${sortableTh('Absences', 'absences', state.sort, { className: 'd-none d-md-table-cell' })}
          ${sortableTh('Dues', 'contract', state.sort, { className: 'd-none d-xl-table-cell' })}
          ${sortableTh('Heures sup.', 'overtime', state.sort)}
          <th class="text-center">Fiche</th></tr>`;
        const rows = sortRows(overview.rows, getters[state.sort.key], state.sort.dir);
        $('table-body').innerHTML = rows.length ? rows.map((r) => {
            const tone = r.rate === null ? '' : r.rate < 90 ? 'bg-brand-orange' : 'bg-lime-accent';
            return `
            <tr>
              <td>${userCell(r.teacher, r.teacher.grade)}</td>
              <td class="table-amount">${esc(h(r.done))}<div class="table-user-sub">sur ${esc(h(r.scheduled))} programmées</div></td>
              <td class="cell-progress">${r.rate === null ? '—' : `<div class="progress-label-row mb-1"><span class="progress-label">${esc(formatNumber(r.rate, 1))} %</span></div><div class="progress" role="progressbar" aria-label="Taux de réalisation" aria-valuenow="${Math.round(r.rate)}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar ${tone}" data-pct="${Math.round(r.rate)}"></div></div>`}</td>
              <td class="d-none d-md-table-cell">${r.absences ? `<span class="badge-table failed">${formatNumber(r.absences)}</span><div class="table-user-sub">${esc(h(r.absentHours))}</div>` : '<span class="text-muted-green">0</span>'}</td>
              <td class="d-none d-xl-table-cell">${esc(h(r.contract))}<div class="table-user-sub">semestre : ${esc(h(r.semesterDone))}</div></td>
              <td>${r.overtime ? `<span class="badge-table pending">+${esc(h(r.overtime))}</span>` : r.missing ? `<span class="badge-table neutral">−${esc(h(r.missing))}</span>` : '<span class="badge-table success">Complet</span>'}</td>
              <td class="text-center"><a href="${esc(url('pages/chef/enseignant.html'))}?id=${esc(r.teacher.id)}" class="table-btn-action" title="Voir la fiche" aria-label="Voir la fiche de ${esc(fullName(r.teacher))}"><i class="bi bi-eye"></i></a></td>
            </tr>`;
        }).join('') : `<tr><td colspan="7">${emptyState('Aucune donnée.', 'bi-clock-history')}</td></tr>`;
        applyDynamicWidths($('table-body'));
    }

    async function load() {
        const mine = ++run;
        charts.forEach((c) => c?.destroy());
        charts = [];
        const [data, weekly] = await Promise.all([StatsService.hoursOverview(range), StatsService.teachingWeekly(range)]);
        if (mine !== run) return;
        overview = data;
        const { totals } = data;
        $('page-subtitle').textContent = `${formatDate(range.from)} - ${formatDate(range.to)} · ${formatNumber(data.rows.length)} enseignants`;

        const hours = trend(weekly.map((w) => w.hours));
        const hoursCard = {
            id: 'hours', label: 'Heures réalisées', icon: 'bi-clock-history', col: 'h-100', value: h(totals.done),
            trend: describeTrend({ direction: hours.direction, value: hours.change, since: sinceWeeks(hours.window) }),
            series: weekly.map((w) => w.hours), format: (v) => h(v),
        };
        $('kpis').innerHTML = `<div class="col-sm-6 col-xl-3">${trendCard(hoursCard)}</div>` +
            statCard({ label: 'Programmées', value: h(totals.scheduled), icon: 'bi-calendar-week', hint: totals.rate === null ? 'Aucune séance' : `${formatNumber(totals.rate, 1)} % réalisées`, col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'Absences', value: formatNumber(totals.absences), icon: 'bi-person-x', hint: `${h(totals.absentHours)} non assurées`, col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'Heures sup. (semestre)', value: h(totals.overtime), icon: 'bi-plus-circle', hint: `${h(totals.missing)} manquantes`, col: 'col-sm-6 col-xl-3' });
        charts.push(cardSparkline(hoursCard));

        const chartHost = $('hours-chart');
        const withSessions = data.rows.filter((r) => r.sessions > 0);
        if (!withSessions.length) {
            chartHost.innerHTML = emptyState('Aucune séance sur cette période.', 'bi-calendar-x');
        } else {
            chartHost.innerHTML = '';
            charts.push(groupedBars(chartHost, {
                categories: withSessions.map((r) => `${r.teacher.firstName[0]}. ${r.teacher.lastName}`),
                series: [{ name: 'Réalisées', data: withSessions.map((r) => r.done) }, { name: 'Absences', data: withSessions.map((r) => r.absentHours) }],
                colors: [CHART_COLORS.forest, CHART_COLORS.orange],
                format: (v) => h(v), height: 280,
            }));
        }
        renderTable();
    }

    bindSort($('table-head'), () => state.sort, (sort) => { state.sort = sort; renderTable(); });

    mountExportMenu($('export-menu'), {
        getSpec() {
            if (!overview?.rows.length) return null;
            const rows = sortRows(overview.rows, getters[state.sort.key], state.sort.dir);
            return {
                filename: 'heures-enseignants',
                sheets: [{
                    name: 'Heures',
                    title: 'Heures des enseignants',
                    subtitle: exportInfo({
                        summary: `${formatNumber(rows.length)} enseignants · période du ${formatDate(range.from)} au ${formatDate(range.to)}`,
                        filters: [],
                    }).concat('Heures dues et supplémentaires : calculées sur le semestre complet, quelle que soit la période.'),
                    columns: [
                        { header: 'Nom', width: 20 }, { header: 'Prénom', width: 18 }, { header: 'Grade', width: 24 },
                        { header: 'Heures réalisées (période)', type: 'decimal1', width: 16 }, { header: 'Heures programmées (période)', type: 'decimal1', width: 16 },
                        { header: 'Taux de réalisation', type: 'percent', width: 14 }, { header: 'Séances', type: 'integer', width: 10 }, { header: 'Absences', type: 'integer', width: 10 },
                        { header: 'Heures d\'absence', type: 'decimal1', width: 12 }, { header: 'Heures dues (semestre)', type: 'integer', width: 14 },
                        { header: 'Heures réalisées (semestre)', type: 'decimal1', width: 16 }, { header: 'Heures supplémentaires', type: 'decimal1', width: 15 }, { header: 'Heures manquantes', type: 'decimal1', width: 14 },
                    ],
                    rows: rows.map((r) => [r.teacher.lastName, r.teacher.firstName, r.teacher.grade, r.done, r.scheduled, r.rate, r.sessions, r.absences, r.absentHours, r.contract, r.semesterDone, r.overtime, r.missing]),
                }],
            };
        },
    });

    initPeriodPicker({
        start: range.from, end: range.to, min: config.SEMESTER_START, max: todayISO(),
        onChange: (next) => { range = next; load().catch(console.error); },
    });

    try {
        await load();
    } catch (error) {
        console.error(error);
        $('kpis').innerHTML = errorState();
    }
}

