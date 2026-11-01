/*
 * Étudiant : ses notes validées, par matière (avec moyenne de la classe) et sous forme d'historique daté.
 * Les brouillons des enseignants ne sont jamais exposés : le relevé ne contient que des notes validées.
 */

import { config } from '../config.js';
import { initPage } from '../layout.js';
import { averageCard, subjectsCard } from '../components/student-kpis.js';
import { GRADE_TYPES, GradeService, StatsService } from '../services/index.js';
import { cardSparkline } from '../utils/charts.js';
import { esc, formatDate, formatGrade, formatNumber, fullName } from '../utils/format.js';
import { emptyState, errorState, renderInto, statCard, subjectTable, trendCard } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const ctx = await initPage({ role: 'etudiant', page: 'grades' });

if (ctx) {
    const studentId = ctx.user.profileId;
    try {
        const [overview, history] = await Promise.all([StatsService.studentOverview(studentId), GradeService.studentHistory(studentId)]);
        $('page-subtitle').textContent = `${overview.className} · semestre ${config.CURRENT_SEMESTER} ${config.ACADEMIC_YEAR}`;

        const average = averageCard(overview);
        const subjects = subjectsCard(overview);
        await renderInto($('kpis'), async () => [average, subjects], () =>
            `<div class="col-md-4">${trendCard(average)}</div><div class="col-md-4">${trendCard(subjects)}</div>` +
            statCard({ label: 'Notes publiées', value: formatNumber(history.length), icon: 'bi-journal-check', hint: history.length ? `Dernière : ${formatDate(history[0].validatedAt)}` : 'Aucune note validée pour le moment', col: 'col-md-4' }));
        cardSparkline(average);
        cardSparkline(subjects);

        $('subject-table').innerHTML = overview.report.lines.length ? subjectTable(overview.report.lines) : emptyState('Aucune matière pour ce semestre.', 'bi-book');

        $('history').innerHTML = history.length ? `
          <div class="table-responsive">
            <table class="table-custom">
              <thead><tr><th>Matière</th><th>Évaluation</th><th>Note</th><th>Publiée le</th><th>Enseignant</th></tr></thead>
              <tbody>${history.map((g) => `
                <tr>
                  <td><div class="table-product-name">${esc(g.subject.name)}</div><div class="table-user-sub">${esc(g.subject.code)}</div></td>
                  <td>${esc(GRADE_TYPES[g.type])}</td>
                  <td class="table-amount">${formatGrade(g.value)} / 20</td>
                  <td>${esc(formatDate(g.validatedAt))}</td>
                  <td>${g.teacher ? esc(fullName(g.teacher)) : '—'}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>` : emptyState("Vos notes apparaîtront ici dès que vos enseignants les auront validées.", 'bi-hourglass-split');
    } catch (error) {
        console.error(error);
        $('kpis').innerHTML = errorState();
    }
}
