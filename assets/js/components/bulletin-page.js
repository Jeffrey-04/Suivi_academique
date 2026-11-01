/*
 * Page d'un bulletin, commune au chef (?student=…) et à l'étudiant (le sien).
 * Affiche la feuille du bulletin, ou l'état du relevé tant qu'il n'est pas généré ; télécharge le PDF ; imprime.
 * Page attendue : #page-title, #page-subtitle, #page-actions (#btn-print, #btn-pdf, #btn-generate facultatif),
 * #banner, #content.
 */

import { config, url } from '../config.js';
import { BulletinService } from '../services/index.js';
import { downloadBulletinPdf } from '../utils/bulletin-pdf.js';
import { toast } from '../utils/dialogs.js';
import { esc, formatDate, fullName } from '../utils/format.js';
import { emptyState, errorState } from '../utils/ui.js';
import { mountBulletinSheet } from './bulletin-view.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{ studentId: string|null, mode: 'chef'|'etudiant', actor: object, listUrl?: string }} options
 */
export async function initBulletinPage({ studentId, mode, actor, listUrl }) {
    const isChef = mode === 'chef';
    let detail = null;
    let stopFit = null;

    const setBusy = (button, busy) => {
        button.disabled = busy;
        const icon = button.querySelector('i');
        if (busy) { button.dataset.icon = icon.className; icon.className = 'spinner-border spinner-border-sm'; }
        else if (button.dataset.icon) icon.className = button.dataset.icon;
    };

    function missingList() {
        return `<ul class="app-modal-details">${detail.missing.map((m) => `<li><strong>${esc(m.code)}</strong> · ${esc(m.name)}</li>`).join('')}</ul>`;
    }

    function renderState() {
        $('page-actions').hidden = true;
        $('banner').innerHTML = '';
        const gradesUrl = `${url('pages/chef/notes.html')}`;
        let body;
        if (detail.status === 'ready') {
            body = isChef
                ? `${emptyState('Le relevé est complet : toutes les moyennes sont calculées. Le bulletin peut être généré ; il deviendra alors visible par l\'étudiant.', 'bi-file-earmark-plus')}
                   <div class="text-center pb-2"><button type="button" class="btn-custom btn-custom-primary" id="btn-generate-inline"><i class="bi bi-file-earmark-plus"></i> Générer le bulletin</button></div>`
                : emptyState('Votre relevé est complet. Le département publiera votre bulletin prochainement : il apparaîtra ici dès sa génération.', 'bi-hourglass-split');
        } else {
            body = isChef
                ? `${emptyState('Relevé incomplet : le bulletin ne peut pas être généré tant que toutes les matières n\'ont pas de moyenne.', 'bi-hourglass-split')}
                   <div class="px-4 pb-3"><span class="form-label-custom">Matières sans moyenne</span>${missingList()}</div>
                   <div class="text-center pb-2"><a class="btn-custom btn-custom-light" href="${esc(gradesUrl)}?subject=${esc(detail.report.lines.find((l) => l.average === null)?.subjectId ?? '')}"><i class="bi bi-eye"></i> Consulter les notes</a></div>`
                : `${emptyState('Votre bulletin n\'est pas encore disponible : certaines matières n\'ont pas encore de note validée.', 'bi-hourglass-split')}
                   <div class="px-4 pb-3"><span class="form-label-custom">Matières concernées</span>${missingList()}</div>`;
        }
        $('content').innerHTML = `<div class="card">${body}</div>`;
        $('btn-generate-inline')?.addEventListener('click', generate);
    }

    function renderDocument() {
        const doc = detail.document;
        $('page-actions').hidden = false;
        if ($('btn-generate')) {
            $('btn-generate').hidden = !(isChef && detail.status === 'outdated');
        }
        $('banner').innerHTML = isChef && detail.status === 'outdated'
            ? `<div class="info-banner is-warning"><i class="bi bi-exclamation-triangle"></i> Des notes ont changé depuis la génération du ${esc(formatDate(doc.generatedAt))} : ce bulletin n'est plus à jour. Régénérez-le pour publier la nouvelle version.</div>`
            : '';
        stopFit?.();
        stopFit = mountBulletinSheet($('content'), doc);
    }

    async function load() {
        $('content').innerHTML = '<div class="empty-state" aria-busy="true"><div class="spinner-border spinner-border-sm" role="status"></div><p>Chargement…</p></div>';
        try {
            detail = studentId ? await BulletinService.detail(studentId) : null;
            if (!detail) {
                $('page-title').textContent = 'Étudiant introuvable';
                $('page-subtitle').textContent = '';
                $('page-actions').hidden = true;
                $('content').innerHTML = `<div class="card">${emptyState("Cet étudiant n'existe pas ou a été supprimé.", 'bi-person-x')}<div class="text-center"><a class="btn-custom btn-custom-primary" href="${esc(listUrl)}">Retour aux bulletins</a></div></div>`;
                return;
            }
            const name = fullName(detail.student);
            document.title = `${isChef ? `Bulletin de ${name}` : 'Mon bulletin'} - Suivi Académique`;
            $('page-title').textContent = isChef ? `Bulletin de ${name}` : 'Mon bulletin';
            $('page-subtitle').textContent = `${detail.cls.label} · semestre ${config.CURRENT_SEMESTER} ${config.ACADEMIC_YEAR}`;
            if (detail.document) renderDocument(); else renderState();
        } catch (error) {
            console.error(error);
            $('content').innerHTML = errorState();
        }
    }

    async function generate() {
        const button = $('btn-generate-inline') ?? $('btn-generate');
        button.disabled = true;
        try {
            await BulletinService.generate({ studentIds: [studentId] }, actor);
            toast(`Bulletin de ${fullName(detail.student)} ${detail.document ? 'régénéré' : 'généré'}.`);
            await load();
        } catch (error) {
            toast(error.message, { type: 'danger' });
            button.disabled = false;
        }
    }

    $('btn-print')?.addEventListener('click', () => window.print());
    $('btn-generate')?.addEventListener('click', generate);
    $('btn-pdf').addEventListener('click', async () => {
        setBusy($('btn-pdf'), true);
        try {
            const name = await downloadBulletinPdf([detail.document]);
            toast(`${name} téléchargé.`);
        } catch (error) {
            console.error(error);
            toast('La génération du PDF a échoué. Réessayez.', { type: 'danger' });
        } finally {
            setBusy($('btn-pdf'), false);
        }
    });

    await load();
}
