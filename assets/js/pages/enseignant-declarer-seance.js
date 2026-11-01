/*
 * Enseignant : déclaration d'une séance effectuée (analyse, module 3 : « déclaration des séances effectuées »).
 * Formulaire + bilan d'heures du semestre + dernières séances. Les contrôles sont ceux de SessionService.
 */

import { url } from '../config.js';
import { initPage } from '../layout.js';
import { loadSessionFormData, sessionFields, wireSessionForm } from '../components/session-form.js';
import { HoursService, SessionService } from '../services/index.js';
import { bindInlineForm, toast } from '../utils/dialogs.js';
import { formatDate, formatHours, formatNumber } from '../utils/format.js';
import { activityList, applyDynamicWidths, emptyState, errorState, progressList } from '../utils/ui.js';


const $ = (id) => document.getElementById(id);
const ctx = await initPage({ role: 'enseignant', page: 'declare' });

if (ctx) {
    const actor = { id: ctx.user.id, role: ctx.user.role, profileId: ctx.user.profileId };

    async function refreshSide() {
        const [hours, recent] = await Promise.all([HoursService.summary(actor.profileId), SessionService.detailed({ teacherId: actor.profileId })]);
        const pct = hours.contract ? (hours.done / hours.contract) * 100 : 0;
        $('balance').innerHTML = progressList([{
            label: `${formatNumber(hours.done)} h réalisées sur ${formatNumber(hours.contract)} h dues`,
            value: `${Math.round(pct)} %`, percent: pct, tone: hours.done >= hours.contract ? 'ok' : 'warn',
        }]) + `<p class="stat-hint mb-0">${hours.overtime ? `${formatNumber(hours.overtime)} h supplémentaires au-delà du volume dû.` : hours.missing ? `${formatNumber(hours.missing)} h prévues dans vos matières restent à effectuer ou à justifier.` : 'Toutes les heures prévues sont réalisées.'}</p>`;
        applyDynamicWidths($('balance'));
        $('recent').innerHTML = activityList(recent.slice(0, 5).map((s) => ({
            icon: s.status === 'present' ? 'bi-check-circle' : 'bi-person-x',
            title: s.subject.name,
            subtitle: `${formatDate(s.date)} · ${s.startTime}-${s.endTime}${s.status === 'absent' && s.note ? ` · ${s.note}` : ''}`,
            amount: `${s.status === 'present' ? '+' : '−'}${formatHours(s.hours)}`,
            amountClass: s.status === 'present' ? 'text-success' : 'text-danger',
        })), 'Aucune séance enregistrée.') + `<div class="text-center mt-3"><a href="${url('pages/enseignant/seances.html')}" class="btn-table-action">Voir tout l'historique</a></div>`;
    }

    try {
        const data = await loadSessionFormData(actor);
        if (!data.subjects.length) {
            $('form-host').innerHTML = emptyState("Aucune matière ne vous est attribuée : vous ne pouvez pas déclarer de séance. Le chef de département peut vous en attribuer.", 'bi-book');
        } else {
            $('form-host').innerHTML = `
              <form id="declare-form" novalidate>
                ${sessionFields({ mode: 'declare', actor, data })}
                <div class="alert alert-danger d-none mt-3 mb-0" role="alert" data-form-error></div>
                <div class="d-flex justify-content-end mt-4"><button type="submit" class="btn-custom btn-custom-primary"><i class="bi bi-check2-circle"></i> Déclarer la séance</button></div>
              </form>`;
            const form = $('declare-form');
            wireSessionForm(form, { actor, data });
            bindInlineForm(form, {
                onSubmit: (values) => SessionService.declare(values, actor),
                async onDone(saved) {
                    toast(`Séance du ${formatDate(saved.date)} déclarée (${saved.startTime}-${saved.endTime}).`);
                    form.querySelector('[name="startTime"]').value = '';
                    form.querySelector('[name="endTime"]').value = '';
                    form.querySelector('[name="note"]').value = '';
                    form.querySelector('[data-duration]').textContent = '';
                    form.querySelector('[name="startTime"]').focus();
                    await refreshSide();
                },
            });
        }
        await refreshSide();
    } catch (error) {
        console.error(error);
        $('form-host').innerHTML = errorState();
    }
}
