// Contrôle statique des importations : chaque `import … from './x.js'` des modules du frontend (et chaque <script src>
// des pages HTML) doit pointer vers un fichier existant, et chaque nom importé doit être exporté par ce fichier.
// Usage : node tools/tests/check-imports.mjs
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir, ext, out = []) => {
  for (const name of readdirSync(dir)) {
    if (['libs', 'node_modules', '.git', 'References'].includes(name)) continue;
    const full = join(dir, name);
    statSync(full).isDirectory() ? walk(full, ext, out) : full.endsWith(ext) && out.push(full);
  }
  return out;
};
const exportsOf = (file) => {
  const src = readFileSync(file, 'utf8'); const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => names.add(x.split(/\s+as\s+/).pop()));
  return names;
};
let problems = 0; const report = (msg) => { problems++; console.log('✗ ' + msg); };
for (const file of walk(join(ROOT, 'assets/js'), '.js')) {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // sans commentaires
  for (const m of src.matchAll(/(?:import|export)\s+(?:([\s\S]*?)\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), m[2]);
    if (!existsSync(target)) { report(`${file.replace(ROOT, '')} : importe ${m[2]} (fichier absent)`); continue; }
    const named = m[1]?.match(/\{([^}]*)\}/)?.[1];
    if (!named) continue;
    const available = exportsOf(target);
    for (const item of named.split(',').map((x) => x.trim()).filter(Boolean)) {
      const name = item.split(/\s+as\s+/)[0];
      if (!available.has(name)) report(`${file.replace(ROOT, '')} : « ${name} » n'est pas exporté par ${m[2]}`);
    }
  }
}
for (const file of walk(ROOT, '.html')) {
  for (const m of readFileSync(file, 'utf8').matchAll(/<(?:script|link)[^>]+(?:src|href)="(\.{1,2}\/[^"#?]+)"/g)) {
    if (!existsSync(resolve(dirname(file), m[1]))) report(`${file.replace(ROOT, '')} : référence ${m[1]} (fichier absent)`);
  }
}
console.log(problems ? `${problems} problème(s)` : 'Importations et références : aucun problème');
if (problems) process.exitCode = 1;
