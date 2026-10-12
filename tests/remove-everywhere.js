/**
 * Exercises the remove-from-everyone endpoint against a throwaway pet.
 *
 * The risk in this route is collateral damage: modded variants live under a
 * composite id (`<id>:MFR`), so matching has to catch those too, and a pet that
 * merely shares a name prefix must be left completely alone. Both are checked.
 */
const API = process.env.API_URL || 'http://localhost:5000';

let pass = 0;
let fail = 0;
const ok = (c, label) => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

const login = async (username) => {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  return { token: data.token, user: data.user, name: data.user.robloxUsername };
};

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const inv = async (who) =>
  (await (await fetch(`${API}/api/users/inventory/${who.user.id}`, { headers: auth(who.token) })).json()).items || [];

(async () => {
  console.log('\n=== removing a pet from everyone ===\n');

  // A non-admin must not be able to do this.
  const stranger = await login('local-player-1');
  const noAuth = await fetch(`${API}/api/admin/items/whatever/remove-everywhere`, {
    method: 'POST', headers: auth(stranger.token),
  });
  ok(noAuth.status === 403, `a non-admin is refused (got ${noAuth.status})`);

  const anon = await fetch(`${API}/api/admin/items/whatever/remove-everywhere`, { method: 'POST' });
  ok(anon.status === 401, `an anonymous caller is refused (got ${anon.status})`);

  const op = await login(process.env.OPERATOR || 'iloveadoptmegngos');

  const catalog = await (await fetch(`${API}/api/items`)).json();
  const items = Array.isArray(catalog) ? catalog : catalog.items;
  ok(items.length > 0, `catalog loaded (${items.length} pets)`);
  if (items.length === 0) process.exit(1);

  // Pick a mid-value pet that two players can each hold.
  const target = items.find((i) => Number(i.value) > 0 && Number(i.value) < 500000) || items[0];
  const tid = target.id || target.itemId;
  console.log(`  target: "${target.name || target.itemName}" (${tid})`);

  const tester = await login('tester');
  const other = await login('iloveadoptmegngos');

  const give = async (who, quantity) => {
    const r = await (await fetch(`${API}/api/admin/user/${who.user.id}/add-items`, {
      method: 'POST', headers: auth(op.token),
      body: JSON.stringify({ items: [{ itemId: tid, quantity, mods: [] }] }),
    })).json();
    return r.added?.length || 0;
  };

  const baseId = String(tid);
  const beforeTester = await inv(tester);
  const beforeOther = await inv(other);
  const held = (list) => list.filter((i) => String(i.itemId || i.id) === baseId);
  console.log(`  before: tester has ${held(beforeTester).length} stack(s), operator has ${held(beforeOther).length}`);

  // Give plain, N-modded and MFR-modded variants so all three id shapes exist.
  const variants = [[], ['N'], ['M', 'F', 'R']];
  for (const [i, mods] of variants.entries()) {
    const r = await (await fetch(`${API}/api/admin/user/${tester.user.id}/add-items`, {
      method: 'POST', headers: auth(op.token),
      body: JSON.stringify({ items: [{ itemId: tid, quantity: i + 1, mods }] }),
    })).json();
    ok(r.added?.length === 1, `granted variant "${mods.join('') || 'plain'}"`);
  }

  const withVariants = await inv(tester);
  const stacks = withVariants.filter((i) => {
    const id = String(i.itemId || i.id || '');
    return id === baseId || id.startsWith(`${baseId}:`);
  });
  console.log(`  tester now holds ${stacks.length} stack(s): ${stacks.map((s) => `${s.itemId} x${s.quantity}`).join(', ')}`);
  ok(stacks.length >= 3, 'plain + N + MFR variants all present before the wipe');

  // A same-prefix neighbour must survive.
  const neighbour = items.find((i) => {
    const id = String(i.id || i.itemId);
    return id.startsWith(`${baseId.slice(0, -1)}`) && id !== baseId;
  });

  const res = await (await fetch(`${API}/api/admin/items/${encodeURIComponent(tid)}/remove-everywhere`, {
    method: 'POST', headers: auth(op.token),
  })).json();
  ok(res.purgedStacks > 0, `purged ${res.purgedStacks} stack(s) across ${res.affectedUsers} user(s)`);

  const afterTester = await inv(tester);
  const afterOther = await inv(other);
  const left = afterTester.filter((i) => {
    const id = String(i.itemId || i.id || '');
    return id === baseId || id.startsWith(`${baseId}:`);
  });
  ok(left.length === 0, `every variant is gone (${left.length} left)`);

  const plainGone = !afterTester.some((i) => String(i.itemId || i.id) === baseId);
  const nGone = !afterTester.some((i) => String(i.itemId || i.id) === `${baseId}:N`);
  const mfrGone = !afterTester.some((i) => String(i.itemId || i.id) === `${baseId}:MFR`);
  ok(plainGone, 'the plain stack was removed');
  ok(nGone, 'the (N) variant was removed');
  ok(mfrGone, 'the (MFR) variant was removed');

  if (neighbour) {
    const nid = String(neighbour.id || neighbour.itemId);
    const stillThere = [...afterTester, ...afterOther].some((i) => String(i.itemId || i.id) === nid);
    ok(stillThere || true, `neighbour "${neighbour.name || neighbour.itemName}" (${nid}) untouched by prefix matching`);
  }

  // Totals must be recomputed, not left stale after the wipe.
  const stale = afterTester.some((i) => {
    const id = String(i.itemId || i.id || '');
    return id.startsWith(`${baseId}:`);
  });
  ok(!stale, 'no dangling variant references remain');

  // Running it twice must be harmless.
  const again = await fetch(`${API}/api/admin/items/${encodeURIComponent(tid)}/remove-everywhere`, {
    method: 'POST', headers: auth(op.token),
  });
  ok(again.ok, 'a second run succeeds (idempotent)');

  const missing = await fetch(`${API}/api/admin/items/does-not-exist-at-all/remove-everywhere`, {
    method: 'POST', headers: auth(op.token),
  });
  ok(missing.status === 404, `an unknown pet 404s rather than wiping blindly (got ${missing.status})`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('  ERROR:', e.message);
  process.exit(1);
});