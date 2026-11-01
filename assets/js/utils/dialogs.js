/*
 * Modales et notifications (Bootstrap) : toast, confirmation, information, formulaire.
 * Les pages doivent charger le bundle Bootstrap (script classique) avant leur module.
 *
 * openFormModal gère tout le cycle d'un formulaire : validation côté « serveur » (le service lève une
 * ValidationError avec les messages par champ), affichage des erreurs sous chaque champ, état « envoi en cours ».
 */

import { ValidationError } from '../services/errors.js';
import { esc } from './format.js';

let toastHost = null;
let sequence = 0;

const TOAST_ICONS = { success: 'bi-check-circle-fill', danger: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };

/** Notification éphémère en haut à droite. type : 'success' | 'danger' | 'info'. */
export function toast(message, { type = 'success' } = {}) {
    if (!toastHost) {
        toastHost = document.createElement('div');
        toastHost.className = 'toast-container position-fixed top-0 end-0 p-3 app-toast-host';
        document.body.appendChild(toastHost);
    }
    const el = document.createElement('div');
    el.className = `toast app-toast app-toast-${type}`;
    el.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    el.innerHTML = `
      <div class="d-flex align-items-start gap-2">
        <i class="bi ${TOAST_ICONS[type] ?? TOAST_ICONS.info} app-toast-icon"></i>
        <div class="toast-body p-0">${esc(message)}</div>
        <button type="button" class="btn-close ms-auto" data-bs-dismiss="toast" aria-label="Fermer"></button>
      </div>`;
    toastHost.appendChild(el);
    el.addEventListener('hidden.bs.toast', () => el.remove());
    new bootstrap.Toast(el, { delay: type === 'danger' ? 7000 : 4000 }).show();
}

const QUEUE_KEY = 'school:toast-queue';

/** Programme une notification affichée à la prochaine page chargée (ex. suppression depuis une fiche, puis retour à la liste). */
export function queueToast(message, options = {}) {
    try {
        const queue = JSON.parse(sessionStorage.getItem(QUEUE_KEY) ?? '[]');
        sessionStorage.setItem(QUEUE_KEY, JSON.stringify([...queue, { message, options }]));
    } catch { /* stockage indisponible : la notification est simplement perdue */ }
}

/** Affiche les notifications programmées (appelé par initPage). */
export function showQueuedToasts() {
    try {
        const queue = JSON.parse(sessionStorage.getItem(QUEUE_KEY) ?? '[]');
        sessionStorage.removeItem(QUEUE_KEY);
        queue.forEach(({ message, options }) => toast(message, options));
    } catch { /* file corrompue : ignorée */ }
}

function mountModal(html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const el = wrapper.firstElementChild;
    document.body.appendChild(el);
    el.addEventListener('hidden.bs.modal', () => el.remove());
    return { el, modal: new bootstrap.Modal(el) };
}

function modalShell(id, { title, size = '', body, footer, tag = 'div' }) {
    return `
    <div class="modal fade app-modal" tabindex="-1" aria-labelledby="${id}-title" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size}">
        <${tag} class="modal-content"${tag === 'form' ? ' novalidate' : ''}>
          <div class="modal-header">
            <h2 class="modal-title" id="${id}-title">${esc(title)}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button>
          </div>
          <div class="modal-body">${body}</div>
          <div class="modal-footer">${footer}</div>
        </${tag}>
      </div>
    </div>`;
}

/**
 * Demande une confirmation. Retourne true si l'utilisateur confirme.
 * details : liste de phrases (texte brut) affichée sous le message. cancelLabel: null = simple information.
 */
export function confirmDialog({ title, message, details = [], confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
    return new Promise((resolve) => {
        const id = `dlg-${++sequence}`;
        const list = details.length ? `<ul class="app-modal-details">${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
        const { el, modal } = mountModal(modalShell(id, {
            title,
            size: 'modal-dialog-sm-md',
            body: `<p class="mb-0">${esc(message)}</p>${list}`,
            footer: `${cancelLabel ? `<button type="button" class="btn-custom btn-custom-light" data-bs-dismiss="modal">${esc(cancelLabel)}</button>` : ''}
                     <button type="button" class="btn-custom ${danger ? 'btn-custom-danger' : 'btn-custom-primary'}" data-confirm disabled>${esc(confirmLabel)}</button>`,
        }));
        let answer = false;
        const confirm = el.querySelector('[data-confirm]');
        // Bootstrap ignore hide() pendant l'animation d'ouverture : on n'active le bouton qu'une fois la modale affichée
        el.addEventListener('shown.bs.modal', () => { confirm.disabled = false; confirm.focus(); });
        confirm.addEventListener('click', () => { answer = true; modal.hide(); });
        el.addEventListener('hidden.bs.modal', () => resolve(answer));
        modal.show();
    });
}

/**
 * Modale générique : retourne l'id du bouton cliqué (null si fermée autrement).
 * buttons : [{ id, label, className = 'btn-custom-light' }] ; body : HTML déjà échappé.
 */
export function openModal({ title, body, buttons = [], size = '' }) {
    return new Promise((resolve) => {
        const id = `dlg-${++sequence}`;
        const { el, modal } = mountModal(modalShell(id, {
            title, size, body,
            footer: buttons.map((b) => `<button type="button" class="btn-custom ${b.className ?? 'btn-custom-light'}" data-modal-action="${esc(b.id)}" disabled>${esc(b.label)}</button>`).join('')
                + '<button type="button" class="btn-custom btn-custom-light" data-bs-dismiss="modal">Fermer</button>',
        }));
        let answer = null;
        // Bootstrap ignore hide() pendant l'animation d'ouverture : boutons actifs une fois la modale affichée
        el.addEventListener('shown.bs.modal', () => { el.dataset.shown = 'true'; el.querySelectorAll('[data-modal-action]').forEach((b) => { b.disabled = false; }); });
        el.addEventListener('click', (event) => {
            const button = event.target.closest('[data-modal-action]');
            if (!button || button.disabled) return;
            answer = button.dataset.modalAction;
            modal.hide();
        });
        el.addEventListener('hidden.bs.modal', () => resolve(answer));
        modal.show();
    });
}

/** Message d'information avec un seul bouton. */
export const infoDialog = ({ title, message, details }) =>
    confirmDialog({ title, message, details, confirmLabel: 'Compris', cancelLabel: null });

/**
 * Valeurs d'un formulaire sous forme d'objet. Un nom présent plusieurs fois (groupe de cases à cocher)
 * donne un tableau ; les autres champs, une chaîne.
 */
export function formValues(form) {
    const values = {};
    for (const [name, value] of new FormData(form)) {
        if (name in values) values[name] = [].concat(values[name], value);
        else values[name] = value;
    }
    return values;
}

// ---- Erreurs de formulaire (modales et formulaires dans une page) ---------------------------------

/** Efface les messages d'erreur d'un formulaire. errorBox : bandeau d'erreur générale (facultatif). */
export function clearFormErrors(form, errorBox) {
    errorBox?.classList.add('d-none');
    form.querySelectorAll('.is-invalid-custom').forEach((input) => input.classList.remove('is-invalid-custom'));
    form.querySelectorAll('.form-feedback-custom').forEach((node) => node.remove());
}

/**
 * Affiche une erreur : un message sous chaque champ désigné par error.fields (clé = attribut name du champ),
 * ou, à défaut, dans le bandeau général. Place le focus sur le premier champ fautif.
 */
export function showFormErrors(form, error, errorBox) {
    if (!(error instanceof ValidationError)) console.error(error);
    const shown = [];
    Object.entries(error.fields ?? {}).forEach(([name, message]) => {
        const input = form.querySelector(`[name="${name}"]`);
        if (!input) return;
        input.classList.add('is-invalid-custom');
        const holder = input.closest('[data-field]') ?? input.parentElement;
        holder.insertAdjacentHTML('beforeend', `<div class="form-feedback-custom invalid-custom">${esc(error.fields[name])}</div>`);
        shown.push(input);
    });
    if (shown.length) {
        shown[0].focus();
    } else if (errorBox) {
        errorBox.textContent = error instanceof ValidationError ? error.message : "L'enregistrement a échoué. Réessayez.";
        errorBox.classList.remove('d-none');
    }
}

/** Un champ corrigé perd son message sans attendre le prochain envoi. */
function clearFieldOnInput(form) {
    form.addEventListener('input', (event) => {
        const input = event.target;
        if (!input.classList?.contains('is-invalid-custom')) return;
        input.classList.remove('is-invalid-custom');
        input.closest('[data-field]')?.querySelector('.form-feedback-custom')?.remove();
    });
}

/**
 * Branche un formulaire situé DANS une page (et non dans une modale) : envoi bloqué pendant l'enregistrement,
 * erreurs affichées sous les champs. onSubmit(data) lève ValidationError pour signaler des champs ; onDone(résultat) suit un succès.
 * Le formulaire doit contenir un bouton [type=submit] et, facultativement, un bandeau [data-form-error].
 */
export function bindInlineForm(form, { onSubmit, onDone }) {
    const submit = form.querySelector('[type="submit"]');
    const errorBox = form.querySelector('[data-form-error]');
    clearFieldOnInput(form);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        clearFormErrors(form, errorBox);
        submit.disabled = true;
        const label = submit.innerHTML;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Enregistrement…';
        try {
            const result = await onSubmit(formValues(form));
            await onDone?.(result);
        } catch (error) {
            showFormErrors(form, error, errorBox);
        } finally {
            submit.disabled = false;
            submit.innerHTML = label;
        }
    });
}

/**
 * Ouvre un formulaire dans une modale.
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.body HTML des champs. Chaque champ = <div data-field>…<input name="…"></div>
 * @param {string} [options.submitLabel]
 * @param {(form: HTMLFormElement) => void} [options.onOpen] pour brancher des comportements (listes dépendantes…)
 * @param {(data: Record<string,string>) => Promise<any>} options.onSubmit lève ValidationError pour signaler des champs
 * @returns {Promise<any|null>} résultat de onSubmit si enregistré, null si annulé
 */
export function openFormModal({ title, body, submitLabel = 'Enregistrer', onOpen, onSubmit, size = '' }) {
    return new Promise((resolve) => {
        const id = `frm-${++sequence}`;
        const { el, modal } = mountModal(modalShell(id, {
            title, size, tag: 'form',
            body: `${body}<div class="alert alert-danger d-none mt-3 mb-0" role="alert" data-form-error></div>`,
            footer: `<button type="button" class="btn-custom btn-custom-light" data-bs-dismiss="modal">Annuler</button>
                     <button type="submit" class="btn-custom btn-custom-primary" disabled>${esc(submitLabel)}</button>`,
        }));
        const form = el.querySelector('form');
        const errorBox = form.querySelector('[data-form-error]');
        const submit = form.querySelector('[type="submit"]');
        let result = null;
        let shown = false; // Bootstrap ignore hide() pendant l'animation d'ouverture : pas d'envoi avant la fin

        const clearErrors = () => clearFormErrors(form, errorBox);
        clearFieldOnInput(form);

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!shown || submit.disabled) return; // modale pas encore affichée, ou envoi déjà en cours (double clic)
            clearErrors();
            submit.disabled = true;
            const label = submit.innerHTML;
            submit.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Enregistrement…';
            try {
                result = await onSubmit(formValues(form));
                modal.hide();
            } catch (error) {
                showFormErrors(form, error, errorBox);
                submit.disabled = false;
                submit.innerHTML = label;
            }
        });

        el.addEventListener('shown.bs.modal', () => {
            shown = true;
            submit.disabled = false;
            form.querySelector('input:not([readonly]), select')?.focus();
        });
        el.addEventListener('hidden.bs.modal', () => resolve(result));
        onOpen?.(form);
        modal.show();
    });
}
