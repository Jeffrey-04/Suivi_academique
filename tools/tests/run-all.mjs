// Lance toute la batterie de vérifications : démarre les serveurs PHP de test, rejoue chaque suite et résume.
//   DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=suivi_academique DB_USER=root DB_PASS= node tools/tests/run-all.mjs [--quick]
// Prérequis : php, Node ≥ 22, Chrome (suites navigateur), une base MySQL/MariaDB VIDE accessible (elle est réinitialisée !).
// --quick : sans les suites navigateur.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const quick = process.argv.includes('--quick');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(join(tmpdir(), 'school-tests-'));
const stubLog = join(tmp, 'mail.log');
const storage = join(tmp, 'storage');
cpSync(join(ROOT, 'backend/storage'), storage, { recursive: true });
const procs = [];
function serve(port, env, args = ['-t', '.', 'tools/dev-router.php']) {
  const p = spawn('php', ['-S', `localhost:${port}`, ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  procs.push(p);
}
const cleanup = () => { procs.forEach((p) => p.kill()); rmSync(tmp, { recursive: true, force: true }); };
process.on('exit', cleanup);

const seed = () => spawnSync('php', ['database/seed.php'], { cwd: join(ROOT, 'backend'), env: { ...process.env, APP_STORAGE_DIR: storage }, stdio: 'inherit' }).status === 0;
if (!seed()) { console.error('Impossible d\'initialiser la base (variables DB_* ?).'); process.exit(2); }

const base = { APP_STORAGE_DIR: storage, STUB_MAIL_LOG: stubLog };
serve(8000, base);
serve(8001, { ...base, MAIL_PROVIDER: 'brevo', MAIL_API_URL: 'http://localhost:8099/', MAIL_API_KEY: 'test-key', MAIL_FROM_EMAIL: 'noreply@example.cm', CRON_TOKEN: 'secrettoken123', APP_URL: 'http://localhost:8001' });
serve(8002, { ...base, DB_PORT: '1' });
serve(8099, base, [join(ROOT, 'tools/tests/stub-mail.php')]);
await sleep(2000);

const suites = [
  ['Lectures : API ≡ mode simulé', 'api-parity.mjs'], ['Droits : route × rôle', 'api-authz.mjs'], ['Écritures refusées : messages et champs', 'api-writes.mjs'],
  ['Scénarios d\'écriture', 'api-flow.mjs'], ['Sécurité', 'api-security.mjs'],
  ...(quick ? [] : [['Navigateur : balayage des pages', 'sweep.mjs'], ['Navigateur : chef', 'ui-chef.mjs'], ['Navigateur : enseignant', 'ui-enseignant.mjs'], ['Navigateur : étudiant', 'ui-etudiant.mjs']]),
];
const resetting = new Set(['api-flow.mjs', 'api-security.mjs', 'ui-chef.mjs', 'ui-enseignant.mjs', 'ui-etudiant.mjs']);
const summary = [];
for (const [label, file] of suites) {
  if (resetting.has(file) || file === 'api-parity.mjs') seed();
  console.log(`\n=== ${label} (${file})`);
  const r = spawnSync('node', [join(ROOT, 'tools/tests', file)], { cwd: ROOT, env: { ...process.env, APP_STORAGE_DIR: storage, STUB_MAIL_LOG: stubLog }, encoding: 'utf8' });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const last = out.trim().split('\n').filter((l) => /conformes|contrôles|PARITÉ|ÉCRITURES|SCÉNARIOS|SÉCURITÉ|DROITS|pages visitées|Aucun problème|erreurs console|ÉCHEC|✗|^\s{4,}\S/.test(l)).slice(-12);
  console.log(last.join('\n') || out.slice(-400));
  summary.push([label, r.status === 0]);
}
console.log('\n=== BILAN');
for (const [label, ok] of summary) console.log(`${ok ? '✓' : '✗'} ${label}`);
seed();
process.exit(summary.every(([, ok]) => ok) ? 0 : 1); // les serveurs de test gardent sinon le processus en vie
