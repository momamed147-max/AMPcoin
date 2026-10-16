/**
 * Exactly one stylesheet may declare the palette.
 *
 * ui/system.css owns every design token. Any other file that declares a base
 * :root palette is a landmine twice over:
 *
 *   1. It is a copy waiting to drift. Four files used to own the palette
 *      between them, which is why the site never looked designed by anyone -
 *      no single sheet was choosing a colour, values had just accumulated.
 *
 *   2. A stylesheet belonging to a lazy page chunk is injected AFTER the main
 *      bundle. Its :root wins on that route, and the moment the route opens
 *      the whole site reverts to whatever fallback that file carried. This was
 *      live for a long time and was invisible: lobby.css, AnimatedPopup.css,
 *      AuthPage.css, AdminPanel.css and ProfileModal.css all shipped the same
 *      stale fallback, so every game route silently painted the old colours
 *      while the login page looked correct.
 *
 * Run: node tests/css-palette.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'frontend', 'src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'build'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.css')) out.push(p);
  }
  return out;
}

let pass = 0;
let fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};

console.log('\n=== only ui/system.css may declare a base palette ===\n');

// index.js is the entry, so its CSS imports - and those of anything they
// reach, transitively - load in the main bundle and are safe. A stylesheet
// pulled in only by a lazily-loaded page is not, and can revert the palette the
// moment that route opens.
function resolveSpec(fromFile, spec) {
  const base = path.dirname(fromFile);
  for (const c of [
    path.resolve(base, spec),
    path.resolve(base, '../' + spec),
    path.resolve(base, '../../' + spec)
  ]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    if (fs.existsSync(c + '.js')) return c + '.js';
    if (fs.existsSync(c + '.css')) return c + '.css';
  }
  return null;
}

const mainBundleCss = (function closure(entry) {
  const css = new Set();
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !f.endsWith('.js')) continue;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/import\s+(?:[^'"]*?from\s+)?['"](\.[^'"]+)['"]/g)) {
      const r = resolveSpec(f, m[1]);
      if (!r) continue;
      if (r.endsWith('.css')) css.add(r);
      else stack.push(r);
    }
  }
  return css;
})(path.join(SRC, 'index.js'));

// Palette variables only. Layout and sizing variables such as --nav-h are
// harmless wherever they live and must not trip this.
const PALETTE_VARS = /^--(bg\d?|panel\d?|line(-soft|-strong)?|txt|mut|dim|acc(-\d+)?|acc-(soft|glow)|grn(-soft)?|red(-soft)?|gold(-soft)?|orange|violet|pink|cyan|r-(xs|sm|md|lg|xl|full)|elev-\d+|fs-|dur-\d|font-)$/;

// The system is the only owner. Nothing else may even be in the main bundle
// with a palette, because a second copy can disagree with the first and there
// is then no way to tell which one the user is looking at.
const PALETTE_OWNER = 'ui/system.css';

/* A digit glued to a custom property means a bulk replace ran over the middle
 * of a number: `38px` became `3var(--r-sm)`, `768px` became `76var(--r-sm)`.
 *
 * These do not fail to parse. The declaration is still valid CSS, the value is
 * simply invalid, and the property is dropped - so the avatar silently fell
 * back to its intrinsic size and grew to 120px. Grepping for "var(--" finds
 * nothing wrong; only this does.
 *
 * Caught by noticing `8px` had been replaced with a radius token in
 * TradingPage.css, then auditing every stylesheet rather than just the file
 * being edited.
 */
{
  const glued = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(^|[^\w.-])(\d+)var\(--/g)) {
      glued.push(`${rel}  ${m[2]}var(--`);
    }
  }
  ok(glued.length === 0,
    'no stylesheet has a number glued to a custom property',
    glued.length
      ? 'a bulk replace matched inside a number; the value is invalid so the\n' +
        '        declaration is dropped and the property silently falls back\n        ' +
        glued.slice(0, 8).join('\n        ')
      : '');
}

console.log(`  main-bundle stylesheets (transitive from index.js): ${mainBundleCss.size}\n`);

const offenders = [];
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  // Strip comments before scanning. The previous detector required :root to be
  // preceded by } or a comma, which meant a :root sitting under a comment
  // header - the normal way to write one - was invisible to it. This guard
  // reported "no stylesheet declares a palette" while system.css, the whole
  // point of it, was right there.
  const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  // A bare :root block (not :root[data-theme=...], which is how a theme
  // overrides the palette) that declares custom properties.
  const declares = [...src.matchAll(/:root(?![^\s{,]*\[)\s*\{([^}]*)\}/g)]
    .filter((m) => /--[a-z0-9-]+\s*:/.test(m[1]));
  if (!declares.length) continue;

  const props = [...declares[0][1].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  const paletteProps = props.filter((p) => PALETTE_VARS.test(p));
  if (!paletteProps.length) continue; // layout-only :root, fine anywhere

  const isOwner = rel === PALETTE_OWNER;
  offenders.push({ rel, isOwner, props: paletteProps });

  if (isOwner) {
    ok(mainBundleCss.has(file),
      `${rel} loads in the main bundle, so every route inherits it`,
      'it is imported by index.js but the resolver could not reach it');
  } else {
    ok(false,
      `${rel} must not declare :root palette variables`,
      `only ${PALETTE_OWNER} owns the palette\n        declared here: ${paletteProps.slice(0, 6).join(', ')}\n        ${mainBundleCss.has(file)
        ? 'it is in the main bundle, so it silently competes with the system'
        : 'it ships in a lazy page chunk, so it reverts the whole site on that route'}`);
  }
}

if (!offenders.length) console.log('  (no stylesheet declares :root variables at all)');

console.log('\n=== the system is imported first, and the palette is complete ===\n');
const indexJs = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
{
  const system = path.join(SRC, 'ui', 'system.css');
  ok(fs.existsSync(system), 'ui/system.css exists');
  const src = fs.readFileSync(system, 'utf8');

  // The token set every other stylesheet reads. If one is missing here it
  // falls through to some other sheet's value, which is precisely the drift
  // this redesign is removing.
  const REQUIRED = [
    '--bg0', '--bg1', '--bg2', '--panel', '--panel2', '--panel3',
    '--line', '--line-soft', '--line-strong',
    '--txt', '--mut', '--dim',
    '--acc', '--acc-bright', '--acc-soft', '--acc-glow',
    '--grn', '--red', '--gold', '--orange',
    '--font-body', '--font-display', '--font-mono',
    '--r-sm', '--r-md', '--r-lg',
    '--elev-1', '--elev-2', '--elev-3', '--elev-4',
    '--dur-1', '--dur-2', '--dur-3', '--ease-1', '--ease-2',
    '--focus-ring', '--page-max', '--z-modal',
  ];
  for (const v of REQUIRED) {
    ok(new RegExp(`${v}\\s*:`).test(src), `system.css defines ${v}`);
  }

  const cssImports = [...indexJs.matchAll(/import\s+['"](\.[^'"]+\.css)['"]/g)].map((m) => m[1]);
  ok(cssImports.includes('./ui/system.css'), 'and index.js imports it');

  const idxSystem = cssImports.indexOf('./ui/system.css');
  ok(idxSystem === 0,
    'and it is the FIRST stylesheet, so everything after it can read the tokens',
    idxSystem < 0 ? 'not imported' : `it is at position ${idxSystem + 1}, after ${cssImports[idxSystem - 1]}`);

  // A theme must still be able to override the system, which it does by
  // matching :root[data-theme]. Same specificity as a bare :root class would
  // lose, but these are attribute selectors on the same element, so the
  // system being first is what keeps themes winning.
  ok(idxSystem < cssImports.indexOf('./theme.css'),
    'theme.css loads after the system, so a chosen theme still repaints it');
}

console.log('\n=== themes still override the palette ===\n');
{
  const theme = fs.readFileSync(path.join(SRC, 'theme.css'), 'utf8');
  ok(/:root\[data-theme=['"][a-z-]+['"]\]/.test(theme),
    'theme.css keys its palettes off :root[data-theme], which outranks a bare :root');
  const themeNew = fs.readFileSync(path.join(SRC, 'theme-new.css'), 'utf8');
  ok(/:root\[data-theme=/.test(themeNew), 'theme-new.css does the same');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
