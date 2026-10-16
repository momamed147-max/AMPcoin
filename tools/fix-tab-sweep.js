/* Restore the outcome-control status dot, and drop the last Jackpot tab override.
 *
 * A selector-sweep that removes everything matching ".oc-tab" also removes
 * ".oc-tab-dot", which is not a tab style at all - it is the small lamp beside
 * each tab showing whether that game's control is armed. Losing it means the
 * operator cannot see at a glance which games are live, which is the single
 * most important thing on that screen.
 *
 * The dot is restored with the shared tokens rather than its original literals,
 * and it stays in this file because it is specific to this screen.
 */

const fs = require('fs');

/* 1. The dot. */
const DOT = `/* A small lamp beside each tab showing whether that game's outcome control
   is armed. Not a tab style - a status indicator - so it stays here rather
   than moving into the shared tab control. */
.oc-tab-dot {
  width: 6px;
  height: 6px;
  margin-left: 2px;
  border-radius: 50%;
  background-color: var(--ds-n-6);
  transition:
    background-color var(--dur-2) var(--ease-1),
    box-shadow var(--dur-2) var(--ease-1);
}

.oc-tab-dot.is-on {
  background-color: var(--gold);
  box-shadow: 0 0 0 3px var(--gold-soft);
}
`;

const OC = 'frontend/src/pages/OutcomeControlTab.css';
let oc = fs.readFileSync(OC, 'utf8');
if (oc.includes('.oc-tab-dot')) {
  console.log('  OutcomeControlTab.css: the dot is still there, nothing to restore');
} else {
  // Append after the file's existing section header for tabs' surroundings.
  oc = oc.replace(/\n\n+/, '\n\n') + '\n' + DOT;
  fs.writeFileSync(OC, oc);
  console.log('  OutcomeControlTab.css: restored .oc-tab-dot');
}

/* 2. The last Jackpot override, which the shared control now covers. */
const JP = 'frontend/src/pages/JackpotPage.css';
const jp = fs.readFileSync(JP, 'utf8');
const next = jp.replace(/^\s*\.jp-tab \{ padding: 8px 14px; font-size: \.78rem; \}\r?\n/m, '');
if (next !== jp) {
  fs.writeFileSync(JP, next);
  console.log('  JackpotPage.css: dropped the last .jp-tab override');
}

for (const f of [OC, JP]) {
  const s = fs.readFileSync(f, 'utf8');
  const o = (s.match(/\{/g) || []).length;
  const c = (s.match(/\}/g) || []).length;
  console.log(`  ${f.padEnd(42)} braces ${o}/${c}${o === c ? '' : '   UNBALANCED'}`);
  if (o !== c) process.exit(1);
}