// Seed the local sandbox so the games are immediately playable.
//
// Local state is in-memory: a backend restart wipes the shelf, the test
// accounts and the tax settings, so re-run this afterwards.
//
//   node seedlocal.js            seed everything
//   node seedlocal.js --list     show what exists
// Load .env so the seeder sees the same configuration the server does -
// otherwise FORCE_OUTCOME_* looks unset here while the server has it live,
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const API = 'http://127.0.0.1:5000';
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`); };

const login = async (u) => (await (await fetch(`${API}/api/auth/dev-login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u })
})).json());
const inv = async (t) => (await (await fetch(`${API}/api/users/inventory/${t.user.id}`, { headers: auth(t.token) })).json()).items;
const val = (i) => (i || []).reduce((s, x) => s + Number(x.value) * Number(x.quantity), 0);
const fmt = (n) => Number(n || 0).toLocaleString();

const listOnly = process.argv.includes('--list');

(async () => {
  console.log('=== accounts ===');
  const admin = await login('local-admin');
  const tester = await login('tester');
  ok(!!admin.token, `local-admin ready (admin=${admin.user.isAdmin})`);
  ok(!!tester.token, 'tester ready');
  ok(admin.user.isAdmin === true, 'local-admin has the admin panel');

  // The outcome-control operator account. It needs admin rights because the
  // arming endpoint is admin-authenticated, so granting it here is what makes
  // the system usable locally. Only created when the server is actually running
  // with FORCE_OUTCOME_OPERATORS naming it.
  const operatorName = String(process.env.FORCE_OUTCOME_OPERATORS || '').split(',')[0].trim();
  if (process.env.FORCE_OUTCOME_ENABLED === '1' && operatorName) {
    const op = await login(operatorName);
    ok(!!op.token, `${operatorName} ready`);
    if (op.token && op.user.isAdmin !== true) {
      const granted = await fetch(`${API}/api/admin/users/${operatorName}/admin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ enabled: true })
      });
      ok(granted.ok, `${operatorName} granted admin (${granted.status})`);
      const again = await login(operatorName);
      ok(again.user.isAdmin === true, `${operatorName} can now reach outcome control`);
    } else if (op.token) {
      ok(true, `${operatorName} is already admin`);
    }
  } else {
    console.log('  outcome control disabled - skipping the operator account');
  }

  const cat = await (await fetch(`${API}/api/items`)).json();
  const all = (Array.isArray(cat) ? cat : cat.items).filter((i) => Number(i.value) > 0);
  if (!all.length) { console.log('  no items in the catalog - cannot seed'); process.exit(1); }
  const byValue = [...all].sort((a, b) => Number(a.value) - Number(b.value));
  // A spread of cheap and valuable pets: cheap ones so a 5% join band is
  // reachable with whole pets, valuable ones so pots are worth something.
  const spread = [];
  const seen = new Set();
  for (let i = 0; i < byValue.length; i += Math.max(1, Math.floor(byValue.length / 14))) {
    const it = byValue[i];
    const id = it.itemId || it.id;
    if (seen.has(id)) continue;
    seen.add(id);
    spread.push(it);
  }
  const cheap = byValue.filter((i) => Number(i.value) <= 60).slice(0, 6);
  const pool = [...cheap, ...spread].filter((i, n, a) => a.findIndex((x) => (x.itemId || x.id) === (i.itemId || i.id)) === n);

  if (listOnly) {
    console.log(`\n  catalog: ${all.length} pets, ${all[0].value} to ${byValue[byValue.length - 1].value}`);
    console.log(`  admin: ${fmt(val(await inv(admin)))} across ${(await inv(admin)).length} stacks`);
    console.log(`  tester: ${fmt(val(await inv(tester)))} across ${(await inv(tester)).length} stacks`);
    const tax = await (await fetch(`${API}/api/admin/taxes`, { headers: auth(admin.token) })).json();
    console.log(`  tax: enabled=${tax.taxEnabled} ${tax.taxPercent}% -> ${tax.taxRecipient || '(unset)'}`);
    const ug = await (await fetch(`${API}/api/upgrader/state`, { headers: auth(tester.token) })).json();
    console.log(`  upgrader shelf: ${(ug.stock || []).length} stacks, ${ug.stockUnits || 0} units`);
    process.exit(0);
  }

  console.log('\n=== tax points at the house account ===');
  const tax = await (await fetch(`${API}/api/admin/taxes`, {
    method: 'PUT', headers: auth(admin.token),
    body: JSON.stringify({ taxEnabled: true, taxPercent: 15, taxRecipient: admin.user.id })
  })).json();
  const check = await (await fetch(`${API}/api/admin/taxes`, { headers: auth(admin.token) })).json();
  ok(check.taxEnabled === true && check.taxPercent === 15,
    `tax is on at 15% (enabled=${check.taxEnabled}, ${check.taxPercent}%)`);
  ok(check.taxRecipient === admin.user.id, 'tax goes to local-admin, which is also the house stock');
  void tax;

  console.log('\n=== house stock (funds the dealer bot and the tax pot) ===');
  const before = val(await inv(admin));
  await fetch(`${API}/api/admin/user/${admin.user.id}/add-items`, {
    method: 'POST', headers: auth(admin.token),
    body: JSON.stringify({ items: pool.map((i) => ({ itemId: i.itemId || i.id, quantity: 400 })) })
  });
  const houseInv = await inv(admin);
  ok(val(houseInv) > before, `house is stocked (${fmt(before)} -> ${fmt(val(houseInv))} across ${houseInv.length} stacks)`);

  console.log('\n=== player pets ===');
  for (const [who, acct] of [['tester', tester], ['local-player-1', await login('local-player-1')]]) {
    const b = val(await inv(acct));
    await fetch(`${API}/api/admin/user/${acct.user.id}/add-items`, {
      method: 'POST', headers: auth(admin.token),
      body: JSON.stringify({ items: pool.map((i) => ({ itemId: i.itemId || i.id, quantity: 300 })) })
    });
    const a = val(await inv(acct));
    ok(a > b, `${who}: ${fmt(b)} -> ${fmt(a)} across ${(await inv(acct)).length} stacks`);
  }

  console.log('\n=== upgrader shelf ===');
  // A ladder of DISTINCT values, not just the N cheapest: there are dozens of
  // 1-value pets, so a shelf of the 40 cheapest is all value 1, and a 1.5x
  // upgrade of a 1-value pot is 1.5 - unreachable with whole pets. The Upgrade
  // button then never enables and the page looks broken.
  const ladder = [];
  const seenValue = new Set();
  const seenId = new Set();
  for (const it of byValue) {
    const id = it.itemId || it.id;
    const v = Number(it.value);
    if (!v || seenValue.has(v) || seenId.has(id)) continue;
    seenValue.add(v);
    seenId.add(id);
    ladder.push(it);
    if (ladder.length >= 40) break;
  }
  await fetch(`${API}/api/admin/user/${admin.user.id}/add-items`, {
    method: 'POST', headers: auth(admin.token),
    body: JSON.stringify({
      items: ladder.map((i) => ({ itemId: i.itemId || i.id, quantity: 200 }))
    })
  });
  await fetch(`${API}/api/upgrader/stock`, {
    method: 'POST', headers: auth(admin.token),
    body: JSON.stringify({
      selectedItems: ladder.map((i) => ({ itemId: i.itemId || i.id, quantity: 150 }))
    })
  });
  const state = await (await fetch(`${API}/api/upgrader/state`, { headers: auth(admin.token) })).json();
  ok((state.stock || []).length > 0,
    `the shelf holds ${(state.stock || []).length} stacks / ${state.stockUnits || 0} units`);
  ok(state.minMultiplier === 1.5, `the minimum multiplier is ${state.minMultiplier}x`);
  const shelfValues = (state.stock || []).map((s) => Number(s.value)).sort((a, b) => a - b);
  if (shelfValues.length) {
    console.log(`    shelf values ${fmt(shelfValues[0])} .. ${fmt(shelfValues[shelfValues.length - 1])}`);
  }
  // The Upgrade button only enables once the selected pot and the selected
  // upgrade clear 1.5x, and both come off whole pets. So what matters is that
  // SOME pot on the shelf can be upgraded - not that every shelf value can be,
  // which is impossible: upgrading a 9,510 pet needs 14,265 of shelf stock and
  // no shelf holds that in cheap pets.
  const unitCounts = (state.stock || []).map((s) => Number(s.quantity) || 0);
  const maxUnits = unitCounts.length ? Math.max(...unitCounts) : 0;
  const cheapest = shelfValues[0];
  const upgradeableUpTo = maxUnits > 0 ? Math.floor((maxUnits * cheapest) / 1.5) : 0;
  const reachable = shelfValues.filter((v) => v <= upgradeableUpTo);
  ok(reachable.length > 0,
    `the shelf can upgrade pots up to ${fmt(upgradeableUpTo)} at 1.5x `
    + `(${reachable.length} shelf values playable)`);
  // And the cheapest pot must work, or the very first thing a new user tries
  // is a dead button.
  ok(upgradeableUpTo >= cheapest,
    `the cheapest shelf pet (${fmt(cheapest)}) is immediately playable`);

  console.log('\n=== a blackjack table opens and a bot takes the seat ===');
  const tInv = await inv(tester);
  const seat = tInv.find((i) => Number(i.value) > 0);
  const table = await (await fetch(`${API}/api/blackjack/tables`, {
    method: 'POST', headers: auth(tester.token),
    body: JSON.stringify({ selectedItems: [{ itemId: seat.itemId, quantity: 3 }] })
  })).json();
  if (table.id) {
    ok(table.status === 'waiting', 'a table is waiting for a player');
    ok(table.dealerSeat && table.dealerSeat.id === tester.user.id, 'the creator is the dealer');
    ok(table.minJoinValue !== undefined, `it publishes the join band ${table.minJoinValue}-${table.maxJoinValue}`);
    const seated = await (await fetch(`${API}/api/blackjack/tables/${table.id}/bot-join`, {
      method: 'POST', headers: auth(tester.token), body: '{}'
    })).json();
    ok(!seated.message && seated.playerSeat && seated.playerSeat.isBot === true,
      seated.message ? `the bot could not sit: "${seated.message}"` : 'the house bot took the player seat');
    ok(seated.playerHand.length === 2 && seated.dealerHand.length === 2, 'both hands are dealt');
    console.log(`    dealer ${seated.dealerValue} vs player ${seated.playerValue}`);
  } else {
    ok(false, `could not open a table: ${table.message}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('\n  frontend  http://localhost:3000');
  console.log('  backend   http://localhost:5000');
  console.log('  log in with "Local test mode":  tester  (play)   local-admin  (admin + house stock)');
  console.log('  local-player-1 exists too, useful as a second player for join tests');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });