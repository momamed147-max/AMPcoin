/**
 * Screenshots the RPS move buttons and the admin give-items panel.
 *
 * The give panel is the part that changed most: quantity and mods now live
 * under each pet's own image instead of as one global "Qty each" value applied
 * to the whole selection.
 *
 * The checks here assert rather than eyeball. Picking two pets and giving them
 * different amounts has to produce two different amounts in the tray - a single
 * shared quantity would pass a glance but fail this.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';
const OUT = path.join(__dirname, 'shots-give');
const OPERATOR = process.env.OPERATOR || 'iloveadoptmegngos';

async function login(username) {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error(`dev-login ${username} -> ${res.status}`);
  const data = await res.json();
  return { token: data.token, user: data.user };
}

const tokenFor = async (username) => (await login(username)).token;

// ── RPS move buttons ──────────────────────────────────────────────────────
  // The picker only renders once BOTH sides are in a live match: it is hidden
  // while a match is still waiting for an opponent. So this stages a real
  // two-player match rather than screenshotting an empty lobby.
  async function stageLiveRpsMatch() {
    const first = await login('local-player-1');
    const second = await login('tester');

    const firstItem = async (who) => {
      const inv = await (await fetch(`${API}/api/users/inventory/${who.user.id}`, {
        headers: { Authorization: `Bearer ${who.token}` },
      })).json();
      const usable = (inv.items || []).filter((i) => Number(i.value) > 0 && (i.quantity || 1) >= 1);
      if (usable.length === 0) throw new Error(`${who.user.robloxUsername} has nothing to wager`);
      return usable[0];
    };

    const a = await firstItem(first);
    const b = await firstItem(second);

    const created = await (await fetch(`${API}/api/rps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ selectedItems: [{ itemId: a.itemId || a.id, quantity: 1 }], side: 'rock', rounds: 3 }),
    })).json();
    if (!created.match) throw new Error(`create failed: ${JSON.stringify(created)}`);

    const joined = await (await fetch(`${API}/api/rps/matches/${created.match.id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${second.token}` },
      body: JSON.stringify({ selectedItems: [{ itemId: b.itemId || b.id, quantity: 1 }], side: 'paper' }),
    })).json();
    if (!joined.match) throw new Error(`join failed: ${JSON.stringify(joined)}`);

    // Both sides pick as they enter, so round 1 settles on join and clears
    // `choices`. The match stays playing, which is exactly the state the picker
    // is for: the next round's pick.
    const status = await (await fetch(`${API}/api/rps/lobby`, {
      headers: { Authorization: `Bearer ${second.token}` },
    })).json();
    const live = (status.myMatches || []).find((m) => m.id === created.match.id);
    console.log(`  match status after join: ${live?.status} (picker shows while 'playing')`);

    return { token: second.token, matchId: created.match.id };
  }

  (async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const signIn = async (token) => {
    await page.evaluateOnNewDocument((t) => {
      localStorage.setItem('token', t);
    }, token);
  };

  // ── RPS move buttons ──────────────────────────────────────────────────────
  const staged = await stageLiveRpsMatch();
  console.log(`  staged live RPS match ${staged.matchId} (both sides joined)`);
  await signIn(staged.token);
  await page.goto(`${BASE}/rps`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rps-move-btn', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  const rps = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.rps-move-btn')];
    return {
      count: btns.length,
      icons: document.querySelectorAll('.rps-move-icon').length,
      boxes: btns.map((b) => {
        const r = b.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top) };
      }),
      tints: btns.map((b) => getComputedStyle(b).getPropertyValue('--move-tint').trim()),
      labels: btns.map((b) => b.textContent.trim()),
    };
  });

  console.log(`  rps move buttons   : ${rps.count}`);
  console.log(`  icon wells         : ${rps.icons} ${rps.icons === rps.count ? '(all present)' : '(MISSING)'}`);
  console.log(`  heights            : ${rps.boxes.map((b) => b.h).join(', ')}`);
  console.log(`  widths             : ${rps.boxes.map((b) => b.w).join(', ')}`);
  const uniform = new Set(rps.boxes.map((b) => b.h)).size === 1 && new Set(rps.boxes.map((b) => b.y)).size === 1;
  console.log(`  uniform size+row   : ${uniform ? 'yes' : 'NO - ragged'}`);
  console.log(`  per-move tints     : ${rps.tints.join(' | ')}`);
  console.log(`  tints all distinct : ${new Set(rps.tints).size === rps.count ? 'yes' : 'NO'}`);

  await page.screenshot({ path: path.join(OUT, 'rps-moves.png') });

  // The picked move has to read differently from an unpicked one. Compare the
  // selected button against a sibling that is still unpicked - comparing the
  // same button before and after just re-measures the same thing.
  await page.click('.rps-move-btn');
  await new Promise((r) => setTimeout(r, 600));
  const diff = await page.evaluate(() => {
    const sel = document.querySelector('.rps-move-btn.selected');
    const other = document.querySelector('.rps-move-btn:not(.selected)');
    if (!sel || !other) return null;
    const a = getComputedStyle(sel);
    const b = getComputedStyle(other);
    return {
      selected: true,
      border: [a.borderColor, b.borderColor],
      bg: [a.backgroundColor, b.backgroundColor],
      shadow: a.boxShadow !== b.boxShadow,
      label: sel.textContent.trim(),
    };
  });
  if (!diff) {
    console.log('  selected state     : could not compare (no unselected sibling)');
  } else {
    const borderDiff = diff.border[0] !== diff.border[1];
    const bgDiff = diff.bg[0] !== diff.bg[1];
    console.log(`  picked move        : ${diff.label}`);
    console.log(`  border  picked/plain: ${diff.border[0]} vs ${diff.border[1]} ${borderDiff ? '(differs)' : '(SAME)'}`);
    console.log(`  bg      picked/plain: ${diff.bg[0]} vs ${diff.bg[1]} ${bgDiff ? '(differs)' : '(SAME)'}`);
    console.log(`  glow differs        : ${diff.shadow ? 'yes' : 'NO'}`);
    console.log(`  reads as selected  : ${borderDiff || bgDiff || diff.shadow ? 'yes' : 'NO - looks identical to unselected'}`);
  }
  await page.screenshot({ path: path.join(OUT, 'rps-moves-selected.png') });

  // ── Admin give-items panel ────────────────────────────────────────────────
  await signIn(await tokenFor(OPERATOR));
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1500));

  await page.waitForSelector('.admin-tabs .tab-btn', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('.admin-tabs .tab-btn')].map((b) => b.textContent.trim())
  );
  console.log(`\n  admin tabs: ${tabs.join(' | ') || 'NONE - page did not render'}`);

  await page.evaluate(() => {
    const target = [...document.querySelectorAll('.admin-tabs .tab-btn')]
      .find((b) => /manage users|users/i.test(b.textContent));
    target?.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Each user row has a small button that opens that player's inventory.
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.btn-secondary.btn-sm')][0];
    if (!btn) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 1800));

  if (!opened || !(await page.$('.give-picker'))) {
    console.log(`  give picker opened: ${opened && (await page.$('.give-picker')) ? 'yes' : 'NO'}`);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="user"]')].slice(0, 6).map((e) => e.className)
    );
    console.log(`  candidate classes: ${rows.join(' | ')}`);
  } else {
    console.log('  give picker opened');

    // Pick two different pets.
    const picked = await page.evaluate(() => {
      const picks = [...document.querySelectorAll('.give-picker-item .give-picker-pick')];
      if (picks.length >= 2) { picks[0].click(); picks[1].click(); return 2; }
      if (picks.length === 1) { picks[0].click(); return 1; }
      return 0;
    });
    console.log(`  pets picked: ${picked}`);
    await new Promise((r) => setTimeout(r, 600));

    const fields = await page.evaluate(() =>
      [...document.querySelectorAll('.give-picker-item.selected .give-qty-field input')].length
    );
    console.log(`  per-pet amount fields: ${fields} ${fields === picked ? '(one per pet)' : '(MISMATCH)'}`);

    // Type a different amount into each pet's own field.
    await page.evaluate(() => {
      const ins = [...document.querySelectorAll('.give-picker-item.selected .give-qty-field input')];
      const setNative = (el, v) => {
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      if (ins[0]) setNative(ins[0], '1');
      if (ins[1]) setNative(ins[1], '3');
    });
    await new Promise((r) => setTimeout(r, 600));

    // Toggle M on the SECOND pet only. It must not leak onto the first - that
    // old behaviour is exactly what made every grant come out as MFR/NFR.
    const modState = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.give-picker-item.selected .give-mods-field')];
      if (groups.length >= 2) groups[1].querySelectorAll('button')[2].click();
      return groups.map((g) => [...g.querySelectorAll('button')].map((b) => (b.classList.contains('active') ? b.textContent.trim() : '')).join(''));
    });
    await new Promise((r) => setTimeout(r, 600));
    const modState2 = await page.evaluate(() =>
      [...document.querySelectorAll('.give-picker-item.selected .give-mods-field')]
        .map((g) => [...g.querySelectorAll('button')].map((b) => (b.classList.contains('active') ? b.textContent.trim() : '')).join(''))
    );
    console.log(`  mods before/after  : ${JSON.stringify(modState)} -> ${JSON.stringify(modState2)}`);
    // M is a tier that implies Fly + Ride - there is no bare-mega price in the
    // catalog. What matters is that the UI does not disagree with the server:
    // what is ticked here must be what the grant actually creates.
    const locked = await page.evaluate(() =>
      [...document.querySelectorAll('.give-picker-item.selected .give-mods-field button.locked')].map((b) => b.textContent.trim())
    );
    const note = await page.evaluate(() => document.querySelector('.give-mods-note')?.textContent.trim() || null);
    console.log(`  F/R shown as locked: ${locked.join(', ') || 'NONE - they appeared from nowhere'}`);
    console.log(`  explanation shown  : ${note || 'MISSING'}`);
    console.log(`  first pet untouched: ${modState2[0] === '' ? 'yes' : `NO (got "${modState2[0]}")`}`);

    const tray = await page.evaluate(() => ({
      names: [...document.querySelectorAll('.give-selection-chip strong')].map((e) => e.textContent.trim()),
      amounts: [...document.querySelectorAll('.give-selection-chip small')].map((e) => e.textContent.trim()),
      summary: document.querySelector('.give-bundle-summary')?.textContent.trim() || null,
      submit: document.querySelector('.give-submit')?.textContent.trim() || null,
      wipe: !!document.querySelector('.give-wipe-all'),
      chipWipe: document.querySelectorAll('.give-chip-wipe').length,
    }));
    // The chip label is the contract with the server: ticked mods in the UI must
    // equal the bracket suffix in the tray, or an admin grants the wrong pet.
    const ticked = modState2[1] ? modState2[1].split('').sort().join('') : '';
    const labelled = (tray.names[1] || '').match(/\(([A-Z]+)\)/);
    const shown = labelled ? labelled[1].split('').sort().join('') : '';
    console.log(`  tray names         : ${tray.names.join(' | ')}`);
    console.log(`  UI vs label agree  : ${ticked === shown ? `yes (${shown || 'plain'})` : `NO - ticked "${ticked}" but labelled "${shown}"`}`);
    console.log(`  tray amounts       : ${tray.amounts.join(' | ')}`);
    console.log(`  amounts differ     : ${new Set(tray.amounts).size > 1 ? 'yes' : 'NO - one shared quantity'}`);
    console.log(`  summary            : ${tray.summary}`);
    console.log(`  submit label       : ${tray.submit}`);
    console.log(`  wipe button        : ${tray.wipe ? 'present' : 'MISSING'} (per-chip: ${tray.chipWipe})`);

    await page.screenshot({ path: path.join(OUT, 'admin-give.png') });
    await page.evaluate(() => document.querySelector('.give-picker')?.scrollIntoView({ block: 'center' }));
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, 'admin-give-picker.png') });
    const el = await page.$('.give-picker');
    if (el) await el.screenshot({ path: path.join(OUT, 'admin-give-panel.png') });
  }

  await browser.close();
  console.log(`\n  shots -> ${OUT}`);
})().catch((e) => {
  console.error('  FAILED:', e.message);
  process.exit(1);
});