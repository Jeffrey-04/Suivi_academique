// Non-régression sécurité : injection SQL, CORS, limitation des connexions, erreurs, mots de passe, e-mails, cron, droits
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { execSync } from 'node:child_process';
import { call, login, ACCOUNTS } from './api-lib.mjs';
// Requêtes SQL via l'outil PHP du backend (mêmes variables d'environnement DB_* que le serveur)
const sql = (q) => execSync(`php tests/sql.php "${q}"`, { cwd: ROOT + 'backend', env: process.env }).toString().trim();
const STUB_LOG = process.env.STUB_MAIL_LOG ?? join(tmpdir(), 'school-stub-mail.log');
const BASE = process.env.APP_BASE_URL ?? 'http://localhost:8000', MAIL_BASE = process.env.APP_MAIL_URL ?? 'http://localhost:8001', DOWN_BASE = process.env.APP_DOWN_URL ?? 'http://localhost:8002';
let pass = 0, fail = 0; const out = [];
const ok = (name, cond, detail = '') => { cond ? pass++ : (fail++, out.push(`✗ ${name} ${detail}`)); };
const raw = async (url, init = {}) => { const r = await fetch(url, { redirect: 'manual', ...init }); return { status: r.status, headers: r.headers, text: await r.text() }; };
const API = BASE + '/backend/api';
await login('chef'); await login('enseignant'); await login('etudiant');

// 1. Injection SQL (chef) : un identifiant piégé doit se comporter comme un identifiant inconnu
const bad = encodeURIComponent("zz' OR '1'='1");
for (const [p, expect] of [[`/subjects/${bad}/usage`, { grades: 0, sessions: 0 }], [`/students/${bad}/removal-impact`, { grades: 0, bulletins: 0 }]]) {
  const r = await call('chef', 'GET', p); ok(`injection ${p}`, JSON.stringify(r.json) === JSON.stringify(expect), JSON.stringify(r.json));
}
for (const p of [`/teachers/${bad}/hours`, `/stats/teachers/${bad}/overview`, `/stats/students/${bad}/overview`, `/subjects/${bad}/grade-sheet`, `/sessions/${bad}`, `/students/${bad}`, `/events/${bad}`]) {
  const r = await call('chef', 'GET', p); ok(`injection ${p}`, [403, 404, 200, 422].includes(r.status) && !/SQL|syntax|PDO/i.test(r.text), `${r.status} ${r.text.slice(0, 80)}`);
}
const q = await call('chef', 'GET', "/stats/department-results?semester=" + encodeURIComponent("S1' OR '1'='1")); ok('injection paramètre semester', q.status === 200 && q.json?.total === 54 && !/SQL/i.test(q.text), `${q.status} ${q.text.slice(0, 100)}`);
const q2 = await call('chef', 'GET', "/students?levelId=" + encodeURIComponent("x' OR 1=1 -- ")); ok('injection filtre levelId', q2.status === 200 && Array.isArray(q2.json) && q2.json.length === 0);
// 2. Page department-results (mots réservés) fonctionne
const dr = await call('chef', 'GET', '/stats/department-results'); ok('department-results', dr.status === 200 && dr.json.total === 54 && dr.json.counts.Admis === 17, dr.text.slice(0, 120));
// 3. Fichiers internes
for (const f of ['backend/config/config.php', 'backend/src/Auth.php', 'backend/database/schema.sql', 'backend/storage/instance.json', 'backend/tests/reference-check.php', 'backend/test_api.php', 'tools/generate-mock.mjs', '.git/config', 'CLAUDE.md', 'backend/docs/openapi.yaml']) {
  const r = await raw(`${BASE}/${f}`); ok(`fichier interdit ${f}`, r.status === 403 || r.status === 404, String(r.status));
}
// 4. CORS / CSRF
const evil = { Origin: 'https://evil.example' };
let r = await raw(`${API}/auth/me`, { headers: evil }); ok('CORS : pas d\'en-tête pour une origine étrangère', !r.headers.get('access-control-allow-origin'));
r = await raw(`${API}/students`, { method: 'OPTIONS', headers: { ...evil, 'Access-Control-Request-Method': 'GET' } }); ok('CORS : préconditions refusées', r.status === 403);
r = await raw(`${API}/auth/login`, { method: 'POST', headers: { ...evil, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ACCOUNTS.chef.email, password: 'demo1234' }) }); ok('CSRF : écriture depuis une origine étrangère refusée', r.status === 403, String(r.status));
r = await raw(`${API}/config`, { headers: { Origin: BASE } }); ok('même origine acceptée', r.headers.get('access-control-allow-origin') === BASE);
// 5. Erreurs
r = await raw(`${API}/students`, { method: 'PATCH' }); ok('405 avec en-tête Allow', r.status === 405 && /GET/.test(r.headers.get('allow') ?? ''), `${r.status} ${r.headers.get('allow')}`);
r = await raw(`${API}/inconnu`); ok('404 JSON', r.status === 404 && /message/.test(r.text));
r = await raw(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' }); ok('JSON invalide → 400', r.status === 400, String(r.status));
r = await raw(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '2000000' }, body: 'x'.repeat(10) }).catch(() => ({ status: 0 })); ok('corps trop volumineux (ou refusé)', [413, 0, 400].includes(r.status), String(r.status));
r = await raw(`${DOWN_BASE}/backend/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"a@b.cd","password":"x"}' }); ok('base injoignable → JSON générique sans détail', r.status === 500 && /message/.test(r.text) && !/SQLSTATE|PDO|getaddr|Connection/i.test(r.text), r.text.slice(0, 160));
ok('en-tête X-Powered-By retiré', !(await raw(`${API}/config`)).headers.get('x-powered-by'));
// 6. Limitation des connexions
sql('DELETE FROM login_attempts');
const codes = []; for (let i = 0; i < 7; i++) { const x = await call('__t__', 'POST', '/auth/login', { email: ACCOUNTS.etudiant.email, password: 'faux' + i }); codes.push(x.status); }
ok('5 échecs puis blocage 429', codes.slice(0, 5).every((c) => c === 422) && codes[5] === 429 && codes[6] === 429, codes.join(','));
const lockedGood = await call('__t__', 'POST', '/auth/login', { email: ACCOUNTS.etudiant.email, password: 'demo1234' }); ok('même le bon mot de passe est refusé pendant le blocage', lockedGood.status === 429, String(lockedGood.status));
const other = await call('__t2__', 'POST', '/auth/login', { email: ACCOUNTS.enseignant.email, password: 'demo1234' }); ok('les autres adresses ne sont pas bloquées', other.status === 200);
sql('DELETE FROM login_attempts');
const okAfter = await call('__t3__', 'POST', '/auth/login', { email: ACCOUNTS.etudiant.email, password: 'demo1234' }); ok('connexion possible après le délai', okAfter.status === 200);
// 7. Mot de passe temporaire + e-mail (serveur 8001 configuré avec le faux service d'e-mails)
const API1 = `${MAIL_BASE}/backend/api`;
const jar = {}; const call1 = async (m, p, b) => { const h = { Accept: 'application/json', Origin: MAIL_BASE }; if (b !== undefined) h['Content-Type'] = 'application/json'; const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); if (c) h.Cookie = c; const res = await fetch(API1 + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) }); for (const sc of res.headers.getSetCookie?.() ?? []) { const [pair] = sc.split(';'); const i = pair.indexOf('='); jar[pair.slice(0, i)] = pair.slice(i + 1); } const t = await res.text(); return { status: res.status, json: t ? JSON.parse(t) : null }; };
await call1('POST', '/auth/login', { email: ACCOUNTS.chef.email, password: 'demo1234' });
const ns = await call1('POST', '/students', { firstName: 'Sécu', lastName: 'Test', email: 'secu.test@etu.dept-info.demo', birthDate: '2005-02-02', levelId: 'lvl-gl-m1' });
ok('création étudiant → mot de passe temporaire aléatoire', ns.status === 201 && /^[A-Za-z0-9]{11}$/.test(ns.json?.temporaryPassword ?? '') && ns.json.temporaryPassword !== 'demo1234', JSON.stringify(ns.json).slice(0, 160));
ok('e-mail envoyé (service stub)', ns.json?.emailSent === true);
const stubLog = readFileSync(STUB_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const mail = stubLog.at(-1); ok('requête e-mail : clé d\'API, destinataire, mot de passe', mail?.headers['api-key'] === 'test-key' && mail.body.to[0].email === 'secu.test@etu.dept-info.demo' && mail.body.textContent.includes(ns.json.temporaryPassword) && mail.body.sender.email === 'noreply@example.cm', JSON.stringify(mail)?.slice(0, 200));
const lg = await call('__n__', 'POST', '/auth/login', { email: 'secu.test@etu.dept-info.demo', password: ns.json.temporaryPassword }); ok('connexion avec le mot de passe temporaire', lg.status === 200 && lg.json.mustChangePassword === true);
const old = await call('__o__', 'POST', '/auth/login', { email: 'secu.test@etu.dept-info.demo', password: 'demo1234' }); ok('demo1234 ne fonctionne PAS sur un compte créé', old.status === 422);
const rs = await call1('POST', `/accounts/usr-${ns.json.id}/reset-password`, {}); ok('réinitialisation : mot de passe + e-mail', rs.status === 200 && rs.json.temporaryPassword.length === 11 && rs.json.emailSent === true);
// 8. Cron web
let c = await raw(`${MAIL_BASE}/backend/cron/reminders.php?token=mauvais`); ok('cron : mauvais jeton → 404', c.status === 404);
c = await raw(`${MAIL_BASE}/backend/cron/reminders.php`); ok('cron : sans jeton → 404', c.status === 404);
c = await raw(`${MAIL_BASE}/backend/cron/reminders.php?token=secrettoken123`); ok('cron : bon jeton → JSON', c.status === 200 && /"added"/.test(c.text), c.text.slice(0, 100));
c = await raw(`${BASE}/backend/cron/reminders.php?token=secrettoken123`); ok('cron désactivé sans jeton configuré', c.status === 404);
// 9. Nettoyage
await call1('DELETE', `/students/${ns.json.id}`);
console.log(`=== SÉCURITÉ : ${pass} contrôles réussis, ${fail} en échec ===\n${out.join('\n')}`);
if (fail) process.exitCode = 1;
