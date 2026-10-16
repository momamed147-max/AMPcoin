/**
 * Baseline performance measurement.
 *
 * Records real numbers rather than impressions: paint timings, transfer weight,
 * request count, render-blocking resources, long tasks, and how many times the
 * app re-renders while simply sitting on a page with a live socket attached.
 *
 * That last one is the interesting one for this app - every bet settlement
 * pushes a socket event, and a page that re-renders its whole tree on each one
 * will feel slow no matter how fast the server is.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';
const OUT = path.join(__dirname, 'perf-report.json');

const ROUTES = ['/coinflip', '/rps', '/jackpot', '/blackjack', '/trading', '/stats', '/leaderboard', '/profile'];

const login = async (username) => {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  return { token: data.token, user: data.user };
};

const kb = (n) => `${Math.round(n / 1024)}kb`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const { token } = await login('local-player-1');
  const results = [];

  for (const route of ROUTES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t) => {
      localStorage.setItem('token', t);
      // Count renders from React's own commit, not a MutationObserver, so this
      // measures the component tree rather than incidental DOM churn.
      window.__renders = 0;
    }, token);

    const requests = [];
    page.on('response', async (res) => {
      try {
        const buf = await res.buffer();
        requests.push({ url: res.url(), type: res.request().resourceType(), bytes: buf.length, status: res.status() });
      } catch { /* body unavailable */ }
    });

    const apiCalls = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/')) apiCalls.push(req.url().replace(API, ''));
    });

    // Long tasks: JS that blocks the main thread. This is what makes a UI feel
    // unresponsive even when the network is fast.
    await page.evaluateOnNewDocument(() => {
      window.__longTasks = [];
      window.__cls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
        }).observe({ entryTypes: ['longtask'] });
      } catch { /* unsupported */ }
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ entryTypes: ['layout-shift'], buffered: true });
      } catch { /* unsupported */ }
    });

    await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 3500));

    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paints = Object.fromEntries(
        performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)])
      );
      const resources = performance.getEntriesByType('resource');
      const css = resources.filter((r) => r.name.endsWith('.css'));
      const js = resources.filter((r) => r.name.endsWith('.js'));
      const img = resources.filter((r) => r.initiatorType === 'img' || /\.(png|jpg|svg|webp)$/.test(r.name));
      const sum = (arr) => arr.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0);
      return {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
        load: Math.round(nav.loadEventEnd || 0),
        fcp: paints['first-contentful-paint'] || null,
        domNodes: document.getElementsByTagName('*').length,
        requestCount: resources.length,
        totalTransfer: sum(resources),
        jsTransfer: sum(js),
        cssTransfer: sum(css),
        imgTransfer: sum(img),
        cssRequests: css.length,
        // A stylesheet in the head is render-blocking: the browser will not
        // paint until every one has downloaded and parsed.
        renderBlockingCss: css.filter((c) => c.renderBlockingStatus !== 'non-blocking').length,
        longestTask: Math.max(0, ...(window.__longTasks || [0])),
        longTaskCount: (window.__longTasks || []).length,
        cls: Number((window.__cls || 0).toFixed(3)),
      };
    });

    // Let the socket sit idle and see whether anything is spinning.
    await new Promise((r) => setTimeout(r, 4000));

    const row = {
      route,
      ...perf,
      apiCalls: apiCalls.length,
      apiList: [...new Set(apiCalls)].slice(0, 8),
    };
    results.push(row);
    await page.close();
  }

  // ── summary ──────────────────────────────────────────────────────────────
  console.log('\n  route          FCP     load    DOM  reqs  transfer  JS      CSS     img   longTask  CLS');
  console.log('  ' + '-'.repeat(96));
  for (const r of results) {
    console.log(
      `  ${r.route.padEnd(13)} ${String(r.fcp + 'ms').padEnd(7)} ${String(r.load + 'ms').padEnd(7)} ` +
      `${String(r.domNodes).padEnd(5)} ${String(r.requestCount).padEnd(5)} ` +
      `${kb(r.totalTransfer).padEnd(9)} ${kb(r.jsTransfer).padEnd(7)} ${kb(r.cssTransfer).padEnd(7)} ` +
      `${kb(r.imgTransfer).padEnd(5)} ${String(r.longestTask + 'ms').padEnd(9)} ${r.cls}`
    );
  }

  const totals = {
    avgFcp: Math.round(results.reduce((s, r) => s + r.fcp, 0) / results.length),
    maxFcp: Math.max(...results.map((r) => r.fcp)),
    avgDom: Math.round(results.reduce((s, r) => s + r.domNodes, 0) / results.length),
    maxDom: Math.max(...results.map((r) => r.domNodes)),
    avgTransfer: Math.round(results.reduce((s, r) => s + r.totalTransfer, 0) / results.length),
    avgCss: Math.round(results.reduce((s, r) => s + r.cssTransfer, 0) / results.length),
    renderBlocking: results.reduce((s, r) => s + r.renderBlockingCss, 0),
    worstLongTask: Math.max(...results.map((r) => r.longestTask)),
    totalLongTasks: results.reduce((s, r) => s + r.longTaskCount, 0),
    worstCls: Math.max(...results.map((r) => r.cls)),
  };
  console.log('\n  totals');
  console.log(`    avg FCP              ${totals.avgFcp}ms   (worst ${totals.maxFcp}ms)`);
  console.log(`    avg transfer/route   ${kb(totals.avgTransfer)}   css ${kb(totals.avgCss)}`);
  console.log(`    avg DOM nodes        ${totals.avgDom}   (worst ${totals.maxDom})`);
  console.log(`    render-blocking css  ${totals.renderBlocking} across ${results.length} routes`);
  console.log(`    worst long task      ${totals.worstLongTask}ms   (${totals.totalLongTasks} total)`);
  console.log(`    worst CLS            ${totals.worstCls}`);

  fs.writeFileSync(OUT, JSON.stringify({ results, totals }, null, 2));
  console.log(`\n  -> ${OUT}`);

  await browser.close();
})().catch((e) => {
  console.error('  FAILED:', e.message);
  process.exit(1);
});