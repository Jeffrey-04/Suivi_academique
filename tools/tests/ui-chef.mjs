// Parcours du chef de département (seul utilisateur) contre l'API : personnes, bulletins, saisie des notes, séances,
// emploi du temps (confirmer, absence, annuler, créneaux), calendrier, profil.
import { assert, reseed, session } from './lib.mjs';
reseed();
const t = await session('chef', 9472); const { b, ok, text, count, click, modalReady, modalClosed, lastToast, submitModal, confirmModal, closeModal } = t;
let failed = false;
try {
  await t.desktop(); await b.login('chef@dept-info.demo');
  const fill = async (o) => { for (const [k, v] of Object.entries(o)) await b.setVal(`.modal.show [name="${k}"]`, v); };
  const toastWith = (re, label) => b.until(`[...document.querySelectorAll('.app-toast')].some(t=>${re}.test(t.textContent))`, label);

  // ---- Menu : un seul rôle, plus de « Comptes »
  const menu = await b.ev(`[...document.querySelectorAll('.sidebar-menu-link')].map((a) => a.textContent.trim())`);
  assert.ok(menu.includes('Emploi du temps') && menu.includes('Saisie des notes') && !menu.includes('Comptes')); ok('menu du chef : emploi du temps et saisie des notes, plus de « Comptes »');

  // ---- Étudiants : création sans compte
  await b.go('pages/chef/etudiants.html'); await b.ready(); await b.sleep(400);
  assert.match(await text('.table-pagination-info'), /sur 54/); ok('liste des étudiants : 54 (API)');
  await click('#btn-add'); await modalReady();
  await submitModal(); await b.until(`document.querySelectorAll('.modal.show .form-feedback-custom').length>=3`, 'erreurs'); ok('formulaire vide : messages du serveur sous les champs');
  await b.ev(`(()=>{const f=document.querySelector('.modal.show #f-filiere'); f.value='fil-gl'; f.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await fill({ firstName: 'Anne', lastName: 'Essomba', birthDate: '2005-03-04', birthPlace: 'Douala', email: 'anne.essomba@etu.dept-info.demo', phone: '+237 677 12 34 56', levelId: 'lvl-gl-m1' });
  assert.match(await text('.modal.show .modal-body'), /n'a pas de compte/);
  await submitModal(); await modalClosed(); await b.sleep(500);
  assert.equal(await count('.temp-password'), 0); assert.match(await text('.table-pagination-info'), /sur 55/); assert.match(await text('#table-body tr.row-flash'), /Essomba/); ok('l\'étudiant apparaît (55), sans mot de passe temporaire ni compte');
  // ---- modification et suppression
  await b.setVal('#search', 'essomba'); await b.sleep(400);
  await click('#table-body [data-action="edit"]'); await modalReady(); await fill({ lastName: 'Essomba-Kamga' }); await submitModal(); await modalClosed(); await b.sleep(500);
  assert.match(await text('#table-body'), /Essomba-Kamga/); ok('modification enregistrée');
  await click('#table-body [data-action="delete"]'); await modalReady(); assert.doesNotMatch(await text('.modal.show .modal-body'), /compte de connexion/); await confirmModal(); await b.sleep(600);
  assert.match(await text('.table-pagination-info'), /Aucun|sur 0/); ok('suppression avec confirmation et impact');
  // ---- Enseignants : création (aucun compte) + suppression refusée avec matières
  await b.go('pages/chef/enseignants.html'); await b.ready(); await click('#btn-add'); await modalReady();
  await fill({ firstName: 'Paul', lastName: 'Mbarga', grade: 'Vacataire', contractHours: '60', email: 'paul.mbarga@dept-info.demo' }); await submitModal(); await modalClosed(); assert.equal(await count('.temp-password'), 0); ok('enseignant créé sans compte');
  await b.setVal('#search', 'atangana'); await b.sleep(400); await click('#table-body [data-action="delete"]'); await modalReady(); assert.match(await text('.modal.show .modal-body'), /ne peut pas être supprimé/); await b.ev(`document.querySelector('.modal.show [data-confirm]').click()`); await modalClosed(); ok('suppression d\'un enseignant avec matières refusée');
  // ---- Matières : code déjà utilisé (message serveur)
  await b.go('pages/chef/matieres.html'); await b.ready(); await click('#btn-add'); await modalReady();
  await fill({ code: 'DS403', name: 'Autre matière', coefficient: '2', plannedHours: '30' });
  await b.ev(`(()=>{const f=document.querySelector('.modal.show #f-filiere'); f.value='fil-ds'; f.dispatchEvent(new Event('change',{bubbles:true})); })()`); await b.setVal('.modal.show #f-level', 'lvl-ds-m1');
  await submitModal(); await b.until(`!!document.querySelector('.modal.show .form-feedback-custom')`, 'erreur code'); assert.match(await text('.modal.show .form-feedback-custom'), /déjà utilisé/); ok('matière : code déjà utilisé (message du serveur)'); await closeModal();

  // ---- Bulletins : génération groupée (avant la saisie de notes, qui change les relevés complets)
  await b.go('pages/chef/bulletins.html'); await b.ready(); await b.sleep(600);
  assert.equal(await b.ev(`document.getElementById('btn-generate').disabled`), false); assert.match(await text('#btn-generate'), /\(10\)/);
  await click('#btn-generate'); await confirmModal(); await toastWith('/10 bulletins générés/', 'toast génération');
  await b.sleep(600); assert.equal(await b.ev(`document.getElementById('btn-generate').disabled`), true); ok('10 bulletins générés par le serveur ; plus aucun à générer');
  const doc = await b.ev(`fetch(location.origin + '/backend/api/students/stu-018/bulletin/document', { credentials: 'include' }).then(r => r.json()).then(d => [d.number, d.rank, d.classAverage, d.student.matricule, d.institution.university.fr])`); assert.deepEqual(doc, ['BLT-007', 4, 12.34, '26GL4006', 'UNIVERSITÉ DE DÉMONSTRATION']); ok('document du bulletin : numéro, rang, moyenne de classe, identité (API)');

  // ---- Saisie des notes : le chef saisit un brouillon puis le valide (examen de DS403, pas encore saisi)
  await b.go('pages/chef/saisie-notes.html?subject=sub-043&type=EXAMEN'); await b.ready(); await b.until(`document.querySelectorAll('.grade-input').length>=6`, 'feuille de saisie');
  assert.match(await text('#page-subtitle'), /DS403|Data|Examen/); assert.equal(await count('.grade-input:not([disabled])'), 6); ok('feuille de saisie de l\'examen DS403 : 6 étudiants, aucune note');
  const ids = await b.ev(`[...document.querySelectorAll('.grade-input')].map((i) => i.dataset.student)`);
  const values = ['9', '11.5', '8.25', '14', '10', '6'];
  for (const [i, id] of ids.entries()) await b.setVal(`.grade-input[data-student="${id}"]`, values[i]);
  await b.setVal(`.grade-input[data-student="${ids[0]}"]`, '25'); await click('#btn-save'); await toastWith('/./', 'refus');
  await b.until(`!!document.querySelector('.form-feedback-custom')`, 'message sous la note'); assert.match(await text('.form-feedback-custom'), /entre 0 et 20/); ok('note invalide refusée : message du serveur sous la ligne, rien d\'enregistré');
  await b.setVal(`.grade-input[data-student="${ids[0]}"]`, '9'); await click('#btn-save'); await toastWith('/Brouillon enregistré \\(6 notes\\)/', 'brouillon'); ok('brouillon enregistré (6 notes)');
  await b.go('pages/chef/saisie-notes.html?subject=sub-043&type=EXAMEN'); await b.ready(); await b.until(`document.querySelectorAll('.grade-input').length>=6`, 'recharge');
  assert.equal(await b.ev(`document.querySelector('.grade-input').value`), '9'); ok('le brouillon est conservé après rechargement');
  await click('#btn-validate'); await confirmModal(); await toastWith('/6 notes validées/', 'validation'); await b.sleep(500);
  assert.equal(await count('.grade-input:not([disabled])'), 0); assert.match(await text('#dirty-info'), /validées et verrouillées/); ok('notes validées et verrouillées par le chef');

  // ---- Séances : déclarer une séance (pour l'enseignant de la matière) puis une absence
  await b.go('pages/chef/presences.html'); await b.ready(); await b.sleep(500);
  await click('#btn-declare'); await modalReady();
  await b.setVal('.modal.show #f-teacher', 'tea-005'); await b.setVal('.modal.show [name="subjectId"]', 'sub-043');
  await fill({ date: '2027-01-25', startTime: '12:00', endTime: '14:00', note: 'Séance de rattrapage' });
  await submitModal(); await modalClosed(); await toastWith('/Séance du 25\\/01\\/2027 enregistrée/', 'déclaration'); ok('séance déclarée par le chef pour l\'enseignant de la matière');
  await b.sleep(500); assert.match(await text('#table-body tr.row-flash'), /DS403|Kamga/); ok('la séance apparaît dans le journal');
  await click('#btn-add'); await modalReady(); await b.setVal('.modal.show #f-teacher', 'tea-005'); await b.setVal('.modal.show [name="subjectId"]', 'sub-043');
  await fill({ date: '2027-01-25', startTime: '12:30', endTime: '13:30' }); await submitModal();
  await b.until(`!!document.querySelector('.modal.show .form-feedback-custom')`, 'chevauchement'); assert.match(await text('.modal.show .form-feedback-custom'), /Chevauche une autre séance/); ok('chevauchement refusé par le serveur'); await closeModal();

  // ---- Emploi du temps : séances à confirmer (3), confirmer, absence, annuler
  await b.go('pages/chef/emploi-du-temps.html'); await b.ready(); await b.sleep(600);
  assert.match(await text('#kpis'), /À confirmer\s*3/); assert.equal(await count('[data-tab="confirm"].active'), 1); assert.equal(await count('#content tbody tr'), 3); ok('3 séances à confirmer, affichées par défaut');
  await click('[data-act="confirm"]'); await toastWith('/confirmée/', 'confirmation'); await b.sleep(600); assert.equal(await count('#content tbody tr'), 2); ok('séance confirmée : il en reste 2');
  await click('[data-act="absent"]'); await modalReady(); await fill({ note: 'Maladie' }); await submitModal(); await modalClosed(); await b.sleep(600); assert.equal(await count('#content tbody tr'), 1); ok('absence déclarée avec son motif : il en reste 1');
  await click('[data-act="cancel"]'); await modalReady(); await fill({ reason: 'Jour de fête' }); await submitModal(); await modalClosed(); await b.sleep(600);
  assert.match(await text('#content'), /Rien à confirmer/); ok('séance annulée : plus rien à confirmer');
  await click('[data-tab="week"]'); await b.sleep(300); assert.equal(await count('.tt-day'), 6); assert.ok((await count('.tt-slot')) > 5); assert.ok((await count('.tt-slot.tt-cancelled')) >= 1 && (await count('.tt-slot.tt-absent')) >= 1 && (await count('.tt-slot.tt-done')) >= 1); ok('grille de la semaine : statuts effectuée / absence / annulée');
  await click('.tt-slot.tt-cancelled'); await modalReady(); assert.match(await text('.modal.show .modal-body'), /Jour de fête/); await b.ev(`document.querySelector('.modal.show [data-modal-action="restore"]').click()`); await modalClosed(); await b.sleep(600);
  assert.equal(await count('.tt-slot.tt-cancelled'), 0); ok('séance annulée rétablie depuis sa fiche');
  // créneaux : conflit d'enseignant refusé, puis création
  await click('[data-tab="slots"]'); await b.sleep(300); await click('#btn-add-slot'); await modalReady();
  await b.setVal('.modal.show #f-teacher', 'tea-005'); await b.setVal('.modal.show [name="subjectId"]', 'sub-031');
  await fill({ weekday: '1', startTime: '09:00', endTime: '10:00', validFrom: '2026-09-14', validUntil: '2027-01-08' }); await submitModal();
  await b.until(`!!document.querySelector('.modal.show .form-feedback-custom')`, 'conflit'); assert.match(await text('.modal.show .form-feedback-custom'), /Chevauche un autre créneau de cet enseignant/); ok('conflit d\'enseignant refusé sous le champ');
  await fill({ weekday: '6', startTime: '08:00', endTime: '10:00', room: 'Salle 999', validFrom: '2027-01-30', validUntil: '2027-02-27' }); await submitModal(); await modalClosed(); await b.sleep(600);
  assert.match(await text('.table-pagination-info'), /sur 59/); ok('créneau créé (59 créneaux)');
  await b.setVal('#filter-teacher', 'tea-005'); await b.sleep(500); assert.ok((await count('#content tbody tr')) >= 3); ok('filtre par enseignant');

  // ---- Fiche enseignant : emploi du temps de l'enseignant
  await b.go('pages/chef/enseignant.html?id=tea-005'); await b.ready(); await b.sleep(600);
  assert.match(await text('#content'), /Emploi du temps/); assert.match(await text('#content'), /Samedi/); ok('fiche enseignant : son emploi du temps hebdomadaire');

  // ---- Calendrier : création d'un événement (plus de destinataires ni de notification)
  await b.go('pages/chef/calendrier.html'); await b.ready(); await click('#btn-add'); await modalReady();
  assert.equal(await count('.modal.show [name="audience"]'), 0); assert.equal(await count('.modal.show [name="notify"]'), 0); ok('formulaire d\'événement : ni destinataires ni notification');
  await fill({ title: 'Réunion pédagogique S2', start: '2027-02-03', startTime: '09:00', endTime: '11:00', location: 'Salle 2' }); await b.setVal('.modal.show [name="type"]', 'reunion'); await submitModal(); await modalClosed(); await b.sleep(500);
  assert.match(await lastToast(), /Événement créé\./); ok('événement créé : ' + (await lastToast()));

  // ---- Profil : réglages (sans « annonces ») et mot de passe
  await b.go('pages/chef/profil.html'); await b.ready(); await b.sleep(400);
  assert.equal(await count('[name="announcements"]'), 0); assert.equal(await count('[name="phone"]'), 0); ok('profil : ni option d\'annonces, ni téléphone');
  assert.equal(await count('a[href*="comptes"]'), 0); ok('profil : plus de lien vers la gestion des comptes');
  await b.logout(); assert.ok((await b.ev('location.pathname')).endsWith('page-login.html')); ok('déconnexion');
} catch (e) { failed = true; console.log('ÉCHEC', e.message); await b.shot('ui-chef-fail').catch(() => {}); }
t.finish(failed);
