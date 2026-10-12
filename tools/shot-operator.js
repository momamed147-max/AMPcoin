/**
 * Screenshot the Outcome control tab as the operator.
 *
 * The generic shots tool logs in as local-admin, who is a NORMAL admin and so
 * never sees this tab. This signs in as the operator account instead, opens the
 * admin panel and switches to the outcome tab.
 *
 *   node tools/shot-operator.js [outDir]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';
const OUT = path.resolve(__dirname, '..', process.argv[2] || 'tools/shots-operator');
const OPERATOR = process.env.OPERATOR || 'iloveadoptmegngos';

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
  const login = await page.evaluate(async (api, who) => {
    const res = await fetch(`${api}/api/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: who })
    });
    const data = await res.json().catch(() => ({}));
    if (!data.token) return `failed (${res.status})`;
    localStorage.setItem('token', data.token);
    if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
    return 'ok';
  }, API, OPERATOR);
  console.log(`  login as ${OPERATOR}: ${login}`);
  await sleep(2500);

  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);

  // Click the Outcome control tab if it is present.
  const tabInfo = await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll('button, [role="tab"], a'))
      .find((el) => /outcome/i.test(el.textContent || ''));
    if (!tab) return 'not found';
    tab.click();
    return 'clicked';
  });
  console.log(`  outcome tab: ${tabInfo}`);
  await sleep(2500);

  // Type the key so the live feed actually loads. It is read from the server
  // .env here rather than bundled, which is the whole point of the design -
  // this is a local screenshot convenience and nothing else.
  const keyFromEnv = (() => {
    try {
      const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
      const m = env.match(/^\s*FORCE_OUTCOME_KEY\s*=\s*(.*)\s*$/m);
      return m ? m[1].replace(/^["']|["']$/g, '') : '';
    } catch (_) { return ''; }
  })();

  if (keyFromEnv) {
    await page.type('#oc-key', keyFromEnv, { delay: 5 });
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => /^(verify|refresh)$/i.test((b.textContent || '').trim()));
      if (btn) btn.click();
    });
    await sleep(2500);
  } else {
    console.log('  no FORCE_OUTCOME_KEY in .env - live feed will stay empty');
  }

  const info = await page.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll('[role="tab"], .ap-tab, .admin-tab'))
      .map((t) => (t.textContent || '').trim()).filter(Boolean).slice(0, 12),
    liveRows: document.querySelectorAll('.oc-live-row').length,
    hasKeyRow: !!document.querySelector('.oc-key-row'),
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160)
  }));

  await page.screenshot({ path: path.join(OUT, 'outcome-tab.png') });

  console.log(`\n  tabs visible: ${info.tabs.join(' | ') || '(none found by selector)'}`);
  console.log(`  key row present: ${info.hasKeyRow}`);
  console.log(`  live bet rows: ${info.liveRows}`);
  console.log(`  on screen: ${info.text}`);
  if (errors.length) {
    console.log('\n  page errors:');
    [...new Set(errors)].forEach((e) => console.log(`    ${e}`));
  }
  console.log(`\n  saved to ${path.relative(path.resolve(__dirname, '..'), OUT)}`);
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });