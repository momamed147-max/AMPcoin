/**
 * What is actually loading on a given route, heaviest first.
 * Usage: node tools/perf-route.js /trading
 */
const puppeteer = require('puppeteer-core');
const API = process.env.API_URL || 'http://localhost:5000';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const route = process.argv[2] || '/';

(async () => {
  const token = (await (await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'local-player-1' }),
  })).json()).token;

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 3500));

  const rows = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => ({
    name: r.name.split('/').pop().slice(0, 46),
    kb: Math.round((r.encodedBodySize || 0) / 1024),
    kind: r.name.endsWith('.css') ? 'css' : r.name.endsWith('.js') ? 'js' : /\.(png|jpe?g|svg|webp|gif)$/.test(r.name) ? 'img' : 'api',
  })));

  const heavy = rows.filter((r) => r.kb > 3).sort((a, b) => b.kb - a.kb);
  console.log(`\n  heaviest on ${route}:`);
  heavy.forEach((r) => console.log(`    ${String(r.kb + 'kb').padEnd(9)}${r.kind.padEnd(5)}${r.name}`));

  const byKind = rows.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] || 0) + r.kb; return acc; }, {});
  console.log('  totals by kind: ' + Object.entries(byKind).map(([k, v]) => `${k} ${v}kb`).join('  '));
  console.log('  file counts:   ' + Object.entries(rows.reduce((a, r) => { a[r.kind] = (a[r.kind] || 0) + 1; return a; }, {}))
    .map(([k, v]) => `${k} ${v}`).join('  '));

  await browser.close();
})().catch((e) => { console.error('  FAILED:', e.message); process.exit(1); });