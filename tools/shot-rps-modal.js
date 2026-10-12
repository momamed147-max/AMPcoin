/**
 * Screenshots the RPS move picker in the create-bet and join-bet modals.
 *
 * These buttons had no CSS at all and rendered as the browser's default grey
 * chrome. The checks here are what would have caught that: the tints only come
 * from per-move CSS, so three identical grey boxes would report as missing.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';
const OUT = path.join(__dirname, 'shots-rps-modal');

const login = async (username) => {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  return { token: data.token, user: data.user };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });

  const player = await login('local-player-1');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), player.token);

  // A live multi-round match so the join path has a target. `tester` owns it, so
  // local-player-1 is the joiner rather than the creator - the create and join
  // flows are different buttons in different places and both need checking.
  const other = await login('tester');
  const otherInv = await (await fetch(`${API}/api/users/inventory/${other.user.id}`, {
    headers: { Authorization: `Bearer ${other.token}` },
  })).json();
  const otherItem = (otherInv.items || []).filter((i) => Number(i.value) > 0)[0];

  // Also give local-player-1 something to wager, in case the create modal needs
  // an item selected to render the picker.
  const inv = await (await fetch(`${API}/api/users/inventory/${player.user.id}`, {
    headers: { Authorization: `Bearer ${player.token}` },
  })).json();
  const item = (inv.items || []).filter((i) => Number(i.value) > 0)[0];
  if (!item) throw new Error('local-player-1 has nothing to wager');

  if (!otherItem) throw new Error('tester has nothing to wager');

  const created = await (await fetch(`${API}/api/rps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${other.token}` },
    body: JSON.stringify({ selectedItems: [{ itemId: otherItem.itemId || otherItem.id, quantity: 1 }], side: 'rock', rounds: 3 }),
  })).json();
  if (!created.match) throw new Error(`create failed: ${JSON.stringify(created)}`);

  // Deliberately NOT joined. The join button only exists on a match the viewer
  // has not taken part in yet, so joining here would remove the very thing the
  // join-modal check needs.
  console.log(`  staged match ${created.match.id} owned by tester, left open for local-player-1 to join`);

  await page.goto(`${BASE}/rps`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 2500));

  const probe = async (label) => {
    const r = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.cf-rps-side-btn')];
      if (btns.length === 0) return null;
      const read = (b) => {
        const s = getComputedStyle(b);
        const box = b.getBoundingClientRect();
        const svg = b.querySelector('svg');
        const label = b.querySelector('span');
        return {
          label: b.textContent.trim(),
          // A label rendered wider than its box is being clipped to "R.." / "P..",
          // which is what made these look broken rather than plain.
          clipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
          tint: getComputedStyle(b).getPropertyValue('--move-tint').trim(),
          border: s.borderColor,
          bg: s.backgroundColor,
          w: Math.round(box.width),
          h: Math.round(box.height),
          svgW: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
          svgH: svg ? Math.round(svg.getBoundingClientRect().height) : 0,
        };
      };
      return {
        count: btns.length,
        all: btns.map(read),
        active: btns.findIndex((b) => b.classList.contains('active')),
      };
    });

    if (!r) {
      console.log(`  ${label}: picker not open`);
      return null;
    }

    console.log(`\n  ${label}`);
    console.log(`    buttons          : ${r.count}`);
    console.log(`    labels           : ${r.all.map((b) => b.label).join(' | ')}`);
    console.log(`    tints            : ${r.all.map((b) => b.tint).join(' | ')}`);
    console.log(`    tints distinct   : ${new Set(r.all.map((b) => b.tint)).size === r.count ? 'yes' : 'NO - still default grey'}`);
    console.log(`    sizes            : ${r.all.map((b) => `${b.w}x${b.h}`).join(' | ')}`);
    console.log(`    uniform          : ${new Set(r.all.map((b) => `${b.w}x${b.h}`)).size === 1 ? 'yes' : 'NO - ragged'}`);
    console.log(`    icons            : ${r.all.map((b) => `${b.svgW}x${b.svgH}`).join(' | ')}`);
    console.log(`    icons square-ish : ${r.all.every((b) => Math.abs(b.svgW - b.svgH) <= 4) ? 'yes' : 'NO - squashed'}`);
    const clipped = r.all.filter((b) => b.clipped).map((b) => b.label);
    console.log(`    labels readable  : ${clipped.length === 0 ? 'yes' : `NO - clipped: ${clipped.join(', ')}`}`);
    console.log(`    preselected      : ${r.active >= 0 ? r.all[r.active].label : 'none'}`);

    // The real test: the picked move must not look like the other two.
    const a = r.active;
    if (a >= 0) {
      const others = r.all.filter((_, i) => i !== a);
      const picked = r.all[a];
      const borderDiff = others.every((o) => o.border !== picked.border);
      const bgDiff = others.every((o) => o.bg !== picked.bg);
      console.log(`    picked stands out: ${borderDiff && bgDiff ? 'yes' : `NO (border ${borderDiff ? 'ok' : 'same'}, bg ${bgDiff ? 'ok' : 'same'})`}`);
    } else {
      console.log('    picked stands out: nothing selected');
    }
    return r;
  };

  // ── Create bet ───────────────────────────────────────────────────────────
  // The create entry point is the gold topbar button; the join entry point is
  // the button inside the match view. Both open the same modal with a different
  // gameType, so the picker markup is identical either way - but the join path
  // is a different button in a different place, so it is checked separately.
  const dismiss = async () => {
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 900));
  };

  await dismiss();
  await page.evaluate(() => document.querySelector('.cf-topbar-btn-gold')?.click());
  await new Promise((r) => setTimeout(r, 1600));

  if (!(await page.$('.cf-rps-side-btn'))) {
    console.log('  the gold topbar button did not open it. Buttons present:');
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 25)
    );
    console.log(`  ${labels.join(' | ')}`);
  }

  await page.waitForSelector('.cf-rps-side-btn', { timeout: 12000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  await probe('CREATE BET modal');
  await page.screenshot({ path: path.join(OUT, 'create-bet.png') });
  const modal = await page.$('.modal');
  if (modal) await modal.screenshot({ path: path.join(OUT, 'create-bet-modal.png') });

  // Click through: the highlight has to actually move, not just look right once.
  const clicked = await page.evaluate(() => {
    const target = [...document.querySelectorAll('.cf-rps-side-btn')].find((b) => /scissors/i.test(b.textContent));
    if (!target) return null;
    target.click();
    return target.textContent.trim();
  });
  await new Promise((r) => setTimeout(r, 600));
  const afterClick = await page.evaluate(() => {
    const act = document.querySelector('.cf-rps-side-btn.active');
    return act ? act.textContent.trim() : null;
  });
  console.log(`    clicked "${clicked}" -> highlighted "${afterClick}" ${clicked && afterClick === clicked ? '(moved correctly)' : '(DID NOT MOVE)'}`);
  if (clicked && afterClick === clicked) {
    const modal2 = await page.$('.modal');
    if (modal2) await modal2.screenshot({ path: path.join(OUT, 'create-bet-selected.png') });
    // And confirm only one button is highlighted at a time.
    const activeCount = await page.evaluate(() => document.querySelectorAll('.cf-rps-side-btn.active').length);
    console.log(`    exactly one active: ${activeCount === 1 ? 'yes' : `NO (${activeCount})`}`);
  }

  // ── Join bet ─────────────────────────────────────────────────────────────
  await dismiss();
  // Open the view of someone else's open match, then the join button inside it.
  await page.evaluate(() => {
    // The join button needs `waiting && !isParticipant`, so this has to be a row
    // still waiting for a challenger. Waiting rows sort after playing ones, so
    // take the LAST View rather than the first - the first is usually a match
    // already in progress, which shows no join button at all.
    const btns = [...document.querySelectorAll('.rps-lobby-row button')]
      .filter((b) => /^view$/i.test(b.textContent.trim()));
    (btns[btns.length - 1] || btns[0])?.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  const hasJoinBtn = await page.evaluate(() => !!document.querySelector('.cf-view-join-btn'));
  console.log(`\n  match view opened with a join button: ${hasJoinBtn ? 'yes' : 'no'}`);
  await page.evaluate(() => document.querySelector('.cf-view-join-btn')?.click());
  await new Promise((r) => setTimeout(r, 1800));
  if (await page.$('.cf-rps-side-btn')) {
    await probe('JOIN BET modal');
    const joined = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.cf-rps-side-btn')].find((b) => /paper/i.test(b.textContent));
      t?.click();
      return t ? t.textContent.trim() : null;
    });
    await new Promise((r) => setTimeout(r, 600));
    const now = await page.evaluate(() => document.querySelector('.cf-rps-side-btn.active')?.textContent.trim() || null);
    console.log(`    clicked "${joined}" -> highlighted "${now}" ${joined && joined === now ? '(moved correctly)' : '(DID NOT MOVE)'}`);
    await page.screenshot({ path: path.join(OUT, 'join-bet.png') });
    const m3 = await page.$('.modal');
    if (m3) await m3.screenshot({ path: path.join(OUT, 'join-bet-modal.png') });
  } else {
    console.log('  JOIN BET modal: picker never appeared');
  }

  await browser.close();
  console.log(`\n  shots -> ${OUT}`);
})().catch((e) => {
  console.error('  FAILED:', e.message);
  process.exit(1);
});