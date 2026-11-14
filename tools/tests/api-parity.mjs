// Compare, pour chaque opération, le résultat du service du frontend en mode simulé (référence)
// avec la réponse de l'API réelle pour le même rôle.
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

import { fileURLToPath } from 'node:url';
globalThis.SCHOOL_MODE = 'mock'; // services du frontend en mode simulé : c'est la RÉFÉRENCE comparée à l'API
import { call, login, diff, summarize, ACCOUNTS } from './api-lib.mjs';
const P = ROOT;
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, get length() { return m.size; }, key: i => [...m.keys()][i] }; };
globalThis.localStorage = mem(); globalThis.sessionStorage = mem();
globalThis.fetch = ((orig) => async (u, o) => (String(u).startsWith('file:') ? (() => { const body = readFileSync(fileURLToPath(u), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; })() : orig(u, o)))(globalThis.fetch);
const M = await import(P + 'assets/js/services/index.js');
const A = ACCOUNTS;
for (const r of Object.keys(A)) await login(r);
const norm = (x) => JSON.parse(JSON.stringify(x ?? null));
const only = process.argv[2];
let pass = 0, fail = 0; const failures = []; const softOrder = [];
async function check(name, role, method, path, expected, opts = {}) {
  if (only && !name.includes(only)) return;
  let res;
  try { res = await call(role, method, path); } catch (e) { fail++; failures.push([name, `ERREUR RÉSEAU ${e.message}`]); return; }
  if (opts.status) { const ok = res.status === opts.status; ok ? pass++ : (fail++, failures.push([name, `statut ${res.status} (attendu ${opts.status}) ${res.text.slice(0, 100)}`])); return; }
  if (res.status !== 200) { fail++; failures.push([name, `HTTP ${res.status} ${res.text.slice(0, 160)}`]); return; }
  const exp = norm(await expected());
  const d = diff(exp, res.json, { ignore: ['demo', 'maxAccuracy'], ...opts });
  const hard = d.filter((x) => !x.soft); if (d.length > hard.length) softOrder.push(name);
  if (!hard.length) { pass++; return; }
  const s = summarize(d); fail++; failures.push([name, `${JSON.stringify(s.byType)}\n      ${s.sample.join('\n      ')}`]);
}
const chef = A.chef.actor, ens = A.enseignant.actor, etu = A.etudiant.actor;
const W = { from: '2026-09-14', to: '2027-01-25' };

// ---- Référentiels
await check('ref filieres', 'chef', 'GET', '/filieres', () => M.ReferenceService.filieres());
await check('ref levels', 'chef', 'GET', '/levels', () => M.ReferenceService.levels());
await check('ref classes', 'chef', 'GET', '/classes', () => M.ReferenceService.classes());
await check('ref units', 'chef', 'GET', '/units', () => M.ReferenceService.units());
await check('ref units filtré', 'chef', 'GET', '/units?levelId=lvl-gl-m1&semester=S1', () => M.ReferenceService.units({ levelId: 'lvl-gl-m1', semester: 'S1' }));
// ---- Personnes
await check('students list', 'chef', 'GET', '/students', () => M.StudentService.list());
await check('students filtre levelId', 'chef', 'GET', '/students?levelId=lvl-gl-m1', () => M.StudentService.list({ levelId: 'lvl-gl-m1' }));
await check('students recherche q', 'chef', 'GET', '/students?q=ondoua', () => M.StudentService.list({ q: 'ondoua' }));
await check('students get', 'chef', 'GET', '/students/stu-018', () => M.StudentService.get('stu-018'));
await check('students count', 'chef', 'GET', '/students/count', async () => ({ count: await M.StudentService.count() }));
await check('students removal-impact', 'chef', 'GET', '/students/stu-018/removal-impact', () => M.StudentService.removalImpact('stu-018'));
await check('teachers list', 'chef', 'GET', '/teachers', () => M.TeacherService.list());
await check('teachers get', 'chef', 'GET', '/teachers/tea-005', () => M.TeacherService.get('tea-005'));
await check('teachers usage', 'chef', 'GET', '/teachers/tea-005/usage', () => M.TeacherService.usage('tea-005'));
// ---- Matières et notes
await check('subjects list', 'chef', 'GET', '/subjects', () => M.SubjectService.list());
await check('subjects list enseignant', 'enseignant', 'GET', '/subjects?teacherId=tea-005', () => M.SubjectService.list({ teacherId: 'tea-005' }));
await check('subjects get', 'chef', 'GET', '/subjects/sub-043', () => M.SubjectService.get('sub-043'));
await check('subjects usage', 'chef', 'GET', '/subjects/sub-043/usage', () => M.SubjectService.usage('sub-043'));
await check('grades list chef', 'chef', 'GET', '/grades', () => M.GradeService.list());
await check('grades list ?studentId', 'chef', 'GET', '/grades?studentId=stu-018', () => M.GradeService.list({ studentId: 'stu-018' }));
await check('grades counts', 'chef', 'GET', '/grades/counts', () => M.GradeService.countByStatus());
await check('grades sheet sub-001 (chef)', 'chef', 'GET', '/subjects/sub-001/grade-sheet', () => M.GradeService.sheet('sub-001'));
await check('grades sheet DS403 (enseignant)', 'enseignant', 'GET', '/subjects/sub-043/grade-sheet', () => M.GradeService.sheet('sub-043'));
await check('grades history (étudiant)', 'etudiant', 'GET', '/students/stu-018/grades/history', () => M.GradeService.studentHistory('stu-018'));
// ---- Bulletins
await check('bulletins list', 'chef', 'GET', '/bulletins', () => M.BulletinService.list());
await check('bulletins list (étudiant)', 'etudiant', 'GET', '/bulletins?studentId=stu-018', () => M.BulletinService.list({ studentId: 'stu-018' }));
await check('bulletins count', 'chef', 'GET', '/bulletins/count', async () => ({ count: await M.BulletinService.count() }));
await check('bulletins overview', 'chef', 'GET', '/bulletins/overview', () => M.BulletinService.overview());
await check('bulletins report (étudiant)', 'etudiant', 'GET', '/students/stu-018/report', () => M.BulletinService.getReport('stu-018'));
await check('bulletins detail (étudiant)', 'etudiant', 'GET', '/students/stu-018/bulletin', () => M.BulletinService.detail('stu-018'));
await check('bulletins document (étudiant)', 'etudiant', 'GET', '/students/stu-018/bulletin/document', () => M.BulletinService.getDocument('stu-018'));
await check('bulletins detail incomplet (chef)', 'chef', 'GET', '/students/stu-001/bulletin', () => M.BulletinService.detail('stu-001'));
// ---- Séances, heures, présences
await check('sessions list ?teacherId', 'chef', 'GET', '/sessions?teacherId=tea-005', () => M.SessionService.list({ teacherId: 'tea-005' }), { unordered: true });
await check('sessions detailed (enseignant)', 'enseignant', 'GET', '/sessions/detailed', () => M.SessionService.detailed({ teacherId: 'tea-005' }));
await check('sessions detailed (chef) période', 'chef', 'GET', '/sessions/detailed?from=2026-12-01&to=2027-01-25', () => M.SessionService.detailed({ from: '2026-12-01', to: '2027-01-25' }));
await check('sessions stats', 'chef', 'GET', '/sessions/stats', () => M.SessionService.stats());
await check('sessions stats (enseignant)', 'enseignant', 'GET', '/sessions/stats', () => M.SessionService.stats({ teacherId: 'tea-005' }));
await check('sessions get', 'chef', 'GET', '/sessions/ses-0001', () => M.SessionService.get('ses-0001'));
await check('hours teacher', 'enseignant', 'GET', '/teachers/tea-005/hours', () => M.HoursService.summary('tea-005'));
await check('hours all', 'chef', 'GET', '/hours', () => M.HoursService.summaries());
await check('checkins institution', 'enseignant', 'GET', '/institution/location', async () => ({ ...(await M.PresenceService.institution()), maxAccuracy: 100 }));
await check('checkins list', 'enseignant', 'GET', '/checkins?teacherId=tea-005', () => M.PresenceService.list({ teacherId: 'tea-005' }));
// ---- Calendrier
await check('events list (chef)', 'chef', 'GET', '/events', () => M.EventService.list());
await check('events list (étudiant)', 'etudiant', 'GET', '/events', () => M.EventService.list({ role: 'etudiant' }));
await check('events get', 'etudiant', 'GET', '/events/evt-008', () => M.EventService.get('evt-008', 'etudiant'));
await check('events get hors audience → 404', 'etudiant', 'GET', '/events/evt-006', () => null, { status: 404 });
await check('events rattrapage-open', 'etudiant', 'GET', '/events/rattrapage-open', async () => ({ open: await M.EventService.rattrapageOpen() }));
await check('events notification-count', 'chef', 'GET', '/events/evt-006/notification-count', async () => ({ count: await M.EventService.notificationCount('evt-006') }));
await check('notifications (enseignant)', 'enseignant', 'GET', '/notifications?limit=5', () => M.NotificationService.listForUser('usr-tea-005', 5));
await check('notifications unread-count', 'enseignant', 'GET', '/notifications/unread-count', async () => ({ count: await M.NotificationService.unreadCount('usr-tea-005') }));
// ---- Comptes
await check('me/profile (enseignant)', 'enseignant', 'GET', '/me/profile', () => M.AccountService.profile('usr-tea-005'));
await check('me/profile (étudiant)', 'etudiant', 'GET', '/me/profile', () => M.AccountService.profile('usr-stu-018'));
await check('me/profile (chef)', 'chef', 'GET', '/me/profile', () => M.AccountService.profile('usr-chef'));
await check('accounts list', 'chef', 'GET', '/accounts', () => M.AccountService.list({}, chef));
await check('accounts filtre', 'chef', 'GET', '/accounts?role=enseignant&q=herve', () => M.AccountService.list({ role: 'enseignant', q: 'herve' }, chef));
await check('auth/me', 'enseignant', 'GET', '/auth/me', async () => (await M.AccountService.profile('usr-tea-005')).user);
// ---- Statistiques
await check('stats teaching-weekly', 'chef', 'GET', `/stats/teaching-weekly?from=${W.from}&to=${W.to}`, () => M.StatsService.teachingWeekly(W));
await check('stats teaching-weekly (enseignant)', 'enseignant', 'GET', `/stats/teaching-weekly?teacherId=tea-005&from=${W.from}&to=${W.to}`, () => M.StatsService.teachingWeekly({ ...W, teacherId: 'tea-005' }));
await check('stats class-averages', 'chef', 'GET', '/stats/class-averages', () => M.StatsService.classAverages());
await check('stats grade-progress', 'chef', 'GET', '/stats/grade-progress', () => M.StatsService.gradeProgress());
await check('stats department-results', 'chef', 'GET', '/stats/department-results', () => M.StatsService.departmentResults());
await check('stats recent-absences', 'chef', 'GET', `/stats/recent-absences?limit=5&from=${W.from}&to=${W.to}`, () => M.StatsService.recentAbsences(5, W));
await check('stats hours-progress', 'chef', 'GET', `/stats/hours-progress?limit=6&from=${W.from}&to=${W.to}`, () => M.StatsService.hoursProgress(6, W));
await check('stats subject-rows', 'chef', 'GET', '/stats/subject-rows', () => M.StatsService.subjectRows());
await check('stats teacher-rows', 'chef', 'GET', '/stats/teacher-rows', () => M.StatsService.teacherRows());
await check('stats hours-overview', 'chef', 'GET', `/stats/hours-overview?from=${W.from}&to=${W.to}`, () => M.StatsService.hoursOverview(W));
await check('stats teacher recent-sessions', 'enseignant', 'GET', `/stats/teachers/tea-005/recent-sessions?limit=5&from=${W.from}&to=${W.to}`, () => M.StatsService.recentSessions('tea-005', 5, W));
await check('stats teacher overview', 'enseignant', 'GET', '/stats/teachers/tea-005/overview', () => M.StatsService.teacherOverview('tea-005'));
await check('stats student overview', 'etudiant', 'GET', '/stats/students/stu-018/overview', () => M.StatsService.studentOverview('stu-018'));

console.log(`\nOrdre différent de la référence (sans conséquence si la page trie elle-même) : ${softOrder.join(', ') || 'aucun'}`);
console.log(`\n=== PARITÉ : ${pass} conformes, ${fail} en écart ===`);
for (const [n, m] of failures) console.log(`\n✗ ${n}\n      ${m}`);
if (fail) process.exitCode = 1;
