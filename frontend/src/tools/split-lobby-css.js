/**
 * Splits CoinflipPage.css into the shared lobby shell and the coinflip-only
 * leftovers, by asking which pages actually render each rule.
 *
 * Why this exists: `cf-` classes are the shared betting UI - topbar, lobby
 * row, join modal, view modal - and four pages render them. But every one of
 * those rules lived in CoinflipPage.css, which is lazy-loaded with the coinflip
 * chunk. Blackjack and Trading therefore rendered ~50 classes that had no CSS
 * on their page at all. That, not taste, is why the screens looked different.
 *
 * Read-only. Prints the plan; it writes nothing.
 */
const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..'); // src/
const SRC = path.join(SRC_ROOT, 'pages', 'CoinflipPage.css');

// ── 1. tokenise top-level rules ────────────────────────────────────────────
function parseRules(css) {
  const n = css.length;
  // Skip comments / strings while looking for the next brace.
  function skipTrivia(at) {
    while (at < n) {
      if (css[at] === '/' && css[at + 1] === '*') {
        const e = css.indexOf('*/', at + 2);
        at = e === -1 ? n : e + 2;
      } else if (css[at] === '"' || css[at] === "'") {
        const q = css[at];
        at += 1;
        while (at < n && css[at] !== q) at += css[at] === '\\' ? 2 : 1;
        at += 1;
      } else if (/\s/.test(css[at])) {
        at += 1;
      } else break;
    }
    return at;
  }

  // The comment immediately preceding offset `at`, if it is separated from the
  // previous rule by nothing but whitespace. Anything else is not this rule's.
  function trailingComment(src, prevEnd, at) {
    const gap = src.slice(prevEnd, at);
    const i = gap.lastIndexOf('/*');
    if (i === -1) return null;
    // Only whitespace may follow the comment.
    if (gap.slice(i).replace(/\/\*[\s\S]*?\*\//, '').trim() !== '') return null;
    // Take the comment from the located position. Re-matching the whole gap with
    // a lazy /\*...\*\/ pattern would start at the FIRST comment and swallow
    // everything up to the last one, so every rule would carry a copy of the
    // entire file that precedes it.
    return gap.slice(i).trim();
  }

  // Parses one brace level and returns the rules found AT that level only.
  // Nested rules live on rule.nested, so the top-level list stays flat and a
  // @media block can be relocated without dragging its contents along.
  function collect(from, depth) {
    const here = [];
    let at = from;
    let prevEnd = from;
    while (at < n) {
      at = skipTrivia(at);
      if (at >= n) break;
      const brace = css.indexOf('{', at);
      if (brace === -1) break;
      const prelude = css.slice(at, brace).trim();
      let d = 1;
      let b = brace + 1;
      while (b < n && d > 0) {
        if (css[b] === '{') d += 1;
        else if (css[b] === '}') d -= 1;
        b += 1;
      }
      const body = css.slice(brace + 1, b - 1);
      const rule = { prelude, body, nested: null, depth };
      if (/^@(media|supports|container|layer)\b/i.test(prelude)) {
        rule.nested = collect(brace + 1, depth + 1);
      }
      // Keep any comments written just above this rule. They are how the file
      // is navigated - losing them would leave a 1000-line wall of rules with
      // no indication of what section each belongs to.
      rule.comment = trailingComment(css, prevEnd, at);
      here.push(rule);
      at = b;
      prevEnd = b;
    }
    return here;
  }
  return collect(0, 0);
}

function renderRules(rules) {
  let s = '';
  for (const r of rules) {
    if (r.nested) {
      s += `${r.prelude} {\n${renderRules(r.nested)}\n}\n`;
    } else {
      s += `${r.prelude} { ${r.body.trim()} }\n`;
    }
  }
  return s;
}

const classesOf = (prelude) => [...prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

// ── 2. which pages can see which class names ───────────────────────────────
const jsRead = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const cssOf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

const PAGES = {
  CoinflipPage: 'pages/CoinflipPage.js',
  RpsPage: 'pages/RpsPage.js',
  BlackjackPage: 'pages/BlackjackPage.js',
  TradingPage: 'pages/TradingPage.js',
  JackpotPage: 'pages/JackpotPage.js',
  UpgraderPage: 'pages/UpgraderPage.js'
};

function resolve(fromFile, spec) {
  const base = path.dirname(fromFile);
  const cand = [
    path.resolve(base, spec),
    path.resolve(base, '../' + spec),
    path.resolve(base, '../../' + spec),
    path.resolve(base, spec.replace(/^\.\//, ''))
  ];
  for (const c of cand) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    const idx = c + '.js';
    if (fs.existsSync(idx)) return idx;
    const idxCss = c + '.css';
    if (fs.existsSync(idxCss)) return idxCss;
  }
  return null;
}

/**
 * Every class name a page actually RENDERS: its own JSX plus the JSX of its
 * whole import closure.
 *
 * Stylesheets are deliberately NOT scanned for class names. RpsPage imports
 * CoinflipPage.css, so counting defined-but-unused classes would make every
 * cf- rule look shared with RPS and nothing would ever move. What decides the
 * split is who renders the markup, and only JS says that.
 */
function reachable(entry) {
  const classes = new Set();
  const seen = new Set();
  const stack = [path.resolve(SRC_ROOT, entry)];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!f.endsWith('.js')) continue; // follow CSS for imports, but never read it for classes
    const src = jsRead(f);
    for (const m of src.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);
    // className="cf-row" and `cf-row ${done ? 'x' : ''}` - capture bare names too
    for (const m of src.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
      for (const g of m.slice(1)) {
        if (!g) continue;
        for (const t of g.matchAll(/[\w-]+/g)) classes.add(t[0]);
      }
    }
    for (const m of src.matchAll(/['"`]([a-z][a-z0-9-]{2,})['"`]/gi)) {
      if (/^(cf|bj|jp|tr|rps|up|ui|toast|cp|db)-/.test(m[1])) classes.add(m[1]);
    }
    for (const m of src.matchAll(/import\s+(?:[^'"]*?from\s+)?['"](\.[^'"]+)['"]/g)) {
      const r = resolve(f, m[1]);
      if (r) stack.push(r);
    }
  }
  return classes;
}

const perPage = {};
for (const [name, entry] of Object.entries(PAGES)) perPage[name] = reachable(entry);
for (const [name, set] of Object.entries(perPage)) {
  console.log(`  ${name.padEnd(15)} reaches ${set.size} class names`);
}

// A class is SHARED if two or more pages can see it.
const users = new Map(); // class -> Set(page)
for (const [page, set] of Object.entries(perPage)) {
  for (const c of set) {
    if (!users.has(c)) users.set(c, new Set());
    users.get(c).add(page);
  }
}

// ── 3. partition ───────────────────────────────────────────────────────────
const rules = parseRules(jsRead(SRC).replace(/\r\n/g, '\n'));
const shared = [];
const coinflipOnly = [];
const dropped = [];

(function walk(list, into) {
  for (const r of list) {
    if (r.nested) {
      // A conditional block goes wherever the rules inside it go.
      const innerShared = [];
      const innerOwn = [];
      walk(r.nested, { shared: innerShared, own: innerOwn });
      if (innerShared.length) into.shared.push({ ...r, nested: innerShared });
      if (innerOwn.length) into.own.push({ ...r, nested: innerOwn });
      continue;
    }
    const cls = classesOf(r.prelude);
    if (!cls.length) {
      // No classes: a bare element/id/attr selector. Treat as shared - it is far
      // more likely to be a shared reset than a coinflip detail.
      into.shared.push(r);
      continue;
    }
    if (!cls.some((c) => users.has(c))) {
      (into.dead || (into.dead = [])).push(r); // nobody renders it
      continue;
    }
    const isShared = cls.some((c) => (users.get(c) || new Set()).size > 1);
    (isShared ? into.shared : into.own).push(r);
  }
})(rules, { shared, own: coinflipOnly, dead: dropped });

// ── 4. report ──────────────────────────────────────────────────────────────
/** Split a declaration block on top-level semicolons only. */
function splitDecls(body) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out.map((d) => d.trim()).filter(Boolean);
}

/**
 * Emit readable CSS: one declaration per line, nested rules indented.
 * A machine-split stylesheet is going to be read and edited by hand from here
 * on, so collapsing bodies onto one line is not acceptable.
 */
/**
 * Normalise a comment for output.
 *
 * The source file's box-drawing characters were already corrupted bytes, which
 * decode to U+FFFD. Carrying those through would permanently bake the mojibake
 * into two files that are meant to be maintained by hand, so replace the rule
 * lines with ASCII dashes and drop any remaining replacement characters.
 */
function tidyComment(c) {
  return c
    .replace(/�+/g, '-')
    .replace(/─+/g, '-')
    .replace(/═+/g, '=')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function render(rules, indent = '') {
  let s = '';
  for (const r of rules) {
    if (r.comment) s += `${indent}${tidyComment(r.comment).split('\n').map((l) => (l ? indent + l : l)).join('\n')}\n`;
    if (r.nested) {
      s += `${indent}${r.prelude} {\n${render(r.nested, indent + '  ')}${indent}}\n\n`;
    } else if (/^@keyframes/i.test(r.prelude)) {
      const frames = r.body.replace(/\s*\n\s*/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
      s += `${indent}${r.prelude} {\n`;
      s += frames.map((f) => `${indent}  ${f}`).join('\n') + '\n';
      s += `${indent}}\n\n`;
    } else {
      const decls = splitDecls(r.body);
      if (!decls.length) continue;
      s += `${indent}${r.prelude.replace(/\s+/g, ' ')} {\n`;
      s += decls.map((d) => `${indent}  ${d.replace(/\s+/g, ' ').replace(/;$/, '')};\n`).join('');
      s += `${indent}}\n\n`;
    }
  }
  return s;
}
const sharedText = render(shared);
const ownText = render(coinflipOnly);

console.log('shared rules     :', shared.length, `(${sharedText.split('\n').length} lines)`);
console.log('coinflip-only    :', coinflipOnly.length, `(${ownText.split('\n').length} lines)`);
console.log('dropped as dead  :', rules.length - shared.length - coinflipOnly.length);

// Any compound selector that mixes a shared class with a coinflip-only one
// would change meaning when the two files are separated.
const sharedCls = new Set();
for (const r of shared) for (const c of classesOf(r.prelude)) sharedCls.add(c);
const ownCls = new Set();
for (const r of coinflipOnly) for (const c of classesOf(r.prelude)) ownCls.add(c);
const mixed = [...sharedCls].filter((c) => ownCls.has(c));
console.log('\nclasses appearing in BOTH groups (order-sensitive):', mixed.length);
mixed.slice(0, 25).forEach((c) => console.log('   ', c));

if (process.argv.includes('--explain')) {
  console.log('\n── dropped as dead (nobody renders these) ──');
  dropped.forEach((r) => console.log('  ', r.prelude.replace(/\\s+/g, ' ').slice(0, 90)));
}

// ── 5. prove the split is order-safe ────────────────────────────────────────
// A class can land in both files when a grouped shared rule mentions it (the
// `:active` list, the scrollbar list) while its own single-class rule stays
// behind. That is only safe if the two rules can never fight: either they set
// different properties, or the shared one out-specifies the other. Same property
// at equal specificity WOULD be decided by load order, and load order changes.
function specificity(sel) {
  const s = sel.trim();
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  return ids * 100 + cls;
}
function propsOf(body) {
  const props = new Set();
  let depth = 0;
  let buf = '';
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === '{') {
      const sel = buf.split(';').pop();
      if (depth > 0) {
        // only top-level declarations inside this rule
        let d = 0;
        let j = i + 1;
        let inner = '';
        while (j < body.length) {
          if (body[j] === '{') d += 1;
          else if (body[j] === '}') { if (d === 0) break; d -= 1; }
          inner += body[j];
          j += 1;
        }
        for (const p of propsOf(inner)) props.add(`${sel.trim()}::${p}`);
        i = j;
      } else {
        for (const decl of body.slice(i + 1).split(';')) {
          const name = decl.split(':')[0];
          if (name) props.add(`${sel.trim()}::${name.trim()}`);
        }
        break;
      }
      buf = '';
      continue;
    }
    buf += ch;
  }
  return [...props];
}

function flatRules(list, acc = []) {
  for (const r of list) {
    if (r.nested) flatRules(r.nested, acc);
    else acc.push(r);
  }
  return acc;
}

const conflicts = [];
for (const c of mixed) {
  const a = flatRules(shared).filter((r) => classesOf(r.prelude).includes(c));
  const b = flatRules(coinflipOnly).filter((r) => classesOf(r.prelude).includes(c));
  for (const ra of a) {
    for (const rb of b) {
      const pa = propsOf(ra.body);
      const pb = propsOf(rb.body);
      const clash = pa.filter((x) => pb.includes(x));
      if (!clash.length) continue;
      // compare the max specificity each side reaches on that class
      const sa = Math.max(...ra.prelude.split(',').filter((s) => s.includes(`.${c}`)).map(specificity));
      const sb = Math.max(...rb.prelude.split(',').filter((s) => s.includes(`.${c}`)).map(specificity));
      if (sa === sb) conflicts.push({ c, sa, sb, clash, a: ra.prelude.replace(/\s+/g, ' '), b: rb.prelude.replace(/\s+/g, ' ') });
    }
  }
}
console.log(`\norder-safety: ${conflicts.length} real conflict(s) (same property, equal specificity)`);
conflicts.forEach((x) => {
  console.log(`   ${x.c}  (spec ${x.sa} vs ${x.sb})`);
  console.log(`      shared : ${x.a.slice(0, 100)}`);
  console.log(`      own    : ${x.b.slice(0, 100)}`);
});

if (process.argv[2] === '--write') {
  const banner = (title, lines) => `/* ${title}\n${lines.map((l) => ` * ${l}`).join('\n')}\n */\n`;

  fs.writeFileSync(
    path.join(SRC_ROOT, 'ui', 'lobby.css'),
    banner('The shared betting lobby.', [
      'Topbar, lobby rows, join and view modals, pet tooltips, row motion and',
      'the responsive rules. Imported by Coinflip, RPS, Blackjack and Trading.',
      '',
      'These rules used to sit in CoinflipPage.css, which is lazy-loaded with',
      'the coinflip chunk. Blackjack, RPS and Trading all render this shell and',
      'none of them imported that file, so on those pages about 50 classes had',
      'no styles at all. Edit this file normally.',
      '',
      'tests/css-reachability.js fails if a page renders a class whose only',
      'definition lives in a stylesheet that page does not load.'
    ]) + '\n' + sharedText
  );

  fs.writeFileSync(
    SRC,
    banner('Coinflip-only styles.', [
      'The history modal, the value-sort dropdown, the coin animation and the',
      'provably-fair buttons. The shared shell lives in ui/lobby.css, which',
      'every game page imports.',
      '',
      'Split out by tools/split-lobby-css.js, which decides by asking which',
      'pages actually render each rule.'
    ]) + '\n' + ownText
  );
  console.log('\nWROTE ui/lobby.css and trimmed pages/CoinflipPage.css');
} else {
  console.log('\n(dry run - pass --write to apply)');
}
