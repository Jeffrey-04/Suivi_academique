/*
 * Événements du calendrier : formulaire (création / modification, chef), fiche détaillée et suppression.
 * Les contrôles sont ceux de EventService : le formulaire n'affiche que ses messages.
 */

import { EventService, academicYearBounds } from '../services/index.js';
import { EVENT_TYPES, eventType } from '../utils/event-types.js';
import { confirmDialog, openFormModal, openModal, toast } from '../utils/dialogs.js';
import { esc, formatDate, formatDateLong, formatDateRange, relativeDay } from '../utils/format.js';
import { TONE_BG } from '../utils/ui.js';
import { inputField, selectField, textareaField } from './fields.js';

function eventFields(event) {
    const bounds = academicYearBounds();
    const range = `min="${bounds.from}" max="${bounds.to}"`;
    return `
      <div class="row g-3">
        ${selectField({ label: "Type d'événement", name: 'type', value: event?.type ?? '', required: true, col: 'col-md-5', placeholder: 'Choisir un type', options: Object.entries(EVENT_TYPES).map(([value, t]) => ({ value, label: t.label })) })}
        ${inputField({ label: 'Titre', name: 'title', value: event?.title ?? '', required: true, col: 'col-md-7', attrs: 'maxlength="120"', placeholder: 'Ex. Contrôle continu — Algorithmique' })}
        ${inputField({ label: 'Date de début', name: 'start', type: 'date', value: event?.start ?? '', required: true, col: 'col-md-6', attrs: range })}
        ${inputField({ label: 'Date de fin (facultatif)', name: 'end', type: 'date', value: event?.end ?? '', col: 'col-md-6', attrs: range })}
        ${inputField({ label: 'Heure de début', name: 'startTime', type: 'time', value: event?.startTime ?? '', col: 'col-6 col-md-3' })}
        ${inputField({ label: 'Heure de fin', name: 'endTime', type: 'time', value: event?.endTime ?? '', col: 'col-6 col-md-3' })}
        ${inputField({ label: 'Lieu', name: 'location', value: event?.location ?? '', col: 'col-md-6', attrs: 'maxlength="80"', placeholder: 'Ex. Amphi A' })}
        <div class="col-12"><p class="stat-hint mb-0" data-times-hint></p></div>
        ${textareaField({ label: 'Description', name: 'description', value: event?.description ?? '', maxlength: 500 })}
        <div class="col-12"><p class="stat-hint mb-0">Un rappel automatique apparaît dans vos notifications 7 jours puis 1 jour avant le début (réglable dans votre profil).</p></div>
      </div>`;
}

/** Les horaires n'ont de sens que pour un événement d'un seul jour : on les grise dès qu'une date de fin est saisie. */
function wireTimes(form) {
    const start = form.querySelector('[name="start"]');
    const end = form.querySelector('[name="end"]');
    const times = ['startTime', 'endTime'].map((name) => form.querySelector(`[name="${name}"]`));
    const hint = form.querySelector('[data-times-hint]');
    const update = () => {
        const multiDay = Boolean(end.value) && end.value !== start.value;
        times.forEach((input) => { input.disabled = multiDay; });
        hint.textContent = multiDay ? "Événement sur plusieurs jours : pas d'horaires (journée entière)." : '';
        end.min = start.value || end.min;
    };
    start.addEventListener('input', update);
    end.addEventListener('input', update);
    update();
}

/**
 * Modale de création (event = null) ou de modification. defaults : valeurs initiales d'une création (ex. { start }).
 * Retourne l'événement enregistré, ou null si annulé.
 */
export async function openEventForm({ event = null, actor, defaults = {} }) {
    const saved = await openFormModal({
        title: event ? "Modifier l'événement" : 'Nouvel événement',
        size: 'modal-lg',
        body: eventFields(event ?? defaults),
        onOpen: wireTimes,
        async onSubmit(values) {
            const result = event ? await EventService.update(event.id, values, actor) : await EventService.create(values, actor);
            toast(event ? 'Événement modifié.' : 'Événement créé.');
            return result;
        },
    });
    return saved;
}

function detailRow(icon, content) {
    return `<div class="event-detail-row"><i class="bi ${icon}" aria-hidden="true"></i><div>${content}</div></div>`;
}

/** Fiche d'un événement dans une modale. Le chef peut la modifier ou la supprimer : retourne 'edit', 'delete' ou null. */
export function openEventDetail({ event, actor }) {
    const type = eventType(event.type);
    const when = event.end
        ? `Du ${formatDate(event.start)} au ${formatDate(event.end)}`
        : `${formatDateLong(event.start)}${event.startTime ? ` · ${event.startTime}${event.endTime ? ` – ${event.endTime}` : ''}` : ''}`;
    const body = `
      <span class="event-type-badge ${TONE_BG[type.tone]}"><i class="bi ${type.icon}" aria-hidden="true"></i> ${esc(type.label)}</span>
      <h3 class="event-detail-title">${esc(event.title)}</h3>
      ${detailRow('bi-calendar-event', `${esc(when)}<div class="stat-hint">${esc(relativeDay(event.start))}</div>`)}
      ${event.location ? detailRow('bi-geo-alt', esc(event.location)) : ''}
      ${event.description ? detailRow('bi-card-text', esc(event.description)) : ''}`;
    const buttons = actor?.role === 'chef'
        ? [{ id: 'edit', label: 'Modifier', className: 'btn-custom-primary' }, { id: 'delete', label: 'Supprimer', className: 'btn-custom-danger' }]
        : [];
    return openModal({ title: 'Détail de l\'événement', body, buttons });
}

/** Demande confirmation puis supprime l'événement. Retourne true s'il est supprimé. */
export async function confirmDeleteEvent(event, actor) {
    const notifications = await EventService.notificationCount(event.id);
    const confirmed = await confirmDialog({
        title: 'Supprimer cet événement ?',
        message: `« ${event.title} » (${formatDateRange(event.start, event.end)}) sera retiré du calendrier.`,
        details: notifications ? [`${notifications} notification${notifications > 1 ? 's' : ''} associée${notifications > 1 ? 's' : ''} ser${notifications > 1 ? 'ont' : 'a'} supprimée${notifications > 1 ? 's' : ''}.`] : [],
        confirmLabel: 'Supprimer', danger: true,
    });
    if (!confirmed) return false;
    try {
        await EventService.remove(event.id, actor);
        toast('Événement supprimé.');
        return true;
    } catch (error) {
        toast(error.message, { type: 'danger' });
        return false;
    }
}
