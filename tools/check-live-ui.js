/**
 * What the deployed sign-in screen actually renders.
 *
 * Run against the live site with no token, so it is the signed-out view. Reads
 * computed styles rather than grepping a bundle, because a rule can be present
 * in a stylesheet and still lose the cascade - which is precisely what went
 * wrong for several turns.
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LIVE = process.env.LIVE_URL || 'https://ampcoin-4v8.pages.dev';
const OUT = path.join(__dirname, '..', 'tools', 'shots-live');

let pass = 0;
let fail = 0;
const ok = (c, label) => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // No token: this must be the signed-out screen.
  await page.goto(`${LIVE}/login`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 3500));

  const s = await page.evaluate(() => {
    const read = (sel, props) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const out = {};
      props.forEach((p) => { out[p] = cs[p]; });
      return out;
    };
    return {
      onLogin: location.pathname === '/login',
      card: read('.auth-card', ['backgroundImage', 'borderColor', 'backdropFilter', 'boxShadow']),
      page: read('.auth-page', ['backgroundImage']),
      btn: read('.auth-btn', ['backgroundImage', 'boxShadow']),
      input: read('.auth-input', ['borderColor', 'backgroundColor']),
      // How many separate background layers the card is painting.
      cardLayers: (() => {
        const el = document.querySelector('.auth-card');
        if (!el) return 0;
        const bg = getComputedStyle(el).backgroundImage;
        return bg === 'none' ? 0 : (bg.match(/gradient\(/g) || []).length;
      })(),
    };
  });

  console.log('\n=== deployed sign-in screen ===\n');
  console.log(`  path            : ${s.onLogin ? '/login' : '/' + ' (NOT the login screen)'}`);
  console.log(`  card layers     : ${s.cardLayers}`);
  console.log(`  card background : ${String(s.card?.backgroundImage || '').slice(0, 100)}`);
  console.log(`  card blur       : ${s.card?.backdropFilter}`);
  console.log(`  page background : ${String(s.page?.backgroundImage || '').slice(0, 90)}`);

  ok(s.onLogin, 'the signed-out screen is what loaded');
  ok(s.cardLayers >= 3, `the card paints a composed multi-layer surface (${s.cardLayers} layers)`);
  ok(/blur\(/.test(s.card?.backdropFilter || ''), 'the card is glass, not a flat box');
  ok(/1000px 640px/.test(s.page?.backgroundImage || ''), 'the page is lit, not flat');
  ok(/gradient/.test(s.btn?.backgroundImage || '') && /rgba\(255, 255, 255/.test(s.btn?.boxShadow || ''),
    'the primary button has a gradient and a real glow');

  await page.screenshot({ path: path.join(OUT, 'live-login.png') });
  console.log(`\n  ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('  FAILED:', e.message); process.exit(1); });