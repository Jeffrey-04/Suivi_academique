/*
 * Chef : liste des enseignants.
 * Recherche, filtre par grade, tri par colonne, pagination, export CSV, ajout / modification / suppression.
 * Le bilan d'heures (réalisées, dues, supplémentaires) vient de StatsService.teacherRows() (objet hoursSummary).
 */

import { config, url } from '../config.js';
import { initPage } from '../layout.js';
import { confirmDeleteTeacher, openTeacherForm } from '../components/teacher-form.js';
import { StatsService, TEACHER_GRADES } from '../services/index.js';
import { esc, formatNumber, fullName } from '../utils/format.js';
import { bindSort, paginate, paginationFooter, sortRows, sortableTh } from '../utils/table.js';
import { describeFilters, exportInfo } from '../utils/exporter.js';
import { mountExportMenu } from '../components/export-menu.js';
import { emptyState, errorState, userCell } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 10;
const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Écart entre heures réalisées et heures dues : +24 h sup., −18 h, ou « Complet ». */
function balance(hours) {
    const gap = Math.round((hours.done - hours.contract) * 10) / 10;
    if (gap > 0) return { gap, html: `<span class="badge-table pending">+${formatNumber(gap)} h sup.</span>` };
    if (gap === 0) return { gap, html: '<span class="badge-table success">Complet</span>' };
    return { gap, html: `<span class="badge-table failed">−${formatNumber(-gap)} h</span>` };
}

const ctx = await initPage({ role: 'chef', page: 'teachers' });

if (ctx) {
    const state = { q: '', grade: '', sort: { key: 'name', dir: 'asc' }, page: 1, highlight: null };
    let rows = [];

    const getters = {
        name: (r) => `${r.teacher.lastName} ${r.teacher.firstName}`,
        subjects: (r) => r.subjects.length,
        hours: (r) => r.hours.done,
        balance: (r) => balance(r.hours).gap,
        rate: (r) => r.rate,
    };

    async function load() {
        rows = await StatsService.teacherRows();
    }

    const visibleRows = () => {
        const needle = normalize(state.q.trim());
        const filtered = rows.filter(({ teacher, subjects }) =>
            (!state.grade || teacher.grade === state.grade) &&
            (!needle || normalize(`${teacher.firstName} ${teacher.lastName} ${teacher.email} ${subjects.map((s) => `${s.code} ${s.name}`).join(' ')}`).includes(needle)));
        return sortRows(filtered, getters[state.sort.key], state.sort.dir);
    };

    function render() {
        const all = visibleRows();
        if (state.highlight) {
            const index = all.findIndex((r) => r.teacher.id === state.highlight);
            if (index >= 0) state.page = Math.floor(index / PAGE_SIZE) + 1;
        }
        const page = paginate(all, state.page, PAGE_SIZE);
        state.page = page.page;
        $('page-subtitle').textContent = `${formatNumber(rows.length)} enseignants · semestre ${config.CURRENT_SEMESTER} ${config.ACADEMIC_YEAR}${all.length !== rows.length ? ` · ${formatNumber(all.length)} correspondent aux filtres` : ''}`;

        $('table-head').innerHTML = `<tr>
          ${sortableTh('Enseignant', 'name', state.sort)}
          ${sortableTh('Matières', 'subjects', state.sort)}
          ${sortableTh('Heures réalisées', 'hours', state.sort)}
          ${sortableTh('Bilan', 'balance', state.sort)}
          ${sortableTh('Présence', 'rate', state.sort, { className: 'd-none d-xl-table-cell' })}
          <th class="text-center">Actions</th></tr>`;

        $('table-body').innerHTML = page.items.length ? page.items.map((row) => {
            const { teacher, subjects, hours, rate, absences } = row;
            const name = fullName(teacher);
            return `
            <tr data-id="${esc(teacher.id)}"${teacher.id === state.highlight ? ' class="row-flash"' : ''}>
              <td>${userCell(teacher, teacher.grade)}</td>
              <td title="${esc(subjects.map((s) => s.name).join(', '))}">${formatNumber(subjects.length)}<div class="table-user-sub">${esc(subjects.slice(0, 3).map((s) => s.code).join(' · '))}${subjects.length > 3 ? ` +${subjects.length - 3}` : ''}</div></td>
              <td class="table-amount">${formatNumber(hours.done)} h<div class="table-user-sub">sur ${formatNumber(hours.contract)} h dues</div></td>
              <td>${balance(hours).html}</td>
              <td class="d-none d-xl-table-cell">${rate === null ? '—' : `${formatNumber(rate, 1)} %`}<div class="table-user-sub">${formatNumber(absences)} absence${absences > 1 ? 's' : ''}</div></td>
              <td>
                <div class="d-flex justify-content-center gap-1">
                  <a href="${esc(url('pages/chef/enseignant.html'))}?id=${esc(teacher.id)}" class="table-btn-action" title="Voir la fiche" aria-label="Voir la fiche de ${esc(name)}"><i class="bi bi-eye"></i></a>
                  <button type="button" class="table-btn-action" data-action="edit" title="Modifier" aria-label="Modifier ${esc(name)}"><i class="bi bi-pencil"></i></button>
                  <button type="button" class="table-btn-action delete" data-action="delete" title="Supprimer" aria-label="Supprimer ${esc(name)}"><i class="bi bi-trash"></i></button>
                </div>
              </td>
            </tr>`;
        }).join('') : `<tr><td colspan="6">${emptyState('Aucun enseignant ne correspond à votre recherche.', 'bi-person-x')}
            <div class="text-center pb-3"><button type="button" class="btn-table-action" data-action="reset-filters">Réinitialiser les filtres</button></div></td></tr>`;

        $('table-footer').innerHTML = paginationFooter(page, 'enseignants');
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
    $('filter-grade').innerHTML = `<option value="">Tous les grades</option>${TEACHER_GRADES.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}`;
    $('filter-grade').addEventListener('change', (e) => { state.grade = e.target.value; state.page = 1; render(); });
    bindSort($('table-head'), () => state.sort, (sort) => { state.sort = sort; state.page = 1; render(); });
    $('table-footer').addEventListener('click', (e) => {
        const link = e.target.closest('[data-page]');
        if (!link) return;
        e.preventDefault();
        state.page = Number(link.dataset.page);
        render();
    });

    function resetFilters() {
        Object.assign(state, { q: '', grade: '', page: 1 });
        $('search').value = '';
        $('filter-grade').value = '';
    }

    $('table-body').addEventListener('click', async (e) => {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        if (button.dataset.action === 'reset-filters') { resetFilters(); render(); return; }
        const teacher = rows.find((r) => r.teacher.id === button.closest('tr').dataset.id)?.teacher;
        if (!teacher) return;
        if (button.dataset.action === 'edit') {
            const saved = await openTeacherForm(teacher);
            if (saved) { state.highlight = saved.id; await refresh(); }
        } else if (button.dataset.action === 'delete') {
            if (await confirmDeleteTeacher(teacher)) await refresh();
        }
    });

    async function addTeacher() {
        const saved = await openTeacherForm();
        if (!saved) return;
        resetFilters();
        state.sort = { key: 'name', dir: 'asc' };
        state.highlight = saved.id;
        await refresh();
    }
    $('btn-add').addEventListener('click', addTeacher);

    mountExportMenu($('export-menu'), {
        getSpec() {
            const data = visibleRows();
            if (!data.length) return null;
            return {
                filename: 'enseignants',
                sheets: [{
                    name: 'Enseignants',
                    title: `Liste des enseignants · semestre ${config.CURRENT_SEMESTER}`,
                    subtitle: exportInfo({
                        summary: `${formatNumber(data.length)} enseignant${data.length > 1 ? 's' : ''} · heures du semestre ${config.CURRENT_SEMESTER}`,
                        filters: describeFilters([['Recherche', $('search')], ['Grade', $('filter-grade')]]),
                    }),
                    columns: [
                        { header: 'Nom', width: 20 }, { header: 'Prénom', width: 18 }, { header: 'Grade', width: 24 },
                        { header: 'Adresse e-mail', width: 36 }, { header: 'Téléphone', width: 20 }, { header: 'Matières', width: 30 },
                        { header: 'Heures dues', type: 'integer', width: 13 }, { header: 'Heures réalisées', type: 'decimal1', width: 15 },
                        { header: 'Heures supplémentaires', type: 'decimal1', width: 16 }, { header: 'Heures manquantes', type: 'decimal1', width: 15 },
                        { header: 'Taux de présence', type: 'percent', width: 14 }, { header: 'Absences', type: 'integer', width: 11 },
                    ],
                    rows: data.map(({ teacher: t, subjects, hours, rate, absences }) => [t.lastName, t.firstName, t.grade, t.email, t.phone, subjects.map((s) => s.code).join(', '), hours.contract, hours.done, hours.overtime, hours.missing, rate, absences]),
                }],
            };
        },
    });

    // --- Démarrage ---------------------------------------------------------------------------------
    try {
        await load();
        render();
        if (new URLSearchParams(window.location.search).get('new') === '1') {
            window.history.replaceState(null, '', window.location.pathname);
            addTeacher();
        }
    } catch (error) {
        console.error(error);
        $('table-body').innerHTML = `<tr><td colspan="6">${errorState()}</td></tr>`;
    }
}
