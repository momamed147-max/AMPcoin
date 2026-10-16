/**
 * List every tab strip in the product: its container class, its item class, and
 * how the selected item is marked.
 *
 * WHY
 * ---
 * There are nine separate tab implementations in the codebase - ui-tabs,
 * cf-tabs, jp-tabs, ug-tabs, admin-tabs, fair-tabs, leaderboard-tabs,
 * vc-rarity-tabs, oc-tabs - each with its own container rule, its own item rule
 * and its own idea of what "selected" looks like. That is the visible reason a
 * page can feel like it belongs to a different product from its neighbour, and
 * it is why unifying them cannot be done by editing one stylesheet: somebody
 * has to know what all nine are.
 *
 * This is the inventory. Once it exists, one rule in ui/components.css can
 * carry every container and every item, and each page's own sheet can drop its
 * duplicate without losing the classes its markup still uses.
 *
 *   node tools/tab-inventory.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src');

const jsFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) jsFiles.push(p);
  }
})(SRC);

// Every class that looks like a tab strip or a tab inside one.
const STRIP = /^(ui|cf|jp|ug|admin|fair|leaderboard|oc|vc|moderator)?-?tabs$/;
const ITEM = /^(?:ui|cf|jp|ug|admin|fair|leaderboard|oc|vc|moderator)?-?(?:tab|tab-btn|rarity-tab)$/;

const found = [];

for (const file of jsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(SRC, file).replace(/\\/g, '/');

  for (const m of src.matchAll(/className=\{?["`]([^"'`]+)["`]/g)) {
    for (const raw of m[1].split(/\s+/)) {
      const c = raw.replace(/\$\{.*$/, '').replace(/\s*$/, '');
      if (!c) continue;

      const isStrip = STRIP.test(c);
      const isItem = ITEM.test(c);
      // "active" / "selected" / "is-active" suffix is how each strip marks the
      // current tab. Which spelling is used is exactly what this needs to know.
      const state = /is-active|_active|-active|selected|is-selected/.test(c);

      if (!isStrip && !isItem && !state) continue;
      if (/table|content/i.test(c)) continue;

      const entry = found.find((f) => f.rel === rel && f.cls === c);
      if (entry) { entry.hits++; continue; }
      found.push({ rel, cls: c, kind: isStrip ? 'strip' : isItem ? 'item' : 'state', hits: 1 });
    }
  }
}

const groups = new Map();
for (const f of found) {
  if (!groups.has(f.cls)) groups.set(f.cls, { ...f, files: new Set() });
  groups.get(f.cls).files.add(f.rel);
}

const byKind = { strip: [], item: [], state: [] };
for (const g of groups.values()) byKind[g.kind].push(g);

const pad = (s, n) => String(s).padEnd(n);

console.log(`\n  ${found.length} tab class names across ${jsFiles.length} modules\n`);

console.log(`  ${pad('CONTAINER (strip)', 26)} ${pad('IN', 3)} ${pad('USED BY', 9)} FILES`);
for (const g of byKind.strip.sort((a, b) => a.cls.localeCompare(b.cls))) {
  console.log(`  ${pad(g.cls, 26)} ${pad(g.hits, 3)} ${pad(g.files.size, 9)} ${[...g.files].join(', ')}`);
}

console.log(`\n  ${pad('ITEM', 26)} ${pad('IN', 3)} ${pad('USED BY', 9)} FILES`);
for (const g of byKind.item.sort((a, b) => a.cls.localeCompare(b.cls))) {
  console.log(`  ${pad(g.cls, 26)} ${pad(g.hits, 3)} ${pad(g.files.size, 9)} ${[...g.files].join(', ')}`);
}

console.log(`\n  ${pad('SELECTED MARKER', 26)} ${pad('IN', 3)} ${pad('USED BY', 9)} FILES`);
for (const g of byKind.state.sort((a, b) => a.cls.localeCompare(b.cls))) {
  console.log(`  ${pad(g.cls, 26)} ${pad(g.hits, 3)} ${pad(g.files.size, 9)} ${[...g.files].join(', ')}`);
}

const sel = [...groups.values()].map((g) => g.cls);
console.log(`\n  container selectors : ${byKind.strip.length}`);
console.log(`  item selectors      : ${byKind.item.length}`);
console.log(`  selected spellings  : ${[...new Set(byKind.state.map((g) => g.cls.replace(/^[a-z]+-/, '')))].join(', ')}`);
console.log(`  markup class names  : ${sel.length}\n`);

void ITEM; void STRIP;