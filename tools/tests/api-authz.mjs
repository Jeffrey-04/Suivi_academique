// Matrice des droits : chaque route × chaque rôle (requêtes sans effet : corps vides, ids inexistants pour les suppressions)
import { call, login, logout } from './api-lib.mjs';
const roles = ['anonyme', 'chef', 'enseignant', 'etudiant'];
for (const r of roles.slice(1)) await login(r);
// [méthode, chemin, corps, autorisés attendus]  (A = anonyme interdit ; "C E É" = rôles autorisés)
const R = [
  ['GET', '/auth/me', undefined, 'C E É'], ['GET', '/filieres', undefined, 'C E É'], ['GET', '/levels', undefined, 'C E É'], ['GET', '/classes', undefined, 'C E É'], ['GET', '/units', undefined, 'C E É'],
  ['GET', '/students', undefined, 'C E É'], ['GET', '/students/count', undefined, 'C'], ['GET', '/students/stu-018', undefined, 'C É'], ['GET', '/students/stu-001', undefined, 'C'], ['GET', '/students/stu-018/removal-impact', undefined, 'C'],
  ['POST', '/students', {}, 'C'], ['PUT', '/students/stu-999', {}, 'C'], ['DELETE', '/students/stu-999', undefined, 'C'],
  ['GET', '/teachers', undefined, 'C E'], ['GET', '/teachers/tea-005', undefined, 'C E'], ['GET', '/teachers/tea-005/usage', undefined, 'C'], ['POST', '/teachers', {}, 'C'], ['PUT', '/teachers/tea-999', {}, 'C'], ['DELETE', '/teachers/tea-999', undefined, 'C'],
  ['GET', '/subjects', undefined, 'C E É'], ['GET', '/subjects/sub-043', undefined, 'C E'], ['GET', '/subjects/sub-043/usage', undefined, 'C'], ['POST', '/subjects', {}, 'C'], ['PUT', '/subjects/sub-999', {}, 'C'], ['DELETE', '/subjects/sub-999', undefined, 'C'],
  ['GET', '/grades', undefined, 'C E É'], ['GET', '/grades/counts', undefined, 'C'], ['GET', '/subjects/sub-043/grade-sheet', undefined, 'C E'], ['PUT', '/subjects/sub-043/grades/CC', { entries: [] }, 'E'], ['POST', '/subjects/sub-043/grades/XX/validate', {}, 'E'], ['GET', '/students/stu-018/grades/history', undefined, 'C É'], ['GET', '/students/stu-001/grades/history', undefined, 'C'],
  ['GET', '/bulletins', undefined, 'C É'], ['GET', '/bulletins/count', undefined, 'C'], ['GET', '/bulletins/overview', undefined, 'C'], ['POST', '/bulletins/generate', { studentIds: [] }, 'C'], ['GET', '/students/stu-018/report', undefined, 'C É'], ['GET', '/students/stu-001/report', undefined, 'C'], ['GET', '/students/stu-018/bulletin', undefined, 'C É'], ['GET', '/students/stu-001/bulletin/document', undefined, 'C'],
  ['GET', '/sessions', undefined, 'C E'], ['GET', '/sessions/detailed', undefined, 'C E'], ['GET', '/sessions/stats', undefined, 'C E'], ['GET', '/sessions/ses-0001', undefined, 'C'], ['POST', '/sessions', {}, 'E'], ['POST', '/sessions/absences', {}, 'C'], ['PUT', '/sessions/ses-0001', {}, 'C'], ['DELETE', '/sessions/ses-9999', undefined, 'C E'],
  ['GET', '/teachers/tea-005/hours', undefined, 'C E'], ['GET', '/teachers/tea-001/hours', undefined, 'C'], ['GET', '/hours', undefined, 'C'],
  ['GET', '/institution/location', undefined, 'C E É'], ['GET', '/checkins', undefined, 'C E'], ['POST', '/checkins', {}, 'E'],
  ['GET', '/events', undefined, 'C E É'], ['GET', '/events/rattrapage-open', undefined, 'C E É'], ['GET', '/events/evt-008', undefined, 'C E É'], ['GET', '/events/evt-006', undefined, 'C E'], ['POST', '/events', {}, 'C'], ['PUT', '/events/evt-999', {}, 'C'], ['DELETE', '/events/evt-999', undefined, 'C'], ['GET', '/events/evt-006/notification-count', undefined, 'C'],
  ['GET', '/notifications', undefined, 'C E É'], ['GET', '/notifications/unread-count', undefined, 'C E É'], ['POST', '/notifications/ntf-9999/read', {}, 'C E É'], ['POST', '/notifications/read-all', {}, 'C E É'],
  ['GET', '/me/profile', undefined, 'C E É'], ['PATCH', '/me/contact', {}, 'C E É'], ['PUT', '/me/photo', {}, 'C E É'], ['PUT', '/me/password', {}, 'C E É'], ['PUT', '/me/settings', {}, 'C E É'],
  ['GET', '/accounts', undefined, 'C'], ['PATCH', '/accounts/usr-999', {}, 'C'], ['POST', '/accounts/usr-999/reset-password', {}, 'C'],
  ['GET', '/stats/teaching-weekly', undefined, 'C E'], ['GET', '/stats/class-averages', undefined, 'C'], ['GET', '/stats/grade-progress', undefined, 'C'], ['GET', '/stats/department-results', undefined, 'C'], ['GET', '/stats/recent-absences', undefined, 'C'], ['GET', '/stats/hours-progress', undefined, 'C'], ['GET', '/stats/subject-rows', undefined, 'C'], ['GET', '/stats/teacher-rows', undefined, 'C'], ['GET', '/stats/hours-overview', undefined, 'C'],
  ['GET', '/stats/teachers/tea-005/recent-sessions', undefined, 'C E'], ['GET', '/stats/teachers/tea-001/recent-sessions', undefined, 'C'], ['GET', '/stats/teachers/tea-005/overview', undefined, 'C E'], ['GET', '/stats/teachers/tea-001/overview', undefined, 'C'], ['GET', '/stats/students/stu-018/overview', undefined, 'C É'], ['GET', '/stats/students/stu-001/overview', undefined, 'C'],
];
const letter = { chef: 'C', enseignant: 'E', etudiant: 'É' };
let bad = 0; const rows = [];
for (const [m, p, b, allowed] of R) {
  const out = {};
  for (const role of roles) {
    const r = role === 'anonyme' ? await anon(m, p, b) : await call(role, m, p, b);
    const denied = r.status === 401 || r.status === 403 || (r.status === 404 && /^\/events\/evt/.test(p)) || (r.status === 422 && /Seul|pas l'enseignant|non autoris|ne vous|pas le droit|ne pouvez/i.test(r.text));
    out[role] = { status: r.status, denied };
  }
  const issues = [];
  if (!out.anonyme.denied && out.anonyme.status !== 401) issues.push(`ANONYME ${out.anonyme.status}`);
  for (const role of roles.slice(1)) { const want = allowed.includes(letter[role]); if (want === out[role].denied) issues.push(`${letter[role]}: ${want ? 'refusé à tort' : 'AUTORISÉ À TORT'} (${out[role].status})`); }
  if ([...Object.values(out)].some((o) => o.status >= 500)) issues.push('ERREUR 500 : ' + roles.map((r) => `${r}=${out[r].status}`).join(' '));
  rows.push([m, p, roles.map((r) => out[r].status).join('/'), issues]);
  if (issues.length) bad++;
}
function anon(m, p, b) { return call('__anon__', m, p, b); }
console.log('méthode chemin → statuts (anonyme/chef/enseignant/étudiant)');
for (const [m, p, s, i] of rows) console.log(`${i.length ? '✗' : '✓'} ${m.padEnd(6)} ${p.padEnd(46)} ${s.padEnd(16)} ${i.join(' ; ')}`);
console.log(`\n${rows.length - bad} routes conformes, ${bad} avec écart`);
if (bad) process.exitCode = 1;
