// Parcours de l'enseignant contre l'API : saisie / validation de notes, séance, présence géolocalisée, profil et réglages
import { assert, reseed, session } from './lib.mjs';
reseed();
const t = await session('enseignant', 9473); const { b, ok, text, count, click, submit, modalReady, modalClosed, lastToast, confirmModal } = t;
let failed = false;
try {
  await t.desktop(); await b.login('herve.kamga@dept-info.demo');
  // ---- Notes : brouillon → validation (DS403, examen)
  await b.go('pages/enseignant/saisie-notes.html?subject=sub-043&type=EXAMEN'); await b.ready(); await b.until(`document.querySelectorAll('.grade-input').length===6`, '6 étudiants');
  ok('feuille de notes de DS403 : 6 étudiants (API)');
  const inputs = await b.ev(`[...document.querySelectorAll('.grade-input')].map(i=>i.dataset.student)`);
  const setGrade = (id, v) => b.setVal(`.grade-input[data-student="${id}"]`, v);
  await setGrade(inputs[0], '25'); await setGrade(inputs[1], '12.345'); await click('#btn-save'); await b.until(`document.querySelectorAll('.is-invalid-custom, .form-feedback-custom').length>=2`, 'erreurs par étudiant');
  ok('notes invalides : un message par étudiant, rien d\'enregistré (atomique)');
  const values = ['9', '11.5', '8.25', '14', '10', '6']; for (let i = 0; i < 6; i++) await setGrade(inputs[i], values[i]);
  await click('#btn-save'); await b.until(`[...document.querySelectorAll('.app-toast')].some(t=>/brouillon/i.test(t.textContent))`, 'toast brouillons'); ok('brouillons enregistrés : ' + await lastToast());
  await b.go('pages/enseignant/saisie-notes.html?subject=sub-043&type=EXAMEN'); await b.ready(); await b.until(`document.querySelectorAll('.grade-input').length===6`, 'rechargé');
  assert.equal(await b.ev(`document.querySelector('.grade-input[data-student="${inputs[3]}"]').value`), '14'); ok('les brouillons survivent au rechargement (base de données)');
  await click('#btn-validate'); await confirmModal(); await b.sleep(600); assert.equal(await b.ev(`document.querySelectorAll('.grade-input[disabled], .grade-input[readonly]').length`), 6); ok('notes validées et verrouillées');
  // ---- Séance : chevauchement refusé, puis déclaration
  await b.go('pages/enseignant/declarer-seance.html'); await b.ready(); await b.until(`!!document.querySelector('form [name="subjectId"]')`, 'formulaire');
  const mine = await b.ev(`[...document.querySelector('[name="subjectId"]').options].map(o=>o.value).filter(Boolean)`); assert.ok(mine.length >= 1);
  await b.setVal('[name="subjectId"]', mine[0]); await b.setVal('[name="date"]', '2027-01-08'); await b.setVal('[name="startTime"]', '16:15'); await b.setVal('[name="endTime"]', '18:15');
  await b.ev(`document.querySelector('form').requestSubmit()`); await b.until(`!!document.querySelector('form .form-feedback-custom')`, 'chevauchement'); assert.match(await text('form .form-feedback-custom'), /Chevauche une autre séance|La classe a déjà cours/); ok('chevauchement refusé : message du serveur');
  await b.setVal('[name="date"]', '2027-01-25'); await b.setVal('[name="startTime"]', '08:00'); await b.setVal('[name="endTime"]', '10:00'); await b.setVal('[name="note"]', 'Rattrapage de TP');
  await b.ev(`document.querySelector('form').requestSubmit()`); await b.until(`/enregistr|déclar/i.test(document.querySelector('.app-toast')?.textContent||'')`, 'toast séance'); ok('séance déclarée : ' + await lastToast());
  // ---- Présence géolocalisée (instance de démonstration : position simulable)
  await b.go('pages/enseignant/marquer-presence.html'); await b.ready(); await b.until(`!!document.getElementById('checkin-form')`, 'formulaire');
  assert.match(await text('#campus'), /Campus de démonstration/); assert.ok(await count('.demo-note') === 1); ok('page « Marquer ma présence » : campus et simulateur (instance de démonstration)');
  await b.setVal('[name="subjectId"]', mine[0]); await b.setVal('[name="simulation"]', 'far'); await submit('#checkin-form'); await b.until(`/rayon autorisé/.test(document.querySelector('[data-form-error]').textContent)`, 'refus loin');
  assert.match(await text('[data-form-error]'), /Vous êtes à 1,3 km/); ok('position lointaine : refus du serveur avec distance et rayon');
  await b.setVal('[name="simulation"]', 'inside'); await submit('#checkin-form'); await b.until(`!!document.querySelector('.checkin-success')`, 'succès'); assert.match(await text('.checkin-success'), /à 40 m du campus/); ok('position dans l\'enceinte : présence enregistrée par le serveur');
  await b.go('pages/enseignant/seances.html'); await b.ready(); await b.sleep(500); assert.ok(await count('#table-body .bi-geo-alt-fill') >= 1); ok('« Mes séances » : repère « géolocalisée »');
  // ---- Profil : coordonnées, mot de passe, réglages
  await b.go('pages/enseignant/profil.html'); await b.ready(); await b.until(`!!document.querySelector('[data-form="securite"]')`, 'profil');
  await b.setVal('[data-form="securite"] [name="currentPassword"]', 'demo1234'); await b.setVal('[data-form="securite"] [name="newPassword"]', 'Secret2027ab'); await b.setVal('[data-form="securite"] [name="confirmPassword"]', 'autre');
  await submit('[data-form="securite"]'); await b.until(`!!document.querySelector('[data-form="securite"] .form-feedback-custom')`, 'confirmation'); ok('mot de passe : confirmation différente refusée (serveur)');
  await b.setVal('[data-form="securite"] [name="confirmPassword"]', 'Secret2027ab'); await submit('[data-form="securite"]'); await b.until(`/modifié/.test(document.querySelector('.app-toast')?.textContent||'')`, 'toast mdp'); ok('mot de passe modifié');
  await t.setCheck('[name="announcements"]', false); await t.setCheck('[name="reminders"][value="7"]', false); await b.setVal('[name="calendarView"]', 'agenda'); await submit('[data-form="reglages"]');
  await b.until(`!!document.querySelector('[data-form="reglages"]') && document.querySelector('[name="calendarView"]').value==='agenda'`, 'réglages rechargés'); await b.ready();
  assert.equal(await b.ev(`document.querySelector('[name="announcements"]').checked`), false); assert.equal(await count('[name="reminders"]:checked'), 1); ok('réglages enregistrés côté serveur (annonces coupées, rappel J-7 retiré, agenda)');
  await b.go('pages/enseignant/calendrier.html'); await b.ready(); await b.until(`!!document.querySelector('.cal-agenda, .empty-state')`, 'agenda'); assert.equal(await count('.cal-month'), 0); ok('le calendrier s\'ouvre en vue Agenda (réglage du serveur)');
  assert.equal(await count('#btn-add'), 0); ok('calendrier en lecture seule pour l\'enseignant');
  // ---- Déconnexion : le cookie de session est détruit côté serveur
  await b.logout(); await b.go('pages/enseignant/dashboard.html'); await b.until(`location.pathname.endsWith('page-login.html')`, 'redirection'); ok('après déconnexion, une page protégée renvoie vers la connexion');
  await b.login('herve.kamga@dept-info.demo', 'Secret2027ab'); ok('connexion avec le nouveau mot de passe');
} catch (e) { failed = true; console.log('ÉCHEC', e.message); await b.shot('ui-ens-fail').catch(() => {}); }
t.finish(failed);
