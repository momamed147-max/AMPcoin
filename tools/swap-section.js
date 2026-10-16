/**
 * Replace a section of a stylesheet between two comments, or between a start
 * marker and an end marker.
 *
 * Needed because the edit tool is unreliable on these files, and because a
 * failed replacement that leaves the file half-written is worse than no
 * replacement at all. This asserts both ends before it writes.
 *
 *   node tools/swap-section.js <file> <startMarker> <endMarker> <replacement>
 *
 * Markers are plain substrings. startMarker must appear before endMarker.
 * Everything from the start of the line containing startMarker through the end
 * of the line containing endMarker is replaced.
 */
const fs = require('fs');
const path = require('path');

const [file, startMarker, endMarker, replacementFile] = process.argv.slice(2);

const src = fs.readFileSync(file, 'utf8');
const lines = src.split(/\r?\n/);

const startAt = lines.findIndex((l) => l.includes(startMarker));
if (startAt < 0) { console.error(`  start marker not found: ${startMarker}`); process.exit(1); }

let endAt = -1;
for (let i = startAt; i < lines.length; i++) {
  if (lines[i].includes(endMarker)) { endAt = i; break; }
}
if (endAt < 0) { console.error(`  end marker not found: ${endMarker}`); process.exit(1); }
if (endAt === startAt) { console.error(`  start and end are the same line - is the section a one-liner?`); process.exit(1); }

const replacement = fs.readFileSync(path.resolve(replacementFile), 'utf8')
  .replace(/\r?\n$/, '')
  .split(/\r?\n/);

const out = [...lines.slice(0, startAt), ...replacement, ...lines.slice(endAt + 1)];
const eol = src.includes('\r\n') ? '\r\n' : '\n';
fs.writeFileSync(file, out.join(eol));

// Verify the swap actually landed, by content and not by "the file changed".
const written = fs.readFileSync(file, 'utf8');
const probe = replacement.find((l) => l.trim().length > 20);
if (probe && !written.includes(probe)) {
  console.error('  replacement did not land - aborting');
  process.exit(1);
}

console.log(`  ${file}: lines ${startAt + 1}-${endAt + 1} (${endAt - startAt + 1}) -> ${replacement.length}`);
console.log(`    first was: ${lines[startAt].trim().slice(0, 58)}`);
console.log(`    first now: ${replacement[0].trim().slice(0, 58)}`);