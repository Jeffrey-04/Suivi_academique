/*
 * Tableau de bord de l'étudiant : moyenne générale et progression CC -> examen, matières à la moyenne,
 * moyennes par matière comparées à la classe, détail des notes, état du bulletin.
 *
 * Le sélecteur de période de l'en-tête filtre la liste des échéances (par défaut : les 6 prochains mois).
 */

import { config, url } from '../config.js';
import { initPage } from '../layout.js';
import { averageCard, subjectsCard } from '../components/student-kpis.js';
import { CHART_COLORS, cardSparkline, groupedBars } from '../utils/charts.js';
import { addDays, formatDate, formatDateRange, formatGrade, formatNumber, todayISO } from '../utils/format.js';
import { initPeriodPicker } from '../utils/period.js';
import {
    alertCard, emptyState, eventList, eventType, eventUrl, progressList, promoCard, renderInto, subjectTable, trendCard,
} from '../utils/ui.js';
import { EventService, StatsService } from '../services/index.js';

const $ = (id) => document.getElementById(id);
const CALENDAR = url('pages/etudiant/calendrier.html');
const PASS = 10; // seuil de la barre « moyennes sur 20 »

const ctx = await initPage({ role: 'etudiant', page: 'dashboard' });

if (ctx) {
    const overviewPromise = StatsService.studentOverview(ctx.user.profileId);

    overviewPromise
        .then((overview) => {
            $('page-subtitle').textContent = `${overview.className} · semestre ${config.CURRENT_SEMESTER} ${config.ACADEMIC_YEAR}`;
        })
        .catch(console.error);

    // --- Moyenne générale (progression CC -> examen) et matières à la moyenne --------------------------
    renderInto($('card-average'), async () => averageCard(await overviewPromise), trendCard)
        .then((card) => { if (card) cardSparkline(card); }).catch(console.error);
    renderInto($('card-subjects'), async () => subjectsCard(await overviewPromise), trendCard)
        .then((card) => { if (card) cardSparkline(card); }).catch(console.error);

    // --- Détail des résultats -------------------------------------------------------------------------
    renderInto($('subject-chart'), () => overviewPromise, () => '').then((overview) => {
        if (!overview) return;
        const { lines } = overview.report;
        groupedBars('#subject-chart', {
            categories: lines.map((l) => l.code),
            series: [{ name: 'Moi', data: lines.map((l) => l.average) }, { name: 'Moyenne de la classe', data: lines.map((l) => l.classAverage) }],
            colors: [CHART_COLORS.forest, CHART_COLORS.lime],
            max: 20,
            format: (v) => `${formatNumber(v, 2)} / 20`,
        });
    });

    renderInto($('subject-table'), () => overviewPromise, ({ report }) => subjectTable(report.lines, { condensed: true }));

    renderInto(
        $('average-progress'),
        () => overviewPromise,
        ({ report }) => progressList(report.lines.map((l) => ({
            label: l.name,
            value: l.average === null ? '—' : formatGrade(l.average),
            percent: l.average === null ? 0 : (l.average / 20) * 100,
            tone: l.average !== null && l.average < PASS ? 'warn' : 'ok',
        }))),
    );

    overviewPromise.then(({ bulletin }) => {
        $('bulletin-promo').innerHTML = promoCard(bulletin
            ? { title: 'Votre bulletin est disponible.', desc: `Généré le ${formatDate(bulletin.generatedAt)}.`, button: { label: 'Voir et télécharger mon bulletin', href: url('pages/etudiant/bulletin.html') } }
            : { title: 'Bulletin en préparation.', desc: 'Il sera disponible une fois toutes vos notes validées.' });
    }).catch(console.error);

    // --- Échéances : prochaine échéance + liste filtrée par la période -------------------------------------
    EventService.upcoming({ role: 'etudiant', limit: 1 }).then(([next]) => {
        $('next-event').innerHTML = next
            ? alertCard({ badge: eventType(next.type).label, date: formatDateRange(next.start, next.end), text: next.title, link: { label: 'Voir le calendrier', href: eventUrl(CALENDAR, next.id) } })
            : `<div class="card h-100">${emptyState('Aucune échéance à venir.', 'bi-calendar-x')}</div>`;
    }).catch(console.error);

    let range = { from: todayISO(), to: addDays(todayISO(), 180) };
    let run = 0;
    function loadEvents() {
        const mine = ++run;
        renderInto(
            $('upcoming-events'),
            () => EventService.list({ role: 'etudiant', ...range }),
            (events) => (events.length ? eventList(events, { calendarUrl: CALENDAR }) : emptyState('Aucune échéance sur cette période.', 'bi-calendar-x')),
            () => mine === run,
        );
    }
    initPeriodPicker({
        start: range.from, end: range.to, min: config.SEMESTER_START, max: addDays(todayISO(), 365),
        onChange: (next) => { range = next; loadEvents(); },
    });
    loadEvents();
}
