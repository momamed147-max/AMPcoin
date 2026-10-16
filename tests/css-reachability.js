/**
 * Every class a page renders must be defined in a stylesheet that page loads.
 *
 * This is not hypothetical. BlackjackPage and TradingPage both rendered ~50
 * `cf-` classes whose only definition lived in CoinflipPage.css - a file they
 * never import, because it is lazy-loaded with the coinflip chunk. The result
 * was silently unstyled UI on two of the six game pages, and it survived
 * because nothing checked.
 *
 * Resolution follows the real import graph (JS -> JS and JS -> CSS), so moving a
 * rule into a new file and importing it is enough; leaving a rule behind in a
 * file nobody imports is not.
 *
 * Run: node tests/css-reachability.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src');
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

/** Resolve a relative import the way webpack does: exact, or +.js / +.css. */
function resolve(fromFile, spec) {
  const base = path.dirname(fromFile);
  const tries = [
    path.resolve(base, spec),
    path.resolve(base, '../' + spec),
    path.resolve(base, '../../' + spec)
  ];
  for (const c of tries) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    if (fs.existsSync(c + '.js')) return c + '.js';
    if (fs.existsSync(c + '.css')) return c + '.css';
  }
  return null;
}

const IMPORT_RE = /import\s+(?:[^'"]*?from\s+)?['"](\.[^'"]+)['"]/g;
const CSS_IMPORT_RE = /import\s+['"](\.[^'"]+\.css)['"]/g;

/**
 * Class names actually written into markup.
 *
 * Deliberately conservative. Quoted strings in JS are far too common ('GET',
 * 'user', 'completed') to treat as class names, so a bare quoted literal is only
 * accepted when it looks like a class: kebab-case, or a known prefix. Over-
 * collecting produces thousands of phantom "unstyled" reports and buries the
 * real defect.
 */
function renderedClasses(js) {
  const out = new Set();
  const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
  const KNOWN = /^(ui|cf|bj|jp|tr|rps|up|db|cp|toast|vc|icon|btn|pet|chat|inv|stat|mod|ring|side|result|rarity|page|row|modal|field|panel|badge)-/;
  const looks = (t) => KEBAB.test(t) || KNOWN.test(t);

  for (const m of js.matchAll(/className\s*=\s*"([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t && looks(t)) out.add(t);
  }
  // Template-literal classNames: `cf-row ${done ? 'cf-row-done' : ''}`
  for (const m of js.matchAll(/className\s*=\s*\{`([^`]*)`\}/g)) {
    for (const t of m[1].split(/\s+/)) {
      const k = t.trim();
      if (/^[\w-]+$/.test(k) && looks(k)) out.add(k);
    }
  }
  // Quoted class names in ternaries / maps: /done\? *'cf-row-done'/
  for (const m of js.matchAll(/['"]([a-z][\w-]{2,})['"]/g)) if (looks(m[1])) out.add(m[1]);
  return out;
}

/** Class names a stylesheet defines. */
function definedClasses(css) {
  const out = new Set();
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  return out;
}

const PAGES = [
  'CoinflipPage',
  'RpsPage',
  'BlackjackPage',
  'TradingPage',
  'JackpotPage',
  'UpgraderPage',
  'AdminPanel',
  'ProfilePage',
  'LeaderboardPage',
  'StatsPageV2',
  'LoginPage',
  'RegisterPage'
];

// Every stylesheet reachable from index.js, and therefore present on every
// route.
//
// Resolved from the entry point rather than written out by hand. The hardcoded
// list went stale the moment a sheet was added or renamed - it still named
// ui/tokens.css after that file was deleted, and had no idea ui/components.css
// existed - so it reported classes as "styled but unloaded" when they load on
// every single page, and would have missed a genuine miss entirely.
const GLOBAL = (function resolveMainBundle(entry) {
  const css = new Set();
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !f.endsWith('.js')) continue;
    seen.add(f);
    const src = read(f);
    for (const m of src.matchAll(IMPORT_RE)) {
      const r = resolve(f, m[1]);
      if (!r) continue;
      if (r.endsWith('.css')) css.add(r);
      else stack.push(r);
    }
  }
  return [...css];
})(path.join(SRC, 'index.js'));

let pass = 0;
let fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};

console.log('\n=== every rendered class has CSS the page actually loads ===\n');

// Every stylesheet in the project, used only to tell the two failure kinds
// apart. If this were limited to the global sheets, a rule living in a lazy
// page chunk would look "defined nowhere" instead of "defined but not loaded",
// and the check would pass while the page rendered unstyled.
const allCssText = (function walk(dir) {
  let acc = '';
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'build') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) acc += walk(p);
    else if (e.name.endsWith('.css')) acc += read(p);
  }
  return acc;
})(SRC);

let deadMarkupTotal = 0;

for (const page of PAGES) {
  const entry = path.join(SRC, 'pages', `${page}.js`);
  if (!fs.existsSync(entry)) { console.log(`  (skip ${page} - not found)`); continue; }

  // Walk the import graph, collecting every CSS the page pulls in.
  const cssFiles = new Set(GLOBAL.filter((f) => fs.existsSync(f)));
  const classes = new Set();
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith('.css')) { cssFiles.add(f); continue; }
    const src = read(f);
    for (const c of renderedClasses(src)) classes.add(c);
    for (const m of src.matchAll(IMPORT_RE)) {
      const r = resolve(f, m[1]);
      if (r) stack.push(r);
    }
  }

  // Which rendered classes have no rule anywhere at all? Those are genuine
  // dead markup. Which have a rule, but only in a stylesheet this page does not
  // load? Those are the bug: styled on one page, invisible on another.
  const reachableText = [...cssFiles].map(read).join('\n');
  const undefinedEverywhere = [];
  const definedButNotLoaded = [];
  for (const c of classes) {
    const re = new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`);
    if (re.test(reachableText)) continue;
    if (re.test(allCssText)) {
      // Styled - just not on this page. This is the exact defect: the rule
      // exists but lives in a stylesheet this page never loads, so the element
      // renders unstyled here and correctly elsewhere.
      definedButNotLoaded.push(c);
    } else {
      undefinedEverywhere.push(c);
    }
  }

  ok(
    definedButNotLoaded.length === 0,
    `${page}: every rendered class is styled by a sheet this page loads`,
    definedButNotLoaded.length
      ? `${definedButNotLoaded.length} styled-but-unloaded: ${definedButNotLoaded.slice(0, 12).join(', ')}${definedButNotLoaded.length > 12 ? ' ...' : ''}`
      : ''
  );

  // Markup with no rule anywhere is a different problem (dead class names in
  // JSX). Not a styling failure, but worth counting rather than hiding.
  deadMarkupTotal += undefinedEverywhere.length;
  if (undefinedEverywhere.length) {
    console.log(`        note: ${undefinedEverywhere.length} class names in ${page} have no CSS anywhere (dead markup, not a styling bug)`);
  }
}

console.log('\n=== the shared shell is imported by every page that renders it ===\n');
{
  const lobby = path.join(SRC, 'ui', 'lobby.css');
  ok(fs.existsSync(lobby), 'ui/lobby.css exists');
  const lobbyClasses = definedClasses(read(lobby));
  for (const page of ['CoinflipPage', 'RpsPage', 'BlackjackPage', 'TradingPage']) {
    const src = read(path.join(SRC, 'pages', `${page}.js`));
    const usesShell = [...renderedClasses(src)].some((c) => lobbyClasses.has(c));
    const imports = [...src.matchAll(CSS_IMPORT_RE)].some((m) => m[1].endsWith('ui/lobby.css'));
    ok(usesShell ? imports : true, `${page}${usesShell ? '' : ' (does not use the shell)'} imports ui/lobby.css`);
  }
}

console.log(`\n${pass} passed, ${fail} failed` + (deadMarkupTotal ? ` (${deadMarkupTotal} dead class names in markup)` : ''));
process.exit(fail ? 1 : 0);
