/*
 * Tableau de bord du chef de département (analyse §5) :
 *  - Étudiants : total, notes disponibles, bulletins générés (+ progression de la moyenne CC -> examen)
 *  - Enseignants : heures réalisées, absences, présences, avec progression/régression sur la période choisie
 *  - Calendrier : prochaines échéances (contrôles, stages, sessions d'examen)
 *  - Analyse : moyennes par classe, absences récentes, avancement des heures, résultats, bulletins à générer
 *
 * Le sélecteur de période de l'en-tête filtre les indicateurs liés aux séances (heures, absences, présences).
 */

import { config, url } from '../config.js';
import { initPage } from '../layout.js';
import { compare, trend } from '../utils/calculs.js';
import { CHART_COLORS, donut, groupedBars, sparkline } from '../utils/charts.js';
import { formatDate, formatDateRange, formatHours, formatNumber, fullName, todayISO } from '../utils/format.js';
import { initPeriodPicker } from '../utils/period.js';
import {
    activityList, alertCard, chartLegend, describeTrend, emptyState, eventList, eventType, eventUrl, progressList, promoCard,
    renderInto, sinceWeeks, statCard, trendCard,
} from '../utils/ui.js';
import {
    BulletinService, EventService, GradeService, SessionService, StatsService, StudentService,
} from '../services/index.js';

const $ = (id) => document.getElementById(id);
const COL4 = 'col-sm-6 col-xl-3';
const CALENDAR = url('pages/chef/calendrier.html');

const ctx = await initPage({ role: 'chef', page: 'dashboard' });

if (ctx) {
    $('page-subtitle').textContent = `Vue d'ensemble du département · semestre ${config.CURRENT_SEMESTER} ${config.ACADEMIC_YEAR}`;

    // --- Étudiants (indépendant de la période) ----------------------------------------------------
    // Les 3 indicateurs de l'analyse + une carte de tendance : l'examen progresse-t-il par rapport au contrôle continu ?
    renderInto(
        $('kpi-students'),
        () => Promise.all([StudentService.count(), GradeService.countByStatus(), BulletinService.count(), StatsService.gradeProgress()]),
        ([students, grades, bulletins, progress]) => {
            const gap = compare(progress.cc, progress.exam);
            return statCard({ label: 'Total des étudiants', value: formatNumber(students), icon: 'bi-people-fill', hint: 'Toutes filières et tous niveaux', col: COL4 }) +
                statCard({ label: 'Notes disponibles', value: formatNumber(grades.validee), icon: 'bi-pencil-square', hint: `${formatNumber(grades.brouillon)} en attente de validation`, col: COL4 }) +
                statCard({ label: 'Bulletins générés', value: formatNumber(bulletins), icon: 'bi-file-earmark-text', hint: `sur ${formatNumber(students)} étudiants`, col: COL4 }) +
                trendCard({
                    id: 'grades', label: "Moyenne à l'examen", icon: 'bi-graph-up-arrow', col: COL4,
                    value: `${formatNumber(progress.exam, 2)} / 20`,
                    trend: describeTrend({ direction: gap.direction, value: gap.delta, unit: 'pt', since: 'vs contrôle continu' }),
                });
        },
    ).then((data) => {
        if (!data) return;
        const progress = data[3];
        sparkline('#spark-grades', {
            name: 'Moyenne', data: [progress.cc, progress.exam],
            tone: compare(progress.cc, progress.exam).direction === 'down' ? 'bad' : 'good',
            format: (v) => `${formatNumber(v, 2)} / 20`,
        });
    }).catch(console.error);

    // --- Enseignants (dépend de la période) -------------------------------------------------------
    let range = { from: config.SEMESTER_START, to: todayISO() };
    let run = 0; // numéro du dernier rafraîchissement : les réponses plus anciennes sont ignorées
    let periodCharts = [];

    function loadTeaching() {
        const mine = ++run;
        const isCurrent = () => mine === run;
        periodCharts.forEach((chart) => chart.destroy());
        periodCharts = [];

        // Vert = évolution favorable (plus d'heures, moins d'absences, meilleur taux), rouge = défavorable.
        renderInto(
            $('kpi-teachers'),
            async () => {
                const [weekly, stats] = await Promise.all([StatsService.teachingWeekly(range), SessionService.stats(range)]);
                const hours = trend(weekly.map((w) => w.hours));
                const absences = trend(weekly.map((w) => w.absences));
                const rate = trend(weekly.map((w) => w.rate), { mode: 'avg' });
                const since = sinceWeeks(hours.window);
                return [
                    {
                        id: 'hours', label: 'Heures réalisées', icon: 'bi-clock-history', value: `${formatNumber(stats.hours)} h`,
                        hint: `sur ${formatNumber(stats.scheduledHours)} h programmées`,
                        trend: describeTrend({ direction: hours.direction, value: hours.change, since }),
                        series: weekly.map((w) => w.hours), format: (v) => `${formatNumber(v, 1)} h`,
                    },
                    {
                        id: 'absences', label: 'Absences', icon: 'bi-person-x', value: formatNumber(stats.absent),
                        hint: `sur ${formatNumber(stats.total)} séances`,
                        trend: describeTrend({ direction: absences.direction, value: absences.change, goodWhen: 'down', since }),
                        series: weekly.map((w) => w.absences), format: (v) => `${formatNumber(v)} absence(s)`,
                    },
                    {
                        id: 'presence', label: 'Présences', icon: 'bi-person-check', value: formatNumber(stats.present),
                        hint: `Taux de présence : ${formatNumber(stats.rate, 1)} %`,
                        trend: describeTrend({ direction: rate.direction, value: rate.delta, unit: 'pt de taux', since }),
                        series: weekly.map((w) => w.rate), format: (v) => `${formatNumber(v, 1)} %`,
                    },
                ];
            },
            (cards) => cards.map(trendCard).join(''),
            isCurrent,
        ).then((cards) => {
            cards?.forEach((c) => periodCharts.push(sparkline(`#spark-${c.id}`, {
                name: c.label, data: c.series, format: c.format, tone: c.trend.good ? 'good' : 'bad',
            })));
        }).catch(console.error);

        renderInto(
            $('recent-absences'),
            () => StatsService.recentAbsences(5, range),
            (absences) => activityList(
                absences.map((a) => ({
                    icon: 'bi-person-x',
                    title: fullName(a.teacher),
                    subtitle: `${a.subject.name} · ${formatDate(a.date)} · ${a.startTime}`,
                    amount: `−${formatHours(a.hours)}`,
                    amountClass: 'text-danger',
                })),
                'Aucune absence sur cette période.',
            ),
            isCurrent,
        );

        renderInto(
            $('hours-progress'),
            () => StatsService.hoursProgress(6, range),
            (rows) => progressList(rows.map((r) => ({
                label: fullName(r.teacher),
                value: `${formatNumber(r.done)} / ${formatNumber(r.planned)} h`,
                percent: r.percent,
                tone: r.percent < 90 ? 'warn' : 'ok',
            })), 'Aucune séance sur cette période.'),
            isCurrent,
        );
    }

    initPeriodPicker({
        start: range.from, end: range.to, min: config.SEMESTER_START, max: todayISO(),
        onChange: (next) => { range = next; loadTeaching(); },
    });
    loadTeaching();

    // --- Calendrier ---------------------------------------------------------------------------------
    EventService.upcoming({ types: ['cc', 'stage', 'session_normale', 'rattrapage'], limit: 6 }).then((events) => {
        const [next, ...others] = events;
        $('next-event').innerHTML = next
            ? alertCard({
                badge: eventType(next.type).label,
                date: formatDateRange(next.start, next.end),
                text: next.title,
                link: { label: 'Voir le calendrier', href: eventUrl(CALENDAR, next.id) },
            })
            : `<div class="card h-100">${emptyState('Aucune échéance à venir.', 'bi-calendar-x')}</div>`;
        $('upcoming-events').innerHTML = eventList(others, { calendarUrl: CALENDAR });
    }).catch((error) => {
        console.error(error);
        $('upcoming-events').innerHTML = emptyState('Impossible de charger le calendrier.', 'bi-exclamation-triangle');
    });

    // --- Analyse (indépendante de la période) ---------------------------------------------------------
    renderInto($('class-chart'), () => StatsService.classAverages(), () => '').then((classes) => {
        if (!classes) return;
        groupedBars('#class-chart', {
            categories: classes.map((c) => c.label),
            series: [{ name: 'Contrôle continu', data: classes.map((c) => c.cc) }, { name: 'Examen', data: classes.map((c) => c.exam) }],
            colors: [CHART_COLORS.forest, CHART_COLORS.lime],
            max: 20,
            format: (v) => `${formatNumber(v, 2)} / 20`,
        });
    });

    // Résultats du semestre + bulletins à générer
    renderInto(
        $('results-legend'),
        () => StatsService.departmentResults(),
        ({ counts }) => chartLegend([
            { label: 'Admis', dot: 'bg-lime-accent', count: formatNumber(counts.Admis) },
            { label: 'Rattrapage', dot: 'bg-brand-orange', count: formatNumber(counts.Rattrapage) },
            { label: 'Ajourné', dot: 'bg-sys-red', count: formatNumber(counts.Ajourné) },
            { label: 'Incomplet', dot: 'bg-muted-green', count: formatNumber(counts.Incomplet) },
        ], { wrap: true }),
    ).then((data) => {
        if (!data) return;
        const { counts, pendingBulletins } = data;
        donut('#results-donut', {
            labels: ['Admis', 'Rattrapage', 'Ajourné', 'Incomplet'],
            series: [counts.Admis, counts.Rattrapage, counts.Ajourné, counts.Incomplet],
            colors: [CHART_COLORS.lime, CHART_COLORS.orange, CHART_COLORS.red, CHART_COLORS.muted],
            totalLabel: 'Étudiants',
        });
        $('bulletin-promo').innerHTML = promoCard(pendingBulletins
            ? {
                title: `${formatNumber(pendingBulletins)} bulletin${pendingBulletins > 1 ? 's' : ''} ${pendingBulletins > 1 ? 'prêts' : 'prêt'} à être ${pendingBulletins > 1 ? 'générés' : 'généré'}.`,
                desc: pendingBulletins > 1 ? 'Les notes de ces étudiants sont complètes et validées.' : 'Les notes de cet étudiant sont complètes et validées.',
                button: { label: 'Générer les bulletins', href: url('pages/chef/bulletins.html') },
            }
            : { title: 'Tous les bulletins disponibles sont générés.', desc: 'Les autres étudiants ont encore des notes à valider ou à saisir.' });
    }).catch(console.error);
}
