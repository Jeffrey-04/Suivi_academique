/*
 * Cartes d'indicateurs d'un étudiant, affichées sur sa fiche (vue du chef).
 * `overview` = résultat de StatsService.studentOverview().
 * Chaque fonction retourne un objet « carte » : trendCard(card) pour le HTML, cardSparkline(card) pour la courbe.
 */

import { compare } from '../utils/calculs.js';
import { formatGrade, formatNumber } from '../utils/format.js';
import { describeTrend } from '../utils/ui.js';

const PASS = 10;

/** Moyenne générale + progression du contrôle continu à l'examen. */
export function averageCard({ report, cc, exam }) {
    const gap = compare(cc, exam);
    return {
        id: 'average', label: 'Moyenne générale', icon: 'bi-graph-up-arrow', col: 'h-100',
        value: report.average === null ? '—' : `${formatGrade(report.average)} / 20`,
        hint: report.average === null ? 'Calcul impossible : des notes manquent' : [report.result, report.mention].filter(Boolean).join(' · '),
        trend: describeTrend({ direction: gap.direction, value: gap.delta, unit: 'pt', since: 'examen vs contrôle continu' }),
        series: [cc, exam].filter((v) => v !== null),
        format: (v) => `${formatGrade(v)} / 20`,
    };
}

/** Nombre de matières à la moyenne (régression si au moins une est sous 10). */
export function subjectsCard({ report }) {
    const graded = report.lines.filter((l) => l.average !== null);
    const below = graded.filter((l) => l.average < PASS).length;
    return {
        id: 'subjects', label: 'Matières à la moyenne', icon: 'bi-check2-circle', col: 'h-100',
        value: `${formatNumber(graded.length - below)} / ${formatNumber(graded.length)}`,
        hint: `Sur ${formatNumber(report.lines.length)} matières du semestre`,
        trend: below
            ? { direction: 'down', good: false, text: `${below} matière${below > 1 ? 's' : ''} sous la moyenne` }
            : { direction: 'up', good: true, text: graded.length ? 'Toutes les matières ≥ 10' : 'Pas encore de note validée' },
        series: graded.map((l) => l.average),
        format: (v) => `${formatGrade(v)} / 20`,
    };
}
