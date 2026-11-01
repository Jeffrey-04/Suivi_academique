/*
 * Enseignant : les matières qui lui sont attribuées, avec l'avancement des heures et des notes.
 * Le lien « Saisir les notes » ouvre la feuille de saisie de la matière.
 */

import { config, url } from '../config.js';
import { initPage } from '../layout.js';
import { StatsService } from '../services/index.js';
import { esc, formatNumber } from '../utils/format.js';
import { emptyState, errorState, renderInto, statCard } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const ctx = await initPage({ role: 'enseignant', page: 'subjects' });

if (ctx) {
    const gradeUrl = (id) => `${url('pages/enseignant/saisie-notes.html')}?subject=${encodeURIComponent(id)}`;

    try {
        const { rows, drafts } = await StatsService.teacherOverview(ctx.user.profileId);
        $('page-subtitle').textContent = `${formatNumber(rows.length)} matière${rows.length > 1 ? 's' : ''} · semestre ${config.CURRENT_SEMESTER} ${config.ACADEMIC_YEAR}`;

        if (!rows.length) {
            $('kpis').innerHTML = '';
            $('btn-grade').hidden = true;
            $('table-body').innerHTML = `<tr><td colspan="6">${emptyState("Aucune matière ne vous est attribuée pour l'instant. Le chef de département peut vous en attribuer.", 'bi-book')}</td></tr>`;
        } else {
            const students = rows.reduce((total, r) => total + r.students, 0);
            const toEnter = rows.reduce((total, r) => total + (r.expected - r.entered), 0);
            await renderInto($('kpis'), async () => rows, () =>
                statCard({ label: 'Matières', value: formatNumber(rows.length), icon: 'bi-book', hint: `${formatNumber(rows.reduce((t, r) => t + r.subject.plannedHours, 0))} h prévues`, col: 'col-sm-6 col-xl-3' }) +
                statCard({ label: 'Étudiants suivis', value: formatNumber(students), icon: 'bi-people-fill', hint: 'Toutes classes confondues', col: 'col-sm-6 col-xl-3' }) +
                statCard({ label: 'Notes à saisir', value: formatNumber(toEnter), icon: 'bi-pencil', hint: toEnter ? 'Contrôle continu et examen manquants' : 'Toutes les notes sont saisies', col: 'col-sm-6 col-xl-3' }) +
                statCard({ label: 'Notes à valider', value: formatNumber(drafts), icon: 'bi-patch-check', hint: drafts ? 'Saisies mais pas encore validées' : 'Aucun brouillon en attente', col: 'col-sm-6 col-xl-3' }));

            $('table-body').innerHTML = rows.map((r) => {
                const pending = r.entered - r.validated;
                const tone = r.validated === r.expected ? 'success' : r.entered === 0 ? 'failed' : 'pending';
                return `
                <tr>
                  <td><div class="table-product-name">${esc(r.subject.name)}</div><div class="table-user-sub">${esc(r.subject.code)} · coef. ${esc(r.subject.coefficient)} · ${esc(r.subject.semester)}</div></td>
                  <td>${esc(r.className)}<div class="table-user-sub">${formatNumber(r.students)} étudiants</div></td>
                  <td class="table-amount">${formatNumber(r.hoursDone)} h<div class="table-user-sub">sur ${formatNumber(r.subject.plannedHours)} h prévues</div></td>
                  <td><span class="badge-table ${tone}">${formatNumber(r.validated)} / ${formatNumber(r.expected)} validées</span>${pending ? `<div class="table-user-sub">${formatNumber(pending)} en brouillon</div>` : ''}</td>
                  <td>${r.cc === null ? '—' : formatNumber(r.cc, 2)} / ${r.exam === null ? '—' : formatNumber(r.exam, 2)}</td>
                  <td class="text-center"><a class="btn-table-action" href="${esc(gradeUrl(r.subject.id))}"><i class="bi bi-pencil-square"></i> Saisir les notes</a></td>
                </tr>`;
            }).join('');
        }
    } catch (error) {
        console.error(error);
        $('table-body').innerHTML = `<tr><td colspan="6">${errorState()}</td></tr>`;
    }
}
