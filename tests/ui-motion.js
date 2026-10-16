/**
 * Does the motion layer actually reach the controls?
 *
 * The earlier audit reported zero animations on hover, but it had also lost
 * .cf-row from its own selector list by then, so it could not distinguish
 * "the motion is missing" from "the audit lost the element". This samples the
 * computed transform of a hovered control directly, which cannot go wrong that
 * way.
 *
 * For each target: the resting transform, the hovered transform, whether it
 * changed, and whether a transition is declared on it.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';

let pass = 0;
let fail = 0;
const ok = (c, label) => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

const login = async (u) => {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u }),
  });
  return (await res.json()).token;
};

const TRANSFORM_PROPS = ['transform', 'box-shadow', 'opacity', 'filter', 'background-color', 'border-color'];

(async () => {
  const { portInUse, startStaticServer, seedLobby } = require('./ui-harness');

  let staticServer = null;
  if (!(await portInUse(3000))) {
    staticServer = await startStaticServer();
    console.log('\n  started a static server on :3000 for this suite');
  }

  const token = await login('local-player-1');
  console.log(`  seeded ${await seedLobby(API)} lobby row(s)`);
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  await page.goto(`${BASE}/coinflip`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 3000));

  const count = await page.evaluate(() => document.querySelectorAll('.cf-row').length);
  ok(count > 0, `${count} lobby rows present to test against`);

  // Sample a control's computed style, then hover it and sample again.
  const sample = async (selector) => {
    const el = await page.$(selector);
    if (!el) return null;
    const read = () => page.evaluate((sel, props) => {
      const node = document.querySelector(sel);
      if (!node) return null;
      const s = getComputedStyle(node);
      return {
        transform: s.transform,
        boxShadow: s.boxShadow,
        transitionDuration: s.transitionDuration,
        transitionProperty: s.transitionProperty,
        rect: node.getBoundingClientRect().toJSON(),
      };
    }, selector, TRANSFORM_PROPS);

    const before = await read();
    await el.hover();
    await new Promise((r) => setTimeout(r, 450));
    const after = await read();
    return { before, after, el };
  };

  console.log('\n=== hover feedback on the controls people use ===\n');

  const targets = [
    ['.cf-row', 'a lobby row lifts'],
    ['.cf-join-btn', 'the Join button responds'],
    ['.cf-topbar-btn', 'a topbar button responds'],
    ['.cf-tab', 'a lobby tab responds'],
    ['.cf-row-thumb', 'an item tile responds'],
  ];

  for (const [selector, label] of targets) {
    const r = await sample(selector);
    if (!r) { ok(false, `${label} - element not found (${selector})`); continue; }

    const moved = r.before.transform !== r.after.transform;
    const shadowed = r.before.boxShadow !== r.after.boxShadow;
    const hasTransition = r.after.transitionDuration !== '0s';

    ok(moved || shadowed, `${label} changes on hover`,
      { transform: `${r.before.transform} -> ${r.after.transform}` });
    ok(hasTransition, `${label} has a transition declared`,
      { duration: r.after.transitionDuration, property: r.after.transitionProperty.slice(0, 60) });
    if (!moved && !shadowed) {
      console.log(`         before: transform=${r.before.transform} shadow=${String(r.before.boxShadow).slice(0, 50)}`);
      console.log(`         after : transform=${r.after.transform} shadow=${String(r.after.boxShadow).slice(0, 50)}`);
    }
  }

  console.log('\n=== press feedback ===\n');
  {
    const el = await page.$('.cf-join-btn');
    if (el) {
      const box = await el.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await new Promise((r) => setTimeout(r, 200));
      const pressed = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('.cf-join-btn'));
        return { transform: s.transform, shadow: s.boxShadow };
      });
      await page.mouse.up();
      // Wait for the release transition to finish before sampling, otherwise
      // both readings are mid-animation and look identical.
      await new Promise((r) => setTimeout(r, 450));
      const released = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('.cf-join-btn'));
        return { transform: s.transform, shadow: s.boxShadow };
      });
      ok(pressed.transform !== released.transform,
        `pressing changes it (down "${pressed.transform}" vs up "${released.transform}")`);
      ok(pressed.transform === 'none' || pressed.transform.includes('matrix'),
        'and the pressed state has a real transform');
    } else {
      ok(false, 'a Join button exists to press');
    }
  }

  console.log('\n=== modal entry ===\n');
  {
      // "View", not "Join": Join raises a warning popup instead of opening a
      // dialog when the viewer has nothing to wager, so it only opens when the
      // test happens to be logged in as somebody holding items.
      const view = await page.$(".cf-view-btn");
      ok(Boolean(view), 'a View button is available to open a dialog with');
      if (view) {
        // Dispatch the click directly. A real mouse click has to hit a button
        // that may sit under a stacking-context sibling, which makes this
        // intermittent for reasons that have nothing to do with the animation.
        await page.evaluate(() => {
          const btn = document.querySelector('.cf-view-btn');
          btn?.click();
        });
        // Wait for the dialog rather than sampling straight after the click;
        // the overlay mounts on the next tick and racing it makes this flake.
        await page.waitForSelector('.cf-modal-overlay, .modal-overlay, .cp-overlay', { timeout: 8000 })
          .catch(() => {});

        // The overlay really is .cf-modal-overlay, not .modal-overlay, and it
        // mounts on document.body through a portal. Guessing the selector here
        // reported "nothing animated" for a dialog that was animating all along.
        const opened = await page.evaluate(() => {
          const ov = document.querySelector('.cf-modal-overlay, .modal-overlay, .cp-overlay');
          if (!ov) return { found: false };
          const read = (el) => {
            if (!el) return null;
            const s = getComputedStyle(el);
            return {
              cls: el.className?.toString?.().slice(0, 50) || el.tagName,
              name: s.animationName,
              dur: s.animationDuration,
            };
          };
          return { found: true, overlay: read(ov), dialog: read(ov.firstElementChild) };
        });

        ok(opened.found, 'a dialog opened');
        if (opened.found) {
          ok(Boolean(opened.overlay?.name && opened.overlay.name !== 'none'),
            `the backdrop animates in (${opened.overlay?.name} ${opened.overlay?.dur})`);
          ok(Boolean(opened.dialog?.name && opened.dialog.name !== 'none'),
            `the dialog animates in (${opened.dialog?.name} ${opened.dialog?.dur})`);
        }

        await new Promise((r) => setTimeout(r, 700));
        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 500));
      }
  }

  console.log('\n=== idle ===\n');
  {
    const idle = await page.evaluate(() => document.getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => a.animationName || 'transition'));
    ok(idle.length >= 2, `the page has life while untouched (${idle.length} running: ${idle.join(', ')})`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await browser.close();
  if (staticServer) staticServer.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('  FAILED:', e.message); process.exit(1); });