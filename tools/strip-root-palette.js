const fs = require('fs');

/**
 * Delete a bare `:root { ... }` palette block from a stylesheet.
 *
 * Every design token now lives in ui/system.css. A second copy in another
 * sheet is not a fallback - it is a silent competitor, and because
 * stylesheets are imported in order, whichever loads later quietly wins on
 * whichever properties it happens to restate. Two sheets each defining half
 * the palette is how the site ended up looking like four different products
 * stitched together.
 */
function stripRootPalette(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  let i = 0;
  let removed = 0;
  let removedProps = [];

  while (i < src.length) {
    const rest = src.slice(i);
    // A bare :root, explicitly not :root[data-theme=...] which is how a theme
    // overrides the system and must be left alone.
    const m = /^:root(?![^\s{,]*\[)\s*\{/.exec(rest);
    if (!m) {
      const next = rest.indexOf(':root');
      if (next === -1) { out.push(rest); break; }
      out.push(rest.slice(0, next));
      i += next;
      continue;
    }
    // Find the matching close brace.
    let depth = 0;
    let j = i + m[0].length - 1;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(i + m[0].length, j);
    if (/--[a-z0-9-]+\s*:/.test(body)) {
      removedProps = removedProps.concat([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((x) => x[1]));
      removed++;
      // Swallow the blank lines that followed it.
      let k = j + 1;
      while (k < src.length && (src[k] === '\n' || src[k] === '\r')) k++;
      i = k;
      continue;
    }
    i++;
  }

  if (!removed) { console.log(`  ${file}: nothing to strip`); return; }
  fs.writeFileSync(file, out.join(''));
  console.log(`  ${file}: removed ${removed} :root block(s), ${removedProps.length} properties`);
  console.log(`     ${[...new Set(removedProps)].join(' ')}`);
}

for (const f of process.argv.slice(2)) stripRootPalette(f);
