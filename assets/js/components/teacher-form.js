/*
 * Formulaire d'enseignant (création / modification) et suppression.
 * La suppression est refusée tant que l'enseignant a des matières ou un historique de séances.
 */

import { TEACHER_GRADES, TeacherService } from '../services/index.js';
import { confirmDialog, infoDialog, openFormModal, toast } from '../utils/dialogs.js';
import { inputField, selectField } from './fields.js';

/** @returns {Promise<object|null>} l'enseignant enregistré, ou null si annulé */
export function openTeacherForm(teacher = null) {
    const body = `
      <div class="row g-3">
        ${inputField({ label: 'Prénom', name: 'firstName', value: teacher?.firstName, required: true })}
        ${inputField({ label: 'Nom', name: 'lastName', value: teacher?.lastName, required: true })}
        ${selectField({ label: 'Grade', name: 'grade', value: teacher?.grade ?? '', required: true, options: TEACHER_GRADES.map((g) => ({ value: g, label: g })) })}
        ${inputField({ label: 'Volume horaire dû (h / semestre)', name: 'contractHours', type: 'number', value: teacher?.contractHours ?? '', required: true, attrs: 'min="0" max="500" step="1" inputmode="numeric"' })}
        ${inputField({ label: 'Adresse e-mail', name: 'email', type: 'email', value: teacher?.email, required: true, placeholder: 'prenom.nom@dept-info.demo' })}
        ${inputField({ label: 'Téléphone', name: 'phone', type: 'tel', value: teacher?.phone, placeholder: '+237 6XX XX XX XX' })}
      </div>
      <p class="stat-hint mt-3 mb-0">Le volume horaire dû sert de référence au calcul des heures supplémentaires. Un compte de connexion est créé avec l'adresse e-mail saisie.</p>`;

    return openFormModal({
        title: teacher ? "Modifier l'enseignant" : 'Ajouter un enseignant',
        submitLabel: teacher ? 'Enregistrer' : 'Ajouter',
        size: 'modal-lg',
        body,
        async onSubmit(data) {
            const saved = teacher ? await TeacherService.update(teacher.id, data) : await TeacherService.create(data);
            toast(teacher ? `${saved.firstName} ${saved.lastName} a été mis à jour.` : `${saved.firstName} ${saved.lastName} a été ajouté.`);
            return saved;
        },
    });
}

/** Supprime l'enseignant après confirmation, ou explique pourquoi c'est impossible. Retourne true si supprimé. */
export async function confirmDeleteTeacher(teacher, { silent = false } = {}) {
    const usage = await TeacherService.usage(teacher.id);
    if (usage.subjects.length || usage.sessions) {
        await infoDialog({
            title: 'Suppression impossible',
            message: `${teacher.firstName} ${teacher.lastName} ne peut pas être supprimé tant que des données lui sont rattachées.`,
            details: [
                ...(usage.subjects.length ? [`Matières attribuées : ${usage.subjects.map((s) => s.code).join(', ')}`] : []),
                ...(usage.sessions ? [`${usage.sessions} séance${usage.sessions > 1 ? 's' : ''} enregistrée${usage.sessions > 1 ? 's' : ''} (historique des heures et présences)`] : []),
                'Réattribuez ses matières à un autre enseignant avant de supprimer son profil.',
            ],
        });
        return false;
    }
    const confirmed = await confirmDialog({
        title: "Supprimer l'enseignant ?",
        message: `${teacher.firstName} ${teacher.lastName} sera retiré de l'application, ainsi que son compte de connexion.`,
        details: ['Cette action est définitive.'], confirmLabel: 'Supprimer', danger: true,
    });
    if (!confirmed) return false;
    try {
        await TeacherService.remove(teacher.id);
        if (!silent) toast(`${teacher.firstName} ${teacher.lastName} a été supprimé.`);
        return true;
    } catch (error) {
        toast(error.message, { type: 'danger' });
        return false;
    }
}
