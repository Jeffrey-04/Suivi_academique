// Mini pilote de Chrome (protocole DevTools, Node ≥ 22 : WebSocket natif) pour les tests de bout en bout.
// Usage : const b = await launch({ port: 9444 }) ; b.go('pages/chef/dashboard.html') ; b.ev('document.title') ; b.close()
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const BASE = process.env.APP_BASE ?? 'http://localhost:8000/';

export async function launch({ port = 9444, outDir = tmpdir() } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'school-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(200); } }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('CONSOLE ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
  const until = async (expr, label, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return; } catch { /* page en cours de chargement */ } await sleep(100); } throw new Error('Timeout: ' + label + ' @ ' + await ev('location.href')); };
  const shot = async (name, w = 1440, h = 900, mobile = false, fullPage = false) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); await sleep(700);
    let clip;
    if (fullPage) { const m = await send('Page.getLayoutMetrics'); const s = m.result.cssContentSize; clip = { x: 0, y: 0, width: s.width, height: s.height, scale: 1 }; await send('Emulation.setDeviceMetricsOverride', { width: w, height: Math.ceil(s.height), deviceScaleFactor: 1, mobile }); await sleep(900); }
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) }); writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  const go = async (p) => { await send('Page.navigate', { url: p.startsWith('http') ? p : BASE + p }); await sleep(300); };
  const ready = () => until(`document.body.classList.contains('app-loading')===false && !document.querySelector('[aria-busy="true"]')`, 'page prête', 15000);
  const setVal = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  /** Connexion par formulaire (le garde de rôle redirige ensuite vers le tableau de bord). */
  const login = async (email, password = 'demo1234') => {
    await go('page-404.html'); await ev('sessionStorage.clear()');
    await go('page-login.html'); await until(`!!document.getElementById('email')`, 'formulaire');
    await setVal('#email', email); await setVal('#password', password);
    await ev(`document.getElementById('loginForm').requestSubmit()`);
    await until(`!location.pathname.endsWith('page-login.html') || !document.getElementById('login-error').classList.contains('d-none')`, 'résultat de connexion');
    if ((await ev('location.pathname')).endsWith('page-login.html')) throw new Error('Connexion refusée : ' + await ev(`document.getElementById('login-error').textContent`));
    await ready();
  };
  const logout = async () => { await ev(`document.querySelector('[data-action="logout"]').click()`); await until(`location.pathname.endsWith('page-login.html')`, 'déconnexion'); };
  return { send, ev, until, shot, go, ready, setVal, login, logout, sleep, errors, close: () => { ws.close(); chrome.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch { /* profil déjà supprimé */ } } };
}
