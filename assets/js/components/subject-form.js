/*
 * Formulaire de matière (création / modification / attribution à un enseignant) et suppression.
 * La classe et le semestre sont figés dès que des notes ou des séances existent (voir SubjectService.update).
 */

import { ReferenceService, SEMESTERS, SubjectService, TeacherService } from '../services/index.js';
import { config } from '../config.js';
import { confirmDialog, infoDialog, openFormModal, toast } from '../utils/dialogs.js';
import { esc, formatNumber, fullName } from '../utils/format.js';
import { inputField, selectField } from './fields.js';

/** @returns {Promise<object|null>} la matière enregistrée, ou null si annulé */
export async function openSubjectForm(subject = null) {
    const [classes, filieres, teachers, units, usage] = await Promise.all([
        ReferenceService.classes(), ReferenceService.filieres(), TeacherService.list(), ReferenceService.units(),
        subject ? SubjectService.usage(subject.id) : { grades: 0, sessions: 0 },
    ]);
    const locked = Boolean(subject) && (usage.grades > 0 || usage.sessions > 0);
    const current = subject ? classes.find((c) => c.id === subject.levelId) : null;
    const levelOptions = (filiereId) => classes.filter((c) => c.filiereId === filiereId).map((c) => ({ value: c.id, label: `${c.name} — ${c.filiere.name}` }));
    const unitOptions = (levelId, semester) => units.filter((u) => u.levelId === levelId && u.semester === semester).map((u) => ({ value: u.id, label: `${u.code} — ${u.name} (${u.type})` }));
    const lockHint = locked ? 'Verrouillé : des notes ou des séances existent.' : '';

    const body = `
      <div class="row g-3">
        ${inputField({ label: 'Code', name: 'code', value: subject?.code, required: true, col: 'col-md-4', placeholder: 'INF201', attrs: 'maxlength="10" autocapitalize="characters"' })}
        ${inputField({ label: 'Intitulé', name: 'name', value: subject?.name, required: true, col: 'col-md-8', placeholder: 'Algorithmique avancée' })}
        ${selectField({ label: 'Filière', id: 'f-filiere', value: current?.filiereId ?? '', required: true, disabled: locked, hint: lockHint, options: filieres.map((f) => ({ value: f.id, label: f.name })) })}
        ${selectField({ label: 'Niveau', name: locked ? undefined : 'levelId', id: 'f-level', value: subject?.levelId ?? '', required: true, disabled: locked, options: current ? levelOptions(current.filiereId) : [], placeholder: "Choisir d'abord une filière" })}
        ${locked ? `<input type="hidden" name="levelId" value="${esc(subject.levelId)}"><input type="hidden" name="semester" value="${esc(subject.semester)}">` : ''}
        ${selectField({ label: 'Semestre', name: locked ? undefined : 'semester', id: 'f-semester', value: subject?.semester ?? config.CURRENT_SEMESTER, required: true, col: 'col-md-4', disabled: locked, options: SEMESTERS.map((s) => ({ value: s, label: s })), placeholder: 'Choisir…' })}
        ${inputField({ label: 'Coefficient', name: 'coefficient', type: 'number', value: subject?.coefficient ?? '', required: true, col: 'col-md-4', attrs: 'min="0.1" max="10" step="0.1" inputmode="decimal"' })}
        ${inputField({ label: 'Heures prévues', name: 'plannedHours', type: 'number', value: subject?.plannedHours ?? '', required: true, col: 'col-md-4', attrs: 'min="1" max="200" step="1" inputmode="numeric"' })}
        ${selectField({ label: "Unité d'enseignement (UE)", name: 'unitId', id: 'f-unit', value: subject?.unitId ?? '', placeholder: 'Sans unité', options: subject ? unitOptions(subject.levelId, subject.semester) : [] })}
        ${selectField({ label: 'Enseignant', name: 'teacherId', value: subject?.teacherId ?? '', col: 'col-md-6', placeholder: 'À attribuer plus tard', options: [...teachers].sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr')).map((t) => ({ value: t.id, label: `${fullName(t)} — ${t.grade}` })) })}
      </div>
      <p class="stat-hint mt-3 mb-0">L'enseignant attribué saisit et valide les notes de cette matière. Le coefficient pèse dans la moyenne générale.</p>`;

    return openFormModal({
        title: subject ? 'Modifier la matière' : 'Créer une matière',
        submitLabel: subject ? 'Enregistrer' : 'Créer',
        size: 'modal-lg',
        body,
        onOpen(form) {
            const filiere = form.querySelector('#f-filiere');
            const level = form.querySelector('#f-level');
            const semester = form.querySelector('#f-semester');
            const unit = form.querySelector('#f-unit');
            // Les UE proposées dépendent de la classe et du semestre ; la sélection est conservée si elle reste valable
            const refreshUnits = () => {
                const options = unitOptions(level.value, semester.value);
                const keep = options.some((o) => o.value === unit.value) ? unit.value : '';
                unit.innerHTML = `<option value="">${options.length ? 'Sans unité' : 'Aucune unité pour cette classe'}</option>` +
                    options.map((o) => `<option value="${esc(o.value)}"${o.value === keep ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
            };
            filiere.addEventListener('change', () => {
                const options = filiere.value ? levelOptions(filiere.value) : [];
                level.innerHTML = `<option value="">${filiere.value ? 'Choisir…' : "Choisir d'abord une filière"}</option>` +
                    options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
                refreshUnits();
            });
            level.addEventListener('change', refreshUnits);
            semester.addEventListener('change', refreshUnits);
        },
        async onSubmit(data) {
            const saved = subject ? await SubjectService.update(subject.id, data) : await SubjectService.create(data);
            toast(subject ? `La matière ${saved.code} a été mise à jour.` : `La matière ${saved.code} a été créée.`);
            return saved;
        },
    });
}

/** Supprime la matière après confirmation, ou explique pourquoi c'est impossible. Retourne true si supprimée. */
export async function confirmDeleteSubject(subject) {
    const usage = await SubjectService.usage(subject.id);
    if (usage.grades || usage.sessions) {
        await infoDialog({
            title: 'Suppression impossible',
            message: `La matière ${subject.code} — ${subject.name} ne peut pas être supprimée.`,
            details: [
                ...(usage.grades ? [`${formatNumber(usage.grades)} note${usage.grades > 1 ? 's' : ''} enregistrée${usage.grades > 1 ? 's' : ''}`] : []),
                ...(usage.sessions ? [`${formatNumber(usage.sessions)} séance${usage.sessions > 1 ? 's' : ''} enregistrée${usage.sessions > 1 ? 's' : ''} (heures et présences)`] : []),
                "Ces données doivent être conservées. Vous pouvez en revanche changer l'enseignant attribué.",
            ],
        });
        return false;
    }
    if (!await confirmDialog({
        title: 'Supprimer la matière ?', message: `${subject.code} — ${subject.name} sera supprimée.`,
        details: ['Cette action est définitive.'], confirmLabel: 'Supprimer', danger: true,
    })) return false;
    try {
        await SubjectService.remove(subject.id);
        toast(`La matière ${subject.code} a été supprimée.`);
        return true;
    } catch (error) {
        toast(error.message, { type: 'danger' });
        return false;
    }
}
