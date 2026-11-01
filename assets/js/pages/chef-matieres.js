/*
 * Chef : liste des matières, avec leur enseignant et l'avancement de la saisie des notes.
 * Création, modification, attribution à un enseignant (dans le formulaire) et suppression protégée.
 */

import { url } from '../config.js';
import { initPage } from '../layout.js';
import { confirmDeleteSubject, openSubjectForm } from '../components/subject-form.js';
import { ReferenceService, StatsService, TeacherService } from '../services/index.js';
import { esc, formatNumber, fullName } from '../utils/format.js';
import { bindSort, paginate, paginationFooter, sortRows, sortableTh } from '../utils/table.js';
import { describeFilters, exportInfo } from '../utils/exporter.js';
import { mountExportMenu } from '../components/export-menu.js';
import { emptyState, errorState } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 10;
const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NO_TEACHER = '__none__';

/** Badge d'avancement de la saisie : validées / attendues (CC + examen par étudiant). */
function progressBadge({ validated, expected, entered }) {
    const tone = expected && validated === expected ? 'success' : validated === 0 && entered === 0 ? 'failed' : 'pending';
    const drafts = entered - validated;
    return `<span class="badge-table ${tone}">${formatNumber(validated)} / ${formatNumber(expected)} validées</span>${drafts ? `<div class="table-user-sub">${formatNumber(drafts)} en brouillon</div>` : ''}`;
}

const ctx = await initPage({ role: 'chef', page: 'subjects' });

if (ctx) {
    const state = { q: '', filiere: '', level: '', teacher: '', sort: { key: 'name', dir: 'asc' }, page: 1, highlight: null };
    let rows = [];

    const getters = {
        name: (r) => r.subject.name,
        class: (r) => r.cls.label,
        teacher: (r) => (r.teacher ? `${r.teacher.lastName} ${r.teacher.firstName}` : ''),
        progress: (r) => (r.expected ? r.validated / r.expected : 0),
    };

    let unitById = new Map();
    const unitCode = (subject) => unitById.get(subject.unitId)?.code ?? '';

    async function load() {
        const [subjectRows, units] = await Promise.all([StatsService.subjectRows(), ReferenceService.units()]);
        rows = subjectRows;
        unitById = new Map(units.map((u) => [u.id, u]));
    }

    const visibleRows = () => {
        const needle = normalize(state.q.trim());
        const filtered = rows.filter(({ subject, cls, teacher }) =>
            (!state.filiere || cls.filiereId === state.filiere) &&
            (!state.level || cls.name === state.level) &&
            (!state.teacher || (state.teacher === NO_TEACHER ? !teacher : teacher?.id === state.teacher)) &&
            (!needle || normalize(`${subject.code} ${subject.name} ${teacher ? fullName(teacher) : ''}`).includes(needle)));
        return sortRows(filtered, getters[state.sort.key], state.sort.dir);
    };

    async function fillFilters() {
        const [classes, teachers] = await Promise.all([ReferenceService.classes(), TeacherService.list()]);
        const options = (label, items) => `<option value="">${label}</option>${items.map((i) => `<option value="${esc(i.value)}">${esc(i.label)}</option>`).join('')}`;
        const filieres = [...new Map(classes.map((c) => [c.filiere.id, c.filiere])).values()];
        $('filter-filiere').innerHTML = options('Toutes les filières', filieres.map((f) => ({ value: f.id, label: f.name })));
        $('filter-level').innerHTML = options('Tous les niveaux', [...new Set(classes.map((c) => c.name))].map((n) => ({ value: n, label: n })));
        $('filter-teacher').innerHTML = options('Tous les enseignants', [
            { value: NO_TEACHER, label: 'Sans enseignant' },
            ...[...teachers].sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr')).map((t) => ({ value: t.id, label: fullName(t) })),
        ]);
    }

    function render() {
        const all = visibleRows();
        if (state.highlight) {
            const index = all.findIndex((r) => r.subject.id === state.highlight);
            if (index >= 0) state.page = Math.floor(index / PAGE_SIZE) + 1;
        }
        const page = paginate(all, state.page, PAGE_SIZE);
        state.page = page.page;
        const unassigned = rows.filter((r) => !r.teacher).length;
        $('page-subtitle').textContent = `${formatNumber(rows.length)} matières${unassigned ? ` · ${formatNumber(unassigned)} sans enseignant` : ''}${all.length !== rows.length ? ` · ${formatNumber(all.length)} correspondent aux filtres` : ''}`;

        $('table-head').innerHTML = `<tr>
          ${sortableTh('Matière', 'name', state.sort)}
          ${sortableTh('Classe', 'class', state.sort)}
          ${sortableTh('Enseignant', 'teacher', state.sort)}
          ${sortableTh('Notes', 'progress', state.sort)}
          <th class="text-center">Actions</th></tr>`;

        $('table-body').innerHTML = page.items.length ? page.items.map((row) => {
            const { subject, cls, teacher } = row;
            const label = `${subject.code} ${subject.name}`;
            return `
            <tr data-id="${esc(subject.id)}"${subject.id === state.highlight ? ' class="row-flash"' : ''}>
              <td><div class="table-product-name">${esc(subject.name)}</div><div class="table-user-sub">${esc(subject.code)} · coef. ${esc(subject.coefficient)} · ${formatNumber(subject.plannedHours)} h · ${esc(subject.semester)}${unitCode(subject) ? ` · ${esc(unitCode(subject))}` : ''}</div></td>
              <td>${esc(cls.short)}<div class="table-user-sub">${esc(cls.filiere.name)}</div></td>
              <td>${teacher
                ? `<a class="table-user-name" href="${esc(url('pages/chef/enseignant.html'))}?id=${esc(teacher.id)}">${esc(fullName(teacher))}</a><div class="table-user-sub">${esc(teacher.grade)}</div>`
                : '<span class="badge-table pending">À attribuer</span>'}</td>
              <td>${progressBadge(row)}</td>
              <td>
                <div class="d-flex justify-content-center gap-1">
                  <a href="${esc(url('pages/chef/notes.html'))}?subject=${esc(subject.id)}" class="table-btn-action" title="Consulter les notes" aria-label="Consulter les notes de ${esc(label)}"><i class="bi bi-eye"></i></a>
                  <button type="button" class="table-btn-action" data-action="edit" title="Modifier / attribuer" aria-label="Modifier ${esc(label)}"><i class="bi bi-pencil"></i></button>
                  <button type="button" class="table-btn-action delete" data-action="delete" title="Supprimer" aria-label="Supprimer ${esc(label)}"><i class="bi bi-trash"></i></button>
                </div>
              </td>
            </tr>`;
        }).join('') : `<tr><td colspan="5">${emptyState('Aucune matière ne correspond à votre recherche.', 'bi-book')}
            <div class="text-center pb-3"><button type="button" class="btn-table-action" data-action="reset-filters">Réinitialiser les filtres</button></div></td></tr>`;

        $('table-footer').innerHTML = paginationFooter(page, 'matières');
        state.highlight = null;
    }

    async function refresh() {
        await load();
        render();
    }

    // --- Interactions -----------------------------------------------------------------------------
    let timer;
    $('search').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.q = e.target.value; state.page = 1; render(); }, 120);
    });
    [['filter-filiere', 'filiere'], ['filter-level', 'level'], ['filter-teacher', 'teacher']].forEach(([id, key]) => {
        $(id).addEventListener('change', (e) => { state[key] = e.target.value; state.page = 1; render(); });
    });
    bindSort($('table-head'), () => state.sort, (sort) => { state.sort = sort; state.page = 1; render(); });
    $('table-footer').addEventListener('click', (e) => {
        const link = e.target.closest('[data-page]');
        if (!link) return;
        e.preventDefault();
        state.page = Number(link.dataset.page);
        render();
    });

    function resetFilters() {
        Object.assign(state, { q: '', filiere: '', level: '', teacher: '', page: 1 });
        ['search', 'filter-filiere', 'filter-level', 'filter-teacher'].forEach((id) => { $(id).value = ''; });
    }

    $('table-body').addEventListener('click', async (e) => {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        if (button.dataset.action === 'reset-filters') { resetFilters(); render(); return; }
        const subject = rows.find((r) => r.subject.id === button.closest('tr').dataset.id)?.subject;
        if (!subject) return;
        if (button.dataset.action === 'edit') {
            const saved = await openSubjectForm(subject);
            if (saved) { state.highlight = saved.id; await refresh(); }
        } else if (button.dataset.action === 'delete') {
            if (await confirmDeleteSubject(subject)) await refresh();
        }
    });

    async function addSubject() {
        const saved = await openSubjectForm();
        if (!saved) return;
        resetFilters();
        state.sort = { key: 'name', dir: 'asc' };
        state.highlight = saved.id;
        await refresh();
    }
    $('btn-add').addEventListener('click', addSubject);

    mountExportMenu($('export-menu'), {
        getSpec() {
            const data = visibleRows();
            if (!data.length) return null;
            return {
                filename: 'matieres',
                sheets: [{
                    name: 'Matières',
                    title: 'Liste des matières',
                    subtitle: exportInfo({
                        summary: `${formatNumber(data.length)} matière${data.length > 1 ? 's' : ''}`,
                        filters: describeFilters([['Recherche', $('search')], ['Filière', $('filter-filiere')], ['Niveau', $('filter-level')], ['Enseignant', $('filter-teacher')]]),
                    }),
                    columns: [
                        { header: 'Code', width: 12 }, { header: 'Intitulé', width: 40 }, { header: 'Unité d\'enseignement', width: 16 }, { header: 'Filière', width: 32 },
                        { header: 'Niveau', width: 10, align: 'center' }, { header: 'Semestre', width: 11, align: 'center' },
                        { header: 'Coefficient', type: 'decimal1', width: 12 }, { header: 'Heures prévues', type: 'integer', width: 14 },
                        { header: 'Enseignant', width: 26 }, { header: 'Étudiants', type: 'integer', width: 11 },
                        { header: 'Notes validées', type: 'integer', width: 13 }, { header: 'Notes saisies', type: 'integer', width: 13 },
                        { header: 'Notes attendues', type: 'integer', width: 14 },
                        { header: 'Avancement', width: 15, align: 'center', tone: (v) => (v === 'Complet' ? 'good' : v === 'Non commencé' ? 'bad' : 'warn') },
                    ],
                    rows: data.map(({ subject: s, cls, teacher, students, validated, entered, expected }) => [
                        s.code, s.name, unitCode(s), cls.filiere.name, cls.name, s.semester, s.coefficient, s.plannedHours, teacher ? fullName(teacher) : 'À attribuer',
                        students, validated, entered, expected, validated === expected ? 'Complet' : entered === 0 ? 'Non commencé' : 'En cours']),
                }],
            };
        },
    });

    // --- Démarrage ---------------------------------------------------------------------------------
    try {
        await Promise.all([load(), fillFilters()]);
        const requested = new URLSearchParams(window.location.search).get('q'); // lien de la recherche rapide
        if (requested) { state.q = requested; $('search').value = requested; }
        render();
        if (new URLSearchParams(window.location.search).get('new') === '1') {
            window.history.replaceState(null, '', window.location.pathname);
            addSubject();
        }
    } catch (error) {
        console.error(error);
        $('table-body').innerHTML = `<tr><td colspan="5">${errorState()}</td></tr>`;
    }
}
