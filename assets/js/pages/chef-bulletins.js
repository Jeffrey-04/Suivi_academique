/*
 * Chef : suivi et génération des bulletins du semestre.
 * États : généré, prêt à générer (relevé complet), à régénérer (notes modifiées depuis), incomplet (notes manquantes).
 * Génération individuelle ou groupée (sur la sélection filtrée), PDF unitaire ou groupé, export Excel à deux onglets.
 */

import { config, url } from '../config.js';
import { initPage } from '../layout.js';
import { mountExportMenu } from '../components/export-menu.js';
import { BULLETIN_STATUS, BulletinService, ReferenceService } from '../services/index.js';
import { downloadBulletinPdf } from '../utils/bulletin-pdf.js';
import { confirmDialog, toast } from '../utils/dialogs.js';
import { describeFilters, exportInfo } from '../utils/exporter.js';
import { esc, formatDate, formatGrade, formatNumber, fullName } from '../utils/format.js';
import { bindSort, paginate, paginationFooter, sortRows, sortableTh } from '../utils/table.js';
import { emptyState, errorState, statCard, userCell } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 10;
const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, one, many = `${one}s`) => (n > 1 ? many : one);
const RESULT_TONE = { Admis: 'success', Rattrapage: 'pending', 'Ajourné': 'failed', Incomplet: 'neutral' };
const STATUS_TONE = { generated: 'success', outdated: 'pending', ready: 'neutral', incomplete: 'failed' };
const STATUS_ORDER = { incomplete: 0, ready: 1, outdated: 2, generated: 3 };

const statusBadge = (row) => {
    const sub = {
        generated: `le ${formatDate(row.bulletin?.generatedAt)}`,
        outdated: 'notes modifiées depuis',
        ready: 'relevé complet',
        incomplete: `manque : ${row.missing.map((m) => m.code).join(', ')}`,
    }[row.status];
    return `<span class="badge-table ${STATUS_TONE[row.status]}">${BULLETIN_STATUS[row.status]}</span><div class="table-user-sub">${esc(sub)}</div>`;
};

const ctx = await initPage({ role: 'chef', page: 'bulletins' });

if (ctx) {
    const actor = { id: ctx.user.id, role: ctx.user.role };
    const state = { q: '', filiere: '', level: '', status: '', sort: { key: 'name', dir: 'asc' }, page: 1, highlight: null };
    let rows = [];
    let classes = [];

    const getters = {
        name: (r) => `${r.student.lastName} ${r.student.firstName}`,
        class: (r) => r.cls.label,
        average: (r) => r.report.average,
        result: (r) => r.report.result,
        status: (r) => STATUS_ORDER[r.status],
    };

    async function load() {
        const [overview, allClasses] = await Promise.all([BulletinService.overview(), ReferenceService.classes()]);
        classes = allClasses;
        const byId = new Map(allClasses.map((c) => [c.id, c]));
        rows = overview.map((row) => ({ ...row, cls: byId.get(row.student.levelId) }));
    }

    const filtered = () => {
        const needle = normalize(state.q.trim());
        return rows.filter(({ student, cls, status }) =>
            (!state.filiere || cls.filiereId === state.filiere) &&
            (!state.level || cls.name === state.level) &&
            (!state.status || status === state.status) &&
            (!needle || normalize(`${student.firstName} ${student.lastName} ${student.matricule}`).includes(needle)));
    };
    const visibleRows = () => sortRows(filtered(), getters[state.sort.key], state.sort.dir);
    const toGenerate = () => filtered().filter((r) => r.status === 'ready' || r.status === 'outdated');

    function fillFilters() {
        const options = (label, items) => `<option value="">${label}</option>${items.map((i) => `<option value="${esc(i.value)}">${esc(i.label)}</option>`).join('')}`;
        const filieres = [...new Map(classes.map((c) => [c.filiere.id, c.filiere])).values()];
        $('filter-filiere').innerHTML = options('Toutes les filières', filieres.map((f) => ({ value: f.id, label: f.name })));
        $('filter-level').innerHTML = options('Tous les niveaux', [...new Set(classes.map((c) => c.name))].map((n) => ({ value: n, label: n })));
        $('filter-status').innerHTML = options('Tous les états', Object.entries(BULLETIN_STATUS).map(([value, label]) => ({ value, label })));
    }

    function renderKpis() {
        const count = (status) => rows.filter((r) => r.status === status).length;
        $('kpis').innerHTML =
            statCard({ label: 'Bulletins générés', value: formatNumber(count('generated')), icon: 'bi-file-earmark-check', hint: `sur ${formatNumber(rows.length)} étudiants`, col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'Prêts à générer', value: formatNumber(count('ready')), icon: 'bi-file-earmark-plus', hint: 'Relevé complet, pas encore généré', col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'À régénérer', value: formatNumber(count('outdated')), icon: 'bi-arrow-repeat', hint: 'Notes modifiées depuis la génération', col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'Relevés incomplets', value: formatNumber(count('incomplete')), icon: 'bi-hourglass-split', hint: 'Notes manquantes ou non validées', col: 'col-sm-6 col-xl-3' });
    }

    function render() {
        renderKpis();
        const all = visibleRows();
        if (state.highlight) {
            const index = all.findIndex((r) => r.student.id === state.highlight);
            if (index >= 0) state.page = Math.floor(index / PAGE_SIZE) + 1;
        }
        const page = paginate(all, state.page, PAGE_SIZE);
        state.page = page.page;
        $('page-subtitle').textContent = `Semestre ${config.CURRENT_SEMESTER} ${config.ACADEMIC_YEAR} · ${formatNumber(rows.length)} étudiants${all.length !== rows.length ? ` · ${formatNumber(all.length)} correspondent aux filtres` : ''}`;

        const pending = toGenerate().length;
        $('btn-generate').disabled = pending === 0;
        $('btn-generate').querySelector('span').textContent = pending ? `Générer les bulletins prêts (${formatNumber(pending)})` : 'Aucun bulletin à générer';
        const available = filtered().filter((r) => r.status === 'generated').length;
        $('btn-pdf-all').disabled = available === 0;
        $('btn-pdf-all').querySelector('span').textContent = available ? `PDF groupé (${formatNumber(available)})` : 'PDF groupé';

        $('table-head').innerHTML = `<tr>
          ${sortableTh('Étudiant', 'name', state.sort)}
          ${sortableTh('Classe', 'class', state.sort)}
          ${sortableTh('Moyenne', 'average', state.sort)}
          ${sortableTh('Résultat', 'result', state.sort)}
          ${sortableTh('État', 'status', state.sort)}
          <th class="text-center">Actions</th></tr>`;

        $('table-body').innerHTML = page.items.length ? page.items.map((row) => {
            const { student, cls, report, bulletin, status } = row;
            const name = fullName(student);
            const canGenerate = status === 'ready' || status === 'outdated';
            const slot = (visible, html) => (visible ? html : '<span class="table-btn-action is-placeholder" aria-hidden="true"></span>');
            return `
            <tr data-id="${esc(student.id)}"${student.id === state.highlight ? ' class="row-flash"' : ''}>
              <td>${userCell(student, student.matricule)}</td>
              <td>${esc(cls.short)}<div class="table-user-sub">${esc(cls.filiere.name)}</div></td>
              <td class="table-amount">${report.average === null ? '—' : esc(formatGrade(report.average))}</td>
              <td><span class="badge-table ${RESULT_TONE[report.result]}">${esc(report.result)}</span>${report.mention ? `<div class="table-user-sub">${esc(report.mention)}</div>` : ''}</td>
              <td>${statusBadge(row)}</td>
              <td>
                <div class="d-flex justify-content-center gap-1">
                  <a href="${esc(url('pages/chef/bulletin.html'))}?student=${esc(student.id)}" class="table-btn-action" title="${bulletin ? 'Voir le bulletin' : "Voir l'état du relevé"}" aria-label="Voir le bulletin de ${esc(name)}"><i class="bi bi-eye"></i></a>
                  ${slot(canGenerate, `<button type="button" class="table-btn-action" data-action="generate" title="${status === 'outdated' ? 'Régénérer le bulletin' : 'Générer le bulletin'}" aria-label="${status === 'outdated' ? 'Régénérer' : 'Générer'} le bulletin de ${esc(name)}"><i class="bi ${status === 'outdated' ? 'bi-arrow-repeat' : 'bi-file-earmark-plus'}"></i></button>`)}
                  ${slot(Boolean(bulletin), `<button type="button" class="table-btn-action" data-action="pdf" title="Télécharger le PDF" aria-label="Télécharger le bulletin PDF de ${esc(name)}"><i class="bi bi-file-earmark-pdf"></i></button>`)}
                </div>
              </td>
            </tr>`;
        }).join('') : `<tr><td colspan="6">${emptyState('Aucun étudiant ne correspond à votre recherche.', 'bi-file-earmark-x')}
            <div class="text-center pb-3"><button type="button" class="btn-table-action" data-action="reset-filters">Réinitialiser les filtres</button></div></td></tr>`;

        $('table-footer').innerHTML = paginationFooter(page, 'étudiants');
        state.highlight = null;
    }

    async function refresh() {
        await load();
        render();
    }

    // --- Génération ---------------------------------------------------------------------------------
    async function generateOne(row) {
        if (row.status === 'outdated' && !await confirmDialog({
            title: 'Régénérer le bulletin ?',
            message: `Le bulletin de ${fullName(row.student)} sera recalculé avec les notes actuelles.`,
            details: [`La version du ${formatDate(row.bulletin.generatedAt)} sera remplacée.`],
            confirmLabel: 'Régénérer',
        })) return;
        try {
            await BulletinService.generate({ studentIds: [row.student.id] }, actor);
            toast(`Bulletin de ${fullName(row.student)} ${row.status === 'outdated' ? 'régénéré' : 'généré'}.`);
            state.highlight = row.student.id;
            await refresh();
        } catch (error) {
            toast(error.message, { type: 'danger' });
        }
    }

    $('btn-generate').addEventListener('click', async () => {
        const targets = toGenerate();
        const fresh = targets.filter((r) => r.status === 'ready').length;
        const stale = targets.length - fresh;
        const scoped = filtered().length !== rows.length;
        const incomplete = filtered().filter((r) => r.status === 'incomplete').length;
        const confirmed = await confirmDialog({
            title: 'Générer les bulletins ?',
            message: `${formatNumber(targets.length)} bulletin${plural(targets.length, '')} ${plural(targets.length, 'sera généré', 'seront générés')}${scoped ? ' pour la sélection actuelle' : ''}.`,
            details: [
                ...(fresh ? [`${formatNumber(fresh)} nouveau${plural(fresh, '', 'x')} bulletin${plural(fresh, '')}`] : []),
                ...(stale ? [`${formatNumber(stale)} bulletin${plural(stale, '')} régénéré${plural(stale, '')} (notes modifiées depuis)`] : []),
                ...(incomplete ? [`${formatNumber(incomplete)} étudiant${plural(incomplete, '')} au relevé incomplet ${plural(incomplete, 'est ignoré', 'sont ignorés')}.`] : []),
                'Le bulletin généré est un instantané : il reste identique tant qu\'il n\'est pas régénéré.',
            ],
            confirmLabel: 'Générer',
        });
        if (!confirmed) return;
        $('btn-generate').disabled = true;
        try {
            const result = await BulletinService.generate({ studentIds: targets.map((r) => r.student.id) }, actor);
            const total = result.generated + result.regenerated;
            toast(`${formatNumber(total)} bulletin${plural(total, '')} ${plural(total, 'généré')}${result.regenerated ? ` (dont ${formatNumber(result.regenerated)} régénéré${plural(result.regenerated, '')})` : ''}.`);
            await refresh();
        } catch (error) {
            toast(error.message, { type: 'danger' });
            render();
        }
    });

    // --- PDF ----------------------------------------------------------------------------------------
    async function pdfFor(rowsToPrint, button) {
        const icon = button.querySelector('i');
        const original = icon?.className;
        button.disabled = true;
        if (icon) icon.className = 'spinner-border spinner-border-sm';
        try {
            const docs = await Promise.all(rowsToPrint.map((r) => BulletinService.getDocument(r.student.id)));
            const name = await downloadBulletinPdf(docs);
            toast(`${name} téléchargé (${docs.length} bulletin${plural(docs.length, '')}).`);
        } catch (error) {
            console.error(error);
            toast('La génération du PDF a échoué. Réessayez.', { type: 'danger' });
        } finally {
            button.disabled = false;
            if (icon) icon.className = original;
        }
    }

    $('btn-pdf-all').addEventListener('click', () => {
        const stale = filtered().filter((r) => r.status === 'outdated').length;
        const printable = sortRows(sortRows(filtered().filter((r) => r.status === 'generated'), getters.name, 'asc'), getters.class, 'asc');
        if (stale) toast(`${stale} bulletin${plural(stale, '')} à régénérer ${plural(stale, 'est exclu', 'sont exclus')} du PDF groupé.`, { type: 'info' });
        pdfFor(printable, $('btn-pdf-all'));
    });

    // --- Interactions -------------------------------------------------------------------------------
    let timer;
    $('search').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.q = e.target.value; state.page = 1; render(); }, 120);
    });
    [['filter-filiere', 'filiere'], ['filter-level', 'level'], ['filter-status', 'status']].forEach(([id, key]) => {
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
    $('table-body').addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        if (button.dataset.action === 'reset-filters') {
            Object.assign(state, { q: '', filiere: '', level: '', status: '', page: 1 });
            ['search', 'filter-filiere', 'filter-level', 'filter-status'].forEach((id) => { $(id).value = ''; });
            render();
            return;
        }
        const row = rows.find((r) => r.student.id === button.closest('tr').dataset.id);
        if (!row) return;
        if (button.dataset.action === 'generate') generateOne(row);
        else if (button.dataset.action === 'pdf') pdfFor([row], button);
    });

    // --- Export Excel : synthèse + détail des notes ------------------------------------------------
    mountExportMenu($('export-menu'), {
        getSpec() {
            const data = visibleRows();
            if (!data.length) return null;
            const info = exportInfo({
                summary: `${formatNumber(data.length)} étudiant${plural(data.length, '')} · semestre ${config.CURRENT_SEMESTER}`,
                filters: describeFilters([['Recherche', $('search')], ['Filière', $('filter-filiere')], ['Niveau', $('filter-level')], ['État', $('filter-status')]]),
            });
            const resultTone = (v) => ({ Admis: 'good', Rattrapage: 'warn', 'Ajourné': 'bad' }[v] ?? 'neutral');
            const statusTone = (v) => ({ Généré: 'good', 'À régénérer': 'warn', 'Prêt à générer': 'neutral' }[v] ?? 'bad');
            return {
                filename: `bulletins-${config.CURRENT_SEMESTER}`,
                sheets: [
                    {
                        name: 'Synthèse',
                        title: `Bulletins du semestre ${config.CURRENT_SEMESTER} · synthèse`,
                        subtitle: info,
                        columns: [
                            { header: 'Matricule', width: 14 }, { header: 'Nom', width: 20 }, { header: 'Prénom', width: 18 },
                            { header: 'Filière', width: 32 }, { header: 'Niveau', width: 10, align: 'center' },
                            { header: 'Moyenne /20', type: 'grade', width: 13, lowBelow: 10 }, { header: 'Rang', type: 'integer', width: 8 },
                            { header: 'Classés', type: 'integer', width: 9 }, { header: 'Mention', width: 14, align: 'center' },
                            { header: 'Résultat', width: 14, align: 'center', tone: resultTone },
                            { header: 'État du bulletin', width: 17, align: 'center', tone: statusTone },
                            { header: 'Généré le', type: 'date', width: 13 }, { header: 'Matières sans moyenne', width: 24 },
                        ],
                        rows: data.map((r) => [
                            r.student.matricule, r.student.lastName, r.student.firstName, r.cls.filiere.name, r.cls.name,
                            r.report.average, r.bulletin?.rank ?? null, r.bulletin?.classRanked ?? null, r.report.mention ?? '', r.report.result,
                            BULLETIN_STATUS[r.status], r.bulletin?.generatedAt ?? null, r.missing.map((m) => m.code).join(', '),
                        ]),
                    },
                    {
                        name: 'Détail des notes',
                        title: `Bulletins du semestre ${config.CURRENT_SEMESTER} · détail par matière`,
                        subtitle: [...info.slice(0, 1), 'Relevés actuels (notes validées uniquement)'],
                        columns: [
                            { header: 'Matricule', width: 14 }, { header: 'Nom', width: 20 }, { header: 'Prénom', width: 18 }, { header: 'Classe', width: 12, align: 'center' },
                            { header: 'Code', width: 11 }, { header: 'Matière', width: 38 }, { header: 'Coef.', type: 'decimal1', width: 8 },
                            { header: 'Contrôle continu', type: 'grade', width: 15, lowBelow: 10 }, { header: 'Examen', type: 'grade', width: 11, lowBelow: 10 },
                            { header: 'Rattrapage', type: 'grade', width: 12, lowBelow: 10 }, { header: 'Moyenne /20', type: 'grade', width: 13, lowBelow: 10 },
                        ],
                        rows: data.flatMap((r) => r.report.lines.map((l) => [
                            r.student.matricule, r.student.lastName, r.student.firstName, r.cls.short, l.code, l.name, l.coefficient, l.cc, l.exam, l.rattrapage, l.average,
                        ])),
                    },
                ],
            };
        },
    });

    // --- Démarrage ---------------------------------------------------------------------------------
    try {
        await load();
        fillFilters();
        render();
    } catch (error) {
        console.error(error);
        $('table-body').innerHTML = `<tr><td colspan="6">${errorState()}</td></tr>`;
    }
}
