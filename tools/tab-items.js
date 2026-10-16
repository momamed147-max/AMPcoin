/**
 * Dump the markup inside each tab strip, so the item classes are read rather
 * than guessed.
 *
 * tools/tab-inventory.js finds the containers but misses the items, because
 * items are almost always written as a template literal with a conditional
 * class - `className={`jp-tab ${active ? 'jp-active' : ''}`}` - so no single
 * token matches an item pattern. Reading the four lines after each strip is
 * the reliable way.
 *
 *   node tools/tab-items.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(SRC);

const STRIPS = [
  'ui-tabs', 'cf-topbar-tabs', 'jp-tabs', 'ug-tabs', 'admin-tabs',
  'fair-tabs', 'leaderboard-tabs', 'oc-tabs', 'vc-rarity-tabs', 'moderator-tabs'
];

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const rel = path.relative(SRC, file).replace(/\\/g, '/');

  lines.forEach((line, i) => {
    const hit = STRIPS.find((s) => line.includes(`className="${s}"`) || line.includes(`'${s}'`));
    if (!hit) return;

    console.log(`\n  ${rel}  ->  .${hit}`);
    // Three lines either side is enough to reach the first item in every
    // layout seen here; the strips are written one element per line.
    for (let k = i; k < Math.min(i + 6, lines.length); k++) {
      const m = lines[k].match(/className=\{?["`]([^"'`]+)["`]/);
      const text = m ? m[1] : lines[k].trim().slice(0, 60);
      if (k === i) continue;
      console.log(`      ${String(k + 1).padStart(5)}  ${text}`);
    }
  });
}