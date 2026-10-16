/**
 * Which animations actually run when a person uses the site?
 *
 * The stylesheets declare 40+ keyframes, but that is not the same as motion. A
 * keyframe that never fires because its element is off-screen, or whose
 * duration has been reduced to nothing, is dead weight - and a site full of
 * those reads as static no matter how many are declared.
 *
 * Drives the real interactions a player performs and records every animation
 * the browser actually starts, plus the transition timings in force, so the
 * shortlist is evidence rather than taste.
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';
const OUT = path.join(__dirname, '..', 'tools', 'motion-report.json');

const login = async (u) => {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u }),
  });
  return (await res.json()).token;
};

(async () => {
  const token = await login('local-player-1');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('token', t);
    // Record every animation the compositor actually starts.
    window.__ran = [];
    const rec = (a) => window.__ran.push({
      name: a.animationName,
      dur: Math.round(parseFloat(a.duration || 0)),
      count: a.effect?.getTiming?.().iterations ?? 1,
      target: a.effect?.target?.className?.toString?.().slice(0, 60) || a.effect?.target?.tagName || '?',
    });
    document.addEventListener('animationstart', (e) => rec(e.animationName ? e.animationName : e), true);
    document.addEventListener('transitionrun', (e) => {
      window.__ran.push({
        name: 'transition:' + e.propertyName,
        dur: Math.round(parseFloat(e.elapsedTime * 1000) || 0),
        count: 1,
        target: e.target?.className?.toString?.().slice(0, 60) || e.target?.tagName || '?',
      });
    }, true);
  }, token);

  const report = {};

  const snap = async (label) => {
    await new Promise((r) => setTimeout(r, 120));
    const ran = await page.evaluate(() => {
      window.__ran = [];
      return true;
    });
    void ran;
  };

  await page.goto(`${BASE}/coinflip`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 2500));

  // Collect everything that ran during first paint.
  const onLoad = await page.evaluate(() => window.__ran.slice());
  await snap('load');

  // ── hover a lobby row ─────────────────────────────────────────────────────
  const rows = await page.$$('.cf-row');
  if (rows[0]) { await rows[0].hover(); await new Promise((r) => setTimeout(r, 700)); }
  const onHover = await page.evaluate(() => window.__ran.slice());
  await snap('hover');

  // ── click the primary action ──────────────────────────────────────────────
  const join = await page.$('.cf-join-btn');
  if (join) { await join.click(); await new Promise((r) => setTimeout(r, 900)); }
  const onModal = await page.evaluate(() => window.__ran.slice());
  await snap('modal');

  // ── close, then navigate to another route ────────────────────────────────
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));

  const idle = await page.evaluate(() => {
    // What is running RIGHT NOW with no interaction at all?
    return document.getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => ({
        name: a.animationName || a.transitionProperty || '?',
        dur: Math.round(parseFloat(a.effect?.getTiming?.().duration || 0)),
        infinite: (a.effect?.getTiming?.().iterations ?? 1) === Infinity,
        target: a.effect?.target?.className?.toString?.().slice(0, 50) || a.effect?.target?.tagName || '?',
      }));
  });

  // Transition durations actually in force on core controls.
  const timings = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { sel, dur: s.transitionDuration, prop: s.transitionProperty.slice(0, 60), ease: s.transitionTimingFunction.slice(0, 30) };
    };
    return ['.cf-row', '.cf-join-btn', '.cf-btn', '.btn', '.cf-topbar-btn', '.cf-tab', '.cf-view-btn', '.app .page-content']
      .map(pick).filter(Boolean);
  });

  report.firstPaint = onLoad;
  report.rowHover = onHover;
  report.modalOpen = onModal;
  report.idleRunning = idle;
  report.controlTimings = timings;

  const count = (a) => a.length;
  console.log('\n  what actually moves');
  console.log('  ' + '-'.repeat(72));
  console.log(`  first paint        ${count(onLoad)} animation(s)/transition(s)`);
  console.log(`  hovering a row     ${count(onHover)}`);
  console.log(`  opening a modal    ${count(onModal)}`);
  console.log(`  running while idle ${idle.length}`);

  console.log('\n  running with no interaction at all:');
  if (!idle.length) console.log('    NOTHING - the page is completely static when you are not touching it');
  idle.forEach((a) => console.log(`    ${String(a.dur + 'ms').padEnd(8)}${a.infinite ? 'loop ' : '     '}${a.name}  (${a.target})`));

  console.log('\n  transitions in force on core controls:');
  timings.forEach((t) => console.log(`    ${t.sel.padEnd(20)} ${t.dur.padEnd(16)} ${t.prop}`));

  console.log('\n  on first paint:');
  onLoad.slice(0, 12).forEach((a) => console.log(`    ${String(a.dur + 'ms').padEnd(8)}${a.name}  (${a.target})`));

  require('fs').writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\n  -> ${OUT}`);
  await browser.close();
})().catch((e) => { console.error('  FAILED:', e.message); process.exit(1); });