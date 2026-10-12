/**
 * Check that the landed coin sits in the same place on every row, however many
 * pets are staked.
 *
 * The coin used to live inside the clipped item container, so it drifted right
 * as bets got bigger and was clipped away on the widest ones. It has its own
 * flex slot now - this asserts that, by measuring where each rendered coin
 * actually is and comparing the offsets.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';
const OUT = path.resolve(__dirname, '..', process.argv[2] || 'tools/shots-coin');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.evaluate(async (api) => {
    const res = await fetch(`${api}/api/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'local-admin' })
    });
    const d = await res.json().catch(() => ({}));
    if (d.token) {
      localStorage.setItem('token', d.token);
      if (d.user) localStorage.setItem('user', JSON.stringify(d.user));
    }
  }, API);
  await sleep(2000);

  await page.goto(`${BASE}/coinflip`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);

  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.cf-row').forEach((row) => {
      const items = row.querySelector('.cf-row-items');
      const landed = row.querySelector('.cf-row-landed');
      const rr = row.getBoundingClientRect();
      const ir = items ? items.getBoundingClientRect() : null;
      const lr = landed ? landed.getBoundingClientRect() : null;
      out.push({
        pets: items ? items.querySelectorAll('.cf-row-thumb-wrap').length : 0,
        hasCoin: !!landed,
        coinLeftFromRow: lr ? Math.round(lr.left - rr.left) : null,
        coinGapFromItems: ir && lr ? Math.round(lr.left - ir.right) : null,
        visible: lr ? (lr.right <= rr.right + 1 && lr.width > 0) : null
      });
    });
    return out;
  });

  await page.screenshot({ path: path.join(OUT, 'coinflip.png') });

  const withCoins = rows.filter((r) => r.hasCoin);
  console.log(`\n  rows measured: ${rows.length}   with a landed coin: ${withCoins.length}\n`);
  console.log('    pets  coinLeftFromRow  gapFromItems  visible');
  for (const r of rows) {
    console.log(`    ${String(r.pets).padStart(5)}  ${String(r.coinLeftFromRow ?? '-').padStart(14)}  ${String(r.coinGapFromItems ?? '-').padStart(12)}  ${String(r.visible ?? '-').padStart(7)}`);
  }

  if (withCoins.length) {
    const lefts = withCoins.map((r) => r.coinLeftFromRow);
    const spread = Math.max(...lefts) - Math.min(...lefts);
    console.log(`\n  coin x-offset spread across rows: ${spread}px`);
    console.log(`  ${spread <= 2 ? 'PASS - the coin is in the same column on every row' : 'FAIL - the coin still drifts with the pet count'}`);
    const clipped = withCoins.filter((r) => r.visible === false);
    console.log(`  ${clipped.length === 0 ? 'PASS - no coin is clipped out of its row' : `FAIL - ${clipped.length} coin(s) clipped`}`);
  }

  if (errors.length) {
    console.log('\n  page errors:');
    [...new Set(errors)].forEach((e) => console.log(`    ${e}`));
  }
  console.log('');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });