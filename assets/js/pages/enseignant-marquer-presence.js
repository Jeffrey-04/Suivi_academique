/*
 * Enseignant : « Marquer ma présence ». Une position précise et proche du campus est exigée (règles dans PresenceService).
 * En démonstration (mock), un sélecteur permet de SIMULER la position : l'appareil de test n'est pas sur le campus.
 */

import { config, INSTITUTION } from '../config.js';
import { initPage } from '../layout.js';
import { selectField } from '../components/fields.js';
import { PresenceService, SubjectService, ValidationError } from '../services/index.js';
import { bindInlineForm } from '../utils/dialogs.js';
import { esc, formatDate, todayISO } from '../utils/format.js';
import { GeoError, SIMULATIONS, formatDistance, locate, simulatedPosition } from '../utils/geo.js';
import { activityList, emptyState, errorState } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const ctx = await initPage({ role: 'enseignant', page: 'checkin' });

if (ctx) {
    const actor = { id: ctx.user.id, role: ctx.user.role, profileId: ctx.user.profileId };
    const campus = await PresenceService.institution();

    $('campus').innerHTML = `
      <div class="d-flex align-items-start gap-3">
        <i class="bi bi-geo-alt-fill campus-icon" aria-hidden="true"></i>
        <div><div class="fw-bold">${esc(campus.name)}</div><div class="stat-hint">Présence acceptée à moins de ${campus.radiusMeters} m, avec une précision de ±${config.CHECKIN_MAX_ACCURACY} m au plus.</div></div>
      </div>
      <p class="stat-hint mt-3 mb-0"><i class="bi bi-shield-lock" aria-hidden="true"></i> Votre position sert uniquement à cette vérification : seules la distance, l'heure et la date sont conservées, pas vos coordonnées. Elle n'est demandée qu'au moment où vous appuyez sur le bouton.</p>`;

    async function refreshRecent() {
        try {
            const recent = (await PresenceService.list({ teacherId: actor.profileId })).slice(0, 6);
            $('recent').innerHTML = activityList(recent.map((c) => ({
                icon: 'bi-geo-alt',
                title: c.subject?.name ?? '—',
                subtitle: `${c.date === todayISO() ? "Aujourd'hui" : formatDate(c.date)} · ${c.time}`,
                amount: formatDistance(c.distance),
                amountClass: 'text-success',
            })), 'Aucune présence marquée pour le moment.');
        } catch (error) {
            console.error(error);
            $('recent').innerHTML = errorState();
        }
    }

    try {
        const subjects = (await SubjectService.list({ teacherId: actor.profileId })).sort((a, b) => a.code.localeCompare(b.code));
        if (!subjects.length) {
            $('checkin-host').innerHTML = emptyState("Aucune matière ne vous est attribuée : vous ne pouvez pas marquer votre présence.", 'bi-book');
        } else {
            const simulation = config.DEMO ? `
              <div class="col-12">
                <div class="demo-note"><i class="bi bi-tools" aria-hidden="true"></i> <strong>Démonstration</strong> : cet appareil n'est pas sur le campus, choisissez la position à simuler.</div>
              </div>
              ${selectField({ label: 'Position simulée', name: 'simulation', col: 'col-12', value: 'inside', placeholder: 'Ma vraie position (appareil)', options: Object.entries(SIMULATIONS).map(([value, s]) => ({ value, label: s.label })) })}` : '';
            $('checkin-host').innerHTML = `
              <form novalidate id="checkin-form">
                <div class="row g-3">
                  ${selectField({ label: 'Matière', name: 'subjectId', col: 'col-12', required: true, value: subjects.length === 1 ? subjects[0].id : '', placeholder: 'Choisir la matière du cours', options: subjects.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })) })}
                  ${simulation}
                </div>
                <div class="alert alert-danger d-none mt-3 mb-0" role="alert" data-form-error></div>
                <button type="submit" class="btn-custom btn-custom-primary checkin-button mt-4"><i class="bi bi-geo-alt-fill"></i> Marquer ma présence</button>
              </form>`;

            bindInlineForm($('checkin-form'), {
                async onSubmit(values) {
                    $('checkin-result').innerHTML = '';
                    if (!values.subjectId) throw new ValidationError('Choisissez la matière concernée.', { subjectId: 'Choisissez la matière concernée.' });
                    let position;
                    try {
                        position = values.simulation ? simulatedPosition(values.simulation, INSTITUTION.location) : await locate();
                    } catch (error) {
                        throw error instanceof GeoError ? new ValidationError(error.message) : error;
                    }
                    return PresenceService.checkIn({ subjectId: values.subjectId, ...position }, actor);
                },
                async onDone(checkin) {
                    const subject = subjects.find((s) => s.id === checkin.subjectId);
                    $('checkin-result').innerHTML = `
                      <div class="checkin-success" role="status"><i class="bi bi-check-circle-fill" aria-hidden="true"></i>
                        <div><div class="fw-bold">Présence enregistrée à ${esc(checkin.time)}</div>
                        <div class="stat-hint">${esc(subject?.name ?? '')} · à ${esc(formatDistance(checkin.distance))} du campus (précision ±${checkin.accuracy} m). Pensez à déclarer la séance une fois terminée.</div></div>
                      </div>`;
                    await refreshRecent();
                },
            });
        }
    } catch (error) {
        console.error(error);
        $('checkin-host').innerHTML = errorState();
    }
    await refreshRecent();
}
