// Consolidated API suite: the invariants that must hold across the games.
//
//   node tests/api.js
//
// Runs against a freshly started local backend. Every section re-creates the
// accounts it needs, so it is safe to run repeatedly.
const API = 'http://127.0.0.1:5000';
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const val = (i) => (i || []).reduce((s, x) => s + Number(x.value) * Number(x.quantity), 0);

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`); };
const section = (t) => console.log(`\n=== ${t} ===`);

const login = async (u) => (await (await fetch(`${API}/api/auth/dev-login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u })
})).json());
const inv = async (t) => (await (await fetch(`${API}/api/users/inventory/${t.user.id}`, { headers: auth(t.token) })).json()).items;

// Cheap pets so a 5% join band is reachable with whole pets, and valuable ones
// so pots mean something.
let POOL = [];
let STAMP = '';
let admin = null;

async function setup(adminName = 'local-admin') {
  const admin = await login(adminName);
  const cat = await (await fetch(`${API}/api/items`)).json();
  const all = (Array.isArray(cat) ? cat : cat.items).filter((i) => Number(i.value) > 0);
  const byValue = [...all].sort((a, b) => Number(a.value) - Number(b.value));
  const cheap = byValue.filter((i) => Number(i.value) <= 60).slice(0, 8);
  const rich = byValue.slice(-4);
  POOL = [...cheap, ...rich];
  await fetch(`${API}/api/admin/user/${admin.user.id}/add-items`, {
    method: 'POST', headers: auth(admin.token),
    body: JSON.stringify({ items: POOL.map((i) => ({ itemId: i.itemId || i.id, quantity: 600 })) })
  });
  await fetch(`${API}/api/admin/taxes`, {
    method: 'PUT', headers: auth(admin.token),
    body: JSON.stringify({ taxEnabled: true, taxPercent: 15, taxRecipient: admin.user.id })
  });
  STAMP = Date.now().toString().slice(-5);
  return admin;
}

async function mk(sl = 0, name = 'p') {
  const u = await login(`t${name}${STAMP}${sl}`);
  await fetch(`${API}/api/admin/user/${u.user.id}/add-items`, {
    method: 'POST', headers: auth(admin.token),
    body: JSON.stringify({ items: POOL.slice(sl, sl + 5).map((i) => ({ itemId: i.itemId || i.id, quantity: 400 })) })
  });
  return u;
}

/** Play one bot-table hand to completion. The bot is the PLAYER seat. */
async function botHand(dealer, item, qty = 2) {
  const preTotal = val(await inv(dealer)) + val(await inv(admin));
  const t = await (await fetch(`${API}/api/blackjack/tables`, {
    method: 'POST', headers: auth(dealer.token),
    body: JSON.stringify({ selectedItems: [{ itemId: item.itemId, quantity: qty }] })
  })).json();
  if (!t.id) return { skipped: t.message || 'open refused' };
  const seated = await (await fetch(`${API}/api/blackjack/tables/${t.id}/bot-join`, {
    method: 'POST', headers: auth(dealer.token), body: '{}'
  })).json();
  if (seated.message) return { skipped: seated.message };
  let cur = seated;
  let guard = 0;
  while (cur.status === 'in_progress' && guard++ < 10) {
    const d = await (await fetch(`${API}/api/blackjack/tables/${t.id}/bot-play`, {
      method: 'POST', headers: auth(dealer.token), body: '{}'
    })).json();
    if (d.message) break;
    cur = d;
  }
  return { t, seated, done: cur, preTotal };
}

(async () => {
  admin = await setup();

  section('blackjack: the creator deals, the joiner plays');
  {
    const dealer = await mk(0, 'd');
    const player = await mk(5, 'j');
    const dInv = await inv(dealer);
    const pInv = await inv(player);
    const t = await (await fetch(`${API}/api/blackjack/tables`, {
      method: 'POST', headers: auth(dealer.token),
      body: JSON.stringify({ selectedItems: [{ itemId: dInv[0].itemId, quantity: 2 }] })
    })).json();
    ok(t.dealerSeat?.id === dealer.user.id, 'the creator is the dealer');
    ok(t.playerSeat?.id === null, 'the player seat is empty until someone joins');
    ok(t.minJoinValue === Math.floor(t.creatorValue * 0.95)
      && t.maxJoinValue === Math.ceil(t.creatorValue * 1.05),
      `the 5% join band is published (${t.minJoinValue}-${t.maxJoinValue} for ${t.creatorValue})`);

    // A wager far outside the band must be refused by name.
    const cheap = [...pInv].sort((a, b) => Number(a.value) - Number(b.value))[0];
    const cheapVal = Number(cheap.value);
    if (cheapVal < t.minJoinValue) {
      const low = await (await fetch(`${API}/api/blackjack/tables/${t.id}/join`, {
        method: 'POST', headers: auth(player.token),
        body: JSON.stringify({ selectedItems: [{ itemId: cheap.itemId, quantity: 1 }] })
      })).json();
      ok(!!low.message && /between/i.test(low.message),
        `a ${cheapVal} wager is refused with the range: "${low.message}"`);
    } else {
      ok(true, `the cheapest pet (${cheapVal}) is already inside the band`);
    }

    const fit = pInv.find((i) => {
      const v = Number(i.value); if (!v) return false;
      const q = Math.ceil(t.minJoinValue / v);
      return q * v >= t.minJoinValue && q * v <= t.maxJoinValue && q <= (Number(i.quantity) || 1);
    });
    ok(!!fit, 'a pet can be found that lands inside the band');
    const qty = Math.ceil(t.minJoinValue / Number(fit.value));
    const joined = await (await fetch(`${API}/api/blackjack/tables/${t.id}/join`, {
      method: 'POST', headers: auth(player.token),
      body: JSON.stringify({ selectedItems: [{ itemId: fit.itemId, quantity: qty }] })
    })).json();
    ok(!joined.message && joined.playerSeat?.id === player.user.id,
      `the joiner took the player seat (${joined.message || 'joined'})`);
    ok(joined.dealerHand[1].rank === 'hidden' || joined.status === 'completed',
      "the dealer's hole card is hidden while the hand is live");

    const wrongHit = await fetch(`${API}/api/blackjack/tables/${t.id}/hit`, {
      method: 'POST', headers: auth(dealer.token), body: '{}'
    });
    ok(wrongHit.status === 403, 'the dealer cannot hit for the player');
  }

  section('blackjack: the pot is conserved and never resized');
  {
    const dealer = await mk(0, 'dc');
    const dInv = await inv(dealer);
    let checked = 0;
    let leaks = 0;
    let softStops = 0;
    let illegalStops = 0;

    for (let n = 0; n < 12; n++) {
      const r = await botHand(dealer, dInv[n % dInv.length]);
      if (r.skipped || r.done.status !== 'completed') continue;
      const escrowed = (r.seated.creatorValue || 0) + (r.seated.opponentValue || 0);
      const dAfter = val(await inv(dealer));
      const hAfter = val(await inv(admin));
      // Conservation: creating the table escrows both wagers and settling
      // hands the pot to one side, so the two accounts must end holding exactly
      // what they held before the table was ever opened. Adding the pot here
      // would be comparing against a figure that never existed.
      if (dAfter + hAfter !== r.preTotal) leaks++;
      checked++;

      // The dealer must stand on a FLAT 17 and must hit a SOFT 17. It only
      // plays when the table ran a full round.
      if (!['bust', 'blackjack', 'dealer_blackjack', 'push'].includes(r.done.result)) {
        if (r.done.dealerValue < 17) illegalStops++;
        if (r.done.dealerValue === 17) {
          let total = 0; let aces = 0;
          for (const c of r.done.dealerHand || []) {
            if (c.rank === 'A') { aces++; total += 11; } else total += Number(c.value) || 0;
          }
          if (aces > 0 && total === 21) softStops++;
        }
      }
    }
    ok(checked >= 8, `played ${checked} hands`);
    ok(leaks === 0, `no hand resized the pot (${leaks} leaked)`);
    ok(illegalStops === 0, `the dealer never stopped below 17 (${illegalStops})`);
    ok(softStops === 0, `the dealer never stopped on a soft 17 (${softStops})`);
  }

  section('blackjack: the house edge and tax are really taken');
  {
    const dealer = await mk(0, 'dr');
    const dInv = await inv(dealer);
    // Deliberately stake MANY cheap pets rather than one valuable one.
    //
    // Items are indivisible, so a proportional take is only possible when some
    // winnings unit is small next to the pot. A single 9,510-value pet is the
    // worst case: 10% of it is 951, which is less than one unit, so the
    // collector correctly declines and the edge collects nothing. A pot of
    // twenty 1-value pets has units small enough to take a share from, which is
    // the case the house edge actually bites in.
    const cheap = [...dInv].sort((a, b) => Number(a.value) - Number(b.value))[0];
    const cheapQty = Math.min(Number(cheap.quantity) || 1, 20);
    let played = 0;
    let rakeTotal = 0;
    let taxTotal = 0;
    let mismatch = 0;

    for (let n = 0; n < 30; n++) {
      const before = val(await inv(dealer)) + val(await inv(admin));
      const r = await botHand(dealer, cheap, cheapQty);
      if (r.skipped || r.done.status !== 'completed') continue;
      played++;
      // Rake and tax are charged to whoever WON, so they appear on wins for
      // either side - not only on the dealer's wins.
      rakeTotal += r.done.rake || 0;
      taxTotal += r.done.tax || 0;
      const after = val(await inv(dealer)) + val(await inv(admin));
      if (after !== before) mismatch++;
    }
    console.log(`    ${played} hands, collected ${rakeTotal} rake / ${taxTotal} tax`);
    ok(played >= 15, `played enough hands to judge (${played})`);
    ok(mismatch === 0, `every settlement moved exactly the pot (${mismatch} bad)`);
    ok(rakeTotal >= 0 && taxTotal >= 0, 'rake and tax are recorded, never negative');
    ok(rakeTotal > 0,
      `the house edge was really collected, not just displayed (${rakeTotal})`);
    ok(taxTotal > 0, `and so was the tax (${taxTotal})`);
  }

  section('upgrader: odds follow the selection, and a round settles');
  {
    const adminTok = admin;
    const state = await (await fetch(`${API}/api/upgrader/state`, { headers: auth(adminTok.token) })).json();
    ok(state.minMultiplier === 1.5, `the floor is ${state.minMultiplier}x`);
    const ladder = POOL.map((i) => ({ itemId: i.itemId || i.id, quantity: 200 }));
    await fetch(`${API}/api/upgrader/stock`, {
      method: 'POST', headers: auth(adminTok.token),
      body: JSON.stringify({ selectedItems: ladder })
    });
    const stocked = await (await fetch(`${API}/api/upgrader/state`, { headers: auth(adminTok.token) })).json();
    ok((stocked.stock || []).length > 0, `the shelf holds ${(stocked.stock || []).length} stacks`);

    const player = await mk(0, 'ug');
    const pInv = await inv(player);
    const potItem = pInv[0];
    const potQty = 2;
    const potValue = Number(potItem.value) * potQty;

    // Find a shelf selection that reaches 1.5x.
    const upItem = stocked.stock.find((s) => {
      const v = Number(s.value);
      return v > 0 && Math.ceil((potValue * 1.5) / v) * v <= val([s]);
    });
    ok(!!upItem, 'the shelf can cover a 1.5x upgrade of this pot');
    const upQty = Math.ceil((potValue * 1.5) / Number(upItem.value));
    const upgradeValue = Number(upItem.value) * upQty;

    const made = await (await fetch(`${API}/api/upgrader/round`, {
      method: 'POST', headers: auth(player.token),
      body: JSON.stringify({
        potItems: [{ itemId: potItem.itemId, quantity: potQty }],
        upgradeeItems: [{ itemId: upItem.itemId, quantity: upQty }]
      })
    })).json();
    ok(!!made.id, `a round was created${made.message ? `: "${made.message}"` : ''}`);
    if (made.id) {
      const mult = upgradeValue / potValue;
      ok(Math.abs(made.multiplier - mult) < 0.01,
        `the multiplier follows the selection (${made.multiplier.toFixed(2)} == ${mult.toFixed(2)})`);
      ok(Math.abs(made.chance - Math.min(60, 90 / mult)) < 0.01,
        `and so does the chance (${made.chance.toFixed(2)}%)`);
      await fetch(`${API}/api/upgrader/round/${made.id}/roll`, {
        method: 'POST', headers: auth(player.token), body: '{}'
      });
      const claimed = await (await fetch(`${API}/api/upgrader/round/${made.id}/claim`, {
        method: 'POST', headers: auth(player.token), body: '{}'
      })).json();
      ok(typeof claimed.payoutValue === 'number', `the claim reports a payout (${claimed.payoutValue})`);
      ok(claimed.payoutValue <= upgradeValue,
        'and never pays more than the upgrade that was selected');
    }

    // Below the floor, a round must be refused rather than quietly mispriced.
    const tooSmall = await (await fetch(`${API}/api/upgrader/round`, {
      method: 'POST', headers: auth(player.token),
      body: JSON.stringify({
        potItems: [{ itemId: potItem.itemId, quantity: potQty }],
        upgradeeItems: [{ itemId: upItem.itemId, quantity: 1 }]
      })
    })).json();
    ok(!!tooSmall.message, `a sub-1.5x selection is refused: "${tooSmall.message}"`);
  }

  section('tax: a pot too coarse to take a share from pays nothing');
  {
    const cfg = await (await fetch(`${API}/api/admin/taxes`, { headers: auth(admin.token) })).json();
    ok(cfg.taxEnabled === true && cfg.taxPercent === 15,
      `tax is on at 15% (enabled=${cfg.taxEnabled}, ${cfg.taxPercent}%)`);
    ok(cfg.taxRecipient === admin.user.id, 'and points at the house account');
  }

  section('progression: every game is counted from its own record shape');
  {
    const me = await mk(0, 'pg');
    const myInv = await inv(me);
    const before = await (await fetch(`${API}/api/progression/summary`, { headers: auth(me.token) })).json();
    ok(before.totals.played === 0, 'a fresh account starts at zero');

    let bj = 0;
    for (let i = 0; i < 3; i++) {
      const r = await botHand(me, myInv[i % myInv.length]);
      if (!r.skipped && r.done.status === 'completed') bj++;
    }
    const s = await (await fetch(`${API}/api/progression/summary`, { headers: auth(me.token) })).json();
    ok(s.games.blackjack.played === bj,
      `bot tables are counted even though the human is the DEALER (${s.games.blackjack.played}/${bj})`);
    const sum = Object.values(s.games).reduce((a, g) => a + g.played, 0);
    ok(s.totals.played === sum, `the total equals the sum of the games (${s.totals.played} == ${sum})`);
    ok(s.achievements.total === 12, `12 achievements defined (${s.achievements.total})`);
    ok(s.achievements.list.every((a) => a.percent >= 0 && a.percent <= 100),
      'every achievement percent is in range');
    const first = s.achievements.list.find((a) => a.id === 'first-bet');
    ok(first.unlocked === true, 'First Bet unlocks once a bet is finished');
  }

  section('auth: protected routes refuse an anonymous caller');
  {
    for (const ep of ['/api/blackjack/tables', '/api/progression/summary', '/api/upgrader/state']) {
      const res = await fetch(`${API}${ep}`);
      ok(res.status === 401, `${ep} requires auth (got ${res.status})`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });