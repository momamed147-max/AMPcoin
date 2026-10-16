/**
 * How much of main.css is actually reachable?
 *
 * 161kb of CSS loads render-blocking on every route, so anything dead in it is
 * pure first-paint cost. Walks the frontend source for className usage and
 * reports which selectors nothing references, split by whether they look like
 * dead weight or like a false positive (dynamically composed names).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src');
const BUILD_CSS = path.join(__dirname, '..', 'frontend', 'build', 'static', 'css');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SRC);

// Everything the app could ever put in a className, plus ids.
const usedClasses = new Set();
const usedIds = new Set();

for (const f of files) {
  if (!/\.(js|jsx|html)$/.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');

  for (const m of src.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const raw = m[1] || m[2] || m[3] || m[4] || '';
    for (const token of raw.split(/[^A-Za-z0-9_-]+/)) {
      if (token) usedClasses.add(token);
    }
  }
  for (const m of src.matchAll(/\bclassList\.(?:add|remove|toggle|contains)\(\s*'([^']+)'/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach((t) => usedClasses.add(t));
  }
  for (const m of src.matchAll(/\bid=\{?["'`]([\w-]+)/g)) usedIds.add(m[1]);
}

// Read every emitted stylesheet so this reflects what actually ships.
const cssFiles = fs.existsSync(BUILD_CSS) ? fs.readdirSync(BUILD_CSS).map((f) => path.join(BUILD_CSS, f)) : [];
let allCss = '';
for (const f of cssFiles) allCss += fs.readFileSync(f, 'utf8');

const classesInCss = new Set();
for (const m of allCss.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classesInCss.add(m[1]);

const dead = [];
const live = [];
for (const c of classesInCss) {
  if (usedClasses.has(c)) live.push(c);
  else dead.push(c);
}

// Dynamic names are built at runtime, so an unmatched selector is not proof of
// anything. Flag the ones that look like a prefix of something used.
const dynamic = dead.filter((c) => [...usedClasses].some((u) => u.startsWith(c) || c.startsWith(u)));

console.log('\n  emitted stylesheets: ' + cssFiles.length);
cssFiles.forEach((f) => console.log(`    ${path.basename(f).padEnd(30)} ${Math.round(fs.statSync(f).size / 1024)}kb`));

console.log(`\n  class selectors in the built CSS : ${classesInCss.size}`);
console.log(`  matched in source                : ${live.length}`);
console.log(`  unmatched                        : ${dead.length}  ${dead.length ? `(${Math.round((dead.length / classesInCss.size) * 100)}%)` : ''}`);
console.log(`  of those, plausibly dynamic      : ${dynamic.length}`);

if (dynamic.length) {
  console.log('\n  plausibly dynamic (prefix-matched, NOT counted as dead):');
  dynamic.slice(0, 30).forEach((c) => console.log('    ' + c));
}

const confidentDead = dead.filter((c) => !dynamic.includes(c));
if (confidentDead.length) {
  console.log(`\n  confidently dead (${confidentDead.length}) - first 60:`);
  confidentDead.slice(0, 60).forEach((c) => console.log('    .' + c));
}

// Rough weight: how many bytes do the confidently-dead rules account for?
let deadBytes = 0;
const re = /([^{}]+)\{([^{}]*)\}/g;
let m2;
while ((m2 = re.exec(allCss))) {
  const sel = m2[1].trim();
  if (!/\./.test(sel)) continue;
  const names = [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((x) => x[1]);
  if (names.length && names.every((n) => confidentDead.includes(n))) deadBytes += m2[0].length;
}
console.log(`\n  bytes in confidently-dead rules : ~${Math.round(deadBytes / 1024)}kb of ${Math.round(allCss.length / 1024)}kb`);
console.log('');