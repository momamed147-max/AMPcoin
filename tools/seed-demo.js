/**
 * Fill every lobby with demo bets so the UI can be judged with real content.
 *
 * Empty lobbies hide most design problems. A row with no avatars, no pet
 * thumbnails, no long names and no value range looks fine; a row carrying all
 * of those is where spacing, overflow and hierarchy actually break.
 *
 *   node tools/seed-demo.js
 */
const API = process.env.API_BASE || 'http://127.0.0.1:5000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(username) {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  if (!res.ok) throw new Error(`login ${username}: ${res.status}`);
  return res.json();
}

const auth = (tok) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` });

async function call(method, path, tok, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: auth(tok),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* 204 */ }
  return { status: res.status, data };
}

const valueOf = (stack) => (Number(stack.value) || 0) * (Number(stack.quantity) || 1);

/**
 * Build a wager out of the user's own inventory.
 *
 * Takes a single unit from each of the first `n` stacks rather than the whole
 * stack: a stack of 297 Orca is worth 297 AMP, but spending all 297 leaves
 * nothing for the next game's lobby, and the demo ends up with only coinflip
 * populated.
 */
function buildWager(items, n) {
  const picked = [];
  for (const s of items) {
    if (picked.length >= n) break;
    const qty = Math.min(1, Number(s.quantity) || 1);
    if (qty < 1) continue;
    picked.push({
      itemId: s.itemId || s.id || s.instanceId,
      name: s.name,
      quantity: qty,
      value: s.value || 0
    });
  }
  return { picked, total: picked.reduce((sum, i) => sum + valueOf(i), 0) };
}

(async () => {
  const accounts = ['tester', 'local-player-1', 'local-admin'];
  const users = {};
  for (const a of accounts) {
    try { users[a] = await login(a); } catch (e) { console.log(`  skip ${a}: ${e.message}`); }
  }

  const inventories = {};
  for (const [name, u] of Object.entries(users)) {
    const r = await call('GET', `/api/users/inventory/${u.user.id}`, u.token);
    inventories[name] = (r.data && (r.data.items || r.data.inventory || [])) || [];
  }
  console.log('  inventories:', Object.entries(inventories)
    .map(([k, v]) => `${k}=${v.length}`).join(' '));

  let made = 0;

  // ── coinflip ──
  for (const [name, u] of Object.entries(users)) {
    const items = inventories[name];
    if (items.length < 2) continue;
    const { picked, total } = buildWager(items, Math.min(3, items.length));
    if (total <= 0) continue;
    const side = made % 2 === 0 ? 'heads' : 'tails';
    const r = await call('POST', '/api/coinflip', u.token, {
      selectedItems: picked,
      sideChosen: side,
      side,
      minOpponentValue: Math.floor(total * 0.95),
      maxOpponentValue: Math.ceil(total * 1.05)
    });
    if (r.status < 300) { made += 1; console.log(`  coinflip  ${name.padEnd(15)} ${total.toLocaleString()} AMP (${picked.length} stacks)`); }
    else console.log(`  coinflip  ${name.padEnd(15)} refused: ${JSON.stringify(r.data).slice(0, 80)}`);
  }

  // ── rps ──
  for (const [name, u] of Object.entries(users)) {
    const items = inventories[name];
    if (items.length < 2) continue;
    const { picked, total } = buildWager(items, 2);
    if (total <= 0) continue;
    const r = await call('POST', '/api/rps', u.token, { selectedItems: picked, bestOf: 5 });
    if (r.status < 300) { made += 1; console.log(`  rps       ${name.padEnd(15)} ${total.toLocaleString()} AMP`); }
    else console.log(`  rps       ${name.padEnd(15)} refused: ${JSON.stringify(r.data).slice(0, 80)}`);
  }

  // ── blackjack tables ──
  for (const [name, u] of Object.entries(users)) {
    const items = inventories[name];
    if (items.length < 2) continue;
    const { picked, total } = buildWager(items, 2);
    if (total <= 0) continue;
    const r = await call('POST', '/api/blackjack/tables', u.token, {
      selectedItems: picked,
      minJoinValue: Math.floor(total * 0.95),
      maxJoinValue: Math.ceil(total * 1.05)
    });
    if (r.status < 300) {
      made += 1;
      console.log(`  blackjack ${name.padEnd(15)} ${total.toLocaleString()} AMP`);
      // Put the house bot in the seat so the table shows a real game.
      const table = (r.data && (r.data.table || r.data)) || {};
      if (table.id) {
        const b = await call('POST', `/api/blackjack/tables/${table.id}/bot-join`, u.token, {});
        if (b.status < 300) console.log(`           bot joined ${table.id.slice(0, 8)}`);
      }
    } else console.log(`  blackjack ${name.padEnd(15)} refused: ${JSON.stringify(r.data).slice(0, 80)}`);
    await sleep(120);
  }

  // ── jackpot ──
  for (const [name, u] of Object.entries(users)) {
    const items = inventories[name];
    if (items.length < 1) continue;
    const { picked, total } = buildWager(items, 3);
    if (total <= 0) continue;
    // /api/jackpot/join takes a flat item list; there is no "create", the pot
    // is open and everyone piles in.
    const r = await call('POST', '/api/jackpot/join', u.token, { selectedItems: picked, items: picked });
    if (r.status < 300) { made += 1; console.log(`  jackpot   ${name.padEnd(15)} ${total.toLocaleString()} AMP`); }
    else console.log(`  jackpot   ${name.padEnd(15)} refused (${r.status}): ${JSON.stringify(r.data).slice(0, 70)}`);
  }

  // ── trades ──
  for (const [name, u] of Object.entries(users)) {
    const items = inventories[name];
    if (items.length < 2) continue;
    const offer = buildWager(items, 2);
    if (offer.total <= 0) continue;
    // Trades use offerItems/wantItems, not selectedItems.
    const r = await call('POST', '/api/trades', u.token, {
      offerItems: offer.picked,
      wantItems: [],
      wantText: `Looking for ${name === 'local-admin' ? 'a dragon or two' : 'anything cheap and cute'}`
    });
    if (r.status < 300) { made += 1; console.log(`  trade     ${name.padEnd(15)} ${offer.total.toLocaleString()} AMP`); }
    else console.log(`  trade     ${name.padEnd(15)} refused: ${JSON.stringify(r.data).slice(0, 80)}`);
  }

  console.log(`\n  created ${made} lobbies\n`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
