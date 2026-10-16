/**
 * Cold-cache baseline: what a player sees on a genuine first visit.
 *
 * The earlier run shared one browser cache across eight routes, so only the
 * first paid for JS parse and the rest were warm. A real first visit is the
 * number that matters, so this clears the cache between routes.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';
const LABEL = process.argv[2] || 'current';
const OUT = path.join(__dirname, `perf-cold-${LABEL}.json`);

const ROUTES = ['/', '/coinflip', '/rps', '/jackpot', '/trading', '/stats', '/leaderboard'];

const login = async (u) => {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u }),
  });
  return (await res.json()).token;
};
const kb = (n) => `${Math.round(n / 1024)}kb`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const token = await login('local-player-1');
  const rows = [];

  for (const route of ROUTES) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

    let bytes = 0;
    let count = 0;
    page.on('response', async (res) => {
      count++;
      try { bytes += (await res.buffer()).length; } catch { /* ignore */ }
    });

    await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 3500));

    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
      const res = performance.getEntriesByType('resource');
      const by = (pred) => res.filter(pred).reduce((s, r) => s + (r.encodedBodySize || 0), 0);
      const js = res.filter((r) => r.name.endsWith('.js'));
      return {
        fcp: paint['first-contentful-paint'] ?? null,
        load: Math.round(nav.loadEventEnd || 0),
        js: by((r) => r.name.endsWith('.js')),
        css: by((r) => r.name.endsWith('.css')),
        img: by((r) => /\.(png|jpe?g|svg|webp|gif)$/.test(r.name)),
        cssFiles: res.filter((r) => r.name.endsWith('.css')).length,
        jsFiles: js.length,
        dom: document.getElementsByTagName('*').length,
      };
    });

    rows.push({ route, ...m, requests: count, bytes });
    await ctx.close();
  }

  console.log(`\n  COLD CACHE  (${LABEL})\n`);
  console.log('  route           FCP     load    reqs  transfer   JS      CSS     img    css/js files  DOM');
  console.log('  ' + '-'.repeat(100));
  for (const r of rows) {
    console.log(
      `  ${r.route.padEnd(14)} ${String(r.fcp + 'ms').padEnd(7)} ${String(r.load + 'ms').padEnd(7)} ` +
      `${String(r.requests).padEnd(5)} ${kb(r.bytes).padEnd(9)} ${kb(r.js).padEnd(7)} ${kb(r.css).padEnd(7)} ` +
      `${kb(r.img).padEnd(6)} ${String(r.cssFiles + '/' + r.jsFiles).padEnd(13)} ${r.dom}`
    );
  }

  const avg = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length);
  const summary = {
    label: LABEL,
    avgFcp: avg('fcp'),
    avgLoad: avg('load'),
    avgBytes: avg('bytes'),
    avgJs: avg('js'),
    avgCss: avg('css'),
    worstFcp: Math.max(...rows.map((r) => r.fcp)),
  };
  console.log('\n  summary');
  console.log(`    avg FCP         ${summary.avgFcp}ms`);
  console.log(`    avg load        ${summary.avgLoad}ms`);
  console.log(`    avg transfer    ${kb(summary.avgBytes)}   (js ${kb(summary.avgJs)}, css ${kb(summary.avgCss)})`);
  console.log(`    worst FCP       ${summary.worstFcp}ms`);

  fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
  console.log(`\n  -> ${OUT}`);
  await browser.close();
})().catch((e) => { console.error('  FAILED:', e.message); process.exit(1); });