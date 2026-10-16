/**
 * Restructure the coinflip lobby row: identity | stake + value | action.
 *
 * WHY
 * ---
 * The row has to answer three questions in one line - who is betting, what
 * have they put up, what is that worth - and offer one obvious next move.
 *
 * It was doing that with the value parked inside the action column, which put
 * the figure and the buttons in competition and left the wide gap between the
 * tiles and the total reading as an accident of layout. The total now sits at
 * the right of the stake column, so the row scans left to right as one
 * thought: here is the stake, here is what it comes to. The action column
 * has exactly one job.
 *
 * WHAT DOES NOT CHANGE
 * --------------------
 * Every handler, every condition, every figure. Only the nesting of blocks
 * that were already rendered changes - the total, the range and the item cap
 * move out of the action column and into the stake column, indented one level
 * deeper and nothing else.
 *
 * Anchored on exact source lines, and it asserts each one before touching the
 * file, because a silent off-by-one here produces JSX that still parses and
 * renders the wrong thing.
 */
const fs = require('fs');

const PAGE = 'frontend/src/pages/CoinflipPage.js';
const lines = fs.readFileSync(PAGE, 'utf8').split(/\r?\n/);

const find = (pred, from = 0) => {
  const i = lines.findIndex((l, n) => n >= from && pred(l));
  return i;
};

// Anchor backwards from the action column. That is the only unambiguous
// direction here: between the wager column opening and the action column
// there are two nested </div> tags that look identical, and matching forward
// for "the closing div" lands on the wrong one.
//
// Walking backwards from a unique string cannot land on the wrong element.
const actionOpen = lines.findIndex((l) => l.includes('className="cf-row-action"'));
const wagerOpen = (() => {
  for (let i = actionOpen; i >= 0; i--) {
    if (lines[i].includes('className="cf-row-wager"')) return i;
  }
  return -1;
})();
const capLine = lines.findIndex((l, i) => i > actionOpen && l.includes('className="cf-row-cap"'));
const capClose = capLine + 1;
const itemsClose = (() => {
  // The landed-coin block sits between the wager column and the action
  // column, and its own closing </div> is closer to the action column than the
  // wager column's. So walk back from the comment above that block rather than
  // from the action column: the first closing tag above it is unambiguously the
  // wager column's.
  const coin = lines.findIndex((l) => l.includes('The landed coin.'));
  if (coin < 0) return -1;
  for (let i = coin - 1; i > wagerOpen; i--) {
    if (/^\s*<\/div>/.test(lines[i])) return i;
  }
  return -1;
})();

// Every anchor checked before a single line is changed.
const checks = [
  [wagerOpen, '<div className="cf-row-wager">', 'cf-row-wager'],
  [itemsClose, 'the wager column close', null],
  [actionOpen, 'className="cf-row-action"', 'cf-row-action'],
  [capLine, 'className="cf-row-cap"', 'cf-row-cap'],
  [capClose, ')}', ')}'],
];
for (const [i, label, needle] of checks) {
  if (i < 0) { console.error(`  anchor not found: ${label}`); process.exit(1); }
  if (needle && !lines[i].includes(needle)) {
    console.error(`  anchor moved: ${label} expected a line containing ${JSON.stringify(needle)}, found ${JSON.stringify(lines[i])}`);
    process.exit(1);
  }
}
// And the wager's closing tag must actually be the wager's, not the items'.
// The wager column opens at 16 spaces of indent, so its close does too; the
// items column's close is one level deeper. Indentation is a weak signal in
// general but it is decisive here, because the two tags are otherwise
// identical strings.
if (!/^ {16}<\/div>/.test(lines[itemsClose])) {
  console.error(`  the wager close anchor is indented ${lines[itemsClose].match(/^ */)[0].length} spaces, expected 16: ${JSON.stringify(lines[itemsClose])}`);
  process.exit(1);
}

/* The three blocks being lifted, taken from the action column and re-indented
   one level deeper. Nothing inside them changes. */
const lifted = lines.slice(actionOpen + 1, capClose + 1).map((l) => (l ? '    ' + l : l));

const rebuilt = [
  '                {/* The stake, and what it is worth.',
  '',
  '                    Two things live here and they belong together: the items',
  '                    being offered, and the figure they add up to. With the total',
  '                    in the action column instead, it sat far from the tiles with',
  '                    a wide empty gap between them, so the two numbers read as',
  '                    unrelated and competed with the buttons for attention. Here',
  '                    the row scans left to right as a single thought. */}',
  '                <div className="cf-row-wager">',
  ...lines.slice(wagerOpen + 1, itemsClose).map((l) => (l ? '  ' + l : l)),
  '',
  '                  {/* The figure, with the qualifiers that turn it into a',
  '                      condition: the range the creator will accept, and the cap',
  '                      on how many items the joiner may bring. */}',
  '                  <div className="cf-row-value">',
  ...lifted,
  '                  </div>',
  '                </div>',
];

const out = [
  ...lines.slice(0, wagerOpen),
  ...rebuilt,
  ...lines.slice(itemsClose + 1, actionOpen).map((l) =>
    l.includes('Action. The value lives in here') || l.trim().startsWith('sibling above') ||
    l.trim().startsWith('buttons, which is where') || l.trim().startsWith('join. It used to sit') ||
    l.trim().startsWith('that, stranded')
      ? null
      : l
  ).filter(Boolean),
  '                {/* Action. One job only. The value moved into the stake column',
  '                    beside the tiles it comes from, which leaves this column free',
  '                    to be the single answer to "what can I do about this?". */}',
  lines[actionOpen],
  ...lines.slice(capClose + 1),
];

fs.writeFileSync(PAGE, out.join('\n'));
console.log(`  lifted ${lifted.length} lines from the action column into the stake column`);
console.log(`  file went from ${lines.length} to ${out.length} lines`);