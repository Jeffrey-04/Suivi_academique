// Scénarios d'écriture exécutés à l'identique sur l'API et sur les services simulés ; compare retours et états finaux.
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
await login('chef');
const A = { chef: ACCOUNTS.chef.actor };
const norm = (x) => JSON.parse(JSON.stringify(x ?? null));
let pass = 0, fail = 0; const out = [];
async function step(name, role, method, path, body, mockFn, ignore = []) {
  const r = await call(role, method, path, body);
  let m; try { m = norm(await mockFn()); } catch (e) { m = { __error: e.message, fields: e.fields }; }
  if (r.status >= 400) { fail++; out.push(`✗ ${name}\n      API ${r.status} ${r.text.slice(0, 200)} ; simulé=${JSON.stringify(m).slice(0, 120)}`); return null; }
  const d = diff(m, r.json, { ignore: ['demo', ...ignore] }).filter((x) => !x.soft);
  if (d.length) { fail++; const s = summarize(d); out.push(`✗ ${name}\n      ${JSON.stringify(s.byType)}\n      ${s.sample.join('\n      ')}`); } else pass++;
  return r.json;
}
// 1. Personnes et matières : création / modification (aucun compte n'est créé : plus de mot de passe temporaire)
const nu = { firstName: 'Anne', lastName: 'Essomba', email: 'anne.essomba@etu.dept-info.demo', birthDate: '2005-03-04', birthPlace: 'Douala', phone: '+237 677 12 34 56', levelId: 'lvl-gl-m1' };
await step('student create', 'chef', 'POST', '/students', nu, () => M.StudentService.create(nu));
const up = { ...nu, lastName: 'Essomba-Kamga', phone: '' };
await step('student update', 'chef', 'PUT', '/students/stu-055', up, () => M.StudentService.update('stu-055', up));
await step('student get après modif', 'chef', 'GET', '/students/stu-055', undefined, () => M.StudentService.get('stu-055'));
const nt = { firstName: 'Paul', lastName: 'Mbarga', grade: 'Vacataire', email: 'paul.mbarga@dept-info.demo', phone: '', contractHours: 60 };
await step('teacher create', 'chef', 'POST', '/teachers', nt, () => M.TeacherService.create(nt));
const ns = { code: 'ZZ101', name: 'Matière de test', coefficient: 2.5, plannedHours: 30, levelId: 'lvl-gl-m1', semester: 'S1', teacherId: 'tea-015', unitId: 'ue-005' };
await step('subject create', 'chef', 'POST', '/subjects', ns, () => M.SubjectService.create(ns));
await step('subject update (réattribution)', 'chef', 'PUT', '/subjects/sub-046', { ...ns, teacherId: 'tea-005', coefficient: 3 }, () => M.SubjectService.update('sub-046', { ...ns, teacherId: 'tea-005', coefficient: 3 }));
// 2. Notes : le chef saisit des brouillons → les valide → feuille → rattrapage
const ds = (await M.StudentService.list({ levelId: 'lvl-ds-m1' })).map((s) => s.id);
const ex = ds.map((id, i) => ({ studentId: id, value: String([9, 11.5, 8.25, 14, 10, 6][i] ?? 12) }));
await step('grades saveDrafts EXAMEN', 'chef', 'PUT', '/subjects/sub-043/grades/EXAMEN', { entries: ex }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'EXAMEN', entries: ex }, A.chef));
await step('grades sheet (brouillons)', 'chef', 'GET', '/subjects/sub-043/grade-sheet', undefined, () => M.GradeService.sheet('sub-043'));
const ex2 = [{ studentId: ds[0], value: '' }, { studentId: ds[1], value: '12' }];
await step('grades saveDrafts (effacer + modifier)', 'chef', 'PUT', '/subjects/sub-043/grades/EXAMEN', { entries: ex2 }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'EXAMEN', entries: ex2 }, A.chef));
await step('grades validate', 'chef', 'POST', '/subjects/sub-043/grades/EXAMEN/validate', {}, () => M.GradeService.validate({ subjectId: 'sub-043', type: 'EXAMEN' }, A.chef));
await step('grades sheet (validées)', 'chef', 'GET', '/subjects/sub-043/grade-sheet', undefined, () => M.GradeService.sheet('sub-043'));
const rat = [{ studentId: ds[2], value: '11' }];
await step('grades saveDrafts RATTRAPAGE éligible', 'chef', 'PUT', '/subjects/sub-043/grades/RATTRAPAGE', { entries: rat }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'RATTRAPAGE', entries: rat }, A.chef));
await step('grades counts', 'chef', 'GET', '/grades/counts', undefined, () => M.GradeService.countByStatus());
// 3. Bulletins
await step('bulletins overview avant génération', 'chef', 'GET', '/bulletins/overview', undefined, () => M.BulletinService.overview());
await step('bulletins generate (tous)', 'chef', 'POST', '/bulletins/generate', {}, () => M.BulletinService.generate({}, A.chef));
await step('bulletins overview après génération', 'chef', 'GET', '/bulletins/overview', undefined, () => M.BulletinService.overview());
await step('bulletins document stu-018', 'chef', 'GET', '/students/stu-018/bulletin/document', undefined, () => M.BulletinService.getDocument('stu-018'));
await step('stats department-results', 'chef', 'GET', '/stats/department-results', undefined, () => M.StatsService.departmentResults());
// 4. Séances : le chef déclare, enregistre une absence, corrige, retire
const sub1 = (await M.SubjectService.list({ teacherId: 'tea-005' }))[0].id;
const sb = { subjectId: sub1, date: '2027-01-25', startTime: '08:00', endTime: '10:00', note: 'Rattrapage de TP' };
const declared = await step('session declare', 'chef', 'POST', '/sessions', sb, () => M.SessionService.declare(sb, A.chef));
await step('session update (statut absent)', 'chef', 'PUT', `/sessions/${declared.id}`, { ...sb, endTime: '11:00', status: 'absent' }, () => M.SessionService.update(declared.id, { ...sb, endTime: '11:00', status: 'absent' }, A.chef));
const ab = { subjectId: sub1, date: '2027-01-22', startTime: '14:00', endTime: '16:00', note: '' };
const absent = await step('session absence', 'chef', 'POST', '/sessions/absences', ab, () => M.SessionService.recordAbsence(ab, A.chef));
await step('session update (présent)', 'chef', 'PUT', `/sessions/${absent.id}`, { ...ab, status: 'present', note: 'Finalement présent' }, () => M.SessionService.update(absent.id, { ...ab, status: 'present', note: 'Finalement présent' }, A.chef));
await step('hours après séances', 'chef', 'GET', '/teachers/tea-005/hours', undefined, () => M.HoursService.summary('tea-005'));
await step('sessions detailed', 'chef', 'GET', '/sessions/detailed?from=2027-01-22&to=2027-01-25', undefined, () => M.SessionService.detailed({ teacherId: 'tea-005', from: '2027-01-22', to: '2027-01-25' }));
// 5. Emploi du temps : créneau → occurrences → confirmer / absence / annuler / rétablir → modifier → supprimer
await step('timetable occurrences à confirmer', 'chef', 'GET', '/timetable/occurrences?from=2027-01-04&to=2027-01-10&status=toConfirm', undefined, () => M.TimetableService.occurrences({ from: '2027-01-04', to: '2027-01-10', status: 'toConfirm' }));
const slot = { subjectId: 'sub-031', weekday: 6, startTime: '08:00', endTime: '10:00', room: 'Salle 999', validFrom: '2027-01-11', validUntil: '2027-02-26' };
const created = await step('timetable createSlot', 'chef', 'POST', '/timetable/slots', slot, () => M.TimetableService.createSlot(slot, A.chef));
await step('timetable occurrences du nouveau créneau', 'chef', 'GET', `/timetable/occurrences?from=2027-01-25&to=2027-02-13&subjectId=sub-031`, undefined, () => M.TimetableService.occurrences({ from: '2027-01-25', to: '2027-02-13', subjectId: 'sub-031' }));
await step('timetable updateSlot', 'chef', 'PUT', `/timetable/slots/${created.id}`, { ...slot, room: 'Salle 998', endTime: '11:00' }, () => M.TimetableService.updateSlot(created.id, { ...slot, room: 'Salle 998', endTime: '11:00' }, A.chef));
await step('timetable cancel', 'chef', 'POST', '/timetable/occurrences/cancel', { slotId: created.id, date: '2027-02-06', reason: 'Jour de fête' }, () => M.TimetableService.cancel({ slotId: created.id, date: '2027-02-06', reason: 'Jour de fête' }, A.chef));
await step('timetable occurrences (annulée)', 'chef', 'GET', `/timetable/occurrences?from=2027-02-01&to=2027-02-13&subjectId=sub-031`, undefined, () => M.TimetableService.occurrences({ from: '2027-02-01', to: '2027-02-13', subjectId: 'sub-031' }));
const restored = await call('chef', 'POST', '/timetable/occurrences/restore', { slotId: created.id, date: '2027-02-06' }); await M.TimetableService.restore({ slotId: created.id, date: '2027-02-06' }, A.chef);
restored.status === 204 ? pass++ : (fail++, out.push(`✗ timetable restore : ${restored.status} ${restored.text.slice(0, 120)}`));
const todo = (await M.TimetableService.occurrences({ from: '2027-01-04', to: '2027-01-10', status: 'toConfirm' }));
const conf = await step('timetable confirm', 'chef', 'POST', '/timetable/occurrences/confirm', { slotId: todo[0].slotId, date: todo[0].date }, () => M.TimetableService.confirm({ slotId: todo[0].slotId, date: todo[0].date }, A.chef));
await step('timetable absence', 'chef', 'POST', '/timetable/occurrences/absence', { slotId: todo[1].slotId, date: todo[1].date, note: 'Maladie' }, () => M.TimetableService.markAbsent({ slotId: todo[1].slotId, date: todo[1].date, note: 'Maladie' }, A.chef));
await step('timetable occurrences après confirmations', 'chef', 'GET', '/timetable/occurrences?from=2027-01-04&to=2027-01-10', undefined, () => M.TimetableService.occurrences({ from: '2027-01-04', to: '2027-01-10' }));
await step('hours après confirmation', 'chef', 'GET', `/teachers/${todo[0].teacherId}/hours`, undefined, () => M.HoursService.summary(todo[0].teacherId));
await step('subject usage (créneaux)', 'chef', 'GET', '/subjects/sub-031/usage', undefined, () => M.SubjectService.usage('sub-031'));
// Retrait en dernier : le compteur d'identifiants de l'API ne réutilise jamais un numéro (le mode simulé, si)
await step('session remove', 'chef', 'DELETE', `/sessions/${absent.id}`, undefined, async () => { await M.SessionService.remove(absent.id, A.chef); return null; });
const gone = await call('chef', 'DELETE', `/timetable/slots/${created.id}`); await M.TimetableService.removeSlot(created.id, A.chef);
gone.status === 204 ? pass++ : (fail++, out.push(`✗ timetable delete : ${gone.status}`));
await step('timetable slots final', 'chef', 'GET', '/timetable/slots', undefined, () => M.TimetableService.slots());
// 6. Calendrier / notifications (le chef est le seul destinataire : plus de notification à l'enregistrement)
const ev = { type: 'reunion', title: 'Réunion pédagogique S2', start: '2027-02-03', end: '', startTime: '09:00', endTime: '11:00', location: 'Salle 2', description: 'Préparation du S2' };
await step('event create', 'chef', 'POST', '/events', ev, () => M.EventService.create(ev, A.chef));
await step('event update', 'chef', 'PUT', '/events/evt-016', { ...ev, title: 'Réunion pédagogique S2 (reportée)', start: '2027-02-05' }, () => M.EventService.update('evt-016', { ...ev, title: 'Réunion pédagogique S2 (reportée)', start: '2027-02-05' }, A.chef));
await step('events list après création', 'chef', 'GET', '/events', undefined, () => M.EventService.list());
await step('notifications', 'chef', 'GET', '/notifications?limit=5', undefined, () => M.NotificationService.listForUser('usr-chef', 5));
await step('notifications unread-count', 'chef', 'GET', '/notifications/unread-count', undefined, async () => ({ count: await M.NotificationService.unreadCount('usr-chef') }));
const ntf0 = (await call('chef', 'GET', '/notifications?limit=1')).json?.[0]?.id;
await call('chef', 'POST', `/notifications/${ntf0}/read`, {}); await M.NotificationService.markRead((await M.NotificationService.listForUser('usr-chef', 1))[0].id, 'usr-chef');
await step('notifications unread-count après lecture', 'chef', 'GET', '/notifications/unread-count', undefined, async () => ({ count: await M.NotificationService.unreadCount('usr-chef') }));
await step('events notification-count', 'chef', 'GET', '/events/evt-016/notification-count', undefined, async () => ({ count: await M.EventService.notificationCount('evt-016') }));
await step('event delete', 'chef', 'DELETE', '/events/evt-016', undefined, async () => { await M.EventService.remove('evt-016', A.chef); return null; });
// 7. Compte du chef
await step('me/settings', 'chef', 'PUT', '/me/settings', { reminders: ['1'], calendarView: 'agenda', sidebarCollapsed: true }, () => M.AccountService.updateSettings('usr-chef', { reminders: ['1'], calendarView: 'agenda', sidebarCollapsed: true }, A.chef));
await step('me/contact', 'chef', 'PATCH', '/me/contact', { email: 'chef@dept-info.demo' }, () => M.AccountService.updateContact('usr-chef', { email: 'chef@dept-info.demo' }, A.chef));
await step('me/profile après modifs', 'chef', 'GET', '/me/profile', undefined, () => M.AccountService.profile('usr-chef'));
// 8. Suppressions
await step('student remove-impact', 'chef', 'GET', '/students/stu-055/removal-impact', undefined, () => M.StudentService.removalImpact('stu-055'));
const del = await call('chef', 'DELETE', '/students/stu-055'); await M.StudentService.remove('stu-055');
del.status === 204 ? pass++ : (fail++, out.push(`✗ student delete : ${del.status}`));
await step('students count final', 'chef', 'GET', '/students/count', undefined, async () => ({ count: await M.StudentService.count() }));
await step('teachers list final', 'chef', 'GET', '/teachers', undefined, () => M.TeacherService.list());
console.log(`=== SCÉNARIOS D'ÉCRITURE : ${pass} conformes, ${fail} en écart ===\n${out.join('\n')}`);
if (fail) process.exitCode = 1;
