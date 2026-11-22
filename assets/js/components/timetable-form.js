/*
 * Emploi du temps : formulaire de créneau (création / modification) et suppression, pour le chef de département.
 * Les contrôles (conflits d'enseignant, de classe, de salle, période…) sont ceux de TimetableService : le formulaire
 * n'affiche que ses messages sous les champs concernés.
 */

import { config } from '../config.js';
import { ReferenceService, SubjectService, TeacherService, TimetableService, WEEKDAYS, academicYearBounds } from '../services/index.js';
import { confirmDialog, openFormModal, toast } from '../utils/dialogs.js';
import { addDays, esc, formatDate, fullName } from '../utils/format.js';
import { inputField, selectField } from './fields.js';

/** Matières ayant un enseignant (avec leur classe) et enseignants concernés. */
export async function loadSlotFormData() {
    const [allSubjects, classes, teachers] = await Promise.all([SubjectService.list(), ReferenceService.classes(), TeacherService.list()]);
    const classById = new Map(classes.map((c) => [c.id, c]));
    const subjects = allSubjects
        .filter((s) => s.teacherId)
        .map((s) => ({ ...s, cls: classById.get(s.levelId) }))
        .sort((a, b) => a.code.localeCompare(b.code));
    return { subjects, teachers: teachers.filter((t) => subjects.some((s) => s.teacherId === t.id)) };
}

const subjectOptions = (subjects) => subjects.map((s) => ({ value: s.id, label: `${s.code} — ${s.name} (${s.cls?.short ?? ''})` }));

/** Période proposée à la création : du début du semestre sur 16 semaines, dans l'année universitaire. */
function defaultPeriod() {
    const bounds = academicYearBounds();
    const from = config.SEMESTER_START >= bounds.from && config.SEMESTER_START <= bounds.to ? config.SEMESTER_START : bounds.from;
    const until = addDays(from, 16 * 7 - 3);
    return { validFrom: from, validUntil: until > bounds.to ? bounds.to : until };
}

function slotFields({ data, slot, defaults }) {
    const initial = slot ?? { ...defaultPeriod(), ...defaults };
    const bounds = academicYearBounds();
    const range = `min="${bounds.from}" max="${bounds.to}"`;
    const teacherId = initial.teacherId ?? '';
    const own = data.subjects.filter((s) => teacherId && s.teacherId === teacherId);
    return `
      <div class="row g-3">
        ${selectField({ label: 'Enseignant', id: 'f-teacher', value: teacherId, required: true, options: data.teachers.map((t) => ({ value: t.id, label: fullName(t) })), placeholder: 'Choisir un enseignant' })}
        ${selectField({ label: 'Matière', name: 'subjectId', id: 'f-subject', value: initial.subjectId ?? '', required: true, col: 'col-md-6', options: subjectOptions(own), placeholder: teacherId ? 'Choisir une matière' : "Choisir d'abord un enseignant" })}
        ${selectField({ label: 'Jour', name: 'weekday', value: initial.weekday ? String(initial.weekday) : '', required: true, col: 'col-md-4', placeholder: 'Choisir un jour', options: Object.entries(WEEKDAYS).map(([value, label]) => ({ value, label })) })}
        ${inputField({ label: 'Début', name: 'startTime', type: 'time', value: initial.startTime ?? '', required: true, col: 'col-6 col-md-4' })}
        ${inputField({ label: 'Fin', name: 'endTime', type: 'time', value: initial.endTime ?? '', required: true, col: 'col-6 col-md-4' })}
        ${inputField({ label: 'Salle (facultatif)', name: 'room', value: initial.room ?? '', col: 'col-md-6', attrs: 'maxlength="40"', placeholder: 'Ex. Amphi A, Salle 101' })}
        <div class="col-md-6"></div>
        ${inputField({ label: 'Du', name: 'validFrom', type: 'date', value: initial.validFrom ?? '', required: true, col: 'col-md-6', attrs: range })}
        ${inputField({ label: 'Au', name: 'validUntil', type: 'date', value: initial.validUntil ?? '', required: true, col: 'col-md-6', attrs: range })}
        <div class="col-12"><p class="stat-hint mb-0">Le créneau se répète chaque semaine, ce jour-là, entre ces deux dates. Un enseignant, une classe ou une salle ne peuvent pas avoir deux créneaux en même temps.</p></div>
      </div>`;
}

/** Branche la liste dépendante enseignant → matières. */
function wireSlotForm(form, data) {
    const teacher = form.querySelector('#f-teacher');
    const subject = form.querySelector('#f-subject');
    teacher.addEventListener('change', () => {
        const options = subjectOptions(data.subjects.filter((s) => s.teacherId === teacher.value));
        subject.innerHTML = `<option value="">${teacher.value ? 'Choisir une matière' : "Choisir d'abord un enseignant"}</option>` +
            options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
        if (options.length === 1) subject.value = options[0].value;
    });
}

/**
 * Modale de création (slot = null) ou de modification d'un créneau. defaults : valeurs initiales d'une création.
 * Retourne le créneau enregistré, ou null si annulé.
 */
export async function openSlotForm({ slot = null, actor, defaults = {} }) {
    const data = await loadSlotFormData();
    return openFormModal({
        title: slot ? 'Modifier le créneau' : 'Nouveau créneau',
        submitLabel: slot ? 'Enregistrer' : 'Ajouter le créneau',
        size: 'modal-lg',
        body: slotFields({ data, slot, defaults }),
        onOpen: (form) => wireSlotForm(form, data),
        async onSubmit(values) {
            const saved = slot ? await TimetableService.updateSlot(slot.id, values, actor) : await TimetableService.createSlot(values, actor);
            toast(slot ? 'Créneau modifié.' : 'Créneau ajouté.');
            return saved;
        },
    });
}

/** Demande confirmation puis supprime le créneau (les séances déjà enregistrées sont conservées). Retourne true si supprimé. */
export async function confirmDeleteSlot(slot, label, actor) {
    const confirmed = await confirmDialog({
        title: 'Supprimer ce créneau ?',
        message: `${label} (${WEEKDAYS[slot.weekday]?.toLowerCase()} ${slot.startTime}-${slot.endTime}, du ${formatDate(slot.validFrom)} au ${formatDate(slot.validUntil)}) sera retiré de l'emploi du temps.`,
        details: ['Les séances déjà enregistrées sont conservées.', 'Les dates annulées de ce créneau sont oubliées.'],
        confirmLabel: 'Supprimer', danger: true,
    });
    if (!confirmed) return false;
    try {
        await TimetableService.removeSlot(slot.id, actor);
        toast('Créneau supprimé.');
        return true;
    } catch (error) {
        toast(error.message, { type: 'danger' });
        return false;
    }
}
