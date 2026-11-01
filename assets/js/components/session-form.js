/*
 * Formulaire de séance, partagé par :
 *  - l'enseignant qui DÉCLARE une séance (formulaire dans la page « Déclarer une séance »),
 *  - le chef qui ENREGISTRE une absence (modale),
 *  - le chef ou l'enseignant qui CORRIGE une séance (modale).
 * Les contrôles (futur, chevauchements, droits…) sont ceux de SessionService : le formulaire n'affiche que ses messages.
 */

import { config } from '../config.js';
import { ReferenceService, SESSION_STATUS, SessionService, SubjectService, TeacherService } from '../services/index.js';
import { confirmDialog, openFormModal, toast } from '../utils/dialogs.js';
import { esc, formatDate, formatHours, fullName, todayISO } from '../utils/format.js';
import { inputField, selectField } from './fields.js';

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Données nécessaires aux listes : matières (avec classe) et enseignants. Pour un enseignant : ses matières seulement. */
export async function loadSessionFormData(actor) {
    const [allSubjects, classes, teachers] = await Promise.all([SubjectService.list(), ReferenceService.classes(), TeacherService.list()]);
    const classById = new Map(classes.map((c) => [c.id, c]));
    const subjects = allSubjects
        .filter((s) => s.teacherId && (actor.role !== 'enseignant' || s.teacherId === actor.profileId))
        .map((s) => ({ ...s, cls: classById.get(s.levelId) }))
        .sort((a, b) => a.code.localeCompare(b.code));
    return { subjects, teachers: teachers.filter((t) => subjects.some((s) => s.teacherId === t.id)) };
}

const subjectOptions = (subjects) => subjects.map((s) => ({ value: s.id, label: `${s.code} — ${s.name} (${s.cls.short})` }));

/**
 * HTML des champs.
 * mode : 'declare' (enseignant), 'absence' (chef), 'edit' (chef ou enseignant).
 */
export function sessionFields({ mode, actor, data, session = null }) {
    const isChef = actor.role === 'chef';
    const teacherId = session?.teacherId ?? '';
    // Chef : les matières n'apparaissent qu'une fois l'enseignant choisi ; enseignant : ses propres matières
    const own = isChef ? data.subjects.filter((s) => teacherId && s.teacherId === teacherId) : data.subjects;
    const noteLabel = mode === 'absence' || session?.status === 'absent' ? "Motif de l'absence" : 'Observation (facultatif)';
    return `
      <div class="row g-3">
        ${isChef ? selectField({ label: 'Enseignant', id: 'f-teacher', value: teacherId, required: true, options: data.teachers.map((t) => ({ value: t.id, label: fullName(t) })), placeholder: 'Choisir un enseignant' }) : ''}
        ${selectField({ label: 'Matière', name: 'subjectId', id: 'f-subject', value: session?.subjectId ?? (isChef ? '' : (data.subjects.length === 1 ? data.subjects[0].id : '')), required: true, col: isChef ? 'col-md-6' : 'col-12', options: subjectOptions(own), placeholder: isChef && !teacherId ? "Choisir d'abord un enseignant" : 'Choisir une matière' })}
        ${inputField({ label: 'Date', name: 'date', type: 'date', value: session?.date ?? todayISO(), required: true, col: 'col-md-4', attrs: `min="${config.SEMESTER_START}" max="${todayISO()}"` })}
        ${inputField({ label: 'Début', name: 'startTime', type: 'time', value: session?.startTime ?? '', required: true, col: 'col-6 col-md-4' })}
        ${inputField({ label: 'Fin', name: 'endTime', type: 'time', value: session?.endTime ?? '', required: true, col: 'col-6 col-md-4' })}
        ${mode === 'edit' && isChef ? selectField({ label: 'Statut', name: 'status', value: session.status, required: true, col: 'col-md-4', options: Object.entries(SESSION_STATUS).map(([value, label]) => ({ value, label })) }) : ''}
        ${inputField({ label: noteLabel, name: 'note', value: session?.note ?? '', col: mode === 'edit' && isChef ? 'col-md-8' : 'col-12', placeholder: mode === 'absence' ? 'Ex. maladie, mission, non communiqué…' : '', attrs: 'maxlength="200"' })}
        <div class="col-12"><p class="stat-hint mb-0" data-duration aria-live="polite"></p></div>
      </div>`;
}

/** Branche les listes dépendantes (enseignant → matières) et l'aperçu de la durée. */
export function wireSessionForm(form, { actor, data }) {
    const teacher = form.querySelector('#f-teacher');
    const subject = form.querySelector('#f-subject');
    if (teacher && actor.role === 'chef') {
        teacher.addEventListener('change', () => {
            const options = subjectOptions(data.subjects.filter((s) => s.teacherId === teacher.value));
            subject.innerHTML = `<option value="">${teacher.value ? 'Choisir une matière' : "Choisir d'abord un enseignant"}</option>` +
                options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
            if (options.length === 1) subject.value = options[0].value;
        });
    }
    const start = form.querySelector('[name="startTime"]');
    const end = form.querySelector('[name="endTime"]');
    const hint = form.querySelector('[data-duration]');
    const update = () => {
        if (!start.value || !end.value) { hint.textContent = ''; return; }
        const h = (minutes(end.value) - minutes(start.value)) / 60;
        hint.textContent = h > 0 ? `Durée : ${formatHours(h)}` : '';
    };
    start.addEventListener('input', update);
    end.addEventListener('input', update);
    update();
}

/** Modale : enregistrer une absence (chef) ou corriger une séance. Retourne la séance enregistrée, ou null. */
export async function openSessionForm({ mode, session = null, actor }) {
    const data = await loadSessionFormData(actor);
    return openFormModal({
        title: mode === 'absence' ? 'Enregistrer une absence' : 'Corriger la séance',
        submitLabel: mode === 'absence' ? "Enregistrer l'absence" : 'Enregistrer',
        size: 'modal-lg',
        body: `${sessionFields({ mode, actor, data, session })}
               ${mode === 'absence' ? "<p class=\"stat-hint mt-3 mb-0\">L'absence est comptée dans la présence de l'enseignant ; ses heures réalisées ne sont pas augmentées.</p>" : ''}`,
        onOpen: (form) => wireSessionForm(form, { actor, data }),
        async onSubmit(values) {
            const saved = mode === 'absence'
                ? await SessionService.recordAbsence(values, actor)
                : await SessionService.update(session.id, values, actor);
            toast(mode === 'absence' ? `Absence enregistrée le ${formatDate(saved.date)}.` : 'Séance mise à jour.');
            return saved;
        },
    });
}

/** Demande confirmation puis retire la séance. Retourne true si retirée. */
export async function confirmDeleteSession(session, actor, label = '') {
    const confirmed = await confirmDialog({
        title: 'Retirer cette séance ?',
        message: `${label || 'La séance'} du ${formatDate(session.date)} (${session.startTime}-${session.endTime}) sera retirée.`,
        details: session.status === 'present'
            ? [`${formatHours((minutes(session.endTime) - minutes(session.startTime)) / 60)} seront retirées des heures réalisées.`]
            : ["L'absence ne sera plus comptée."],
        confirmLabel: 'Retirer', danger: true,
    });
    if (!confirmed) return false;
    try {
        await SessionService.remove(session.id, actor);
        toast('Séance retirée.');
        return true;
    } catch (error) {
        toast(error.message, { type: 'danger' });
        return false;
    }
}
