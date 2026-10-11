/**
 * Static check: every name imported from a relative module is actually exported
 * by that module, and every file it points at exists.
 *
 * A missing export is a runtime crash the bundler cannot see, which is how a
 * page ends up rendering as a blank screen while the build still says
 * "Compiled successfully".
 *
 * Run with: node src/__tests__/imports.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`); };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolveSpec(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const cands = [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')];
  return cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

/** Every name a module exports, including renamed and re-exported ones. */
function exportsOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();

  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/^\s*export\s+(?:const|let|var)\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    }
  }
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}\s*;/gm)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    }
  }
  if (/^\s*export\s+default\b/m.test(src)) names.add('default');
  for (const m of src.matchAll(/^\s*export\s+\*\s+from\s+['"]([^'"]+)['"]/gm)) {
    const t = resolveSpec(file, m[1]);
    if (t) for (const n of exportsOf(t, seen)) names.add(n);
  }
  return names;
}

const files = walk(SRC);
const missingFiles = [];
const missingExports = [];
let importCount = 0;

for (const file of files) {
  if (file.endsWith(path.join('__tests__', 'imports.js'))) continue;
  const src = fs.readFileSync(file, 'utf8');
  const re = /import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))?\s*from\s*['"](\.[^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const [, defaultA, named, star, defaultB, spec] = m;
    const rel = path.relative(SRC, file);
    const target = resolveSpec(file, spec);
    if (!target) {
      missingFiles.push(`${spec}  (imported by ${rel})`);
      continue;
    }
    if (!/\.jsx?$/.test(target)) continue;
    const avail = exportsOf(target);
    const wanted = [];
    if (named) {
      for (const part of named.split(',')) {
        const n = part.trim().split(/\s+as\s+/)[0].trim();
        if (n) wanted.push(n);
      }
    }
    if (defaultA || defaultB) wanted.push('default');
    importCount += wanted.length;
    for (const w of wanted) {
      if (!avail.has(w)) missingExports.push(`${w} from ${spec}  (imported by ${rel})`);
    }
    void star;
  }
}

console.log(`checked ${files.length} files, ${importCount} imported names`);
ok(missingFiles.length === 0,
  `every relative import points at a real file${missingFiles.length ? ` (${missingFiles.length} bad)` : ''}`);
for (const m of missingFiles) console.log(`      MISSING FILE: ${m}`);
ok(missingExports.length === 0,
  `every imported name is exported by its module${missingExports.length ? ` (${missingExports.length} bad)` : ''}`);
for (const m of missingExports) console.log(`      MISSING EXPORT: ${m}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);