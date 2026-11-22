// Matrice des droits : chaque route × (anonyme, chef). Requêtes sans effet : corps vides, identifiants inexistants pour les suppressions.
// Un seul rôle existe : tout est refusé à l'anonyme (sauf /config et la connexion), tout est permis au chef ; les routes supprimées
// avec les anciens rôles (comptes, pointages géolocalisés) répondent 404.
import { call, login } from './api-lib.mjs';
await login('chef');
const PUBLIC = [['GET', '/config', undefined]];
const PRIVATE = [
  ['GET', '/auth/me'], ['GET', '/filieres'], ['GET', '/levels'], ['GET', '/classes'], ['GET', '/units'],
  ['GET', '/students'], ['GET', '/students/count'], ['GET', '/students/stu-018'], ['GET', '/students/stu-018/removal-impact'], ['POST', '/students', {}], ['PUT', '/students/stu-999', {}], ['DELETE', '/students/stu-999'],
  ['GET', '/teachers'], ['GET', '/teachers/tea-005'], ['GET', '/teachers/tea-005/usage'], ['POST', '/teachers', {}], ['PUT', '/teachers/tea-999', {}], ['DELETE', '/teachers/tea-999'],
  ['GET', '/subjects'], ['GET', '/subjects/sub-043'], ['GET', '/subjects/sub-043/usage'], ['POST', '/subjects', {}], ['PUT', '/subjects/sub-999', {}], ['DELETE', '/subjects/sub-999'],
  ['GET', '/grades'], ['GET', '/grades/counts'], ['GET', '/subjects/sub-043/grade-sheet'], ['PUT', '/subjects/sub-043/grades/CC', { entries: [] }], ['POST', '/subjects/sub-043/grades/XX/validate', {}], ['GET', '/students/stu-018/grades/history'],
  ['GET', '/bulletins'], ['GET', '/bulletins/count'], ['GET', '/bulletins/overview'], ['POST', '/bulletins/generate', { studentIds: [] }], ['GET', '/students/stu-018/report'], ['GET', '/students/stu-018/bulletin'], ['GET', '/students/stu-018/bulletin/document'],
  ['GET', '/sessions'], ['GET', '/sessions/detailed'], ['GET', '/sessions/stats'], ['GET', '/sessions/ses-0001'], ['POST', '/sessions', {}], ['POST', '/sessions/absences', {}], ['PUT', '/sessions/ses-0001', {}], ['DELETE', '/sessions/ses-9999'],
  ['GET', '/teachers/tea-005/hours'], ['GET', '/hours'],
  ['GET', '/timetable/slots'], ['GET', '/timetable/slots/slt-001'], ['POST', '/timetable/slots', {}], ['PUT', '/timetable/slots/slt-999', {}], ['DELETE', '/timetable/slots/slt-999'],
  ['GET', '/timetable/occurrences'], ['POST', '/timetable/occurrences/confirm', {}], ['POST', '/timetable/occurrences/absence', {}], ['POST', '/timetable/occurrences/cancel', {}], ['POST', '/timetable/occurrences/restore', {}],
  ['GET', '/events'], ['GET', '/events/rattrapage-open'], ['GET', '/events/evt-008'], ['POST', '/events', {}], ['PUT', '/events/evt-999', {}], ['DELETE', '/events/evt-999'], ['GET', '/events/evt-006/notification-count'],
  ['GET', '/notifications'], ['GET', '/notifications/unread-count'], ['POST', '/notifications/ntf-9999/read', {}], ['POST', '/notifications/read-all', {}],
  ['GET', '/me/profile'], ['PATCH', '/me/contact', {}], ['PUT', '/me/photo', {}], ['PUT', '/me/password', {}], ['PUT', '/me/settings', {}],
  ['GET', '/stats/teaching-weekly'], ['GET', '/stats/class-averages'], ['GET', '/stats/grade-progress'], ['GET', '/stats/department-results'], ['GET', '/stats/recent-absences'], ['GET', '/stats/hours-progress'], ['GET', '/stats/subject-rows'], ['GET', '/stats/teacher-rows'], ['GET', '/stats/hours-overview'],
  ['GET', '/stats/teachers/tea-005/recent-sessions'], ['GET', '/stats/teachers/tea-005/overview'], ['GET', '/stats/students/stu-018/overview'],
];
const REMOVED = [['GET', '/accounts'], ['PATCH', '/accounts/usr-999', {}], ['POST', '/accounts/usr-999/reset-password', {}], ['GET', '/checkins'], ['POST', '/checkins', {}], ['GET', '/institution/location']];
let bad = 0; const rows = [];
const add = (m, p, expected, issues) => { rows.push([m, p, expected, issues]); if (issues.length) bad++; };
for (const [m, p, b] of PUBLIC) {
  const anon = await call('__anon__', m, p, b);
  add(m, p, `${anon.status}`, anon.status === 200 ? [] : [`la route publique répond ${anon.status}`]);
}
for (const [m, p, b] of PRIVATE) {
  const anon = await call('__anon__', m, p, b);
  const chef = await call('chef', m, p, b);
  const issues = [];
  if (anon.status !== 401) issues.push(`ANONYME ${anon.status} (401 attendu)`);
  if (chef.status === 401 || chef.status === 403) issues.push(`chef refusé à tort (${chef.status})`);
  if (chef.status >= 500 || anon.status >= 500) issues.push(`ERREUR 500 : anonyme=${anon.status} chef=${chef.status}`);
  add(m, p, `${anon.status}/${chef.status}`, issues);
}
for (const [m, p, b] of REMOVED) {
  const chef = await call('chef', m, p, b);
  add(m, p, `${chef.status}`, chef.status === 404 ? [] : [`route supprimée encore active (${chef.status})`]);
}
console.log('méthode chemin → statuts (anonyme/chef)');
for (const [m, p, s, i] of rows) console.log(`${i.length ? '✗' : '✓'} ${m.padEnd(6)} ${p.padEnd(46)} ${s.padEnd(10)} ${i.join(' ; ')}`);
console.log(`\n${rows.length - bad} routes conformes, ${bad} avec écart`);
if (bad) process.exitCode = 1;
