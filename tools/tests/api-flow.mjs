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
for (const r of Object.keys(ACCOUNTS)) await login(r);
const A = Object.fromEntries(Object.entries(ACCOUNTS).map(([k, v]) => [k, v.actor]));
const norm = (x) => JSON.parse(JSON.stringify(x ?? null));
let pass = 0, fail = 0; const out = [];
async function step(name, role, method, path, body, mockFn, ignore = []) {
  const r = await call(role, method, path, body);
  let m; try { m = norm(await mockFn()); } catch (e) { m = { __error: e.message, fields: e.fields }; }
  if (r.status >= 400) { fail++; out.push(`✗ ${name}\n      API ${r.status} ${r.text.slice(0, 200)} ; simulé=${JSON.stringify(m).slice(0, 120)}`); return null; }
  const d = diff(m, r.json, { ignore: ['demo', 'maxAccuracy', ...ignore] }).filter((x) => !x.soft);
  if (d.length) { fail++; const s = summarize(d); out.push(`✗ ${name}\n      ${JSON.stringify(s.byType)}\n      ${s.sample.join('\n      ')}`); } else pass++;
  return r.json;
}
const U = { id: 'x' };
const TEMP = ['temporaryPassword', 'emailSent']; // champs propres à l'API (mot de passe aléatoire, e-mail)
// 1. Étudiant : création / modification / liste
const nu = { firstName: 'Anne', lastName: 'Essomba', email: 'anne.essomba@etu.dept-info.demo', birthDate: '2005-03-04', birthPlace: 'Douala', phone: '+237 677 12 34 56', levelId: 'lvl-gl-m1' };
await step('student create', 'chef', 'POST', '/students', nu, () => M.StudentService.create(nu), TEMP);
const up = { ...nu, lastName: 'Essomba-Kamga', phone: '' };
await step('student update', 'chef', 'PUT', '/students/stu-055', up, () => M.StudentService.update('stu-055', up));
await step('student get après modif', 'chef', 'GET', '/students/stu-055', undefined, () => M.StudentService.get('stu-055'));
await step('teacher create', 'chef', 'POST', '/teachers', { firstName: 'Paul', lastName: 'Mbarga', grade: 'Vacataire', email: 'paul.mbarga@dept-info.demo', phone: '', contractHours: 60 }, () => M.TeacherService.create({ firstName: 'Paul', lastName: 'Mbarga', grade: 'Vacataire', email: 'paul.mbarga@dept-info.demo', phone: '', contractHours: 60 }), TEMP);
const ns = { code: 'ZZ101', name: 'Matière de test', coefficient: 2.5, plannedHours: 30, levelId: 'lvl-gl-m1', semester: 'S1', teacherId: 'tea-015', unitId: 'ue-005' };
await step('subject create', 'chef', 'POST', '/subjects', ns, () => M.SubjectService.create(ns));
await step('subject update (réattribution)', 'chef', 'PUT', '/subjects/sub-046', { ...ns, teacherId: 'tea-005', coefficient: 3 }, () => M.SubjectService.update('sub-046', { ...ns, teacherId: 'tea-005', coefficient: 3 }));
// 2. Notes : brouillons → validation → feuille → rattrapage
const ds = (await M.StudentService.list({ levelId: 'lvl-ds-m1' })).map((s) => s.id);
const ex = ds.map((id, i) => ({ studentId: id, value: String([9, 11.5, 8.25, 14, 10, 6][i] ?? 12) }));
await step('grades saveDrafts EXAMEN', 'enseignant', 'PUT', '/subjects/sub-043/grades/EXAMEN', { entries: ex }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'EXAMEN', entries: ex }, A.enseignant));
await step('grades sheet (brouillons)', 'enseignant', 'GET', '/subjects/sub-043/grade-sheet', undefined, () => M.GradeService.sheet('sub-043'));
const ex2 = [{ studentId: ds[0], value: '' }, { studentId: ds[1], value: '12' }];
await step('grades saveDrafts (effacer + modifier)', 'enseignant', 'PUT', '/subjects/sub-043/grades/EXAMEN', { entries: ex2 }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'EXAMEN', entries: ex2 }, A.enseignant));
await step('grades validate', 'enseignant', 'POST', '/subjects/sub-043/grades/EXAMEN/validate', {}, () => M.GradeService.validate({ subjectId: 'sub-043', type: 'EXAMEN' }, A.enseignant));
await step('grades sheet (validées)', 'chef', 'GET', '/subjects/sub-043/grade-sheet', undefined, () => M.GradeService.sheet('sub-043'));
const rat = [{ studentId: ds[2], value: '11' }];
await step('grades saveDrafts RATTRAPAGE éligible', 'enseignant', 'PUT', '/subjects/sub-043/grades/RATTRAPAGE', { entries: rat }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'RATTRAPAGE', entries: rat }, A.enseignant));
await step('grades counts', 'chef', 'GET', '/grades/counts', undefined, () => M.GradeService.countByStatus());
// 3. Bulletins
await step('bulletins overview avant génération', 'chef', 'GET', '/bulletins/overview', undefined, () => M.BulletinService.overview());
await step('bulletins generate (tous)', 'chef', 'POST', '/bulletins/generate', {}, () => M.BulletinService.generate({}, A.chef));
await step('bulletins overview après génération', 'chef', 'GET', '/bulletins/overview', undefined, () => M.BulletinService.overview());
await step('bulletins document stu-018', 'etudiant', 'GET', '/students/stu-018/bulletin/document', undefined, () => M.BulletinService.getDocument('stu-018'));
await step('stats department-results', 'chef', 'GET', '/stats/department-results', undefined, () => M.StatsService.departmentResults());
// 4. Séances / présences
const sub1 = (await M.SubjectService.list({ teacherId: 'tea-005' }))[0].id;
const sb = { subjectId: sub1, date: '2027-01-25', startTime: '08:00', endTime: '10:00', note: 'Rattrapage de TP' };
await step('session declare', 'enseignant', 'POST', '/sessions', sb, () => M.SessionService.declare(sb, A.enseignant));
await step('session update par enseignant', 'enseignant', 'PUT', '/sessions/ses-0871', { ...sb, endTime: '11:00' }, () => M.SessionService.update('ses-0871', { ...sb, endTime: '11:00', status: 'absent' }, A.enseignant));
const ab = { subjectId: sub1, date: '2027-01-22', startTime: '14:00', endTime: '16:00', note: '' };
await step('session absence par le chef', 'chef', 'POST', '/sessions/absences', ab, () => M.SessionService.recordAbsence(ab, A.chef));
await step('session update par le chef (statut)', 'chef', 'PUT', '/sessions/ses-0872', { ...ab, status: 'present', note: 'Finalement présent' }, () => M.SessionService.update('ses-0872', { ...ab, status: 'present', note: 'Finalement présent' }, A.chef));
await step('hours après séances', 'enseignant', 'GET', '/teachers/tea-005/hours', undefined, () => M.HoursService.summary('tea-005'));
const ck = { subjectId: sub1, lat: 3.8667 + 40 / 111194.9, lng: 11.5167, accuracy: 15 };
await step('checkin accepté', 'enseignant', 'POST', '/checkins', ck, () => M.PresenceService.checkIn(ck, A.enseignant), ['time']);
await step('sessions detailed verified', 'enseignant', 'GET', '/sessions/detailed?from=2027-01-25&to=2027-01-25', undefined, () => M.SessionService.detailed({ teacherId: 'tea-005', from: '2027-01-25', to: '2027-01-25' }));
await step('session remove', 'chef', 'DELETE', '/sessions/ses-0872', undefined, async () => { await M.SessionService.remove('ses-0872', A.chef); return null; });
// 5. Calendrier / notifications
const ev = { type: 'reunion', title: 'Réunion pédagogique S2', start: '2027-02-03', end: '', startTime: '09:00', endTime: '11:00', location: 'Salle 2', description: 'Préparation du S2', audience: ['chef', 'enseignant'], notify: true };
await step('event create notify', 'chef', 'POST', '/events', ev, async () => { const r = await M.EventService.create(ev, A.chef, { notify: true }); return r; });
await step('notifications enseignant', 'enseignant', 'GET', '/notifications?limit=5', undefined, () => M.NotificationService.listForUser('usr-tea-005', 5));
await step('notifications unread-count', 'enseignant', 'GET', '/notifications/unread-count', undefined, async () => ({ count: await M.NotificationService.unreadCount('usr-tea-005') }));
await step('event update notify', 'chef', 'PUT', '/events/evt-016', { ...ev, title: 'Réunion pédagogique S2 (reportée)', start: '2027-02-05' }, () => M.EventService.update('evt-016', { ...ev, title: 'Réunion pédagogique S2 (reportée)', start: '2027-02-05' }, A.chef, { notify: true }));
const ntf0 = (await call('enseignant', 'GET', '/notifications?limit=1')).json?.[0]?.id;
await call('enseignant', 'POST', `/notifications/${ntf0}/read`, {}); await M.NotificationService.markRead((await M.NotificationService.listForUser('usr-tea-005', 1))[0].id, 'usr-tea-005');
await step('notifications unread-count après lecture', 'enseignant', 'GET', '/notifications/unread-count', undefined, async () => ({ count: await M.NotificationService.unreadCount('usr-tea-005') }));
await step('events notification-count', 'chef', 'GET', '/events/evt-016/notification-count', undefined, async () => ({ count: await M.EventService.notificationCount('evt-016') }));
await step('event delete', 'chef', 'DELETE', '/events/evt-016', undefined, async () => { await M.EventService.remove('evt-016', A.chef); return null; });
// 6. Comptes
await step('me/settings', 'enseignant', 'PUT', '/me/settings', { announcements: true, reminders: ['1'], calendarView: 'agenda', sidebarCollapsed: true }, () => M.AccountService.updateSettings('usr-tea-005', { announcements: true, reminders: ['1'], calendarView: 'agenda', sidebarCollapsed: true }, A.enseignant));
await step('me/contact', 'enseignant', 'PATCH', '/me/contact', { email: 'herve.kamga@dept-info.demo', phone: '+237 699 11 22 33' }, () => M.AccountService.updateContact('usr-tea-005', { email: 'herve.kamga@dept-info.demo', phone: '+237 699 11 22 33' }, A.enseignant));
await step('me/profile après modifs', 'enseignant', 'GET', '/me/profile', undefined, () => M.AccountService.profile('usr-tea-005'));
await step('accounts setActive false', 'chef', 'PATCH', '/accounts/usr-stu-055', { active: false }, () => M.AccountService.setActive('usr-stu-055', false, A.chef));
const rl = await call('chef', 'POST', '/accounts/usr-stu-055/reset-password', {});
(rl.status === 200 && rl.json?.temporaryPassword?.length >= 10 && !('password' in (rl.json.user ?? {}))) ? pass++ : (fail++, out.push(`✗ accounts reset-password : ${rl.status} ${rl.text.slice(0, 160)}`));
// 7. Suppressions
await step('student remove-impact', 'chef', 'GET', '/students/stu-055/removal-impact', undefined, () => M.StudentService.removalImpact('stu-055'));
const del = await call('chef', 'DELETE', '/students/stu-055'); await M.StudentService.remove('stu-055');
del.status === 204 ? pass++ : (fail++, out.push(`✗ student delete : ${del.status}`));
await step('students count final', 'chef', 'GET', '/students/count', undefined, async () => ({ count: await M.StudentService.count() }));
await step('teachers list final', 'chef', 'GET', '/teachers', undefined, () => M.TeacherService.list());
console.log(`=== SCÉNARIOS D'ÉCRITURE : ${pass} conformes, ${fail} en écart ===\n${out.join('\n')}`);
if (fail) process.exitCode = 1;
