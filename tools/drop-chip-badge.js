/**
 * Remove the heads/tails chip badge from the lobby row.
 *
 * WHY
 * ---
 * Each player's avatar carried the side twice: once as the colour of the ring
 * around it, and once as a small coin chip stuck to its bottom-left corner.
 * Two encodings of one fact, in the same 48px, is what made the identity column
 * read as cluttered rather than as informative - and the chip, being a detailed
 * little illustration, was louder than the plain ring it duplicated.
 *
 * The ring keeps the job. It is the better carrier: it is always in the same
 * place, it cannot be missed against a dark avatar, and it survives the row
 * being scanned at speed.
 *
 * The chip is not removed from the product. It still appears on the landed
 * result, where it is the answer rather than a reminder.
 *
 * Two occurrences are removed, one per player.
 */
const fs = require('fs');

const PAGE = 'frontend/src/pages/CoinflipPage.js';
const lines = fs.readFileSync(PAGE, 'utf8').split(/\r?\n/);

const out = [];
let removed = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('cf-row-chip-badge')) {
    // The badge is a two-line element: the opening tag and its contents, then
    // the closing tag. Skip both, and the blank line after if there is one.
    const isOpen = lines[i].includes('<span className="cf-row-chip-badge">');
    const isClose = lines[i].includes('</span>') && lines[i + 1] !== undefined && i > 0 && lines[i - 1] !== undefined;
    if (isOpen || /^\s*<\/span>\s*$/.test(lines[i])) {
      // Only drop the close if the line before it opened the badge.
      if (isOpen) { removed++; i += 2; continue; }
      continue;
    }
    removed++;
    continue;
  }
  out.push(lines[i]);
}

if (removed !== 2) {
  console.error(`  expected to remove 2 badges, removed ${removed} - aborting`);
  process.exit(1);
}

fs.writeFileSync(PAGE, out.join('\n'));
console.log(`  removed ${removed} chip badges from the lobby row`);