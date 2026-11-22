/*
 * Page « Mon profil » du chef de département :
 *  - identité et photo ; coordonnées (e-mail) ; sécurité (mot de passe) ; réglages personnels.
 * AccountService contrôle que chacun ne modifie que son propre profil. Les formulaires sont dans la page :
 * bindInlineForm gère l'envoi et affiche les messages du service sous les champs.
 */

import { config, ROLES, url } from '../config.js';
import { AccountService, CALENDAR_VIEWS, DEFAULT_PHOTO, PASSWORD_MIN } from '../services/index.js';
import { bindInlineForm, queueToast, toast } from '../utils/dialogs.js';
import { esc, fullName } from '../utils/format.js';
import { renderInto } from '../utils/ui.js';
import { checkboxField, checkboxGroup, inputField, selectField } from './fields.js';

const $ = (id) => document.getElementById(id);
const PHOTO_SIZE = 256; // côté de l'image enregistrée (recadrée au carré)
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

const row = (label, value) => (value ? `<div class="profile-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '');

function formShell(id, title, hint, fields, submitLabel) {
    return `
      <div class="card mb-0" id="${id}">
        <div class="card-header mb-1"><h3 class="card-title">${esc(title)}</h3></div>
        <p class="stat-hint mb-3">${hint}</p>
        <form novalidate data-form="${id}">
          <div class="row g-3">${fields}</div>
          <div class="alert alert-danger d-none mt-3 mb-0" role="alert" data-form-error></div>
          <div class="d-flex justify-content-end mt-4"><button type="submit" class="btn-custom btn-custom-primary">${esc(submitLabel)}</button></div>
        </form>
      </div>`;
}

function render(profile) {
    const { user, settings } = profile;
    const isDefaultPhoto = user.photo === DEFAULT_PHOTO;
    const reminderOptions = config.REMINDER_DAYS.map((d) => ({ value: String(d), label: d === 1 ? '1 jour avant' : `${d} jours avant` }));

    const identity = `
      <div class="card mb-0">
        <div class="profile-head profile-head-lg">
          <img src="${esc(url(user.photo))}" alt="Photo de ${esc(fullName(user))}" class="profile-photo profile-photo-lg" id="profile-photo">
          <div>
            <div class="profile-name">${esc(fullName(user))}</div>
            <span class="badge-table success">${esc(ROLES[user.role].label)}</span>
          </div>
        </div>
        <div class="d-flex gap-2 flex-wrap mb-3">
          <button type="button" class="btn-table-action" id="btn-photo"><i class="bi bi-camera"></i> Changer la photo</button>
          ${isDefaultPhoto ? '' : '<button type="button" class="btn-table-action" id="btn-photo-remove"><i class="bi bi-trash"></i> Retirer</button>'}
          <input type="file" id="photo-input" accept="image/png,image/jpeg,image/webp" class="d-none" aria-label="Choisir une photo de profil">
        </div>
        <dl class="profile-list profile-list-stacked mb-0">${row('Adresse e-mail', user.email)}${row('Département', config.DEPARTMENT)}</dl>
      </div>`;

    const contact = formShell('contact', 'Coordonnées',
        "L'adresse e-mail sert d'identifiant de connexion.",
        `${inputField({ label: 'Adresse e-mail', name: 'email', type: 'email', value: user.email, required: true, col: 'col-12', attrs: 'autocomplete="email"' })}
         ${inputField({ label: 'Mot de passe actuel', name: 'currentPassword', id: 'contact-current-password', type: 'password', col: 'col-12', attrs: 'autocomplete="current-password"' })}
         <div class="col-12"><p class="stat-hint mb-0">Le mot de passe actuel n'est demandé que si vous changez l'adresse e-mail.</p></div>`,
        'Enregistrer les coordonnées');

    const security = formShell('securite', 'Sécurité',
        `Au moins ${PASSWORD_MIN} caractères, avec des lettres et des chiffres.`,
        `${inputField({ label: 'Mot de passe actuel', name: 'currentPassword', id: 'security-current-password', type: 'password', required: true, col: 'col-12', attrs: 'autocomplete="current-password"' })}
         ${inputField({ label: 'Nouveau mot de passe', name: 'newPassword', type: 'password', required: true, col: 'col-md-6', attrs: 'autocomplete="new-password"' })}
         ${inputField({ label: 'Confirmer le nouveau mot de passe', name: 'confirmPassword', type: 'password', required: true, col: 'col-md-6', attrs: 'autocomplete="new-password"' })}`,
        'Changer le mot de passe');

    const preferences = formShell('reglages', 'Réglages',
        'Ces choix ne concernent que votre compte.',
        `<div class="col-12"><div class="settings-title">Rappels</div></div>
         ${checkboxGroup({ label: 'Rappels automatiques avant un événement', name: 'reminders', options: reminderOptions, checked: settings.reminders.map(String) })}
         <div class="col-12"><div class="settings-title">Affichage</div></div>
         ${selectField({ label: 'Affichage du calendrier', name: 'calendarView', value: settings.calendarView, col: 'col-md-6', placeholder: null, options: Object.entries(CALENDAR_VIEWS).map(([value, label]) => ({ value, label })) })}
         ${checkboxField({ label: 'Réduire le menu latéral au démarrage', name: 'sidebarCollapsed', checked: settings.sidebarCollapsed, switchStyle: true, col: 'col-md-6', hint: 'Grands écrans uniquement.' })}`,
        'Enregistrer les réglages');

    return `
      <div class="row g-4">
        <div class="col-xl-4"><div class="d-flex flex-column gap-4 profile-aside">${identity}</div></div>
        <div class="col-xl-8"><div class="d-flex flex-column gap-4">${contact}${security}${preferences}</div></div>
      </div>`;
}

/** Réduit une image au carré PHOTO_SIZE (recadrage centré) et retourne un data URL JPEG. */
async function resizeImage(file) {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.85);
}

export async function mountProfilePage(ctx) {
    const { user } = ctx;
    const actor = { id: user.id, role: user.role };
    const root = $('profile-root');
    $('page-subtitle').textContent = 'Votre compte, votre sécurité et vos réglages';

    const profile = await renderInto(root, () => AccountService.profile(user.id), render);
    if (!profile) return;

    // Un enregistrement qui change l'identité visible (photo, e-mail, réglages d'affichage) recharge la page : le menu suit.
    const saved = (message) => { queueToast(message); window.location.reload(); };

    const form = (id) => root.querySelector(`[data-form="${id}"]`);
    bindInlineForm(form('contact'), {
        onSubmit: (values) => AccountService.updateContact(user.id, values, actor),
        onDone: () => saved('Coordonnées enregistrées.'),
    });
    bindInlineForm(form('securite'), {
        onSubmit: (values) => AccountService.changePassword(user.id, values, actor),
        onDone: () => {
            form('securite').reset();
            $('password-banner')?.remove();
            toast('Mot de passe modifié.');
        },
    });
    bindInlineForm(form('reglages'), {
        onSubmit: (values) => AccountService.updateSettings(user.id, values, actor),
        onDone: () => saved('Réglages enregistrés.'),
    });

    // Photo
    const input = $('photo-input');
    $('btn-photo').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Choisissez une image PNG, JPEG ou WebP.', { type: 'danger' }); return; }
        if (file.size > MAX_SOURCE_BYTES) { toast('Image trop lourde (8 Mo maximum).', { type: 'danger' }); return; }
        try {
            await AccountService.updatePhoto(user.id, await resizeImage(file), actor);
            saved('Photo mise à jour.');
        } catch (error) {
            console.error(error);
            toast(error.message || "Cette image n'a pas pu être utilisée.", { type: 'danger' });
        }
    });
    $('btn-photo-remove')?.addEventListener('click', async () => {
        try {
            await AccountService.updatePhoto(user.id, null, actor);
            saved('Photo retirée.');
        } catch (error) {
            toast(error.message, { type: 'danger' });
        }
    });
}
