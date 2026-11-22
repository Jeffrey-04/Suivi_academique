/*
 * Chef : saisie et validation des notes d'une matière (le chef saisit pour l'enseignant de la matière).
 *
 * Parcours : choisir la matière et l'évaluation (contrôle continu / examen / rattrapage), saisir les notes,
 * « Enregistrer le brouillon » (modifiable, non comptée), puis « Valider » (verrouillage, prise en compte dans
 * les moyennes). Les contrôles (0-20, droits, rattrapage éligible) sont ceux de GradeService ; la page affiche
 * le message de chaque étudiant sous sa note.
 */


import { initPage } from '../layout.js';
import { GRADE_TYPES, GradeService, ReferenceService, SubjectService, ValidationError } from '../services/index.js';
import { confirmDialog, toast } from '../utils/dialogs.js';
import { esc, formatGrade, formatNumber } from '../utils/format.js';
import { applyDynamicWidths, emptyState, errorState, progressList, userCell } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const FIELD = { CC: 'cc', EXAMEN: 'exam', RATTRAPAGE: 'rattrapage' };
const TYPES = Object.keys(GRADE_TYPES);
const plural = (n, one, many = `${one}s`) => (n > 1 ? many : one);

const ctx = await initPage({ role: 'chef', page: 'grade-entry' });

if (ctx) {
    const actor = { id: ctx.user.id, role: ctx.user.role };
    const state = { subjectId: '', type: 'CC' };
    let subjects = [];
    let sheet = null;
    let initial = new Map(); // studentId -> valeur enregistrée (chaîne), pour détecter les modifications

    const rowsOfType = () => sheet.rows.filter((r) => state.type !== 'RATTRAPAGE' || r.eligibleRattrapage || r.rattrapage);
    const gradeOf = (row) => row[FIELD[state.type]];
    const inputs = () => [...document.querySelectorAll('#entry-body .grade-input')];
    const editable = () => inputs().filter((i) => !i.disabled);
    const isDirty = (input) => input.value.trim() !== (initial.get(input.dataset.student) ?? '');
    const dirtyCount = () => editable().filter(isDirty).length;

    // --- Navigation (matière / évaluation) ------------------------------------------------------------
    async function confirmLeave() {
        if (!dirtyCount()) return true;
        return confirmDialog({
            title: 'Abandonner les modifications ?', message: `${dirtyCount()} note${dirtyCount() > 1 ? 's' : ''} modifiée${dirtyCount() > 1 ? 's' : ''} n'${dirtyCount() > 1 ? 'ont' : 'a'} pas été enregistrée${dirtyCount() > 1 ? 's' : ''}.`,
            confirmLabel: 'Abandonner', danger: true,
        });
    }
    window.addEventListener('beforeunload', (event) => {
        if (dirtyCount()) { event.preventDefault(); event.returnValue = ''; }
    });

    /** Évaluation à ouvrir par défaut : la première qui a encore des notes à valider. */
    function defaultType() {
        const pending = (field) => sheet.rows.some((r) => r[field]?.status !== 'validee');
        if (pending('cc')) return 'CC';
        if (pending('exam')) return 'EXAMEN';
        if (sheet.rows.some((r) => r.eligibleRattrapage && r.rattrapage?.status !== 'validee')) return 'RATTRAPAGE';
        return 'EXAMEN';
    }

    async function loadSheet({ keepType = false } = {}) {
        sheet = await GradeService.sheet(state.subjectId);
        if (!keepType) {
            const wanted = new URLSearchParams(window.location.search).get('type');
            state.type = TYPES.includes(wanted) ? wanted : defaultType();
        }
        window.history.replaceState(null, '', `${window.location.pathname}?${new URLSearchParams({ subject: state.subjectId, type: state.type })}`);
        render();
    }

    // --- Rendu ---------------------------------------------------------------------------------------
    function renderTypeButtons() {
        $('type-buttons').innerHTML = TYPES.map((type) => {
            const field = FIELD[type];
            const rows = type === 'RATTRAPAGE' ? sheet.rows.filter((r) => r.eligibleRattrapage || r.rattrapage) : sheet.rows;
            const done = rows.filter((r) => r[field]).length;
            const count = type === 'RATTRAPAGE' ? `${done}/${rows.length}` : `${done}/${sheet.rows.length}`;
            return `<button type="button" class="segmented-btn${type === state.type ? ' active' : ''}" data-type="${type}" aria-pressed="${type === state.type}">${esc(GRADE_TYPES[type])} <span class="segmented-count">${count}</span></button>`;
        }).join('');
    }

    function render() {
        renderTypeButtons();
        const { subject, cls } = sheet;
        const teacher = sheet.teacher ? `${sheet.teacher.firstName} ${sheet.teacher.lastName}` : 'sans enseignant';
        $('page-subtitle').textContent = `${subject.name} · ${cls.label} · ${teacher} · coef. ${subject.coefficient} · ${GRADE_TYPES[state.type]}`;
        const rows = rowsOfType();
        const showCc = state.type !== 'CC';
        const showExam = state.type === 'RATTRAPAGE';

        if (!rows.length) {
            $('content').innerHTML = `<div class="card">${emptyState(state.type === 'RATTRAPAGE'
                ? "Aucun étudiant n'est éligible au rattrapage : il faut une moyenne inférieure à 10 une fois le contrôle continu et l'examen validés."
                : "Aucun étudiant n'est inscrit dans cette classe.", 'bi-journal-check')}</div>`;
            return;
        }

        const body = rows.map((row) => {
            const grade = gradeOf(row);
            const locked = grade?.status === 'validee';
            const value = grade ? String(grade.value) : '';
            return `
            <tr data-student="${esc(row.student.id)}">
              <td>${userCell(row.student, row.student.matricule)}</td>
              ${showCc ? `<td>${row.cc ? formatGrade(row.cc.value) : '—'}</td>` : ''}
              ${showExam ? `<td>${row.exam ? formatGrade(row.exam.value) : '—'}</td>` : ''}
              <td>
                <div class="grade-field" data-field>
                  <input type="number" class="form-control-custom grade-input" data-student="${esc(row.student.id)}" value="${esc(value)}"
                    min="0" max="20" step="0.01" inputmode="decimal" placeholder="—" ${locked ? 'disabled' : ''}
                    aria-label="Note de ${esc(row.student.firstName)} ${esc(row.student.lastName)}">
                  <span class="grade-suffix">/ 20</span>
                </div>
              </td>
              <td data-status></td>
              <td class="table-amount">${formatGrade(row.average)}</td>
            </tr>`;
        }).join('');

        $('content').innerHTML = `
          <div id="progress-block" class="card mb-4"></div>
          <div class="table-card-custom">
            <div class="table-responsive">
              <table class="table-custom">
                <thead><tr>
                  <th>Étudiant</th>
                  ${showCc ? '<th>Contrôle continu</th>' : ''}${showExam ? '<th>Examen</th>' : ''}
                  <th>Note ${esc(GRADE_TYPES[state.type].toLowerCase())}</th>
                  <th>Statut</th>
                  <th title="Moyenne de la matière, notes validées seulement">Moyenne actuelle</th>
                </tr></thead>
                <tbody id="entry-body">${body}</tbody>
              </table>
            </div>
            <div class="grade-actions">
              <span class="grade-actions-info" id="dirty-info" aria-live="polite"></span>
              <div class="d-flex gap-2 flex-wrap">
                <button type="button" class="btn-custom btn-custom-light" id="btn-save"><i class="bi bi-save"></i> Enregistrer le brouillon</button>
                <button type="button" class="btn-custom btn-custom-primary" id="btn-validate"><i class="bi bi-patch-check"></i> Valider les notes</button>
              </div>
            </div>
          </div>
          <p class="stat-hint">Saisissez une note entre 0 et 20 (deux décimales au maximum) ; laissez vide pour un étudiant absent ou sans note. Touche Entrée : étudiant suivant.</p>`;
        initial = new Map(editable().map((i) => [i.dataset.student, i.value.trim()]));
        refreshState();
    }

    /** Met à jour badges, compteurs et boutons après chaque saisie. */
    function refreshState() {
        const rows = rowsOfType();
        let validated = 0;
        let drafts = 0;
        let typed = 0;
        rows.forEach((row) => {
            const tr = document.querySelector(`tr[data-student="${CSS.escape(row.student.id)}"]`);
            const input = tr.querySelector('.grade-input');
            const status = tr.querySelector('[data-status]');
            const locked = input.disabled;
            const dirty = !locked && isDirty(input);
            const has = input.value.trim() !== '';
            tr.classList.toggle('is-dirty', dirty);
            if (locked) { validated += 1; status.innerHTML = '<span class="badge-table success"><i class="bi bi-lock-fill"></i> Validée</span>'; }
            else if (dirty) { if (has) typed += 1; status.innerHTML = '<span class="badge-table pending">Modifiée</span>'; }
            else if (has) { drafts += 1; status.innerHTML = '<span class="badge-table pending">Brouillon</span>'; }
            else status.innerHTML = '<span class="badge-table neutral">Non saisie</span>';
        });
        const total = rows.length;
        const entered = validated + drafts + typed;
        $('progress-block').innerHTML = `
          <div class="card-header mb-2"><h3 class="card-title">${esc(GRADE_TYPES[state.type])}</h3><span class="stat-hint">${formatNumber(entered)} / ${formatNumber(total)} notes</span></div>
          ${progressList([{ label: `${formatNumber(validated)} validée${validated > 1 ? 's' : ''} · ${formatNumber(drafts + typed)} en brouillon · ${formatNumber(total - entered)} sans note`, value: `${Math.round(total ? (entered / total) * 100 : 0)} %`, percent: total ? (entered / total) * 100 : 0, tone: validated === total ? 'ok' : 'warn' }])}`;
        applyDynamicWidths($('progress-block'));

        const dirty = dirtyCount();
        const lockedAll = editable().length === 0;
        $('dirty-info').textContent = lockedAll
            ? 'Toutes les notes de cette évaluation sont validées et verrouillées.'
            : dirty ? `${dirty} modification${dirty > 1 ? 's' : ''} non enregistrée${dirty > 1 ? 's' : ''}` : 'Aucune modification en attente.';
        $('btn-save').disabled = dirty === 0;
        $('btn-validate').disabled = lockedAll || (drafts + typed) === 0;
    }

    // --- Actions -------------------------------------------------------------------------------------
    function clearRowErrors() {
        document.querySelectorAll('#entry-body .is-invalid-custom').forEach((i) => i.classList.remove('is-invalid-custom'));
        document.querySelectorAll('#entry-body .form-feedback-custom').forEach((n) => n.remove());
    }

    function showRowErrors(fields) {
        let first = null;
        Object.entries(fields).forEach(([studentId, message]) => {
            const input = document.querySelector(`.grade-input[data-student="${CSS.escape(studentId)}"]`);
            if (!input) return;
            input.classList.add('is-invalid-custom');
            input.closest('[data-field]').insertAdjacentHTML('afterend', `<div class="form-feedback-custom invalid-custom">${esc(message)}</div>`);
            first ??= input;
        });
        first?.focus();
    }

    async function save({ silent = false } = {}) {
        clearRowErrors();
        const entries = editable().map((i) => ({ studentId: i.dataset.student, value: i.value }));
        const result = await GradeService.saveDrafts({ subjectId: state.subjectId, type: state.type, entries }, actor);
        if (!silent) toast(result.saved || result.removed ? `Brouillon enregistré (${formatNumber(result.saved)} note${result.saved > 1 ? 's' : ''}${result.removed ? `, ${formatNumber(result.removed)} effacée${result.removed > 1 ? 's' : ''}` : ''}).` : 'Aucun changement à enregistrer.');
        return result;
    }

    function handleError(error) {
        if (error instanceof ValidationError && Object.keys(error.fields).length) {
            showRowErrors(error.fields);
            toast(error.message, { type: 'danger' });
        } else {
            if (!(error instanceof ValidationError)) console.error(error);
            toast(error instanceof ValidationError ? error.message : "L'opération a échoué. Réessayez.", { type: 'danger' });
        }
    }

    async function onSave() {
        $('btn-save').disabled = true;
        try {
            await save();
            await loadSheet({ keepType: true });
        } catch (error) {
            handleError(error);
            refreshState();
        }
    }

    async function onValidate() {
        const withValue = editable().filter((i) => i.value.trim() !== '');
        const without = editable().length - withValue.length;
        const confirmed = await confirmDialog({
            title: 'Valider les notes ?',
            message: `${withValue.length} note${withValue.length > 1 ? 's' : ''} de ${GRADE_TYPES[state.type].toLowerCase()} ${withValue.length > 1 ? 'seront validées' : 'sera validée'} pour ${sheet.subject.code}.`,
            details: [
                ...(without ? [`${without} étudiant${without > 1 ? 's' : ''} sans note (absent${without > 1 ? 's' : ''} ?) : leur évaluation restera incomplète.`] : []),
                'Les notes validées entrent dans les moyennes et les bulletins.',
                'Elles ne pourront plus être modifiées.',
            ],
            confirmLabel: 'Valider définitivement',
        });
        if (!confirmed) return;
        $('btn-validate').disabled = true;
        try {
            if (dirtyCount()) await save({ silent: true });
            const { validated } = await GradeService.validate({ subjectId: state.subjectId, type: state.type }, actor);
            toast(`${formatNumber(validated)} note${validated > 1 ? 's validées' : ' validée'} : ${plural(validated, 'elle est verrouillée', 'elles sont verrouillées')}.`);
            await loadSheet({ keepType: true });
        } catch (error) {
            handleError(error);
            refreshState();
        }
    }

    // --- Événements ----------------------------------------------------------------------------------
    document.addEventListener('input', (e) => {
        if (!e.target.classList?.contains('grade-input')) return;
        e.target.classList.remove('is-invalid-custom');
        const feedback = e.target.closest('[data-field]')?.nextElementSibling;
        if (feedback?.classList.contains('form-feedback-custom')) feedback.remove();
        refreshState();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.classList?.contains('grade-input')) return;
        e.preventDefault();
        const list = editable();
        (list[list.indexOf(e.target) + 1] ?? $('btn-save')).focus();
    });
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btn-save')) onSave();
        else if (e.target.closest('#btn-validate')) onValidate();
    });

    $('type-buttons').addEventListener('click', async (e) => {
        const button = e.target.closest('[data-type]');
        if (!button || button.dataset.type === state.type) return;
        if (!await confirmLeave()) return;
        state.type = button.dataset.type;
        await loadSheet({ keepType: true });
    });
    $('select-subject').addEventListener('change', async (e) => {
        if (!await confirmLeave()) { e.target.value = state.subjectId; return; }
        state.subjectId = e.target.value;
        await loadSheet();
    });

    // --- Démarrage -----------------------------------------------------------------------------------
    try {
        const [all, classes] = await Promise.all([SubjectService.list(), ReferenceService.classes()]);
        const classById = new Map(classes.map((c) => [c.id, c]));
        subjects = all.sort((a, b) => a.code.localeCompare(b.code));
        if (!subjects.length) {
            $('content').innerHTML = `<div class="card">${emptyState("Aucune matière n'est enregistrée : créez-en une pour saisir des notes.", 'bi-book')}</div>`;
        } else {
            const requested = new URLSearchParams(window.location.search).get('subject');
            state.subjectId = subjects.find((s) => s.id === requested)?.id ?? subjects[0].id;
            $('select-subject').innerHTML = subjects.map((s) => `<option value="${esc(s.id)}"${s.id === state.subjectId ? ' selected' : ''}>${esc(s.code)} — ${esc(s.name)} (${esc(classById.get(s.levelId)?.short ?? '')})</option>`).join('');
            $('controls').hidden = false;
            await loadSheet();
        }
    } catch (error) {
        console.error(error);
        $('content').innerHTML = errorState();
    }
}
