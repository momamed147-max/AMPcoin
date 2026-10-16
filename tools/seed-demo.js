/**
 * Fill every lobby with demo bets, granting inventory first if it is missing.
 *
 * Empty lobbies hide most design problems. A row with no avatars, no pet
 * thumbnails, no long names and no value range looks fine; a row carrying all
 * of those is where spacing, overflow and hierarchy actually break. So this
 * grants a spread of pets first - cheap through to mythic, bare and modified -
 * and only then builds wagers out of them.
 *
 *   node tools/seed-demo.js
 */
const API = process.env.API_BASE || 'http://127.0.0.1:5000';

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

/* ── Granting inventory ─────────────────────────────────────────────────────
   The demo accounts start empty, so there is nothing to build a lobby out of.
   Give each one a spread chosen to exercise the layout rather than to be
   valuable: a long name, several tiers, a couple of modified variants, and
   one very expensive item so the value column has a real range in it. */
const GIFT = [
  { qty: 40, mods: [] },      // commons, many of them
  { qty: 12, mods: [] },
  { qty: 6,  mods: [] },
  { qty: 4,  mods: ['M'] },   // mega
  { qty: 3,  mods: ['N'] },   // neon
  { qty: 2,  mods: ['MF'] },
  { qty: 2,  mods: ['MR'] },
  { qty: 2,  mods: ['MFR'] },
  { qty: 1,  mods: ['NFR'] },
  { qty: 1,  mods: ['F'] },
  { qty: 1,  mods: ['R'] },
];

async function grantInventory(admin, targets) {
  const catalog = await call('GET', '/api/admin/items', admin.token);
  // The catalogue route answers with a bare array, not { items: [...] }. Take
  // whichever shape arrived rather than assuming, because a silent [] here
  // looks exactly like "granting worked but there was nothing to grant".
  const body = catalog.data;
  const all = Array.isArray(body) ? body : (body?.items || body?.data || []);
  if (!all.length) {
    console.log(`  catalogue came back empty (${catalog.status}, ${Array.isArray(body) ? 'array' : typeof body}), cannot grant`);
    return false;
  }
  console.log(`  catalogue has ${all.length} items`);

  // Spread the picks across the whole catalogue rather than taking the first N,
  // so the demo lobbies contain a mix of tiers and rarities.
  const stride = Math.max(1, Math.floor(all.length / GIFT.length));
  const chosen = GIFT.map((g, i) => ({ ...g, item: all[(i * stride) % all.length] }))
    .filter((g) => g.item);

  for (const t of targets) {
    const r = await call('POST', `/api/admin/user/${t.user.id}/add-items`, admin.token, {
      items: chosen.map((g) => ({
        itemId: g.item.itemId || g.item.id,
        quantity: g.qty,
        mods: g.mods
      }))
    });
    if (r.status < 300) {
      const n = r.data?.added?.length ?? chosen.length;
      console.log(`  granted ${n} pet stacks to ${t.name}`);
    } else {
      console.log(`  grant to ${t.name} refused (${r.status}): ${JSON.stringify(r.data).slice(0, 90)}`);
    }
  }
  return true;
}

(async () => {
  const accounts = ['tester', 'local-player-1', 'local-admin'];
  const users = {};
  for (const a of accounts) {
    try { users[a] = await login(a); } catch (e) { console.log(`  skip ${a}: ${e.message}`); }
  }
  if (!Object.keys(users).length) { console.log('  no accounts could sign in'); return; }

  let inventories = {};
  for (const [name, u] of Object.entries(users)) {
    const r = await call('GET', `/api/users/inventory/${u.user.id}`, u.token);
    inventories[name] = (r.data && (r.data.items || r.data.inventory || [])) || [];
  }

  // Nothing to wager with means every lobby below comes out empty, so grant
  // first. The admin account does the granting; the others receive.
  const empty = Object.entries(inventories)
    .filter(([, v]) => v.length < 4)
    .map(([name]) => name)
    .filter((name) => users[name]);
  if (empty.length) {
    const admin = users['local-admin'];
    if (admin) {
      console.log(`  ${empty.length} account(s) have no inventory, granting pets first`);
      await grantInventory(admin, empty.map((name) => ({ name, user: users[name].user })));
      for (const [name, u] of Object.entries(users)) {
        const r = await call('GET', `/api/users/inventory/${u.user.id}`, u.token);
        inventories[name] = (r.data && (r.data.items || r.data.inventory || [])) || [];
      }
    } else {
      console.log('  no admin account available, cannot grant inventory');
    }
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
    const side = ['rock', 'paper', 'scissors'][made % 3];
    const r = await call('POST', '/api/rps', u.token, { selectedItems: picked, side, rounds: 5 });
    if (r.status < 300) { made += 1; console.log(`  rps       ${name.padEnd(15)} ${total.toLocaleString()} AMP`); }
    else console.log(`  rps       ${name.padEnd(15)} refused: ${JSON.stringify(r.data).slice(0, 80)}`);
  }

  // ── blackjack ──
  for (const [name, u] of Object.entries(users)) {
    const items = inventories[name];
    if (items.length < 2) continue;
    const { picked, total } = buildWager(items, 2);
    if (total <= 0) continue;
    const r = await call('POST', '/api/blackjack/tables', u.token, {
      selectedItems: picked,
      mode: 'heads'
    });
    if (r.status < 300 && (r.data?.table || r.data?.id)) {
      made += 1;
      const table = r.data.table || r.data;
      console.log(`  blackjack ${name.padEnd(15)} ${total.toLocaleString()} AMP`);
      const b = await call('POST', `/api/blackjack/tables/${table.id}/bot-join`, u.token, {});
      if (b.status < 300) console.log(`            bot joined ${r.data.table.id.slice(0, 8)}`);
    } else console.log(`  blackjack ${name.padEnd(15)} refused: ${JSON.stringify(r.data).slice(0, 80)}`);
  }

  // ── jackpot ──
  for (const [name, u] of Object.entries(users)) {
    const items = inventories[name];
    if (items.length < 1) continue;
    const { picked, total } = buildWager(items, 1);
    if (total <= 0) continue;
    const r = await call('POST', '/api/jackpot/join', u.token, { selectedItems: picked, items: picked });
    if (r.status < 300) { made += 1; console.log(`  jackpot   ${name.padEnd(15)} ${total.toLocaleString()} AMP`); }
    else console.log(`  jackpot   ${name.padEnd(15)} refused: ${JSON.stringify(r.data).slice(0, 80)}`);
  }

  // ── trading ──
  for (const [name, u] of Object.entries(users)) {
    const items = inventories[name];
    if (items.length < 1) continue;
    const { picked } = buildWager(items, 1);
    const r = await call('POST', '/api/trades', u.token, {
      offerItems: picked,
      wantText: 'Any high-value pets, happy to go within 10% of value.'
    });
    if (r.status < 300) { made += 1; console.log(`  trade     ${name.padEnd(15)} ${picked.length} stack(s)`); }
    else console.log(`  trade     ${name.padEnd(15)} refused: ${JSON.stringify(r.data).slice(0, 80)}`);
  }

  console.log(`\n  created ${made} lobbies\n`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });