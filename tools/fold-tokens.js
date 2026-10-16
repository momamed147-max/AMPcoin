const fs = require('fs');
const path = require('path');

/**
 * Remove custom-property declarations that ui/system.css now owns.
 *
 * Only the declaration line goes. Anything else in the block stays, because
 * these sheets also declare values the system has no business knowing about -
 * per-component dimensions, per-move tints, animation triggers set from JS.
 *
 * usage: node tools/fold-tokens.js <sheet> <token> [<token> ...]
 */
for (const file of process.argv.slice(2, 3)) void file;

const [sheet, ...tokens] = process.argv.slice(2);
const target = tokens.map((t) => t.replace(/^--/, ''));
const file = path.resolve(sheet);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

const keep = [];
const dropped = [];
for (const line of lines) {
  const m = /^(\s*)--([a-z0-9-]+)\s*:/.exec(line);
  if (m && target.includes(m[2])) {
    dropped.push(m[2]);
    continue;
  }
  keep.push(line);
}

// A :root block that has been emptied out is worse than none: it looks like it
// still means something. Drop the block and any comment header directly above
// it if the block is now empty.
const text = keep.join('\n');
const collapsed = text.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(file, collapsed);

console.log(`  ${sheet}: dropped ${dropped.length} declaration(s)`);
console.log(`     ${dropped.join(' ')}`);
