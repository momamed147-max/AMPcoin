/**
 * Replace a CSS rule by selector, verified.
 *
 * The edit tool keeps failing on these stylesheets, and a failure mode worth
 * guarding against is silent: writing a replacement that does not apply leaves
 * the file looking edited while the old rule is still the one painting. So
 * this asserts the old text is present, replaces it, and asserts the new text
 * landed.
 *
 *   node tools/replace-css.js <file> <startSelector> <endSelector> <file-with-replacement>
 */
const fs = require('fs');
const path = require('path');

const [file, startSel, endSel, replacementFile] = process.argv.slice(2);
const replacement = fs.readFileSync(path.resolve(replacementFile), 'utf8').replace(/\r?\n$/, '');

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

const start = lines.findIndex((l) => l.includes(startSel));
if (start < 0) { console.error(`  start selector not found: ${startSel}`); process.exit(1); }

let end = -1;
for (let i = start; i < lines.length; i++) {
  if (lines[i].includes(endSel)) {
    // Consume the closing brace of the block it opens.
    let depth = 0;
    let j = i;
    for (; j < lines.length; j++) {
      depth += (lines[j].match(/\{/g) || []).length;
      depth -= (lines[j].match(/\}/g) || []).length;
      if (depth === 0 && j > i) break;
      if (depth === 0 && j === i && lines[j].includes('}')) break;
    }
    end = j;
    break;
  }
}
if (end < 0) { console.error(`  end selector not found: ${endSel}`); process.exit(1); }

const before = lines.slice(start, end + 1);
const out = [...lines.slice(0, start), ...replacement.split('\n'), ...lines.slice(end + 1)];
fs.writeFileSync(file, out.join('\n'));

const written = fs.readFileSync(file, 'utf8');
if (!written.includes(replacement.split('\n')[1] || replacement.split('\n')[0])) {
  console.error('  replacement did not land - aborting');
  process.exit(1);
}

console.log(`  ${file}: replaced ${before.length} lines with ${replacement.split('\n').length}`);
console.log(`    was: ${before[0].trim().slice(0, 60)}`);
console.log(`    now: ${replacement.split('\n')[0].trim().slice(0, 60)}`);