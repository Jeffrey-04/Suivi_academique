/*
 * Gabarits de champs de formulaire (classes form-*-custom du template).
 * Chaque champ est enveloppé dans [data-field] : openFormModal y insère le message d'erreur.
 */

import { esc } from '../utils/format.js';

const wrap = (col, label, name, required, control, id = `f-${name}`) => `
  <div class="${col}" data-field>
    <label for="${esc(id)}" class="form-label-custom">${esc(label)}${required ? ' <span class="text-danger" aria-hidden="true">*</span>' : ''}</label>
    ${control}
  </div>`;

/** Champ texte / e-mail / date / nombre. attrs : attributs HTML bruts déjà sûrs (ex. 'max="2010-01-01"'). */
export function inputField({ label, name, type = 'text', value = '', required = false, col = 'col-md-6', placeholder = '', attrs = '', id = `f-${name}` }) {
    return wrap(col, label, name, required, `<input type="${type}" class="form-control-custom" id="${esc(id)}" name="${esc(name)}" value="${esc(value)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${required ? ' required' : ''} ${attrs}>`, id);
}

/** Liste déroulante. options : [{ value, label }]. name absent = champ d'aide non envoyé (listes dépendantes). */
export function selectField({ label, name, id, options, value = '', required = false, col = 'col-md-6', placeholder = 'Choisir…', disabled = false, hint = '' }) {
    const fieldId = id ?? `f-${name}`;
    const list = [...(placeholder === null ? [] : [{ value: '', label: placeholder }]), ...options] // placeholder null : pas de choix vide
        .map((o) => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    return `
  <div class="${col}" data-field>
    <label for="${esc(fieldId)}" class="form-label-custom">${esc(label)}${required ? ' <span class="text-danger" aria-hidden="true">*</span>' : ''}</label>
    <select class="form-select-custom" id="${esc(fieldId)}"${name ? ` name="${esc(name)}"` : ''}${required ? ' required' : ''}${disabled ? ' disabled' : ''}>${list}</select>${hint ? `\n    <div class="stat-hint mt-1">${esc(hint)}</div>` : ''}
  </div>`;
}

/** Zone de texte. */
export function textareaField({ label, name, value = '', required = false, col = 'col-12', rows = 3, placeholder = '', maxlength }) {
    return wrap(col, label, name, required, `<textarea class="form-control-custom" id="f-${esc(name)}" name="${esc(name)}" rows="${rows}"${maxlength ? ` maxlength="${maxlength}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>${esc(value)}</textarea>`);
}

/**
 * Groupe de cases à cocher partageant le même name (valeurs reçues sous forme de tableau, voir formValues).
 * options : [{ value, label }] ; checked : valeurs cochées.
 */
export function checkboxGroup({ label, name, options, checked = [], required = false, col = 'col-12' }) {
    const boxes = options.map((o, i) => `
      <div class="form-check form-check-inline">
        <input class="form-check-input" type="checkbox" id="f-${esc(name)}-${i}" name="${esc(name)}" value="${esc(o.value)}"${checked.includes(o.value) ? ' checked' : ''}>
        <label class="form-check-label" for="f-${esc(name)}-${i}">${esc(o.label)}</label>
      </div>`).join('');
    return `
  <div class="${col}" data-field>
    <span class="form-label-custom d-block">${esc(label)}${required ? ' <span class="text-danger" aria-hidden="true">*</span>' : ''}</span>
    <div class="checkbox-group" role="group" aria-label="${esc(label)}">${boxes}</div>
  </div>`;
}

/** Case à cocher isolée (valeur « 1 » si cochée, absente sinon). */
export function checkboxField({ label, name, checked = false, col = 'col-12', hint = '', switchStyle = false }) {
    return `
  <div class="${col}" data-field>
    <div class="form-check${switchStyle ? ' form-switch' : ''}">
      <input class="form-check-input" type="checkbox" id="f-${esc(name)}" name="${esc(name)}" value="1"${checked ? ' checked' : ''}>
      <label class="form-check-label" for="f-${esc(name)}">${esc(label)}</label>
    </div>${hint ? `\n    <div class="stat-hint mt-1">${esc(hint)}</div>` : ''}
  </div>`;
}
