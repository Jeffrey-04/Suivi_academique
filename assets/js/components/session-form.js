/*
 * Formulaire de séance, utilisé par le chef de département (modale) pour :
 *  - DÉCLARER une séance effectuée par un enseignant ;
 *  - ENREGISTRER une absence ;
 *  - CORRIGER une séance (statut compris).
 * Les contrôles (futur, chevauchements…) sont ceux de SessionService : le formulaire n'affiche que ses messages.
 */

import { config } from '../config.js';
import { ReferenceService, SESSION_STATUS, SessionService, SubjectService, TeacherService } from '../services/index.js';
import { confirmDialog, openFormModal, toast } from '../utils/dialogs.js';
import { esc, formatDate, formatHours, fullName, todayISO } from '../utils/format.js';
import { inputField, selectField } from './fields.js';

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Données nécessaires aux listes : matières avec un enseignant (avec leur classe) et enseignants concernés. */
export async function loadSessionFormData() {
    const [allSubjects, classes, teachers] = await Promise.all([SubjectService.list(), ReferenceService.classes(), TeacherService.list()]);
    const classById = new Map(classes.map((c) => [c.id, c]));
    const subjects = allSubjects
        .filter((s) => s.teacherId)
        .map((s) => ({ ...s, cls: classById.get(s.levelId) }))
        .sort((a, b) => a.code.localeCompare(b.code));
    return { subjects, teachers: teachers.filter((t) => subjects.some((s) => s.teacherId === t.id)) };
}

const subjectOptions = (subjects) => subjects.map((s) => ({ value: s.id, label: `${s.code} — ${s.name} (${s.cls.short})` }));

/**
 * HTML des champs. mode : 'declare', 'absence' ou 'edit'.
 * `values` préremplit une création (ex. depuis l'emploi du temps : { teacherId, subjectId, date, startTime, endTime }).
 */
export function sessionFields({ mode, data, session = null, values = {} }) {
    const initial = session ?? values;
    const teacherId = initial.teacherId ?? '';
    // Les matières n'apparaissent qu'une fois l'enseignant choisi
    const own = data.subjects.filter((s) => teacherId && s.teacherId === teacherId);
    const noteLabel = mode === 'absence' || session?.status === 'absent' ? "Motif de l'absence" : 'Observation (facultatif)';
    const editing = mode === 'edit';
    return `
      <div class="row g-3">
        ${selectField({ label: 'Enseignant', id: 'f-teacher', value: teacherId, required: true, options: data.teachers.map((t) => ({ value: t.id, label: fullName(t) })), placeholder: 'Choisir un enseignant' })}
        ${selectField({ label: 'Matière', name: 'subjectId', id: 'f-subject', value: initial.subjectId ?? '', required: true, col: 'col-md-6', options: subjectOptions(own), placeholder: teacherId ? 'Choisir une matière' : "Choisir d'abord un enseignant" })}
        ${inputField({ label: 'Date', name: 'date', type: 'date', value: initial.date ?? todayISO(), required: true, col: 'col-md-4', attrs: `min="${config.SEMESTER_START}" max="${todayISO()}"` })}
        ${inputField({ label: 'Début', name: 'startTime', type: 'time', value: initial.startTime ?? '', required: true, col: 'col-6 col-md-4' })}
        ${inputField({ label: 'Fin', name: 'endTime', type: 'time', value: initial.endTime ?? '', required: true, col: 'col-6 col-md-4' })}
        ${editing ? selectField({ label: 'Statut', name: 'status', value: session.status, required: true, col: 'col-md-4', options: Object.entries(SESSION_STATUS).map(([value, label]) => ({ value, label })) }) : ''}
        ${inputField({ label: noteLabel, name: 'note', value: initial.note ?? '', col: editing ? 'col-md-8' : 'col-12', placeholder: mode === 'absence' ? 'Ex. maladie, mission, non communiqué…' : '', attrs: 'maxlength="200"' })}
        <div class="col-12"><p class="stat-hint mb-0" data-duration aria-live="polite"></p></div>
      </div>`;
}

/** Branche les listes dépendantes (enseignant → matières) et l'aperçu de la durée. */
export function wireSessionForm(form, { data }) {
    const teacher = form.querySelector('#f-teacher');
    const subject = form.querySelector('#f-subject');
    teacher.addEventListener('change', () => {
        const options = subjectOptions(data.subjects.filter((s) => s.teacherId === teacher.value));
        subject.innerHTML = `<option value="">${teacher.value ? 'Choisir une matière' : "Choisir d'abord un enseignant"}</option>` +
            options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
        if (options.length === 1) subject.value = options[0].value;
    });
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

const TITLES = { declare: 'Déclarer une séance', absence: 'Enregistrer une absence', edit: 'Corriger la séance' };
const SUBMIT = { declare: 'Enregistrer la séance', absence: "Enregistrer l'absence", edit: 'Enregistrer' };
const HINTS = {
    declare: "La séance est comptée dans les heures réalisées de l'enseignant.",
    absence: "L'absence est comptée dans la présence de l'enseignant ; ses heures réalisées ne sont pas augmentées.",
};

/** Modale : déclarer une séance, enregistrer une absence ou corriger une séance. Retourne la séance enregistrée, ou null. */
export async function openSessionForm({ mode, session = null, actor, values = {} }) {
    const data = await loadSessionFormData();
    return openFormModal({
        title: TITLES[mode],
        submitLabel: SUBMIT[mode],
        size: 'modal-lg',
        body: `${sessionFields({ mode, data, session, values })}
               ${HINTS[mode] ? `<p class="stat-hint mt-3 mb-0">${HINTS[mode]}</p>` : ''}`,
        onOpen: (form) => wireSessionForm(form, { data }),
        async onSubmit(formValues) {
            const saved = mode === 'declare' ? await SessionService.declare(formValues, actor)
                : mode === 'absence' ? await SessionService.recordAbsence(formValues, actor)
                    : await SessionService.update(session.id, formValues, actor);
            toast(mode === 'declare' ? `Séance du ${formatDate(saved.date)} enregistrée.`
                : mode === 'absence' ? `Absence enregistrée le ${formatDate(saved.date)}.` : 'Séance mise à jour.');
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
