/**
 * What does the LIVE site actually render?
 *
 * Every check so far has been indirect - grep a bundle, count a colour, look at
 * a screenshot. All of those can pass while the page looks identical, because a
 * rule can be present in a stylesheet and still lose the cascade at runtime.
 *
 * This loads the deployed site, asks the browser what the computed values
 * actually are, and compares them to a local build of the same source. If those
 * match, the deploy is fine and the design is simply not different enough. If
 * they differ, something between the build and the browser is rewriting it.
 */
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LIVE = process.env.LIVE_URL || 'https://ampcoin-4v8.pages.dev';
const LOCAL = process.env.BASE_URL || 'http://localhost:3000';

const PROBE = () => {
  const pick = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const out = { _sel: sel };
    props.forEach((p) => { out[p] = s[p]; });
    return out;
  };
  return {
    // Whatever the page's main raised surface happens to be on the login screen.
    surfaces: [
      '.login-card', '.auth-card', '.card', '.panel', '.modal',
      '.cf-card', 'form', '.cf-login-card',
    ].map((s) => pick(s, ['backgroundImage', 'borderColor', 'boxShadow'])).filter(Boolean),
    buttons: [
      '.btn', '.btn-primary', '.cf-btn', 'button',
    ].map((s) => pick(s, ['backgroundImage', 'boxShadow', 'color'])).filter(Boolean),
    bodyBg: getComputedStyle(document.body).backgroundImage.slice(0, 120),
    rootBg: (() => {
      const a = document.querySelector('.app, #root > div, #root');
      return a ? getComputedStyle(a).backgroundImage.slice(0, 140) : null;
    })(),
    styleSheets: [...document.styleSheets].map((sh) => (sh.href || 'inline').split('/').pop()),
  };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  for (const [label, url] of [['LIVE', LIVE], ['LOCAL', LOCAL]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 2500));

    const r = await page.evaluate(PROBE);
    console.log(`\n  ===== ${label}  (${url}) =====`);
    console.log(`  body background : ${r.bodyBg || 'none'}`);
    console.log(`  app root bg     : ${r.rootBg || 'none'}`);
    console.log(`  stylesheets     : ${r.styleSheets.join(', ')}`);
    console.log('  surfaces:');
    r.surfaces.forEach((s) => {
      console.log(`    ${s._sel}`);
      console.log(`      bg     ${String(s.backgroundImage).slice(0, 95)}`);
      console.log(`      border ${s.borderColor}`);
    });
    console.log('  buttons:');
    r.buttons.forEach((s) => {
      console.log(`    ${s._sel}`);
      console.log(`      bg     ${String(s.backgroundImage).slice(0, 95)}`);
    });
    await page.close();
  }

  await browser.close();
})().catch((e) => { console.error('  FAILED:', e.message); process.exit(1); });