/**
 * Screenshot the AMPcoin Modifier's three tabs as the operator.
 *
 * Signs in as the operator (the generic shots tool uses local-admin, who is a
 * normal admin and never sees this tab), opens the admin panel, then captures
 * each tab.
 *
 *   node tools/shot-modifier.js [outDir]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';
const OUT = path.resolve(__dirname, '..', process.argv[2] || 'tools/shots-modifier');
const OPERATOR = process.env.OPERATOR || 'iloveadoptmegngos';

const TABS = ['Coinflip', 'RPS', 'Jackpot'];
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

  const opened = await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll('button, [role="tab"], a'))
      .find((el) => /outcome/i.test(el.textContent || ''));
    if (!tab) return 'not found';
    tab.click();
    return 'clicked';
  });
  console.log(`  outcome tab: ${opened}`);
  await sleep(2500);

  for (const label of TABS) {
    const clicked = await page.evaluate((name) => {
      const tab = Array.from(document.querySelectorAll('.oc-tab'))
        .find((el) => (el.textContent || '').trim().startsWith(name));
      if (!tab) return 'not found';
      tab.click();
      return 'clicked';
    }, label);
    await sleep(1800);
    const info = await page.evaluate(() => ({
      bets: document.querySelectorAll('.oc-bet').length,
      toggles: document.querySelectorAll('.oc-switch').length,
      outcome: (document.querySelector('.oc-outcome-value')?.textContent || '').trim(),
      panels: document.querySelectorAll('.oc-panel').length
    }));
    await page.screenshot({ path: path.join(OUT, `${label.toLowerCase()}.png`) });
    console.log(`  ${label.padEnd(9)} ${clicked.padEnd(10)} panels=${info.panels} toggles=${info.toggles} bets=${info.bets} outcome="${info.outcome}"`);
  }

  if (errors.length) {
    console.log('\n  page errors:');
    [...new Set(errors)].forEach((e) => console.log(`    ${e}`));
  }
  console.log(`\n  saved to ${path.relative(path.resolve(__dirname, '..'), OUT)}`);
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });