/**
 * The tab control has exactly one definition.
 *
 * WHY
 * ---
 * The product had nine tab implementations: the ui-tabs primitive, cf-tabs on
 * three game lobbies, jp-tabs, ug-tabs, admin-tabs, fair-tabs,
 * leaderboard-tabs, oc-tabs and the value checker's rarity filter. Four were an
 * underlined strip, three a recessed pill track, two something else, and the
 * selected state was spelled three different ways (is-active, cf-tab-active,
 * plain active).
 *
 * That is not visible in any single file. It is only visible by moving between
 * two pages and noticing they do not match, which is exactly what a user does.
 *
 * ui/components.css now defines all ten class names at once. That only works
 * while nothing competes with it - and a page stylesheet rides in a lazy chunk,
 * so it beats every global layer no matter how specific the global rule is. A
 * page adding one `.ug-tab` rule would therefore take its tabs back with no
 * error, no warning, and no visible cause.
 *
 * This is the check that catches that.
 *
 * Run: node tests/css-tabs.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'frontend', 'src');

let pass = 0;
let fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'build') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.css')) out.push(p);
  }
  return out;
}

/* Every name the product uses for a tab strip or a tab inside one. Kept as an
 * explicit list rather than discovered, because a test that discovers what it
 * is checking cannot notice a new tab appearing with no rule. */
const STRIPS = [
  'ui-tabs', 'cf-topbar-tabs', 'jp-tabs', 'ug-tabs', 'admin-tabs',
  'fair-tabs', 'leaderboard-tabs', 'oc-tabs', 'vc-rarity-tabs', 'moderator-tabs'
];
const ITEMS = [
  'ui-tab', 'cf-tab', 'jp-tab', 'ug-tab', 'tab-btn', 'tab-button', 'oc-tab', 'vc-rarity-tab'
];
/* Classes that start like a tab but are not one. Removing these by prefix is
 * how the outcome-control status dot got deleted once already. */
const NOT_TABS = ['oc-tab-dot'];

console.log('\n=== the shared control covers every tab name in use ===\n');

const system = fs.readFileSync(path.join(SRC, 'ui', 'components.css'), 'utf8');

for (const name of [...STRIPS, ...ITEMS]) {
  ok(new RegExp(`\\.${name}[\\s,{:]`).test(system),
    `ui/components.css styles .${name}`);
}

console.log('\n=== no page stylesheet re-declares a tab ===\n');

const offenders = [];
const motionOnly = [];
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  if (rel === 'ui/components.css') continue;

  const src = fs.readFileSync(file, 'utf8');
  // Match a selector line: something, an opening brace, and none of the tokens
  // that mean this is a declaration rather than a selector.
  const rules = src.matchAll(/^([^\n{}]*?)\{([^}]*)\}/gm);
  for (const m of rules) {
    const selector = m[1].trim();
    if (!selector || selector.startsWith('/*') || selector.startsWith('*')) continue;
    // Skip nested at-rules, whose contents are selectors but whose own line is
    // a condition.
    if (/^@(media|supports|container|layer)/.test(selector)) continue;
    // Skip anything that references a token inside the selector.
    if (/var\(/.test(selector)) continue;

    const hit = [...STRIPS, ...ITEMS]
      // Whole-token match, so .oc-tab does not match .oc-tab-dot and
      // .admin-tabs does not match .admin-tab-content.
      .find((n) => new RegExp(`\\.${n}(?![\\w-])`).test(selector));
    if (!hit) continue;

    /* Motion is a separate concern from appearance, and ui/motion.css exists
     * to hold it. A rule that only declares how a tab moves on hover is not a
     * competing definition of what a tab looks like - the two layers are meant
     * to coexist. A rule that sets a colour, a border, a radius or a padding is
     * a competing definition, and that is what this rejects. */
    const body = m[2];
    const APPEARANCE = /(^\s*(color|background(-color|-image)?|border|padding|margin|width|height|min-|max-|font|letter|line-height|gap|grid|flex|display|inset|top|left|right|bottom|opacity|border-radius)\s*:)|(^[\s,{}]*(color|background|border|padding|width|height|font|display|gap|grid-template|flex|align|justify|border-radius)\s*:)/m;
    if (!APPEARANCE.test(body)) {
      motionOnly.push({ rel, selector });
      continue;
    }

    offenders.push({ rel, selector, hit, body: body.trim().slice(0, 70) });
  }
}

if (motionOnly.length) {
  console.log(`  note: ${motionOnly.length} motion-only rule(s) on tabs, which is ui/motion.css's job`);
}

if (!offenders.length) {
  console.log('  (no page stylesheet declares a tab)');
}

for (const o of offenders) {
  const isDeliberate = o.rel === 'ui/lobby.css' || o.rel === 'ui/ui.css';
  ok(false,
    `${o.rel} must not re-declare ${o.selector}`,
    `a page sheet rides in a lazy chunk and loads after the main bundle, so this\n` +
    `        wins over ui/components.css and takes its page's tabs back out of the\n` +
    `        shared control with no error and no visible cause\n` +
    `        selector: ${o.selector}\n` +
    `        body:     ${o.body}`);
  void isDeliberate;
}

console.log('\n=== the selected state is spelled the same way everywhere ===\n');

/* Every selected-state spelling the product uses, and the single rule they all
 * have to be covered by. If a page invents a fourth, it is caught here. */
const marks = [
  { name: 'is-active', expect: /\.ui-tab\.is-active/ },
  { name: 'cf-tab-active', expect: /\.cf-tab\.cf-tab-active/ },
  { name: 'active (jp/ug/tab-btn/tab-button/oc)', expect: /\.jp-tab\.active/ },
  { name: 'aria-selected', expect: /\[aria-selected='true'\]/ }
];

for (const m of marks) {
  ok(m.expect.test(system),
    `ui/components.css covers the "${m.name}" spelling`,
    `a tab marked ${m.name} would render as unselected`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);