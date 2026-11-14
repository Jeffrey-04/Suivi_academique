// Balayage de toutes les pages des 3 rôles contre l'API : console sans erreur, accessibilité de base, mobile sans défilement
// horizontal, et page utilisable quand l'API tombe en panne (un bloc en erreur ne casse pas la page).
// Usage : node tools/tests/sweep.mjs [normal|mobile|panne|mock|all]   (mock : mode démonstration sans serveur, ?mock=1)
// Ancien usage :   (serveur et base lancés, voir tools/tests/README.md)
import { launch } from './cdp.mjs';

const mode = process.argv[2] ?? 'all';
const pages = {
  chef: ['dashboard', 'etudiants', 'etudiant?id=stu-001', 'enseignants', 'enseignant?id=tea-005', 'matieres', 'notes', 'bulletins', 'bulletin?student=stu-001', 'heures', 'presences', 'calendrier', 'comptes', 'profil'],
  enseignant: ['dashboard', 'matieres', 'saisie-notes', 'marquer-presence', 'declarer-seance', 'seances', 'calendrier', 'profil'],
  etudiant: ['dashboard', 'notes', 'bulletin', 'calendrier', 'profil'],
};
const accounts = { chef: 'chef@dept-info.demo', enseignant: 'herve.kamga@dept-info.demo', etudiant: 'ulrich.foning@etu.dept-info.demo' };
const A11Y = `(() => {
  const issues = [];
  const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.textContent.trim() || e.getAttribute('title') || e.querySelector('img[alt]:not([alt=""])')?.alt || '');
  document.querySelectorAll('button, [role="button"]').forEach((e) => { if (!name(e)) issues.push('bouton sans nom : ' + e.outerHTML.slice(0, 90)); });
  document.querySelectorAll('a[href]').forEach((e) => { if (!name(e)) issues.push('lien sans nom : ' + e.outerHTML.slice(0, 90)); });
  document.querySelectorAll('img').forEach((e) => { if (!e.hasAttribute('alt')) issues.push('image sans alt : ' + e.outerHTML.slice(0, 90)); });
  document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea').forEach((e) => { const lab = e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); if (!lab && !e.closest('label') && !e.getAttribute('aria-label') && !e.getAttribute('title')) issues.push('champ sans libellé : ' + e.outerHTML.slice(0, 90)); });
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => issues.push('id en double : ' + id));
  return issues;
})()`;
const b = await launch({ port: 9471 });
const results = []; let visited = 0;
const run = async (role, page, label, mobile) => {
  b.errors.length = 0;
  await b.send('Emulation.setDeviceMetricsOverride', mobile ? { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.go(`pages/${role}/${page.includes('?') ? page.replace('?', '.html?') : page + '.html'}`);
  try { await b.until(`document.body.classList.contains('app-loading')===false && !document.querySelector('[aria-busy="true"]')`, 'prête', 15000); } catch (e) { results.push(`${label} ${role}/${page} : ${e.message}`); return; }
  await b.sleep(600); visited += 1;
  const info = await b.ev(`({ blank: !(document.querySelector('main')?.innerText.trim().length > 20), hscroll: document.documentElement.scrollWidth > window.innerWidth, a11y: ${A11Y} })`);
  const problems = [];
  const exc = b.errors.filter((x) => x.startsWith('EXC')); if (exc.length) problems.push('exception : ' + exc[0].slice(0, 200));
  if (info.blank) problems.push('page vide');
  if (mobile && info.hscroll) problems.push('défilement horizontal');
  if (label === 'normal') { const c = b.errors.filter((x) => !x.startsWith('EXC')); if (c.length) problems.push('erreur console : ' + c[0].slice(0, 200)); info.a11y.slice(0, 4).forEach((x) => problems.push('a11y : ' + x)); }
  if (problems.length) results.push(`${label} ${role}/${page} : ${problems.join(' ; ')}`);
};
try {
  for (const m of (mode === 'all' ? ['normal', 'mobile', 'panne', 'mock'] : [mode])) {
    console.log('--- mode', m);
    for (const [role, list] of Object.entries(pages)) {
      if (m === 'mock') { await b.go('page-404.html'); await b.ev("localStorage.setItem('school:mode','mock'); localStorage.removeItem('school:users'); sessionStorage.clear()"); } else { await b.go('page-404.html'); await b.ev("localStorage.removeItem('school:mode')"); }
      await b.login(accounts[role]);
      if (m === 'panne') await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch; window.fetch = (u, ...r) => (/\\/backend\\/api\\//.test(String(u)) && !/\\/(auth|config)\\b/.test(String(u))) ? Promise.resolve(new Response(JSON.stringify({ message: 'panne simulée' }), { status: 500, headers: { 'Content-Type': 'application/json' } })) : f(u, ...r); })()` });
      for (const page of list) await run(role, page, m === 'mock' ? 'normal' : m, m === 'mobile');
    }
  }
} catch (e) { console.log('ERREUR DU BALAYAGE', e.message); process.exitCode = 1; }
console.log(`${visited} pages visitées`);
console.log(results.length ? results.join('\n') : 'Aucun problème détecté');
if (results.length) process.exitCode = 1;
b.close();
