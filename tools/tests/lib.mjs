// Outils communs des tests de bout en bout (navigateur, mode API)
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

export { assert };
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Réinitialise la base avec le jeu de démonstration (efface toutes les données). Nécessite php et l'accès à la base (variables DB_*). */
export function reseed() { execSync('php database/seed.php', { cwd: ROOT + 'backend', env: process.env, stdio: 'ignore' }); }

export async function session(name, port) {
  const b = await launch({ port });
  const ok = (m) => console.log('  ok  ' + m);
  const text = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g,' ').trim()`);
  const count = (sel) => b.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const click = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const submit = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)}).requestSubmit()`);
  const setCheck = (sel, v) => b.ev(`document.querySelector(${JSON.stringify(sel)}).checked=${v}`);
  const modalReady = () => b.until(`(()=>{const m=document.querySelector('.modal.show'); return !!m && (m.dataset.shown==='true' || !!m.querySelector('[type="submit"]:not([disabled]), [data-confirm]:not([disabled])'));})()`, 'modale ouverte');
  const modalClosed = () => b.until(`!document.querySelector('.modal.show') && !document.querySelector('.modal-backdrop')`, 'modale fermée');
  const lastToast = () => b.ev(`[...document.querySelectorAll('.app-toast')].at(-1)?.textContent.replace(/\\s+/g,' ').trim()`);
  const submitModal = () => b.ev(`document.querySelector('.modal.show form').requestSubmit()`);
  const confirmModal = async () => { await modalReady(); await b.ev(`document.querySelector('.modal.show [data-confirm]').click()`); await modalClosed(); };
  const closeModal = async () => { await modalReady(); await b.ev(`document.querySelector('.modal.show [data-bs-dismiss="modal"]').click()`); await modalClosed(); };
  const desktop = () => b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const phone = () => b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // Les refus de validation (422) sont journalisés par Chrome comme « Failed to load resource » : attendus, ignorés ici
  const realErrors = () => b.errors.filter((e) => !/Failed to load resource.*\b(422|409|404|403)\b/.test(e) && !/beforeunload/.test(e));
  const finish = (failed) => { const errs = realErrors(); console.log('erreurs console :', errs.length ? errs : 'aucune'); b.close(); if (failed || errs.length) process.exitCode = 1; };
  return { b, ok, text, count, click, submit, setCheck, modalReady, modalClosed, lastToast, submitModal, confirmModal, closeModal, desktop, phone, finish, name };
}
