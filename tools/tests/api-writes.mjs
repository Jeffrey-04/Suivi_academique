// Écritures refusées : compare les messages / champs d'erreur de l'API à ceux des services du frontend (mode simulé)
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

import { fileURLToPath } from 'node:url';
globalThis.SCHOOL_MODE = 'mock'; // services du frontend en mode simulé : c'est la RÉFÉRENCE comparée à l'API
import { call, login, ACCOUNTS } from './api-lib.mjs';
const P = ROOT;
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, get length() { return m.size; }, key: i => [...m.keys()][i] }; };
globalThis.localStorage = mem(); globalThis.sessionStorage = mem();
globalThis.fetch = ((orig) => async (u, o) => (String(u).startsWith('file:') ? (() => { const body = readFileSync(fileURLToPath(u), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; })() : orig(u, o)))(globalThis.fetch);
const M = await import(P + 'assets/js/services/index.js');
await login('chef');
const A = { chef: ACCOUNTS.chef.actor };
const only = process.argv[2]; let pass = 0, fail = 0; const out = [];
async function mockError(fn) { try { await fn(); return { ok: true }; } catch (e) { return { ok: false, message: e.message, fields: e.fields ?? {} }; } }
async function cmp(name, role, method, path, body, mockFn, { allowStatus = [422, 409], noMessage = false } = {}) {
  if (only && !name.includes(only)) return;
  const m = await mockError(mockFn); const r = await call(role, method, path, body);
  const apiOk = r.status >= 200 && r.status < 300;
  const problems = [];
  if (m.ok !== apiOk) problems.push(`résultat différent : simulé=${m.ok ? 'succès' : 'refus'} / API=${r.status}`);
  else if (!m.ok) {
    if (!allowStatus.includes(r.status)) problems.push(`statut ${r.status} (attendu ${allowStatus.join('/')})`);
    if (!noMessage && (r.json?.message ?? '') !== m.message) problems.push(`message : « ${r.json?.message ?? r.text.slice(0, 80)} » ≠ « ${m.message} »`);
    const af = r.json?.fields ?? {}; const keys = new Set([...Object.keys(m.fields), ...Object.keys(af)]);
    for (const k of keys) if (m.fields[k] !== af[k]) problems.push(`champ ${k} : « ${af[k] ?? '∅'} » ≠ « ${m.fields[k] ?? '∅'} »`);
  }
  problems.length ? (fail++, out.push(`✗ ${name}\n      ${problems.join('\n      ')}`)) : pass++;
}
const stu = { firstName: 'A', lastName: '', email: 'pas-mail', phone: 'abc', birthDate: '2015-01-01', levelId: 'x', birthPlace: 'x'.repeat(61) };
await cmp('student create invalide', 'chef', 'POST', '/students', stu, () => M.StudentService.create(stu));
const dup = { firstName: 'Anne', lastName: 'Test', email: 'ulrich.foning@etu.dept-info.demo', birthDate: '2005-01-01', levelId: 'lvl-gl-m1' };
await cmp('student create e-mail déjà pris', 'chef', 'POST', '/students', dup, () => M.StudentService.create(dup));
const old = { firstName: 'Anne', lastName: 'Test', email: 'a@b.cd', birthDate: '1930-01-01', levelId: 'lvl-gl-m1' };
await cmp('student create date de naissance trop ancienne', 'chef', 'POST', '/students', old, () => M.StudentService.create(old));
const chg = { firstName: 'Ulrich', lastName: 'Foning', email: 'ulrich.foning@etu.dept-info.demo', birthDate: '2002-01-01', levelId: 'lvl-gl-l2' };
await cmp('student update changement de classe avec notes', 'chef', 'PUT', '/students/stu-018', chg, () => M.StudentService.update('stu-018', chg));
await cmp('student update inconnu', 'chef', 'PUT', '/students/stu-999', chg, () => M.StudentService.update('stu-999', chg), { allowStatus: [404, 422] });
const tch = { firstName: '', lastName: 'X', grade: 'Roi', email: 'x', phone: '1', contractHours: 900 };
await cmp('teacher create invalide', 'chef', 'POST', '/teachers', tch, () => M.TeacherService.create(tch));
const tdup = { firstName: 'Paul', lastName: 'Test', grade: 'Vacataire', email: 'herve.kamga@dept-info.demo', phone: '', contractHours: 60 };
await cmp('teacher create e-mail déjà pris', 'chef', 'POST', '/teachers', tdup, () => M.TeacherService.create(tdup));
await cmp('teacher delete avec matières', 'chef', 'DELETE', '/teachers/tea-005', undefined, () => M.TeacherService.remove('tea-005'), { allowStatus: [409, 422] });
const sub = { code: 'x', name: 'ab', coefficient: 99, plannedHours: 0, levelId: 'x', semester: 'S9', teacherId: 'tea-xxx', unitId: 'ue-xxx' };
await cmp('subject create invalide', 'chef', 'POST', '/subjects', sub, () => M.SubjectService.create(sub));
const dupc = { code: 'DS403', name: 'Autre matière', coefficient: 2, plannedHours: 30, levelId: 'lvl-ds-m1', semester: 'S1', teacherId: 'tea-005' };
await cmp('subject create code déjà utilisé', 'chef', 'POST', '/subjects', dupc, () => M.SubjectService.create(dupc));
const s1 = (await M.SubjectService.get('sub-001'));
const upS = { code: s1.code, name: s1.name, coefficient: s1.coefficient, plannedHours: s1.plannedHours, levelId: 'lvl-gl-l3', semester: s1.semester, teacherId: s1.teacherId, unitId: null };
await cmp('subject update classe figée', 'chef', 'PUT', '/subjects/sub-001', upS, () => M.SubjectService.update('sub-001', upS));
await cmp('subject delete avec notes', 'chef', 'DELETE', '/subjects/sub-001', undefined, () => M.SubjectService.remove('sub-001'), { allowStatus: [409, 422] });
// ---- Notes : le chef saisit et valide pour n'importe quelle matière
const dsStudents = (await M.StudentService.list({ levelId: 'lvl-ds-m1' })).map((s) => s.id);
const ent2 = { entries: [{ studentId: dsStudents[0], value: '25' }, { studentId: dsStudents[1], value: 'abc' }, { studentId: dsStudents[2], value: '12.345' }, { studentId: 'stu-018', value: '10' }] };
await cmp('grades saveDrafts invalide', 'chef', 'PUT', '/subjects/sub-043/grades/EXAMEN', ent2, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'EXAMEN', entries: ent2.entries }, A.chef));
await cmp('grades saveDrafts note validée', 'chef', 'PUT', '/subjects/sub-043/grades/CC', { entries: [{ studentId: dsStudents[0], value: '12' }] }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'CC', entries: [{ studentId: dsStudents[0], value: '12' }] }, A.chef));
await cmp('grades saveDrafts rattrapage non éligible', 'chef', 'PUT', '/subjects/sub-043/grades/RATTRAPAGE', { entries: [{ studentId: dsStudents[0], value: '12' }] }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'RATTRAPAGE', entries: [{ studentId: dsStudents[0], value: '12' }] }, A.chef));
await cmp('grades saveDrafts type inconnu', 'chef', 'PUT', '/subjects/sub-043/grades/XX', { entries: [] }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'XX', entries: [] }, A.chef));
await cmp('grades saveDrafts sans changement', 'chef', 'PUT', '/subjects/sub-043/grades/CC', { entries: [] }, () => M.GradeService.saveDrafts({ subjectId: 'sub-043', type: 'CC', entries: [] }, A.chef));
await cmp('grades validate sans brouillon', 'chef', 'POST', '/subjects/sub-043/grades/CC/validate', {}, () => M.GradeService.validate({ subjectId: 'sub-043', type: 'CC' }, A.chef));
// ---- Séances : le chef déclare pour l'enseignant de la matière
const ses = { subjectId: '', date: '2027-02-01', startTime: '10:00', endTime: '09:00', note: 'x'.repeat(201) };
await cmp('session déclarer invalide', 'chef', 'POST', '/sessions', ses, () => M.SessionService.declare(ses, A.chef));
const mine = (await M.SubjectService.list({ teacherId: 'tea-005' }))[0];
const clash = { subjectId: mine.id, date: '2027-01-08', startTime: '16:15', endTime: '18:15', note: '' };
await cmp('session déclarer chevauchement', 'chef', 'POST', '/sessions', clash, () => M.SessionService.declare(clash, A.chef));
const fut = { subjectId: mine.id, date: '2027-03-01', startTime: '08:00', endTime: '10:00' };
await cmp('session déclarer futur', 'chef', 'POST', '/sessions', fut, () => M.SessionService.declare(fut, A.chef));
await cmp('session absence futur', 'chef', 'POST', '/sessions/absences', fut, () => M.SessionService.recordAbsence(fut, A.chef));
await cmp('session corriger inconnue', 'chef', 'PUT', '/sessions/ses-9999', fut, () => M.SessionService.update('ses-9999', fut, A.chef));
// ---- Calendrier
const evb = { type: 'x', title: 'ab', start: '2025-01-01', end: '', startTime: '25:00', endTime: '', location: 'y'.repeat(81), description: 'z'.repeat(501) };
await cmp('event create invalide', 'chef', 'POST', '/events', evb, () => M.EventService.create(evb, A.chef));
const evm = { type: 'cc', title: 'Contrôle', start: '2027-03-01', end: '2027-03-05', startTime: '08:00', endTime: '10:00' };
await cmp('event create horaires multi-jours', 'chef', 'POST', '/events', evm, () => M.EventService.create(evm, A.chef));
await cmp('event delete inconnu', 'chef', 'DELETE', '/events/evt-999', undefined, () => M.EventService.remove('evt-999', A.chef), { allowStatus: [404, 422] });
// ---- Compte du chef
const ct = { email: 'pas-un-mail' };
await cmp('me/contact invalide', 'chef', 'PATCH', '/me/contact', ct, () => M.AccountService.updateContact('usr-chef', ct, A.chef));
const ct2 = { email: 'nouveau@dept-info.demo' };
await cmp('me/contact e-mail sans mot de passe', 'chef', 'PATCH', '/me/contact', ct2, () => M.AccountService.updateContact('usr-chef', ct2, A.chef));
const pw = { currentPassword: 'faux', newPassword: 'court', confirmPassword: 'autre' };
await cmp('me/password invalide', 'chef', 'PUT', '/me/password', pw, () => M.AccountService.changePassword('usr-chef', pw, A.chef));
const pw2 = { currentPassword: 'demo1234', newPassword: 'abcdefgh', confirmPassword: 'abcdefgh' };
await cmp('me/password sans chiffre', 'chef', 'PUT', '/me/password', pw2, () => M.AccountService.changePassword('usr-chef', pw2, A.chef));
const st = { reminders: ['3'], calendarView: 'xx' };
await cmp('me/settings invalide', 'chef', 'PUT', '/me/settings', st, () => M.AccountService.updateSettings('usr-chef', st, A.chef));
await cmp('me/photo invalide', 'chef', 'PUT', '/me/photo', { photo: 'http://x/y.png' }, () => M.AccountService.updatePhoto('usr-chef', 'http://x/y.png', A.chef));
await cmp('bulletins generate relevé incomplet', 'chef', 'POST', '/bulletins/generate', { studentIds: ['stu-001'] }, () => M.BulletinService.generate({ studentIds: ['stu-001'] }, A.chef));
// ---- Emploi du temps : validations, conflits, règles des occurrences
const period = { validFrom: '2026-09-14', validUntil: '2027-01-08' };
const bd = { subjectId: '', weekday: 9, startTime: '25:00', endTime: '10:00', room: 'x'.repeat(41), validFrom: '2025-01-01', validUntil: 'x' };
await cmp('slot create invalide', 'chef', 'POST', '/timetable/slots', bd, () => M.TimetableService.createSlot(bd, A.chef));
const dur = { subjectId: 'sub-031', weekday: 6, startTime: '08:00', endTime: '08:10', ...period };
await cmp('slot create durée trop courte', 'chef', 'POST', '/timetable/slots', dur, () => M.TimetableService.createSlot(dur, A.chef));
const inv = { subjectId: 'sub-031', weekday: 6, startTime: '08:00', endTime: '10:00', validFrom: '2027-01-08', validUntil: '2026-09-14' };
await cmp('slot create période inversée', 'chef', 'POST', '/timetable/slots', inv, () => M.TimetableService.createSlot(inv, A.chef));
const cT = { subjectId: 'sub-031', weekday: 1, startTime: '09:00', endTime: '10:00', ...period }; // tea-005 a déjà DS403 le lundi 08:00-11:00
await cmp('slot create conflit enseignant', 'chef', 'POST', '/timetable/slots', cT, () => M.TimetableService.createSlot(cT, A.chef));
const dsOther = (await M.SubjectService.list({ levelId: 'lvl-ds-m1' })).find((s) => s.teacherId && s.teacherId !== 'tea-005');
const cC = { subjectId: dsOther.id, weekday: 1, startTime: '09:00', endTime: '10:00', ...period };
await cmp('slot create conflit de classe', 'chef', 'POST', '/timetable/slots', cC, () => M.TimetableService.createSlot(cC, A.chef));
const other = (await M.SubjectService.list()).find((s) => s.teacherId && s.teacherId !== 'tea-005' && s.levelId !== 'lvl-ds-m1');
const cR = { subjectId: other.id, weekday: 1, startTime: '09:00', endTime: '10:00', room: 'salle 201', ...period }; // « Salle 201 » est prise le lundi 08:00-11:00
await cmp('slot create conflit de salle', 'chef', 'POST', '/timetable/slots', cR, () => M.TimetableService.createSlot(cR, A.chef));
await cmp('slot update inconnu', 'chef', 'PUT', '/timetable/slots/slt-999', cT, () => M.TimetableService.updateSlot('slt-999', cT, A.chef), { allowStatus: [404, 422] });
await cmp('slot delete inconnu', 'chef', 'DELETE', '/timetable/slots/slt-999', undefined, () => M.TimetableService.removeSlot('slt-999', A.chef), { allowStatus: [404, 422] });
const occ = await M.TimetableService.occurrences({ from: '2026-09-14', to: '2026-12-18' });
const done = occ.find((o) => o.status === 'done'), cancelled = (await M.TimetableService.occurrences({ from: '2026-12-14', to: '2027-01-10' })).find((o) => o.status === 'cancelled');
const toConfirm = (await M.TimetableService.occurrences({ from: '2027-01-04', to: '2027-01-10', status: 'toConfirm' }))[0];
await cmp('occurrence confirmer créneau inconnu', 'chef', 'POST', '/timetable/occurrences/confirm', { slotId: 'slt-999', date: '2027-01-06' }, () => M.TimetableService.confirm({ slotId: 'slt-999', date: '2027-01-06' }, A.chef));
await cmp('occurrence confirmer date sans cours', 'chef', 'POST', '/timetable/occurrences/confirm', { slotId: toConfirm.slotId, date: '2027-01-07' }, () => M.TimetableService.confirm({ slotId: toConfirm.slotId, date: '2027-01-07' }, A.chef));
await cmp('occurrence confirmer date invalide', 'chef', 'POST', '/timetable/occurrences/confirm', { slotId: toConfirm.slotId, date: 'x' }, () => M.TimetableService.confirm({ slotId: toConfirm.slotId, date: 'x' }, A.chef));
await cmp('occurrence confirmer déjà enregistrée', 'chef', 'POST', '/timetable/occurrences/confirm', { slotId: done.slotId, date: done.date }, () => M.TimetableService.confirm({ slotId: done.slotId, date: done.date }, A.chef));
await cmp('occurrence confirmer annulée', 'chef', 'POST', '/timetable/occurrences/confirm', { slotId: cancelled.slotId, date: cancelled.date }, () => M.TimetableService.confirm({ slotId: cancelled.slotId, date: cancelled.date }, A.chef));
await cmp('occurrence absence déjà enregistrée', 'chef', 'POST', '/timetable/occurrences/absence', { slotId: done.slotId, date: done.date }, () => M.TimetableService.markAbsent({ slotId: done.slotId, date: done.date }, A.chef));
await cmp('occurrence annuler déjà enregistrée', 'chef', 'POST', '/timetable/occurrences/cancel', { slotId: done.slotId, date: done.date }, () => M.TimetableService.cancel({ slotId: done.slotId, date: done.date }, A.chef));
await cmp('occurrence annuler déjà annulée', 'chef', 'POST', '/timetable/occurrences/cancel', { slotId: cancelled.slotId, date: cancelled.date }, () => M.TimetableService.cancel({ slotId: cancelled.slotId, date: cancelled.date }, A.chef));
const longReason = { slotId: toConfirm.slotId, date: toConfirm.date, reason: 'x'.repeat(121) };
await cmp('occurrence annuler motif trop long', 'chef', 'POST', '/timetable/occurrences/cancel', longReason, () => M.TimetableService.cancel(longReason, A.chef));
await cmp('occurrence rétablir non annulée', 'chef', 'POST', '/timetable/occurrences/restore', { slotId: done.slotId, date: done.date }, () => M.TimetableService.restore({ slotId: done.slotId, date: done.date }, A.chef));
// Les matières suivent la grille : classe figée, enseignant obligatoire, réattribution sans conflit
const d43 = await M.SubjectService.get('sub-043');
const base43 = { code: d43.code, name: d43.name, coefficient: d43.coefficient, plannedHours: d43.plannedHours, levelId: d43.levelId, semester: d43.semester, teacherId: d43.teacherId, unitId: d43.unitId };
const monday = (await M.TimetableService.slots()).find((t) => t.weekday === 1 && t.teacherId !== 'tea-005' && t.startTime < '11:00' && t.endTime > '08:00');
const noTeacher = { ...base43, teacherId: '' };
await cmp('subject update sans enseignant (créneaux)', 'chef', 'PUT', '/subjects/sub-043', noTeacher, () => M.SubjectService.update('sub-043', noTeacher));
const clashTeacher = { ...base43, teacherId: monday.teacherId };
await cmp('subject update enseignant en conflit de créneau', 'chef', 'PUT', '/subjects/sub-043', clashTeacher, () => M.SubjectService.update('sub-043', clashTeacher));
const frozen = { ...base43, levelId: 'lvl-gl-m1' };
await cmp('subject update classe figée (créneaux)', 'chef', 'PUT', '/subjects/sub-043', frozen, () => M.SubjectService.update('sub-043', frozen));
console.log(`=== ÉCRITURES REFUSÉES : ${pass} conformes, ${fail} en écart ===\n${out.join('\n')}`);
if (fail) process.exitCode = 1;
