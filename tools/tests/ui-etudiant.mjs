// Parcours de l'étudiant contre l'API : notes validées uniquement, bulletin, recherche, calendrier, périmètre
import { assert, reseed, session } from './lib.mjs';
reseed();
const t = await session('etudiant', 9474); const { b, ok, text, count, click } = t;
let failed = false;
try {
  await t.desktop(); await b.login('ulrich.foning@etu.dept-info.demo'); await b.sleep(1200);
  assert.match(await text('.stat-value'), /10,43 \/ 20|10,43/); ok('tableau de bord : moyenne 10,43 / 20 (calcul du serveur)');
  await b.go('pages/etudiant/notes.html'); await b.ready(); await b.sleep(600); assert.ok(await count('#subject-table tbody tr') === 5); ok('« Mes notes » : 5 matières');
  const drafts = await b.ev(`fetch(location.origin + '/backend/api/grades', { credentials: 'include' }).then(r => r.json()).then(g => g.filter(x => x.status !== 'validee').length)`); assert.equal(drafts, 0); ok('l\'API ne renvoie aucun brouillon à un étudiant');
  const others = await b.ev(`fetch(location.origin + '/backend/api/grades', { credentials: 'include' }).then(r => r.json()).then(g => new Set(g.map(x => x.studentId)).size)`); assert.equal(others, 1); ok('l\'API ne renvoie que SES notes');
  const denied = await b.ev(`Promise.all(['/sessions', '/hours', '/teachers', '/students/stu-001', '/stats/teacher-rows', '/bulletins/overview', '/accounts', '/checkins'].map(p => fetch(location.origin + '/backend/api' + p, { credentials: 'include' }).then(r => r.status)))`);
  assert.ok(denied.every((s) => s === 403), denied.join(',')); ok('routes interdites à l\'étudiant : toutes en 403 (' + denied.join(' ') + ')');
  await b.go('pages/etudiant/bulletin.html'); await b.ready(); await b.sleep(800); assert.ok(await count('.transcript-sheet, .transcript-stage') >= 1); ok('bulletin : relevé affiché (généré par le chef)');
  await b.setVal('#main-search', 'rattrapage'); await b.until(`!document.getElementById('search-results').classList.contains('d-none')`, 'recherche'); assert.equal(await b.ev(`[...document.querySelectorAll('.search-group-title')].map(e=>e.textContent).join('|')`), 'Calendrier'); ok('recherche rapide limitée au calendrier');
  await b.go('pages/etudiant/calendrier.html'); await b.ready(); await b.until(`!!document.querySelector('.cal-month')`, 'grille'); assert.equal(await count('.cal-chip[data-event="evt-007"]'), 0); ok('calendrier : les réunions du personnel sont invisibles');
  await b.go('pages/chef/dashboard.html'); await b.until(`location.pathname.endsWith('/etudiant/dashboard.html')`, 'redirection de rôle'); ok('page d\'un autre rôle : renvoi vers son tableau de bord');
  await t.phone(); await b.go('pages/etudiant/dashboard.html'); await b.ready(); await b.sleep(800); assert.ok(await b.ev(`document.documentElement.scrollWidth <= window.innerWidth`)); ok('mobile : pas de défilement horizontal');
} catch (e) { failed = true; console.log('ÉCHEC', e.message); await b.shot('ui-etu-fail').catch(() => {}); }
t.finish(failed);
