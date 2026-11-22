// Outils communs : client HTTP avec cookies (un par « rôle » : le chef, plus un client anonyme) et comparateur de formes JSON
export const BASE = process.env.API_BASE ?? 'http://localhost:8000/backend/api';
const jars = {};
export const ACCOUNTS = {
  chef: { email: 'chef@dept-info.demo', actor: { id: 'usr-chef', role: 'chef' } },
};
export async function call(role, method, path, body, { raw = false } = {}) {
  const jar = (jars[role] ??= {});
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair.indexOf('='); const name = pair.slice(0, i); const val = pair.slice(i + 1); if (val === 'deleted' || val === '') delete jar[name]; else jar[name] = val; }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { __nonJson: text.slice(0, 200) }; }
  return { status: res.status, json, text, headers: res.headers };
}
export async function login(role, password = 'demo1234') { const r = await call(role, 'POST', '/auth/login', { email: ACCOUNTS[role].email, password }); if (r.status !== 200) throw new Error(`login ${role}: ${r.status} ${r.text.slice(0, 120)}`); return r.json; }
export function logout(role) { delete jars[role]; }

const isNum = (x) => typeof x === 'number';
const kind = (x) => (x === null || x === undefined ? 'null' : Array.isArray(x) ? 'array' : typeof x);
/** Compare attendu (service simulé) et obtenu (API). Retourne la liste des écarts. */
export function diff(exp, act, { ignore = [], path = '$', unordered = false, maxDepth = 12 } = {}) {
  const out = [];
  const walk = (e, a, p, depth) => {
    if (depth > maxDepth) return;
    const ke = kind(e), ka = kind(a);
    if (ke === 'null' && ka === 'null') return;
    if (ke !== ka) { out.push({ path: p, type: 'TYPE', expected: ke === 'null' ? null : ke === 'array' || ke === 'object' ? ke : e, actual: ka === 'null' ? null : ka === 'array' || ka === 'object' ? ka : a }); return; }
    if (ke === 'array') {
      if (e.length !== a.length) out.push({ path: p, type: 'LENGTH', expected: e.length, actual: a.length });
      const keyOf = (x) => (x && typeof x === 'object' ? (x.id ?? x.teacherId ?? x.levelId ?? x.week ?? x.subject?.id ?? x.teacher?.id ?? x.student?.id ?? null) : null);
      const ek = e.map(keyOf), ak = a.map(keyOf);
      const hasId = e.length && ek.every((k) => k !== null) && ak.every((k) => k !== null) && new Set(ek).size === ek.length;
      if (hasId) {
        const byId = new Map(a.map((x, i) => [ak[i], x]));
        const orderOk = e.length === a.length && ek.every((k, i) => ak[i] === k);
        if (!orderOk) out.push({ path: p, type: 'ORDER', soft: true, expected: ek.slice(0, 3), actual: ak.slice(0, 3) });
        e.forEach((x, i) => { if (!byId.has(ek[i])) out.push({ path: `${p}[id=${ek[i]}]`, type: 'MISSING' }); else walk(x, byId.get(ek[i]), `${p}[id=${ek[i]}]`, depth + 1); });
      } else { for (let i = 0; i < Math.min(e.length, a.length); i++) walk(e[i], a[i], `${p}[${i}]`, depth + 1); }
      return;
    }
    if (ke === 'object') {
      for (const k of Object.keys(e)) {
        if (ignore.includes(k)) continue;
        if (!(k in a)) { if (e[k] !== null && e[k] !== undefined) out.push({ path: `${p}.${k}`, type: 'KEY_MISSING', expected: e[k] }); continue; }
        walk(e[k], a[k], `${p}.${k}`, depth + 1);
      }
      for (const k of Object.keys(a)) if (!(k in e) && !ignore.includes(k) && a[k] !== null) out.push({ path: `${p}.${k}`, type: 'EXTRA', actual: a[k] });
      return;
    }
    if (isNum(e) && isNum(a)) { if (Math.abs(e - a) > 1e-9) out.push({ path: p, type: 'VALUE', expected: e, actual: a }); return; }
    if (e !== a) out.push({ path: p, type: 'VALUE', expected: e, actual: a });
  };
  walk(exp, act, path, 0);
  return out;
}
export function summarize(list, max = 6) {
  list = list.filter((d) => !d.soft);
  const byType = {}; list.forEach((d) => { byType[d.type] = (byType[d.type] ?? 0) + 1; });
  const sample = []; const seen = new Set();
  for (const d of list) { const key = `${d.type}:${d.path.replace(/\[id=[^\]]+\]/g, '[]').replace(/\[\d+\]/g, '[]')}`; if (seen.has(key)) continue; seen.add(key); sample.push(`${d.type} ${d.path}${'expected' in d ? ` attendu=${JSON.stringify(d.expected)?.slice(0, 50)}` : ''}${'actual' in d ? ` obtenu=${JSON.stringify(d.actual)?.slice(0, 50)}` : ''}`); if (sample.length >= max) break; }
  return { byType, sample };
}
