/**
 * Is elvebredd 403-ing us, or are the URLs simply wrong?
 *
 * Navigates a real browser straight to an image URL rather than embedding it,
 * so the answer is not confounded by hotlink protection on the referencing
 * page. If a direct navigation also 403s, every pet image in the game is dead
 * for this client and the grey diamond is the real site.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'https://elvebredd.com/images/pets/Orca.png';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const seen = [];
  page.on('response', (r) => seen.push(`${r.status()} ${r.url().slice(0, 60)}`));

  try {
    const res = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`  direct navigation: HTTP ${res.status()}`);
  } catch (e) {
    console.log(`  direct navigation failed: ${e.message}`);
  }

  // And what the page actually rendered.
  const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 160) : '').catch(() => '');
  console.log(`  page body: ${JSON.stringify(body.trim().slice(0, 120))}`);

  // Compare against a known-good public image to prove the network path works.
  try {
    const ok = await page.goto('https://www.roblox.com/favicon.ico', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`  control (roblox.com): HTTP ${ok.status()}`);
  } catch (e) {
    console.log(`  control failed: ${e.message}`);
  }

  console.log(`  responses seen: ${seen.slice(0, 5).join(' | ')}`);
  await browser.close();
})().catch((e) => { console.error('  FAILED:', e.message); process.exit(1); });