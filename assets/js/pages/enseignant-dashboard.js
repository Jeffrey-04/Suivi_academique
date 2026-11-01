/*
 * Tableau de bord de l'enseignant : ses heures (progression sur la période choisie), les moyennes de ses matières,
 * la validation de ses notes, ses dernières séances et les échéances.
 *
 * Le sélecteur de période de l'en-tête filtre les indicateurs liés aux séances (heures, dernières séances).
 */

import { config, url } from '../config.js';
import { initPage } from '../layout.js';
import { compare, trend } from '../utils/calculs.js';
import { CHART_COLORS, donut, groupedBars, sparkline } from '../utils/charts.js';
import { formatDate, formatDateRange, formatHours, formatNumber, todayISO } from '../utils/format.js';
import { initPeriodPicker } from '../utils/period.js';
import {
    activityList, alertCard, chartLegend, describeTrend, emptyState, eventList, eventType, eventUrl, progressList, promoCard,
    renderInto, sinceWeeks, trendCard,
} from '../utils/ui.js';
import { EventService, SessionService, StatsService } from '../services/index.js';

const $ = (id) => document.getElementById(id);
const CALENDAR = url('pages/enseignant/calendrier.html');

const ctx = await initPage({ role: 'enseignant', page: 'dashboard' });

if (ctx) {
    const teacherId = ctx.user.profileId;
    $('page-subtitle').textContent = `Bonjour ${ctx.user.firstName} · semestre ${config.CURRENT_SEMESTER} ${config.ACADEMIC_YEAR}`;

    // Un seul chargement partagé par tous les blocs « matières » (indépendants de la période)
    const overviewPromise = StatsService.teacherOverview(teacherId);

    // --- Heures et séances (dépendent de la période) ----------------------------------------------
    let range = { from: config.SEMESTER_START, to: todayISO() };
    let run = 0;
    let hoursChart = null;

    function loadTeaching() {
        const mine = ++run;
        const isCurrent = () => mine === run;
        hoursChart?.destroy();
        hoursChart = null;

        renderInto(
            $('card-hours'),
            async () => {
                const [weekly, stats] = await Promise.all([StatsService.teachingWeekly({ ...range, teacherId }), SessionService.stats({ ...range, teacherId })]);
                const hours = trend(weekly.map((w) => w.hours));
                return {
                    id: 'hours', label: 'Heures réalisées', icon: 'bi-clock-history', col: 'h-100',
                    value: `${formatNumber(stats.hours)} h`,
                    hint: `sur ${formatNumber(stats.scheduledHours)} h programmées · ${formatNumber(stats.absent)} absence(s)`,
                    trend: describeTrend({ direction: hours.direction, value: hours.change, since: sinceWeeks(hours.window) }),
                    series: weekly.map((w) => w.hours),
                };
            },
            (card) => trendCard(card),
            isCurrent,
        ).then((card) => {
            if (card) hoursChart = sparkline('#spark-hours', { name: card.label, data: card.series, tone: card.trend.good ? 'good' : 'bad', format: (v) => `${formatNumber(v, 1)} h` });
        }).catch(console.error);

        renderInto(
            $('recent-sessions'),
            () => StatsService.recentSessions(teacherId, 5, range),
            (sessions) => activityList(
                sessions.map((s) => ({
                    icon: s.status === 'present' ? 'bi-check-circle' : 'bi-person-x',
                    title: s.subject.name,
                    subtitle: `${formatDate(s.date)} · ${s.startTime}–${s.endTime}${s.status === 'absent' && s.note ? ` · ${s.note}` : ''}`,
                    amount: `${s.status === 'present' ? '+' : '−'}${formatHours(s.hours)}`,
                    amountClass: s.status === 'present' ? 'text-success' : 'text-danger',
                })),
                'Aucune séance sur cette période.',
            ),
            isCurrent,
        );
    }

    initPeriodPicker({
        start: range.from, end: range.to, min: config.SEMESTER_START, max: todayISO(),
        onChange: (next) => { range = next; loadTeaching(); },
    });
    loadTeaching();

    // --- Prochaine échéance + liste -----------------------------------------------------------------
    EventService.upcoming({ role: 'enseignant', limit: 6 }).then((events) => {
        const [next, ...others] = events;
        $('next-event').innerHTML = next
            ? alertCard({ badge: eventType(next.type).label, date: formatDateRange(next.start, next.end), text: next.title, link: { label: 'Voir le calendrier', href: eventUrl(CALENDAR, next.id) } })
            : `<div class="card h-100">${emptyState('Aucune échéance à venir.', 'bi-calendar-x')}</div>`;
        $('upcoming-events').innerHTML = eventList(others.length ? others : events, { calendarUrl: CALENDAR });
    }).catch((error) => {
        console.error(error);
        $('upcoming-events').innerHTML = emptyState('Impossible de charger le calendrier.', 'bi-exclamation-triangle');
    });

    // --- Matières (indépendantes de la période) -----------------------------------------------------
    renderInto(
        $('card-grades'),
        async () => {
            const overview = await overviewPromise;
            const gap = compare(overview.cc, overview.exam);
            return {
                id: 'grades', label: "Moyenne à l'examen", icon: 'bi-graph-up-arrow', col: 'h-100',
                value: overview.exam === null ? '—' : `${formatNumber(overview.exam, 2)} / 20`,
                hint: `Sur ${formatNumber(overview.rows.length)} matière(s), notes validées`,
                trend: describeTrend({ direction: gap.direction, value: gap.delta, unit: 'pt', since: 'vs contrôle continu' }),
                series: [overview.cc, overview.exam].filter((v) => v !== null),
            };
        },
        (card) => trendCard(card),
    ).then((card) => {
        if (card) sparkline('#spark-grades', { name: card.label, data: card.series, tone: card.trend.good ? 'good' : 'bad', format: (v) => `${formatNumber(v, 2)} / 20` });
    }).catch(console.error);

    renderInto($('subject-chart'), () => overviewPromise, () => '').then((overview) => {
        if (!overview) return;
        groupedBars('#subject-chart', {
            categories: overview.rows.map((r) => r.subject.code),
            series: [{ name: 'Contrôle continu', data: overview.rows.map((r) => r.cc) }, { name: 'Examen', data: overview.rows.map((r) => r.exam) }],
            colors: [CHART_COLORS.forest, CHART_COLORS.lime],
            max: 20,
            format: (v) => `${formatNumber(v, 2)} / 20`,
        });
    });

    renderInto(
        $('validation-progress'),
        () => overviewPromise,
        ({ rows }) => progressList(rows.map((r) => ({
            label: `${r.subject.name} (${r.className})`,
            value: `${formatNumber(r.validated)} / ${formatNumber(r.entered)}`,
            percent: r.entered ? (r.validated / r.entered) * 100 : 0,
            tone: r.validated < r.entered ? 'warn' : 'ok',
        }))),
    );

    // --- Répartition des notes d'examen + notes à valider -------------------------------------------
    renderInto(
        $('exam-legend'),
        () => overviewPromise,
        ({ examBands }) => (examBands.low + examBands.mid + examBands.high === 0 ? '' : chartLegend([
            { label: 'Moins de 10', dot: 'bg-brand-orange', count: formatNumber(examBands.low) },
            { label: '10 à 14', dot: 'bg-lime-accent', count: formatNumber(examBands.mid) },
            { label: '14 et plus', dot: 'bg-forest-medium', count: formatNumber(examBands.high) },
        ], { wrap: true })),
    ).then((overview) => {
        if (!overview) return;
        const { examBands, drafts } = overview;
        if (examBands.low + examBands.mid + examBands.high === 0) {
            $('exam-donut').innerHTML = emptyState("Aucune note d'examen validée pour le moment.", 'bi-journal');
        } else {
            donut('#exam-donut', {
                labels: ['Moins de 10', '10 à 14', '14 et plus'],
                series: [examBands.low, examBands.mid, examBands.high],
                colors: [CHART_COLORS.orange, CHART_COLORS.lime, CHART_COLORS.forest],
                totalLabel: 'Copies',
            });
        }
        $('validation-promo').innerHTML = promoCard(drafts
            ? {
                title: `${formatNumber(drafts)} note${drafts > 1 ? 's' : ''} à valider.`,
                desc: 'Saisies mais pas encore comptées dans les moyennes.',
                button: { label: 'Saisir et valider mes notes', href: url('pages/enseignant/saisie-notes.html') },
            }
            : { title: 'Toutes vos notes sont validées.', desc: 'Elles sont prises en compte dans les moyennes et les bulletins.' });
    }).catch(console.error);
}
