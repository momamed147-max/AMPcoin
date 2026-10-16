/**
 * Delete a CSS rule by selector, handling multi-line blocks.
 *
 * WHY THIS EXISTS
 * ---------------
 * Removing a rule with a regex needs to guess the block's shape, and the guess
 * is wrong in three common ways:
 *
 *   - the rule is written across several lines, so `\{[^}]*\}` stops at the
 *     first inner brace and leaves the tail behind;
 *   - a one-line rule and a multi-line rule with the same selector need
 *     different patterns, and there are usually both;
 *   - a media-query override of a rule that was just deleted needs removing
 *     too, and it is far away from the original.
 *
 * Counting braces from the opening one finds the real end regardless of shape,
 * and a selector list is handled by checking whether the whole preamble
 * contains the selector rather than matching the whole line.
 *
 *   node tools/drop-css-rule.js <file> <selector> [<selector> ...]
 */
const fs = require('fs');

const [file, ...selectors] = process.argv.slice(2);
if (!file || !selectors.length) {
  console.error('  usage: node tools/drop-css-rule.js <file> <selector> [...]');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const keep = [];
let dropped = 0;
const droppedSelectors = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const braceAt = line.indexOf('{');

  // A selector line is one with an opening brace that is not inside a comment
  // or a declaration. If any requested selector appears in the part before the
  // brace, this is the rule to drop.
  if (braceAt > 0 && !/^\s*(\/\*|\*)/.test(line) && !/\b(var|calc|color-mix)\(/.test(line.slice(0, braceAt))) {
    const preamble = line.slice(0, braceAt);
    const hits = selectors.filter((s) => preamble.includes(s));

    if (hits.length) {
      // Consume until the braces balance. A one-liner balances on the same
      // line; a multi-line block closes further down.
      let depth = 0;
      let j = i;
      for (; j < lines.length; j++) {
        depth += (lines[j].match(/\{/g) || []).length;
        depth -= (lines[j].match(/\}/g) || []).length;
        if (depth <= 0) break;
      }
      // Swallow a blank line that followed, so the file does not grow gaps.
      let next = j + 1;
      while (next < lines.length && lines[next].trim() === '') next++;
      i = next - 1;
      dropped++;
      droppedSelectors.push(hits.join('+'));
      continue;
    }
  }

  keep.push(line);
}

if (!dropped) {
  console.log(`  ${file}: nothing matched (${selectors.join(', ')})`);
  process.exit(0);
}

const eol = fs.readFileSync(file, 'utf8').includes('\r\n') ? '\r\n' : '\n';
fs.writeFileSync(file, keep.join(eol));
console.log(`  ${file}: dropped ${dropped} rule(s) [${droppedSelectors.join('] [')}]`);

const after = fs.readFileSync(file, 'utf8');
const o = (after.match(/\{/g) || []).length;
const c = (after.match(/\}/g) || []).length;
console.log(`  ${file}: braces ${o}/${c}${o === c ? '' : '   UNBALANCED'}`);
if (o !== c) process.exit(1);