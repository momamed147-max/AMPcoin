/**
 * Why does the app block the main thread?
 *
 * The baseline run showed 31 long tasks, worst 373ms. A long task is JS the
 * browser cannot interleave with input, so anything running inside one is a
 * frozen UI regardless of how fast the network was.
 *
 * Attributes each blocking window to whatever was on the stack, so this names
 * the function rather than just reporting a number.
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';

const ROUTES = ['/coinflip', '/jackpot', '/stats', '/blackjack'];

const login = async (u) => {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u }),
  });
  return (await res.json()).token;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const token = await login('local-player-1');

  for (const route of ROUTES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

    // Capture the stack at the moment each long task is attributed.
    await page.evaluateOnNewDocument(() => {
      window.__tasks = [];
      try {
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            window.__tasks.push({
              duration: Math.round(e.duration),
              start: Math.round(e.startTime),
              name: e.name,
              // attributeResetTime / containerType are unreliable in headless, so
              // capture the stack ourselves instead.
              stack: (() => {
                try { throw new Error(); } catch (err) {
                  return String(err.stack || '').split('\n').slice(2, 7)
                    .map((l) => l.trim()).join(' <- ');
                }
              })(),
            });
          }
        });
        po.observe({ entryTypes: ['longtask'] });
      } catch { /* unsupported */ }
    });

    await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 4000));

    const tasks = await page.evaluate(() => window.__tasks || []);
    const heavy = tasks.filter((t) => t.duration > 80).sort((a, b) => b.duration - a.duration);

    console.log(`\n  ${route}  —  ${tasks.length} long tasks, ${heavy.length} over 80ms`);
    heavy.slice(0, 5).forEach((t) => {
      console.log(`    ${String(t.duration + 'ms').padEnd(7)} at ${String(t.start + 'ms').padEnd(7)} ${t.name}`);
      console.log(`      ${t.stack.slice(0, 150)}`);
    });

    // How much of the time is React committing vs everything else?
    const commit = await page.evaluate(() => {
      const entries = performance.getEntriesByType('measure').filter((m) => m.name.includes('react'));
      return entries.length ? entries.reduce((s, m) => s + m.duration, 0) : null;
    });
    console.log(`    react measures: ${commit === null ? 'none recorded' : Math.round(commit) + 'ms total'}`);

    await page.close();
  }

  await browser.close();
})().catch((e) => { console.error('  FAILED:', e.message); process.exit(1); });