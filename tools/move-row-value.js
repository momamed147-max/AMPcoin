/**
 * Move the wager's value out of the action column and into the stake column.
 *
 * WHY
 * ---
 * The row answers three questions in one line: who is betting, what have they
 * put up, and what does that come to. Splitting the first two across columns
 * and stranding the third with the buttons puts the figure and the action in
 * the same column, so they compete, and leaves the gap between the tiles and
 * the total reading as an accident of layout.
 *
 * With the total at the right of the stake column, the row reads left to
 * right as a sentence - tiles, then what they are worth - and the action
 * column has exactly one job left in it.
 *
 * WHAT CHANGES
 * ---
 * Behaviour is untouched: same handlers, same disabled logic, same conditionals,
 * same data. Only where three already-rendered blocks sit in the DOM changes.
 */
const fs = require('fs');

const PAGE = 'frontend/src/pages/CoinflipPage.js';
let src = fs.readFileSync(PAGE, 'utf8');

/* 1. Lift the value block out of .cf-row-action. */
const valueRe = /([ \t]*)<div className="cf-row-total">\n[\s\S]*?\n[ \t]*<\/div>\n([ \t]*)\{/;
const start = src.indexOf('<div className="cf-row-action">');
if (start < 0) { console.error('  .cf-row-action not found'); process.exit(1); }

const totalStart = src.indexOf('<div className="cf-row-total">', start);
const capEnd = src.indexOf('</span>', src.indexOf('className="cf-row-cap"', start)) + '</span>'.length;
if (totalStart < 0 || capEnd < totalStart) { console.error('  value block not found'); process.exit(1); }

// The value block runs from the total's opening div through the cap's closing
// span, plus the whitespace before the next conditional.
let valueBlock = src.slice(totalStart, capEnd);
const after = src.slice(capEnd);

// Everything between .cf-row-action's opening and the total is whitespace, and
// everything after the cap up to the next conditional is whitespace. Pull both
// so the JSX left behind is still well-formed.
const beforeTotal = src.slice(start + '<div className="cf-row-action">'.length, totalStart);

let rest = after.replace(/^\s*\n/, '\n');

// 2. Close the wager column after its items, and open the value column there.
const wagerClose = src.indexOf('</div>', src.indexOf('className="cf-row-wager-head"'));
// Find the wager column's own closing div: it is the one that matches the
// indentation of <div className="cf-row-wager">.
const wagerOpen = src.indexOf('<div className="cf-row-wager">');
const wagerCloseIdx = src.indexOf('\n                  </div>\n', wagerOpen);
if (wagerCloseIdx < 0) { console.error('  wager column close not found'); process.exit(1); }

const insertAt = wagerCloseIdx + '\n                  </div>\n'.length;
const indent = '                  ';

// Re-indent the lifted block by two spaces so it reads as nested inside the
// wager column rather than as a sibling of it.
valueBlock = valueBlock
  .split('\n')
  .map((l, n) => (n === 0 ? l : indent + '  ' + l.trim().replace(/^\s+/, '')))
  .join('\n');

const insert = `${indent}  {/* The stake, and what it is worth. The total belongs with the\n` +
  `${indent}      tiles rather than with the buttons: it is part of the same thought, and\n` +
  `${indent}      with it over by the action column the gap between the two numbers reads\n` +
  `${indent}      as an accident of layout rather than as their belonging together. */}\n` +
  `${indent}  <div className="cf-row-value">\n` +
  indent + '  ' + valueBlock + `\n` +
  `${indent}  </div>\n`;

src = src.slice(0, insertAt) + insert + src.slice(insertAt);

// 3. Drop the block from the action column.
const newStart = src.indexOf('<div className="cf-row-action">');
const newTotal = src.indexOf('<div className="cf-row-total">', newStart);
const newCap = src.indexOf('className="cf-row-cap"', newStart);
if (newTotal > 0 && newTotal < newStart + 200) {
  const newEnd = src.indexOf('</span>', newCap) + '</span>'.length;
  src = src.slice(0, newStart + '<div className="cf-row-action">'.length)
        + src.slice(newEnd).replace(/^\s*\n/, '\n');
  console.log('  removed the value block from the action column');
}

fs.writeFileSync(PAGE, src);
console.log('  value now lives in the stake column');
void beforeTotal; void rest; void wagerClose;