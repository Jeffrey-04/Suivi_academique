/*
 * Chef : consultation des notes d'une matière (lecture seule).
 * On choisit une classe puis une matière ; la feuille montre toutes les notes (brouillons compris, signalés),
 * les moyennes (notes validées seulement) et l'avancement de la validation par l'enseignant.
 */

import { url } from '../config.js';
import { initPage } from '../layout.js';
import { GradeService, ReferenceService, SubjectService } from '../services/index.js';
import { compare, mean } from '../utils/calculs.js';
import { cardSparkline } from '../utils/charts.js';
import { exportInfo } from '../utils/exporter.js';
import { mountExportMenu } from '../components/export-menu.js';
import { esc, formatGrade, formatNumber, fullName } from '../utils/format.js';
import { bindSort, sortRows, sortableTh } from '../utils/table.js';
import { describeTrend, emptyState, errorState, renderInto, statCard, trendCard, userCell } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const PASS = 10;

/** Une note : valeur, ou valeur en italique avec crayon si elle n'est pas encore validée. */
function gradeCell(grade) {
    if (!grade) return '<span class="text-muted-green">—</span>';
    if (grade.status === 'validee') return formatGrade(grade.value);
    return `<span class="grade-draft" title="Brouillon : pas encore validé par l'enseignant">${formatGrade(grade.value)} <i class="bi bi-pencil-square"></i></span>`;
}

function rowStatus(row) {
    const hasDraft = [row.cc, row.exam, row.rattrapage].some((g) => g?.status === 'brouillon');
    if (row.average === null) return hasDraft ? '<span class="badge-table pending">En attente de validation</span>' : '<span class="badge-table pending">Incomplet</span>';
    if (row.average >= PASS) return '<span class="badge-table success">Validée</span>';
    return row.eligibleRattrapage && !row.rattrapage ? '<span class="badge-table failed">À rattraper</span>' : '<span class="badge-table failed">Sous la moyenne</span>';
}

const ctx = await initPage({ role: 'chef', page: 'grades' });

if (ctx) {
    const state = { levelId: '', subjectId: '', status: '', sort: { key: 'name', dir: 'asc' } };
    let subjects = [];
    let classes = [];
    let sheet = null;
    let run = 0;
    let charts = [];

    const subjectsOf = (levelId) => subjects.filter((s) => s.levelId === levelId).sort((a, b) => a.code.localeCompare(b.code));

    function fillSelects() {
        $('select-class').innerHTML = classes.map((c) => `<option value="${esc(c.id)}"${c.id === state.levelId ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
        $('select-subject').innerHTML = subjectsOf(state.levelId)
            .map((s) => `<option value="${esc(s.id)}"${s.id === state.subjectId ? ' selected' : ''}>${esc(s.code)} — ${esc(s.name)}</option>`).join('');
    }

    const getters = {
        name: (r) => `${r.student.lastName} ${r.student.firstName}`,
        cc: (r) => r.cc?.value ?? null,
        exam: (r) => r.exam?.value ?? null,
        average: (r) => r.average,
    };

    const matchesStatus = (row) => {
        switch (state.status) {
            case 'drafts': return [row.cc, row.exam, row.rattrapage].some((g) => g?.status === 'brouillon');
            case 'missing': return !row.cc || !row.exam;
            case 'below': return row.average !== null && row.average < PASS;
            default: return true;
        }
    };

    function renderTable() {
        const { rows } = sheet;
        const shown = sortRows(rows.filter(matchesStatus), getters[state.sort.key], state.sort.dir);
        const showRattrapage = rows.some((r) => r.rattrapage || r.eligibleRattrapage);
        const body = shown.length ? shown.map((r) => `
            <tr>
              <td>${userCell(r.student, r.student.matricule)}</td>
              <td>${gradeCell(r.cc)}</td>
              <td>${gradeCell(r.exam)}</td>
              ${showRattrapage ? `<td>${gradeCell(r.rattrapage)}</td>` : ''}
              <td class="table-amount">${formatGrade(r.average)}</td>
              <td>${rowStatus(r)}</td>
            </tr>`).join('') : `<tr><td colspan="${showRattrapage ? 6 : 5}">${emptyState('Aucun étudiant ne correspond à ce filtre.', 'bi-funnel')}</td></tr>`;
        $('sheet-table').innerHTML = `
          <thead><tr>
            ${sortableTh('Étudiant', 'name', state.sort)}
            ${sortableTh('Contrôle continu', 'cc', state.sort)}
            ${sortableTh('Examen', 'exam', state.sort)}
            ${showRattrapage ? '<th>Rattrapage</th>' : ''}
            ${sortableTh('Moyenne', 'average', state.sort)}
            <th>Statut</th>
          </tr></thead><tbody>${body}</tbody>`;
    }

    function renderSheet() {
        charts.forEach((c) => c?.destroy());
        charts = [];
        const { subject, cls, teacher, rows } = sheet;
        const validated = (key) => rows.map((r) => r[key]).filter((g) => g?.status === 'validee');
        const cc = mean(validated('cc').map((g) => g.value));
        const exam = mean(validated('exam').map((g) => g.value));
        const withAverage = rows.filter((r) => r.average !== null);
        const passed = withAverage.filter((r) => r.average >= PASS).length;
        const all = rows.flatMap((r) => [r.cc, r.exam]).filter(Boolean);
        const validatedCount = all.filter((g) => g.status === 'validee').length;
        const drafts = all.length - validatedCount;
        const gap = compare(cc, exam);

        $('page-subtitle').textContent = `${subject.name} · ${cls.label} · coef. ${subject.coefficient} · ${teacher ? fullName(teacher) : 'enseignant à attribuer'}`;

        const examCard = {
            id: 'exam', label: "Moyenne à l'examen", icon: 'bi-graph-up-arrow', col: 'h-100',
            value: exam === null ? '—' : `${formatNumber(exam, 2)} / 20`,
            hint: `Contrôle continu : ${cc === null ? '—' : `${formatNumber(cc, 2)} / 20`}`,
            trend: describeTrend({ direction: gap.direction, value: gap.delta, unit: 'pt', since: 'vs contrôle continu' }),
            series: [cc, exam].filter((v) => v !== null), format: (v) => `${formatNumber(v, 2)} / 20`,
        };
        $('content').innerHTML = `
          <div class="row g-4 mb-4">
            <div class="col-sm-6 col-xl-3">${trendCard(examCard)}</div>
            ${statCard({ label: 'Taux de réussite', value: withAverage.length ? `${formatNumber((passed / withAverage.length) * 100)} %` : '—', icon: 'bi-check2-circle', hint: `${formatNumber(passed)} / ${formatNumber(withAverage.length)} étudiants à 10 ou plus`, col: 'col-sm-6 col-xl-3' })}
            ${statCard({ label: 'Notes validées', value: `${formatNumber(validatedCount)} / ${formatNumber(rows.length * 2)}`, icon: 'bi-patch-check', hint: drafts ? `${formatNumber(drafts)} en brouillon chez l'enseignant` : 'Aucun brouillon en attente', col: 'col-sm-6 col-xl-3' })}
            ${statCard({ label: 'Étudiants', value: formatNumber(rows.length), icon: 'bi-people-fill', hint: `${formatNumber(subject.plannedHours)} h prévues · ${subject.semester}`, col: 'col-sm-6 col-xl-3' })}
          </div>
          <div class="table-card-custom">
            <div class="table-responsive"><table class="table-custom" id="sheet-table"></table></div>
          </div>
          <p class="stat-hint">Les notes en <span class="grade-draft">italique <i class="bi bi-pencil-square"></i></span> sont des brouillons : elles n'entrent pas dans les moyennes tant que l'enseignant ne les a pas validées.</p>`;
        renderTable();
        charts.push(cardSparkline(examCard));
        bindSort($('sheet-table'), () => state.sort, (sort) => { state.sort = sort; renderTable(); });
    }

    async function loadSheet() {
        const mine = ++run;
        if (!state.subjectId) {
            $('content').innerHTML = `<div class="card">${emptyState("Aucune matière n'est définie pour cette classe.", 'bi-book')}<div class="text-center"><a class="btn-custom btn-custom-primary" href="${esc(url('pages/chef/matieres.html'))}?new=1">Créer une matière</a></div></div>`;
            return;
        }
        const sync = new URLSearchParams({ subject: state.subjectId });
        window.history.replaceState(null, '', `${window.location.pathname}?${sync}`);
        const result = await renderInto($('content'), () => GradeService.sheet(state.subjectId), () => '', () => mine === run);
        if (!result || mine !== run) return;
        sheet = result;
        renderSheet();
    }

    $('select-class').addEventListener('change', (e) => {
        state.levelId = e.target.value;
        state.subjectId = subjectsOf(state.levelId)[0]?.id ?? '';
        fillSelects();
        loadSheet();
    });
    $('select-subject').addEventListener('change', (e) => { state.subjectId = e.target.value; loadSheet(); });
    $('select-status').addEventListener('change', (e) => { state.status = e.target.value; if (sheet) renderTable(); });
    mountExportMenu($('export-menu'), {
        getSpec() {
            if (!sheet) return null;
            const { subject, cls, teacher, rows } = sheet;
            const showRattrapage = rows.some((r) => r.rattrapage || r.eligibleRattrapage);
            const hasDraft = (r) => [r.cc, r.exam, r.rattrapage].some((g) => g?.status === 'brouillon');
            const value = (g) => (g ? g.value : null);
            const statusOf = (r) => {
                if (r.average === null) return hasDraft(r) ? 'En attente de validation' : 'Incomplet';
                if (r.average >= PASS) return 'Validée';
                return r.eligibleRattrapage && !r.rattrapage ? 'À rattraper' : 'Sous la moyenne';
            };
            return {
                filename: `notes-${subject.code}`,
                sheets: [{
                    name: subject.code,
                    title: `Notes · ${subject.code} ${subject.name}`,
                    subtitle: [
                        ...exportInfo({ summary: `${formatNumber(rows.length)} étudiant${rows.length > 1 ? 's' : ''} · semestre ${subject.semester}` }),
                        `${cls.label} · coefficient ${subject.coefficient} · ${teacher ? fullName(teacher) : 'enseignant à attribuer'}`,
                        ...(rows.some(hasDraft) ? ["Les notes en brouillon ne sont pas encore validées par l'enseignant : elles ne comptent pas dans les moyennes."] : []),
                    ],
                    columns: [
                        { header: 'Matricule', width: 14 }, { header: 'Nom', width: 22 }, { header: 'Prénom', width: 20 },
                        { header: 'Contrôle continu', type: 'grade', width: 15, lowBelow: PASS }, { header: 'Examen', type: 'grade', width: 12, lowBelow: PASS },
                        ...(showRattrapage ? [{ header: 'Rattrapage', type: 'grade', width: 12, lowBelow: PASS }] : []),
                        { header: 'Moyenne /20', type: 'grade', width: 13, lowBelow: PASS },
                        { header: 'Statut', width: 24, align: 'center', tone: (v) => (v === 'Validée' ? 'good' : v === 'Sous la moyenne' || v === 'À rattraper' ? 'bad' : 'warn') },
                        { header: 'Saisie', width: 20, align: 'center', tone: (v) => (v === 'Validée' ? 'good' : 'warn') },
                    ],
                    rows: rows.map((r) => [
                        r.student.matricule, r.student.lastName, r.student.firstName,
                        value(r.cc), value(r.exam), ...(showRattrapage ? [value(r.rattrapage)] : []),
                        r.average, statusOf(r), hasDraft(r) ? 'Brouillon présent' : 'Validée',
                    ]),
                }],
            };
        },
    });

    // --- Démarrage ---------------------------------------------------------------------------------
    try {
        [subjects, classes] = await Promise.all([SubjectService.list(), ReferenceService.classes()]);
        const requested = subjects.find((s) => s.id === new URLSearchParams(window.location.search).get('subject'));
        state.levelId = requested?.levelId ?? classes.find((c) => subjectsOf(c.id).length)?.id ?? classes[0]?.id ?? '';
        state.subjectId = requested?.id ?? subjectsOf(state.levelId)[0]?.id ?? '';
        fillSelects();
        await loadSheet();
    } catch (error) {
        console.error(error);
        $('content').innerHTML = errorState();
    }
}
