/*
 * Formulaire d'étudiant (création / modification) et suppression confirmée.
 * Utilisé par la liste et par la fiche : une seule définition des champs et des messages.
 */

import { ReferenceService, StudentService } from '../services/index.js';
import { confirmDialog, openFormModal, toast } from '../utils/dialogs.js';
import { esc, formatNumber } from '../utils/format.js';
import { inputField, selectField } from './fields.js';
import { showTemporaryPassword } from './temp-password.js';

/** @returns {Promise<object|null>} l'étudiant enregistré, ou null si annulé */
export async function openStudentForm(student = null) {
    const [classes, filieres] = await Promise.all([ReferenceService.classes(), ReferenceService.filieres()]);
    const current = student ? classes.find((c) => c.id === student.levelId) : null;
    const levelOptions = (filiereId) => classes.filter((c) => c.filiereId === filiereId).map((c) => ({ value: c.id, label: c.name + ' — ' + c.filiere.name }));

    const body = `
      <div class="row g-3">
        ${student ? `<div class="col-12"><span class="form-label-custom">Matricule</span> <span class="badge-table success">${esc(student.matricule)}</span> <span class="stat-hint ms-1">attribué automatiquement</span></div>` : ''}
        ${inputField({ label: 'Prénom', name: 'firstName', value: student?.firstName, required: true })}
        ${inputField({ label: 'Nom', name: 'lastName', value: student?.lastName, required: true })}
        ${inputField({ label: 'Date de naissance', name: 'birthDate', type: 'date', value: student?.birthDate, required: true, attrs: `max="${StudentService.latestBirthDate()}" min="1940-01-01"` })}
        ${inputField({ label: 'Lieu de naissance', name: 'birthPlace', value: student?.birthPlace, placeholder: 'Ville (figure sur le relevé de notes)', attrs: 'maxlength="60"' })}
        ${inputField({ label: 'Adresse e-mail', name: 'email', type: 'email', value: student?.email, required: true, placeholder: 'prenom.nom@etu.dept-info.demo' })}
        ${inputField({ label: 'Téléphone', name: 'phone', type: 'tel', value: student?.phone, placeholder: '+237 6XX XX XX XX' })}
        ${selectField({ label: 'Filière', id: 'f-filiere', value: current?.filiereId ?? '', required: true, options: filieres.map((f) => ({ value: f.id, label: f.name })) })}
        ${selectField({ label: 'Niveau', name: 'levelId', value: student?.levelId ?? '', required: true, options: current ? levelOptions(current.filiereId) : [], placeholder: 'Choisir d\'abord une filière' })}
      </div>
      <p class="stat-hint mt-3 mb-0">Un compte de connexion est créé avec l'adresse e-mail saisie (mot de passe temporaire, communiqué par e-mail et affiché une fois).</p>`;

    const saved = await openFormModal({
        title: student ? "Modifier l'étudiant" : 'Ajouter un étudiant',
        submitLabel: student ? 'Enregistrer' : 'Ajouter',
        size: 'modal-lg',
        body,
        onOpen(form) {
            // Les niveaux proposés dépendent de la filière choisie
            const filiere = form.querySelector('#f-filiere');
            const level = form.querySelector('[name="levelId"]');
            filiere.addEventListener('change', () => {
                const options = filiere.value ? levelOptions(filiere.value) : [];
                level.innerHTML = `<option value="">${filiere.value ? 'Choisir…' : "Choisir d'abord une filière"}</option>` +
                    options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
            });
        },
        async onSubmit(data) {
            const saved = student ? await StudentService.update(student.id, data) : await StudentService.create(data);
            toast(student ? `${saved.firstName} ${saved.lastName} a été mis à jour.` : `${saved.firstName} ${saved.lastName} a été ajouté (matricule ${saved.matricule}).`);
            return saved;
        },
    });
    // Compte créé : le mot de passe temporaire n'est montré qu'ici, une seule fois
    if (saved?.temporaryPassword) {
        await showTemporaryPassword({ name: `${saved.firstName} ${saved.lastName}`, email: saved.email, password: saved.temporaryPassword, emailSent: saved.emailSent });
    }
    return saved;
}

/** Demande confirmation puis supprime l'étudiant (et ses notes, bulletins, compte). Retourne true si supprimé. */
/** silent : ne pas afficher la notification de succès (la page appelante en programme une autre après redirection). */
export async function confirmDeleteStudent(student, { silent = false } = {}) {
    const impact = await StudentService.removalImpact(student.id);
    const details = [];
    if (impact.grades) details.push(`${formatNumber(impact.grades)} note${impact.grades > 1 ? 's' : ''} supprimée${impact.grades > 1 ? 's' : ''}`);
    if (impact.bulletins) details.push(`${formatNumber(impact.bulletins)} bulletin${impact.bulletins > 1 ? 's' : ''} supprimé${impact.bulletins > 1 ? 's' : ''}`);
    details.push('Son compte de connexion sera supprimé.', 'Cette action est définitive.');
    const confirmed = await confirmDialog({
        title: "Supprimer l'étudiant ?",
        message: `${student.firstName} ${student.lastName} (${student.matricule}) sera retiré de l'application.`,
        details, confirmLabel: 'Supprimer', danger: true,
    });
    if (!confirmed) return false;
    try {
        await StudentService.remove(student.id);
        if (!silent) toast(`${student.firstName} ${student.lastName} a été supprimé.`);
        return true;
    } catch (error) {
        toast(error.message, { type: 'danger' });
        return false;
    }
}
