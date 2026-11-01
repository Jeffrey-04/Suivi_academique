/*
 * Chef : liste des étudiants.
 * Recherche, filtres filière / niveau, tri par colonne, pagination, export CSV,
 * ajout / modification / suppression (modales). Les écritures passent par StudentService.
 */

import { url } from '../config.js';
import { initPage } from '../layout.js';
import { confirmDeleteStudent, openStudentForm } from '../components/student-form.js';
import { BulletinService, ReferenceService, StudentService } from '../services/index.js';
import { esc, formatNumber } from '../utils/format.js';
import { bindSort, paginate, paginationFooter, sortRows, sortableTh } from '../utils/table.js';
import { describeFilters, exportInfo } from '../utils/exporter.js';
import { mountExportMenu } from '../components/export-menu.js';
import { emptyState, errorState, userCell } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 10;
const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ctx = await initPage({ role: 'chef', page: 'students' });

if (ctx) {
    const state = { q: '', filiere: '', level: '', sort: { key: 'name', dir: 'asc' }, page: 1, highlight: null };
    let rows = [];
    let classes = [];

    const getters = {
        name: (r) => `${r.student.lastName} ${r.student.firstName}`,
        matricule: (r) => r.student.matricule,
        class: (r) => r.cls.label,
        bulletin: (r) => (r.hasBulletin ? 'Généré' : 'À générer'),
    };

    async function load() {
        const [students, allClasses, bulletins] = await Promise.all([StudentService.list(), ReferenceService.classes(), BulletinService.list()]);
        classes = allClasses;
        const withBulletin = new Set(bulletins.map((b) => b.studentId));
        const byId = new Map(allClasses.map((c) => [c.id, c]));
        rows = students.map((student) => ({ student, cls: byId.get(student.levelId), hasBulletin: withBulletin.has(student.id) }));
    }

    const visibleRows = () => {
        const needle = normalize(state.q.trim());
        const filtered = rows.filter(({ student, cls }) =>
            (!state.filiere || cls.filiereId === state.filiere) &&
            (!state.level || cls.name === state.level) &&
            (!needle || normalize(`${student.firstName} ${student.lastName} ${student.matricule} ${student.email}`).includes(needle)));
        return sortRows(filtered, getters[state.sort.key], state.sort.dir);
    };

    function fillFilters() {
        const options = (label, items) => `<option value="">${label}</option>${items.map((i) => `<option value="${esc(i.value)}">${esc(i.label)}</option>`).join('')}`;
        const filieres = [...new Map(classes.map((c) => [c.filiere.id, c.filiere])).values()];
        $('filter-filiere').innerHTML = options('Toutes les filières', filieres.map((f) => ({ value: f.id, label: f.name })));
        $('filter-level').innerHTML = options('Tous les niveaux', [...new Set(classes.map((c) => c.name))].map((n) => ({ value: n, label: n })));
    }

    function render() {
        const all = visibleRows();
        if (state.highlight) {
            const index = all.findIndex((r) => r.student.id === state.highlight);
            if (index >= 0) state.page = Math.floor(index / PAGE_SIZE) + 1;
        }
        const page = paginate(all, state.page, PAGE_SIZE);
        state.page = page.page;
        $('page-subtitle').textContent = `${formatNumber(rows.length)} étudiants inscrits${all.length !== rows.length ? ` · ${formatNumber(all.length)} correspondent aux filtres` : ''}`;

        $('table-head').innerHTML = `<tr>
          ${sortableTh('Étudiant', 'name', state.sort)}
          ${sortableTh('Matricule', 'matricule', state.sort)}
          ${sortableTh('Classe', 'class', state.sort)}
          ${sortableTh('Bulletin', 'bulletin', state.sort)}
          <th class="text-center">Actions</th></tr>`;

        $('table-body').innerHTML = page.items.length ? page.items.map(({ student, cls, hasBulletin }) => {
            const name = `${student.firstName} ${student.lastName}`;
            return `
            <tr data-id="${esc(student.id)}"${student.id === state.highlight ? ' class="row-flash"' : ''}>
              <td>${userCell(student, student.email)}</td>
              <td class="table-order-id">${esc(student.matricule)}</td>
              <td>${esc(cls.short)}<div class="table-user-sub">${esc(cls.filiere.name)}</div></td>
              <td><span class="badge-table ${hasBulletin ? 'success' : 'pending'}">${hasBulletin ? 'Généré' : 'À générer'}</span></td>
              <td>
                <div class="d-flex justify-content-center gap-1">
                  <a href="${esc(url('pages/chef/etudiant.html'))}?id=${esc(student.id)}" class="table-btn-action" title="Voir la fiche" aria-label="Voir la fiche de ${esc(name)}"><i class="bi bi-eye"></i></a>
                  <button type="button" class="table-btn-action" data-action="edit" title="Modifier" aria-label="Modifier ${esc(name)}"><i class="bi bi-pencil"></i></button>
                  <button type="button" class="table-btn-action delete" data-action="delete" title="Supprimer" aria-label="Supprimer ${esc(name)}"><i class="bi bi-trash"></i></button>
                </div>
              </td>
            </tr>`;
        }).join('') : `<tr><td colspan="5">${emptyState('Aucun étudiant ne correspond à votre recherche.', 'bi-person-x')}
            <div class="text-center pb-3"><button type="button" class="btn-table-action" data-action="reset-filters">Réinitialiser les filtres</button></div></td></tr>`;

        $('table-footer').innerHTML = paginationFooter(page, 'étudiants');
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
    $('filter-filiere').addEventListener('change', (e) => { state.filiere = e.target.value; state.page = 1; render(); });
    $('filter-level').addEventListener('change', (e) => { state.level = e.target.value; state.page = 1; render(); });
    bindSort($('table-head'), () => state.sort, (sort) => { state.sort = sort; state.page = 1; render(); });
    $('table-footer').addEventListener('click', (e) => {
        const link = e.target.closest('[data-page]');
        if (!link) return;
        e.preventDefault();
        state.page = Number(link.dataset.page);
        render();
    });

    function resetFilters() {
        Object.assign(state, { q: '', filiere: '', level: '', page: 1 });
        $('search').value = '';
        $('filter-filiere').value = '';
        $('filter-level').value = '';
    }

    $('table-body').addEventListener('click', async (e) => {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        if (button.dataset.action === 'reset-filters') { resetFilters(); render(); return; }
        const student = rows.find((r) => r.student.id === button.closest('tr').dataset.id)?.student;
        if (!student) return;
        if (button.dataset.action === 'edit') {
            const saved = await openStudentForm(student);
            if (saved) { state.highlight = saved.id; await refresh(); }
        } else if (button.dataset.action === 'delete') {
            if (await confirmDeleteStudent(student)) await refresh();
        }
    });

    async function addStudent() {
        const saved = await openStudentForm();
        if (!saved) return;
        resetFilters(); // pour que le nouvel étudiant soit visible
        state.sort = { key: 'name', dir: 'asc' };
        state.highlight = saved.id;
        await refresh();
    }
    $('btn-add').addEventListener('click', addStudent);

    mountExportMenu($('export-menu'), {
        getSpec() {
            const data = visibleRows();
            if (!data.length) return null;
            return {
                filename: 'etudiants',
                sheets: [{
                    name: 'Étudiants',
                    title: 'Liste des étudiants',
                    subtitle: exportInfo({
                        summary: `${formatNumber(data.length)} étudiant${data.length > 1 ? 's' : ''}`,
                        filters: describeFilters([['Recherche', $('search')], ['Filière', $('filter-filiere')], ['Niveau', $('filter-level')]]),
                    }),
                    columns: [
                        { header: 'Matricule', width: 14 }, { header: 'Nom', width: 20 }, { header: 'Prénom', width: 18 },
                        { header: 'Filière', width: 32 }, { header: 'Niveau', width: 10, align: 'center' },
                        { header: 'Adresse e-mail', width: 36 }, { header: 'Téléphone', width: 20 },
                        { header: 'Date de naissance', type: 'date', width: 16 }, { header: 'Lieu de naissance', width: 20 },
                        { header: 'Bulletin', width: 14, align: 'center', tone: (v) => (v === 'Généré' ? 'good' : 'warn') },
                    ],
                    rows: data.map(({ student: s, cls, hasBulletin }) => [s.matricule, s.lastName, s.firstName, cls.filiere.name, cls.name, s.email, s.phone, s.birthDate, s.birthPlace ?? '', hasBulletin ? 'Généré' : 'À générer']),
                }],
            };
        },
    });

    // --- Démarrage ---------------------------------------------------------------------------------
    try {
        await load();
        fillFilters();
        render();
        // Lien « Nouvel étudiant » du menu Créer : ?new=1 ouvre directement le formulaire
        if (new URLSearchParams(window.location.search).get('new') === '1') {
            window.history.replaceState(null, '', window.location.pathname);
            addStudent();
        }
    } catch (error) {
        console.error(error);
        $('table-body').innerHTML = `<tr><td colspan="5">${errorState()}</td></tr>`;
    }
}
