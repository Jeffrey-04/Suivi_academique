// Parcours du chef de département contre l'API : personnes, comptes, bulletins, calendrier, présences
import { assert, reseed, session } from './lib.mjs';
reseed();
const t = await session('chef', 9472); const { b, ok, text, count, click, submit, modalReady, modalClosed, lastToast, submitModal, confirmModal, closeModal } = t;
let failed = false;
try {
  await t.desktop(); await b.login('chef@dept-info.demo');
  // ---- Étudiants : création avec mot de passe temporaire
  await b.go('pages/chef/etudiants.html'); await b.ready(); await b.sleep(400);
  assert.match(await text('.table-pagination-info'), /sur 54/); ok('liste des étudiants : 54 (API)');
  await click('#btn-add'); await modalReady();
  const fill = async (o) => { for (const [k, v] of Object.entries(o)) await b.setVal(`.modal.show [name="${k}"]`, v); };
  await submitModal(); await b.until(`document.querySelectorAll('.modal.show .form-feedback-custom').length>=3`, 'erreurs'); ok('formulaire vide : messages du serveur sous les champs');
  await b.ev(`(()=>{const f=document.querySelector('.modal.show #f-filiere'); f.value='fil-gl'; f.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await fill({ firstName: 'Anne', lastName: 'Essomba', birthDate: '2005-03-04', birthPlace: 'Douala', email: 'anne.essomba@etu.dept-info.demo', phone: '+237 677 12 34 56', levelId: 'lvl-gl-m1' });
  await submitModal(); await b.until(`!!document.querySelector('.modal.show .temp-password')`, 'mot de passe temporaire');
  const temp = await text('.modal.show .temp-password'); assert.match(temp, /^[A-Za-z0-9]{11}$/); assert.notEqual(temp, 'demo1234'); assert.match(await text('.modal.show .modal-body'), /Aucun e-mail n'a été envoyé/); ok(`création : mot de passe temporaire aléatoire affiché une fois (${temp})`);
  await closeModal(); await b.sleep(500);
  assert.match(await text('.table-pagination-info'), /sur 55/); assert.match(await text('#table-body tr.row-flash'), /Essomba/); ok('l\'étudiant apparaît (55), ligne surlignée');
  await b.login('anne.essomba@etu.dept-info.demo', temp); assert.equal(await count('#password-banner'), 1); ok('connexion de l\'étudiant avec le mot de passe temporaire : bandeau « à changer »');
  await b.login('chef@dept-info.demo');
  // ---- modification et suppression
  await b.go('pages/chef/etudiants.html'); await b.ready(); await b.setVal('#search', 'essomba'); await b.sleep(400);
  await click('#table-body [data-action="edit"]'); await modalReady(); await fill({ lastName: 'Essomba-Kamga' }); await submitModal(); await modalClosed(); await b.sleep(500);
  assert.match(await text('#table-body'), /Essomba-Kamga/); ok('modification enregistrée');
  await click('#table-body [data-action="delete"]'); await modalReady(); assert.match(await text('.modal.show .modal-body'), /compte de connexion sera supprimé/); await confirmModal(); await b.sleep(600);
  assert.match(await text('.table-pagination-info'), /Aucun|sur 0/); ok('suppression avec confirmation et impact');
  // ---- Enseignants : création + suppression refusée avec matières
  await b.go('pages/chef/enseignants.html'); await b.ready(); await click('#btn-add'); await modalReady();
  await fill({ firstName: 'Paul', lastName: 'Mbarga', grade: 'Vacataire', contractHours: '60', email: 'paul.mbarga@dept-info.demo' }); await submitModal(); await b.until(`!!document.querySelector('.modal.show .temp-password')`, 'mdp enseignant'); await closeModal(); ok('enseignant créé : mot de passe temporaire affiché');
  await b.setVal('#search', 'atangana'); await b.sleep(400); await click('#table-body [data-action="delete"]'); await modalReady(); assert.match(await text('.modal.show .modal-body'), /ne peut pas être supprimé/); await b.ev(`document.querySelector('.modal.show [data-confirm]').click()`); await modalClosed(); ok('suppression d\'un enseignant avec matières refusée');
  // ---- Matières : code déjà utilisé (message serveur)
  await b.go('pages/chef/matieres.html'); await b.ready(); await click('#btn-add'); await modalReady();
  await fill({ code: 'DS403', name: 'Autre matière', coefficient: '2', plannedHours: '30' });
  await b.ev(`(()=>{const f=document.querySelector('.modal.show #f-filiere'); f.value='fil-ds'; f.dispatchEvent(new Event('change',{bubbles:true})); })()`); await b.setVal('.modal.show #f-level', 'lvl-ds-m1');
  await submitModal(); await b.until(`!!document.querySelector('.modal.show .form-feedback-custom')`, 'erreur code'); assert.match(await text('.modal.show .form-feedback-custom'), /déjà utilisé/); ok('matière : code déjà utilisé (message du serveur)'); await closeModal();
  // ---- Comptes : réinitialisation, désactivation
  await b.go('pages/chef/comptes.html'); await b.ready(); await b.setVal('#search', 'ulrich'); await b.sleep(400);
  await click('[data-action="reset"]'); await modalReady(); await confirmModal().catch(() => {}); await b.until(`!!document.querySelector('.modal.show .temp-password')`, 'reset'); const pw2 = await text('.modal.show .temp-password'); await closeModal(); assert.match(pw2, /^[A-Za-z0-9]{11}$/); ok('réinitialisation : nouveau mot de passe temporaire');
  await click('[data-action="deactivate"]'); await confirmModal(); await b.sleep(500); assert.match(await text('#table-body tr.row-flash .badge-table'), /Désactivé/); ok('compte désactivé');
  await b.login('chef@dept-info.demo');
  // ---- Bulletins : génération groupée (10 relevés complets → 29 bulletins)
  await b.go('pages/chef/bulletins.html'); await b.ready(); await b.sleep(600);
  assert.equal(await b.ev(`document.getElementById('btn-generate').disabled`), false); assert.match(await text('#btn-generate'), /\(10\)/);
  await click('#btn-generate'); await confirmModal(); await b.until(`[...document.querySelectorAll('.app-toast')].some(t=>/10 bulletins générés/.test(t.textContent))`, 'toast génération');
  await b.sleep(600); assert.equal(await b.ev(`document.getElementById('btn-generate').disabled`), true); ok('10 bulletins générés par le serveur ; plus aucun à générer');
  const doc = await b.ev(`fetch(location.origin + '/backend/api/students/stu-018/bulletin/document', { credentials: 'include' }).then(r => r.json()).then(d => [d.number, d.rank, d.classAverage, d.student.matricule, d.institution.university.fr])`); assert.deepEqual(doc, ['BLT-007', 4, 12.34, '26GL4006', 'UNIVERSITÉ DE DÉMONSTRATION']); ok('document du bulletin : numéro, rang, moyenne de classe, identité (API)');
  // ---- Calendrier : création avec notification, puis suppression
  await b.go('pages/chef/calendrier.html'); await b.ready(); await click('#btn-add'); await modalReady();
  await fill({ title: 'Réunion pédagogique S2', start: '2027-02-03', startTime: '09:00', endTime: '11:00', location: 'Salle 2' }); await b.setVal('.modal.show [name="type"]', 'reunion'); await submitModal(); await modalClosed(); await b.sleep(500);
  assert.match(await lastToast(), /Événement créé\. \d+ personnes? (ont|a) été prévenue/); ok('événement créé, destinataires prévenus : ' + (await lastToast()));
  await b.logout(); await b.login('herve.kamga@dept-info.demo'); assert.match(await text('#notification-list .notification-item'), /Réunion pédagogique S2/); ok('notification reçue par l\'enseignant');
} catch (e) { failed = true; console.log('ÉCHEC', e.message); await b.shot('ui-chef-fail').catch(() => {}); }
t.finish(failed);
