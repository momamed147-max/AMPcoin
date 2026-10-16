/**
 * No stylesheet may declare :root variables.
 *
 * The app-level palette lives in ui/v3.css, imported from index.js. Any other
 * file that declares :root is a landmine, because a stylesheet belonging to a
 * lazy page chunk is injected AFTER the main bundle. Its :root therefore wins,
 * and the moment that route opens the whole site reverts to whatever fallback
 * that file happened to carry.
 *
 * This was live for a long time and was invisible: lobby.css,
 * AnimatedPopup.css, AuthPage.css, AdminPanel.css and ProfileModal.css all
 * carried the same stale fallback, so every game route silently painted the
 * old colours while the login page looked correct.
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

console.log('\n=== only the app-level stylesheets may declare :root variables ===\n');

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

const ALLOWED_PALETTE_OWNERS = /^index\.css$|^theme(-new)?\.css$|^ui\/(tokens|v3)\.css$/;

console.log(`  main-bundle stylesheets (transitive from index.js): ${mainBundleCss.size}\n`);

const offenders = [];
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');

  // A bare :root block (not :root[data-theme=...], which is how a theme
  // overrides the palette) that declares custom properties.
  const declares = [...src.matchAll(/(^|[},]\s*)(:root(?![^\s{,]*\[))\s*\{([^}]*)\}/g)]
    .filter((m) => /--[a-z0-9-]+\s*:/.test(m[3]));
  if (!declares.length) continue;

  const props = [...declares[0][3].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  const paletteProps = props.filter((p) => PALETTE_VARS.test(p));
  if (!paletteProps.length) continue; // layout-only :root, fine anywhere

  const isMain = mainBundleCss.has(file);
  offenders.push({ rel, isMain, props: paletteProps });

  if (isMain) {
    ok(ALLOWED_PALETTE_OWNERS.test(rel),
      `${rel} may own a base :root palette`,
      ALLOWED_PALETTE_OWNERS.test(rel)
        ? ''
        : `${paletteProps.length} palette vars declared here: ${paletteProps.slice(0, 6).join(', ')}\n        a second palette is a copy of ui/v3.css waiting to drift`);
  } else {
    ok(false,
      `${rel} must not declare :root palette variables`,
      `it ships in a lazy page chunk, where it loads AFTER ui/v3.css and reverts the whole site on that route\n        declared: ${paletteProps.slice(0, 6).join(', ')}`);
  }
}

if (!offenders.length) console.log('  (no stylesheet declares :root variables at all)');

console.log('\n=== the app palette is actually reachable ===\n');
const indexJs = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
{
  const v3 = path.join(SRC, 'ui', 'v3.css');
  ok(fs.existsSync(v3), 'ui/v3.css exists');
  const src = fs.readFileSync(v3, 'utf8');
  for (const v of ['--bg0', '--bg1', '--bg2', '--panel', '--txt', '--acc', '--grn', '--red']) {
    ok(new RegExp(`${v}\\s*:`).test(src), `v3.css defines ${v}`);
  }
  ok(indexJs.includes('ui/v3.css'), 'and index.js imports it');
  // v3 must be the last stylesheet index.js imports, or a later one wins.
  const cssImports = [...indexJs.matchAll(/import\s+['"](\.[^'"]+\.css)['"]/g)].map((m) => m[1]);
  const idxV3 = cssImports.indexOf('./ui/v3.css');

  // v3 must land after every layer it is meant to outrank. Those are the older
  // design layers and the token/theme sheets, which sit earlier by design.
  const v3MustBeat = ['./index.css', './theme.css', './ui/tokens.css', './ui/ui.css', './ui/shell.css'];
  for (const sheet of v3MustBeat) {
    ok(idxV3 > cssImports.indexOf(sheet),
      `v3.css comes after ${sheet}, so v3 wins where it should`);
  }

  // And the deliberate override layers come after v3, or they do nothing. Each
  // exists to beat v3 in the cascade, which is why they are imported last.
  const overrides = ['./ui/surface.css', './ui/layout.css'];
  for (const sheet of overrides) {
    ok(cssImports.indexOf(sheet) > idxV3,
      `${sheet} is imported after v3.css, or it would be discarded`);
  }
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
