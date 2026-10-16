/**
 * Remove the duplicated page title from the statistics screen.
 *
 * WHY
 * ---
 * The header band above every page already carries the page name, an icon and
 * a one-line purpose. Statistics repeated it as an <h1> directly underneath,
 * eight pixels below, at a larger size - so the most prominent text on the
 * screen said the same word twice and the eye had to work out which one was
 * the heading.
 *
 * The duplication used to be hidden with `display: none` from a global
 * override layer. That was hiding a content problem with a styling trick, and
 * it left the heading in the accessibility tree where it was read out while
 * being invisible. This removes it from the markup.
 *
 * WHAT SURVIVES
 * -------------
 * The block is not deleted - it becomes a toolbar carrying the two things
 * that genuinely are not in the header band: the longer explanation, and the
 * refresh control. All three render paths (loading, error, loaded) are
 * updated, because leaving either of the first two with a title would mean the
 * title flashes in and out as the data arrives.
 */
const fs = require('fs');

const PAGE = 'frontend/src/pages/StatsPageV2.js';
const lines = fs.readFileSync(PAGE, 'utf8').split(/\r?\n/);

/* Located by line, not by pattern.

   The obvious version of this - a regex from the opening <div className="sp2-head">
   to a </div> - matched greedily from the FIRST block (in the loading path) all
   the way to the last, and deleted the entire body of the page between them.
   Which is a good reminder that on markup, line numbers beat patterns: there
   are exactly three known blocks, and three is a number you can count. */
const heads = [];
lines.forEach((l, i) => { if (l.includes('className="sp2-head"')) heads.push(i); });

if (heads.length !== 3) {
  console.error(`  expected 3 .sp2-head blocks, found ${heads.length} - aborting`);
  process.exit(1);
}

const out = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Paths one and two: a single line holding nothing but the title. There is
  // nothing else in the block, so it goes entirely rather than becoming an
  // empty row - an empty toolbar is worse than no toolbar.
  if (/^\s*<div className="sp2-head"><h1>Statistics<\/h1><\/div>\s*$/.test(line)) {
    continue;
  }

  // Path three: title, subtitle, refresh button, wrapped in a div. Rebuilt as
  // a row carrying only what the header band does not already have.
  if (i === heads[2] && line.trim() === '<div className="sp2-head">') {
    // The block runs from here to its matching close. It is four levels deep in
    // fixed-shape JSX, so walk the tags rather than trusting a depth number.
    let depth = 0;
    let end = -1;
    for (let j = i; j < lines.length; j++) {
      for (const tag of lines[j].matchAll(/<\/?([A-Za-z][\w.]*)/g)) {
        if (tag[0].startsWith('</')) depth--;
        else if (!tag[0].endsWith('/>')) depth++;
        if (depth === 0) { end = j; break; }
      }
      if (end >= 0) break;
    }
    if (end < 0 || !lines[end].includes('</div>')) {
      console.error(`  could not find the end of the third .sp2-head block - aborting`);
      process.exit(1);
    }

    out.push('      <div className="sp2-head">');
    out.push('        {/* No title here. The header band above already says "Statistics"');
    out.push('            and carries the icon and a one-line purpose; repeating it eight');
    out.push('            pixels below, larger, made the most prominent text on the screen');
    out.push('            say the same word twice. This row is only the two things the');
    out.push('            band does not have: the longer explanation, and a way to');
    out.push('            refetch it. */}');
    out.push('        <p className="sp2-sub">');
    out.push('          Everything you have won and lost across every game, and what you have unlocked.');
    out.push('        </p>');
    out.push('        <Button variant="ghost" icon="rpsRock" onClick={reload} loading={loading}>Refresh</Button>');
    out.push('      </div>');

    i = end;
    continue;
  }

  out.push(line);
}

fs.writeFileSync(PAGE, out.join('\n'));
console.log(`  removed 2 title-only blocks, rebuilt 1 as a toolbar; ${lines.length} -> ${out.length} lines`);