/**
 * Grants a bare (M) and a bare (N) through the real admin endpoint and checks
 * what actually lands in the inventory.
 *
 * This is the end-to-end version of mod-combinations.js. The logic tests prove
 * the grid resolves; this proves the whole path - request, value, stored name,
 * stored id - actually produces a distinct "(M)" rather than quietly widening
 * back to "(MFR)".
 */
const API = process.env.API_URL || 'http://localhost:5000';
const OPERATOR = process.env.OPERATOR || 'iloveadoptmegngos';

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
  console.log('\n=== granting a bare Mega and a bare Neon ===\n');

  const op = await login(OPERATOR);
  const tester = await login('tester');

  const catalog = await (await fetch(`${API}/api/items`)).json();
  const items = Array.isArray(catalog) ? catalog : catalog.items;
  const target = items.find((i) => Number(i.value) > 0 && i.variants?.mega?.base > 0);
  if (!target) { console.log('  no catalog pet with a mega grid - cannot test'); process.exit(1); }
  const tid = target.id || target.itemId;
  const base = String(tid);
  console.log(`  target "${target.name}" (${base})`);
  console.log(`    grid: mega.base=${target.variants.mega.base} mega.flyRide=${target.variants.mega.flyRide}`);

  const give = async (mods) => {
    const r = await (await fetch(`${API}/api/admin/user/${tester.user.id}/add-items`, {
      method: 'POST', headers: auth(op.token),
      body: JSON.stringify({ items: [{ itemId: tid, quantity: 1, mods }] }),
    })).json();
    return r.added?.[0] || null;
  };

  const bareM = await give(['M']);
  const bareN = await give(['N']);
  const full = await give(['M', 'F', 'R']);

  ok(Boolean(bareM), "a bare M grant is accepted");
  ok(Boolean(bareN), "a bare N grant is accepted");

  ok(bareM && JSON.stringify(bareM.mods) === JSON.stringify(['M']),
    `the server kept M alone (got ${JSON.stringify(bareM?.mods)})`);
  ok(bareN && JSON.stringify(bareN.mods) === JSON.stringify(['N']),
    `the server kept N alone (got ${JSON.stringify(bareN?.mods)})`);

  // Now the part that actually matters: what is sitting in the inventory.
  const stacks = await inv(tester);
  const find = (suffix) => stacks.find((s) => String(s.itemId || s.id) === `${base}:${suffix}`);
  const plain = stacks.find((s) => String(s.itemId || s.id) === base);

  const mStack = find('M');
  const nStack = find('N');
  const frStack = find('MFR');

  ok(Boolean(mStack), "the inventory holds a stack whose id is `<base>:M`");
  ok(Boolean(nStack), "the inventory holds a stack whose id is `<base>:N`");
  ok(Boolean(frStack), "and MFR is still reachable as its own stack");

  ok(mStack && /\(M\)$/.test(String(mStack.name || '')),
    `its name is "(M)" and nothing was appended (got "${mStack?.name}")`);
  ok(nStack && /\(N\)$/.test(String(nStack?.name || '')),
    `its name is "(N)" (got "${nStack?.name}")`);

  // Distinct ids, so they are genuinely separate tradable items.
  ok(mStack && frStack && String(mStack.itemId || mStack.id) !== String(frStack.itemId || frStack.id),
    "(M) and (MFR) are separate items with separate ids");

  if (mStack && frStack) {
    const gridBase = Number(target.variants.mega.base);
    const gridFr = Number(target.variants.mega.flyRide);
    console.log(`    (M)   stored value=${mStack.value}  grid mega.base=${gridBase}`);
    console.log(`    (MFR) stored value=${frStack.value}  grid mega.flyRide=${gridFr}`);
    ok(Number(mStack.value) === gridBase,
      "(M) was valued from mega.base");
    ok(Number(frStack.value) === gridFr,
      "(MFR) is unchanged, still valued from mega.flyRide");
    ok(Number(mStack.value) !== Number(frStack.value),
      "and the two are not the same number");
  }

  // Clean up so repeated runs do not accumulate these.
  const clean = await (await fetch(`${API}/api/admin/items/${encodeURIComponent(tid)}/remove-everywhere`, {
    method: 'POST', headers: auth(op.token),
  })).json();
  ok(clean.purgedStacks >= 3, `cleaned up ${clean.purgedStacks} test stacks`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('  ERROR:', e.message);
  process.exit(1);
});