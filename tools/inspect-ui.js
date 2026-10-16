/**
 * Frontend inventory for the redesign.
 *
 * Three questions this answers that reading files one at a time does not:
 *
 *  1. Where does every stylesheet actually load from? The global chain from
 *     index.js, and the per-route sheets that ride along in a lazy chunk. That
 *     distinction has caused repeated bugs - a global override can never beat
 *     a chunk's own CSS, because the chunk is injected after the whole main
 *     bundle.
 *  2. Where does the cascade actually stand? theme.css wraps its rules in
 *     html[data-theme], which outranks any plain class selector. Knowing how
 *     many rules are affected tells us whether an override layer is viable.
 *  3. What is shared versus page-local, so the redesign can put the shared
 *     primitives in one place instead of re-styling them per page.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'frontend', 'src');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

const files = walk(SRC);
const jsFiles = files.filter((f) => f.endsWith('.js'));
const cssFiles = files.filter((f) => f.endsWith('.css'));
const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/');

const kb = (n) => `${Math.round(n / 1024)}kb`;

// ── 1. The style graph ─────────────────────────────────────────────────────
console.log('\n  STYLE GRAPH');
console.log('  ' + '-'.repeat(72));

const globalChain = [];
for (const m of fs.readFileSync(path.join(SRC, 'index.js'), 'utf8').matchAll(/import\s+'(\.[^']+\.css)'/g)) {
  globalChain.push(m[1]);
}
console.log(`  global chain (index.js), ${globalChain.length} sheets, load order top to bottom:`);
globalChain.forEach((s, i) => console.log(`    ${i + 1}. ${s}`));

// Which stylesheets are pulled in by a component, and therefore ride along in
// whatever chunk that component is split into.
const ownedBy = new Map();
for (const js of jsFiles) {
  const src = fs.readFileSync(js, 'utf8');
  for (const m of src.matchAll(/import\s+'(\.[^']+\.css)'/g)) {
    const owner = rel(js);
    if (!ownedBy.has(m[1])) ownedBy.set(m[1], []);
    ownedBy.get(m[1]).push(owner);
  }
}

const pageCss = [...ownedBy.entries()]
  .filter(([sheet]) => !globalChain.includes(sheet))
  .sort((a, b) => a[0].localeCompare(b[0]));

console.log(`\n  sheets owned by a component (${pageCss.length}), each loads inside its own chunk:`);
pageCss.forEach(([sheet, owners]) => {
  console.log(`    ${sheet.padEnd(34)} <- ${owners.join(', ')}`);
});

// ── 2. The cascade reality ────────────────────────────────────────────────
console.log(`\n  CASCADE`);
console.log('  ' + '-'.repeat(72));

const themeRules = fs.readFileSync(path.join(SRC, 'theme.css'), 'utf8');
const themed = (themeRules.match(/html\[data-theme\][^{]*\{/g) || []).length;
console.log(`  theme.css wraps ${themed} rules in html[data-theme]  -> specificity (0,2,1)`);
console.log(`    Any plain class selector (0,1,0) loses to those. A redesign layer`);
console.log(`    therefore cannot rely on specificity alone.`);

const v3 = fs.readFileSync(path.join(SRC, 'ui', 'v3.css'), 'utf8');
const important = (v3.match(/!important/g) || []).length;
console.log(`  v3.css uses !important ${important} time(s)`);

const totalCss = cssFiles.reduce((s, f) => s + fs.statSync(f).size, 0);
console.log(`  total stylesheet source: ${kb(totalCss)} across ${cssFiles.length} files`);

// ── 3. Shared vs page-local ───────────────────────────────────────────────
console.log(`\n  SHARED COMPONENTS  (used by more than one page)`);
console.log('  ' + '-'.repeat(72));

const importCounts = new Map();
for (const js of jsFiles) {
  const src = fs.readFileSync(js, 'utf8');
  for (const m of src.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+'\.\/components\/([^']+)'/g)) {
    const names = m[1] ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]) : [m[2]];
    for (const n of names) {
      if (!n) continue;
      if (!importCounts.has(n)) importCounts.set(n, new Set());
      importCounts.get(n).add(rel(js));
    }
  }
}

const shared = [...importCounts.entries()]
  .filter(([, users]) => users.size > 1)
  .sort((a, b) => b[1].size - a[1].size);

shared.forEach(([name, users]) => console.log(`    ${name.padEnd(24)} used by ${users.size}`));

const onlyOnce = [...importCounts.entries()].filter(([, u]) => u.size === 1).length;
console.log(`\n    ${shared.length} shared across pages, ${onlyOnce} used by a single page`);

// ── 4. Route -> page -> sheet map ─────────────────────────────────────────
console.log(`\n  ROUTES`);
console.log('  ' + '-'.repeat(72));

const appSrc = fs.readFileSync(path.join(SRC, 'App.js'), 'utf8');
const lazy = new Map();
for (const m of appSrc.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\('([^']+)'\)\)/g)) {
  lazy.set(m[1], m[2]);
}
for (const m of appSrc.matchAll(/<Route\s+path="([^"]+)"[\s\S]{0,200}?<(\w+)/g)) {
  const target = lazy.get(m[2]);
  if (!target) continue;
  const jsPath = path.join(SRC, target);
  const css = fs.existsSync(jsPath) ? (fs.readFileSync(jsPath, 'utf8').match(/import\s+'(\.[^']+\.css)'/g) || []) : [];
  console.log(`    ${m[1].padEnd(16)} ${m[2].padEnd(18)} ${css.map((c) => c.replace(/import\s+'(.*)'/, '$1')).join(' ') || '(no own sheet)'}`);
}

// ── 5. Where the design tokens live today ─────────────────────────────────
console.log(`\n  TOKENS`);
console.log('  ' + '-'.repeat(72));
const tokenFiles = ['index.css', 'theme.css', 'ui/tokens.css'];
for (const tf of tokenFiles) {
  const p = path.join(SRC, tf);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const root = (src.match(/--[\w-]+\s*:/g) || []).length;
  const themed = (src.match(/html\[data-theme\]\s*\{[\s\S]*?\}/g) || []).length;
  console.log(`    ${tf.padEnd(16)} ${root} custom properties, ${themed} themed block(s)`);
}
console.log('');