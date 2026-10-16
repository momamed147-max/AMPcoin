/**
 * Remove per-page tab rules that duplicate the shared control.
 *
 * WHY
 * ---
 * ui/components.css now defines one tab control for all ten of the class names
 * the product uses. It cannot be that one control while nine page stylesheets
 * each keep their own version, because a page sheet rides in a lazy chunk and
 * is injected after the whole main bundle - so a page's own rules beat the
 * shared ones regardless of specificity. Restyling the shared control would
 * change one page and leave eight looking exactly as before, which is the
 * behaviour that produced nine tabs in the first place.
 *
 * So the duplicates come out, and what each page keeps is only what is
 * genuinely its own: the media-query overrides that apply at one width and the
 * few selectors the shared rule does not cover.
 *
 * Nothing is deleted blindly. Each removal is listed explicitly, and the file
 * is re-checked for balance afterwards.
 */
const fs = require('fs');

/* [file, exact block to delete, why it can go] */
const REMOVALS = [
  // Jackpot: a flex row with a 6px gap and no track at all. The margin-bottom
  // is kept by re-declaring it on .jp-tabs below, so the page's rhythm does not
  // change.
  ['frontend/src/pages/JackpotPage.css', /\.jp-tabs \{ display: flex; gap: 6px; margin-bottom: 16px; \}\n\.jp-tab, \.jp-active \{[\s\S]*?\n\}\n/],

  ['frontend/src/pages/JackpotPage.css', /\.jp-tabs \{ flex-wrap: wrap; \}\n\.jp-tab \{ padding: 8px 14px; font-size: \.78rem; \}\n/],

  // Upgrader: an underlined strip - border-bottom on the container, which is
  // the fourth visual idiom the product had.
  ['frontend/src/pages/UpgraderPage.css', /\.ug-tabs \{[^\n]*\}\n\.ug-tab \{[\s\S]*?\n\}\n/],

  ['frontend/src/pages/ProvablyFairPage.css', /\.fair-tabs \{[\s\S]*?\n\}\n/],

  // Admin: .tab-btn is the shared item class and is used by the leaderboard and
  // admin panels alike, so it was one rule serving two pages - which is the
  // right idea, just written in the wrong file. .oc-tab-dot stays: it is a
  // status indicator, not a tab.
  ['frontend/src/pages/AdminPanel.css', /\.admin-tabs \{[\s\S]*?\n\}\n/],
  ['frontend/src/pages/AdminPanel.css', /\.tab-btn \{[\s\S]*?\n\}\n/],
  ['frontend/src/pages/AdminPanel.css', /\.admin-tabs \{ flex-direction: row !important;[^\n]*\}\n\.tab-btn \{ white-space: nowrap;[^\n]*\}\n/],

  ['frontend/src/pages/OutcomeControlTab.css', /\.oc-tabs \{[\s\S]*?\n\}\n/],
  ['frontend/src/pages/OutcomeControlTab.css', /\.oc-tab \{[\s\S]*?\n\}\n/],
  ['frontend/src/pages/OutcomeControlTab.css', /\.oc-tabs \{ flex-direction: column; \}\n\.oc-tab \{ justify-content: flex-start; \}\n/],
];

/* What each page keeps, because it is page-specific rather than a tab style. */
const KEEP = {
  'frontend/src/pages/JackpotPage.css': `/* The gap between the tab strip and the content below it is page rhythm, not a
   tab style, so it stays here. The strip itself is ui/components.css. */
.jp-tabs { margin-bottom: var(--sp-5); }
`,
};

let removed = 0;
let missed = 0;

for (const [file, pattern] of REMOVALS) {
  const src = fs.readFileSync(file, 'utf8');
  const next = src.replace(pattern, '');
  if (next === src) {
    console.log(`  MISS ${file}  ${pattern.source.slice(0, 60)}`);
    missed++;
    continue;
  }
  removed++;
  fs.writeFileSync(file, next);
}

for (const [file, block] of Object.entries(KEEP)) {
  const src = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, src.replace(/(\n\n+)/, `\n\n${block}\n`) );
}

console.log(`  removed ${removed} duplicate tab block(s)${missed ? `, ${missed} did not match` : ''}`);

// Balance check on everything touched.
const files = [...new Set(REMOVALS.map(([f]) => f))];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const o = (s.match(/{/g) || []).length;
  const c = (s.match(/}/g) || []).length;
  console.log(`  ${f.padEnd(42)} braces ${o}/${c}${o === c ? '' : '   UNBALANCED'}`);
}