/**
 * Measure the lobby row in a real browser and report what is actually tall.
 *
 * Guessing at a layout from its CSS does not work here: the row is styled by
 * five stylesheets, some of which ship inside a lazy chunk and win by load
 * order rather than by specificity, so the rule actually painting is rarely
 * the one that reads as last. This reports each box's real geometry, and
 * which stylesheet won each property, so a too-tall row can be traced to a
 * rule instead of guessed at.
 *
 *   BASE_URL=http://localhost:3000 node tools/measure-row.js
 *
 * Point BASE_URL at a production build rather than the dev server when you
 * need to know which file a rule came from: the dev server injects anonymous
 * <style> tags with no URL, so it can only report "some stylesheet".
 */
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = () => {
  /* Which rules match this element and declare this property.
   *
   * Two things make this non-obvious and both cost a wrong answer once:
   * a rule written with a shorthand (`padding:`) declares the longhand too,
   * so asking only for `padding-top` misses it; and matches() throws on a
   * selector it cannot parse, which used to abort the whole scan and report
   * that nothing sets anything. */
  const whoDeclares = (node, longhand, also = []) => {
    const hits = [];
    [...document.styleSheets].forEach((sheet, idx) => {
      let rules;
      try { rules = sheet.cssRules; } catch (_) { return; }
      const name = (sheet.href || `style#${idx}`).split('/').pop().replace(/\?.*/, '');
      const walk = (list, media) => {
        for (const rule of list) {
          if (rule.cssRules) { walk(rule.cssRules, rule.conditionText || media); continue; }
          if (!rule.selectorText || !rule.style) continue;
          let hit = false;
          try { hit = node.matches(rule.selectorText); } catch (_) { continue; }
          if (!hit) continue;
          let value = null; let via = null;
          for (const p of [longhand, ...also]) {
            const v = rule.style.getPropertyValue(p);
            if (v) { value = v; via = p; break; }
          }
          if (!value) continue;
          hits.push({ sheet: name, selector: rule.selectorText, value, via, media: media || '' });
        }
      };
      walk(rules, '');
    });
    return hits;
  };

  const row = document.querySelector('.cf-row');
  if (!row) return { error: 'no .cf-row on the page' };
  const rbox = row.getBoundingClientRect();

  const box = (sel) => {
    const el = row.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      sel,
      x: Math.round(b.left - rbox.left),
      y: Math.round(b.top - rbox.top),
      w: Math.round(b.width),
      h: Math.round(b.height),
      display: getComputedStyle(el).display
    };
  };

  const rowPad = whoDeclares(row, 'padding-top', ['padding']);
  const boxes = [
    '.cf-row-players', '.cf-row-wager', '.cf-row-wager-head', '.cf-row-wager-label',
    '.cf-row-items', '.cf-row-thumb-wrap', '.cf-row-value', '.cf-row-total',
    '.cf-row-action', '.cf-row-player', '.cf-row-avatar-ring', '.cf-row-player-name'
  ].map(box).filter(Boolean);

  const detail = {};
  for (const sel of ['.cf-row', '.cf-row-wager', '.cf-row-items', '.cf-row-thumb-wrap', '.cf-row-value']) {
    const el = row.querySelector(sel) || (sel === '.cf-row' ? row : null);
    if (!el) continue;
    detail[sel] = {
      padding: whoDeclares(el, 'padding-top', ['padding']).slice(-3),
      height: whoDeclares(el, 'height').slice(-2)
    };
  }

  return {
    row: { w: Math.round(rbox.width), h: Math.round(rbox.height), padding: getComputedStyle(row).padding },
    boxes,
    rowPad,
    detail
  };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  const ok = await page.evaluate(async (apiBase) => {
    const res = await fetch(`${apiBase}/api/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'local-admin' })
    });
    const d = await res.json().catch(() => ({}));
    if (!d.token) return `failed: ${res.status}`;
    localStorage.setItem('token', d.token);
    if (d.user) localStorage.setItem('user', JSON.stringify(d.user));
    return 'ok';
  }, API);
  if (ok !== 'ok') { console.log(`  login ${ok}`); process.exit(1); }

  await page.goto(`${BASE}/coinflip`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.cf-row', { timeout: 20000 });
  await sleep(1500);

  const r = await page.evaluate(PROBE);
  await browser.close();

  if (r.error) { console.log(`  ${r.error}`); process.exit(1); }

  console.log(`\n  ROW  ${r.row.w} x ${r.row.h}   padding ${r.row.padding}\n`);
  console.log('  cell                          x     y    w     h  display');
  for (const b of r.boxes) {
    console.log(`  ${b.sel.padEnd(28)} ${String(b.x).padStart(4)} ${String(b.y).padStart(4)} ${String(b.w).padStart(5)} ${String(b.h).padStart(5)}  ${b.display}`);
  }

  console.log('\n  who sets the row padding (last wins):');
  for (const h of r.rowPad.slice(-3)) {
    console.log(`    ${h.sheet.padEnd(24)} ${h.selector.slice(0, 40).padEnd(42)} ${h.via} = ${h.value}${h.media ? `  @${h.media}` : ''}`);
  }

  console.log('\n  per-cell:');
  for (const [sel, d] of Object.entries(r.detail)) {
    console.log(`  ${sel}`);
    for (const h of d.padding) console.log(`      pad   ${h.sheet.padEnd(24)} ${h.selector.slice(0, 36).padEnd(38)} = ${h.value}`);
    for (const h of d.height) console.log(`      ht    ${h.sheet.padEnd(24)} ${h.selector.slice(0, 36).padEnd(38)} = ${h.value}`);
    if (!d.padding.length && !d.height.length) console.log('      (nothing sets padding or height)');
  }
  console.log('');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });