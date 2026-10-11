/**
 * Screenshot every route so UI work can be judged against what it actually
 * looked like before.
 *
 * Headless Chrome via puppeteer-core. The desktop browser tool is not attached
 * to this session, and guessing at a UI from its CSS is how the last two rounds
 * of work missed what was actually broken.
 *
 *   node tools/shots.js [outDir] [--mobile]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const OUT = path.resolve(__dirname, '..', process.argv[2] || 'tools/shots');
const MOBILE = process.argv.includes('--mobile');

const ROUTES = [
  ['login', 'Login', true],
  ['register', 'Register', true],
  ['coinflip', 'Coinflip'],
  ['blackjack', 'Blackjack'],
  ['rps', 'RPS'],
  ['jackpot', 'Jackpot'],
  ['upgrader', 'Upgrader'],
  ['trading', 'Trading'],
  ['stats', 'Stats'],
  ['profile', 'Profile'],
  ['leaderboard', 'Leaderboard'],
  ['provably-fair', 'Provably Fair']
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport(MOBILE
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }
    : { width: 1600, height: 900, deviceScaleFactor: 1 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

  // Log in once through the real UI so the session matches a player's.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find((x) => /local account/i.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(3000);

  const report = [];
  for (const [route, label, publicRoute] of ROUTES) {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle2', timeout: 60000 });
    // Wait for data, not just the shell - a screenshot of the spinner is useless.
    try {
      await page.waitForFunction(
        () => !document.querySelector('.cf-loading,.loading-spinner') ||
              document.body.innerText.includes('Loading AMPcoin') === false,
        { timeout: 15000 }
      );
    } catch (_) { /* some pages never use .cf-loading */ }
    await sleep(2200);

    const info = await page.evaluate(() => {
      const main = document.querySelector('.main-content');
      const rows = document.querySelectorAll('.cf-row');
      const content = document.querySelector('.page-content');
      const ch = content ? content.getBoundingClientRect() : null;
      const mh = main ? main.getBoundingClientRect() : null;
      return {
        stuck: /Loading AMPcoin/.test(document.body.innerText),
        rows: rows.length,
        // How much of the viewport the actual content fills. A big gap here is
        // the "looks unfinished" feeling, and it is not visible in the CSS.
        fill: ch && mh ? Math.round((ch.height / mh.height) * 100) : null,
        contentH: ch ? Math.round(ch.height) : null,
        mainH: mh ? Math.round(mh.height) : null,
        viewportH: window.innerHeight,
        empty: !!document.querySelector('.cf-empty,.empty-state'),
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 70)
      };
    });

    const file = path.join(OUT, `${MOBILE ? 'm-' : ''}${route}.png`);
    await page.screenshot({ path: file });
    report.push({ route, label, ...info, publicRoute });
  }

  await browser.close();

  console.log(`\n${MOBILE ? 'MOBILE' : 'DESKTOP'}  ${OUT}\n`);
  console.log('  route          rows  fill%  contentH  empty  stuck  note');
  for (const r of report) {
    const notes = [];
    if (r.stuck) notes.push('STUCK ON LOADER');
    if (r.fill !== null && r.fill < 55) notes.push(`${100 - r.fill}% empty below content`);
    if (r.empty) notes.push('empty state');
    console.log(`  ${r.route.padEnd(13)} ${String(r.rows).padStart(4)} ${String(r.fill).padStart(6)} ${String(r.contentH).padStart(9)}  ${String(r.empty).padEnd(5)}  ${String(r.stuck).padEnd(5)}  ${notes.join('; ')}`);
  }
  if (errors.length) {
    console.log('\n  page errors:');
    [...new Set(errors)].forEach((e) => console.log('    ' + e));
  }
  console.log('');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
