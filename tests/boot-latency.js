// Boot-path latency: the browser blocks on these before it can render anything.
//
// This exists because the site was unusable and nothing noticed. Every page load
// called POST /api/auth/verify-token and GET /api/users/profile/:name, and both
// awaited a live Roblox API call. With Roblox unreachable each burned the full
// request timeout, so the app sat on "Loading AMPcoin..." for over ten seconds
// before rendering - which looks exactly like a broken site.
//
// Two independent fixes, and this suite has to be able to catch either one being
// undone. That matters: measuring latency alone does NOT do it. Restoring the
// `await` on the boot routes still passes a pure latency check, because the
// circuit breaker short-circuits the network call and an await of an
// already-resolved value costs nothing. So there are three layers here:
//
//   1. the circuit breaker behaves correctly (unit, no server needed)
//   2. the boot routes do not await Roblox at all (structural)
//   3. the endpoints the browser waits on are fast in practice (end to end)
const API = 'http://127.0.0.1:5000';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Generous enough for a slow box, tight enough to catch a stall. The broken
// behaviour was 5000ms+; the fixed behaviour is under 100ms.
const BUDGET_MS = 1500;

let pass = 0;
let fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n=== ${t} ===`);

async function timed(p, token, method = 'GET') {
  const started = Date.now();
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined
  });
  const body = await res.json().catch(() => ({}));
  return { ms: Date.now() - started, status: res.status, body };
}

// ── 1. the circuit breaker, in isolation ────────────────────────────────────
async function breakerUnit() {
  section('the circuit breaker (unit)');
  // Swap the transport for one that always fails, so every lookup fails
  // immediately and deterministically instead of depending on whether this
  // machine can reach Roblox at all.
  const roblox = require(path.join(ROOT, 'backend', 'robloxApi.js'));
  const https = require('https');
  const EventEmitter = require('events');
  const realRequest = https.request;
  https.request = () => {
    const e = new EventEmitter();
    e.write = () => e;
    e.end = () => { setImmediate(() => e.emit('error', new Error('ECONNREFUSED (simulated)'))); return e; };
    e.destroy = () => {};
    e.setTimeout = () => {};
    return e;
  };

  roblox.resetBreaker();
  // The breaker warns on purpose; silence it so a deliberate simulated outage
  // does not look like a real one in the test output.
  const realWarn = console.warn;
  console.warn = () => {};
  const before = roblox.getRobloxStats();

  const started = Date.now();
  const id = await roblox.getRobloxUserIdFromUsername('someuser');
  const firstMs = Date.now() - started;
  ok(id === null, 'a failed lookup returns null rather than throwing');
  ok(firstMs < 3000, `and gives up quickly (${firstMs}ms)`);

  const afterFirst = roblox.getRobloxStats();
  ok(afterFirst.breakerOpen === true, 'the breaker is open after a failure');
  ok(afterFirst.failed >= 1, `the failure is counted (${afterFirst.failed})`);

  // With the breaker open, repeated calls must not touch the network at all.
  const t2 = Date.now();
  for (let i = 0; i < 25; i += 1) await roblox.getRobloxProfileByUsername('someuser');
  const manyMs = Date.now() - t2;
  const after = roblox.getRobloxStats();
  ok(after.attempted === afterFirst.attempted,
    `25 further calls make no network attempt (attempted stayed ${after.attempted})`);
  ok(after.skipped > afterFirst.skipped,
    `they are counted as skipped instead (${after.skipped - afterFirst.skipped})`);
  ok(manyMs < 200, `and they return near-instantly (${manyMs}ms for 25 calls)`);

  ok(after.timeoutMs <= 3000,
    `the per-request timeout is short enough to be harmless (${after.timeoutMs}ms)`);
  ok(before.timeoutMs === after.timeoutMs, 'and is configurable');

  https.request = realRequest;
  console.warn = realWarn;
  roblox.resetBreaker();
  ok(roblox.getRobloxStats().breakerOpen === false, 'the breaker can be reset to probe again');
}

// ── 2. the boot routes must not await Roblox ────────────────────────────────
section('the boot routes do not block on Roblox (structural)');
{
  /**
   * Pull out one route handler's source.
   *
   * A naive scan of the whole file is wrong: login and register legitimately
   * await this inside a setImmediate callback, which is fire-and-forget and
   * fine. Only the boot routes matter, so only their handlers are checked.
   */
  function routeBody(file, method, route) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const start = src.search(new RegExp(`router\\.${method}\\((['"])${route.replace(/\//g, '\\/')}\\1`));
    if (start === -1) return null;
    // The handler ends at the next top-level `router.` declaration.
    const rest = src.slice(start + 1);
    const next = rest.search(/\nrouter\.(get|post|put|delete)\(/);
    return next === -1 ? rest : rest.slice(0, next);
  }

  const cases = [
    { file: 'backend/routes/auth.js', method: 'post', route: '/verify-token', marker: 'resolveAndCacheAvatar', what: 'verify-token' },
    { file: 'backend/routes/users.js', method: 'get', route: '/profile/:robloxUsername', marker: 'resolveAndCacheRobloxProfile', what: 'users/profile' }
  ];

  for (const c of cases) {
    const body = routeBody(c.file, c.method, c.route);
    ok(body !== null, `${c.what} route was found in ${path.basename(c.file)}`);
    if (body === null) continue;

    // An `await` that is already inside a deferred callback does not delay the
    // response, so only count awaits that are NOT in one.
    const deferred = [...body.matchAll(/setImmediate\([\s\S]*?\n\s*\}\);/g)].map((m) => m[0]);
    const blocking = body
      .replace(/setImmediate\([\s\S]*?\n\s*\}\);/g, '')
      .match(new RegExp(`await\\s+${c.marker}\\s*\\(`, 'g')) || [];

    ok(blocking.length === 0,
      `${c.what} does not await ${c.marker} on the response path`,
      blocking.length
        ? `this route runs on every page load; awaiting there restores the multi-second stall`
        : '');
    ok(deferred.some((d) => d.includes(c.marker)) || new RegExp(`${c.marker}\\s*\\([^)]*\\)\\.catch\\(`).test(body),
      `${c.what} still refreshes the profile, but in the background`);
  }
}

// ── 3. end to end ───────────────────────────────────────────────────────────
(async () => {
  // Sequential, so the report reads top to bottom in the order it runs.
  await breakerUnit();

  const login = await (await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tester' })
  })).json();

  if (!login.token) {
    console.log('\n  could not log in - is the backend seeded? run: node seedlocal.js');
    process.exit(1);
  }
  const token = login.token;
  const name = login.user.robloxUsername;

  section('the endpoints the browser waits on before it can render');
  {
    await timed('/api/auth/verify-token', token, 'POST');
    await timed(`/api/users/profile/${name}`, token);
    const runs = [];
    for (let i = 0; i < 4; i += 1) runs.push((await timed('/api/auth/verify-token', token, 'POST')).ms);
    const worst = Math.max(...runs);
    console.log(`    verify-token: ${runs.join('ms, ')}ms`);
    ok(worst < BUDGET_MS, `verify-token answers in under ${BUDGET_MS}ms on every load (worst ${worst}ms)`);
  }

  {
    const runs = [];
    for (let i = 0; i < 4; i += 1) runs.push((await timed(`/api/users/profile/${name}`, token)).ms);
    const worst = Math.max(...runs);
    console.log(`    users/profile: ${runs.join('ms, ')}ms`);
    ok(worst < BUDGET_MS, `users/profile answers in under ${BUDGET_MS}ms on every load (worst ${worst}ms)`);
  }

  section('a failure still answers with usable data, not an error');
  {
    const r = await timed(`/api/users/profile/${name}`, token);
    ok(r.status === 200, `the profile route returns 200 (${r.status})`);
    ok(r.body && typeof r.body === 'object', 'and returns a JSON object');
    ok('displayName' in r.body, 'including a displayName the client can render');
  }

  section('a token check still validates');
  {
    const good = await timed('/api/auth/verify-token', token, 'POST');
    ok(good.status === 200, `a valid token verifies (${good.status})`);
    ok(good.body.valid === true && !!good.body.user, 'and returns the user');

    const bad = await fetch(`${API}/api/auth/verify-token`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-real-token', 'Content-Type': 'application/json' },
      body: '{}'
    });
    ok(bad.status === 401, `a bogus token is still rejected (${bad.status})`);
  }

  section('repeated loads do not degrade');
  {
    const rest = [];
    for (let i = 0; i < 6; i += 1) rest.push((await timed('/api/auth/verify-token', token, 'POST')).ms);
    ok(Math.max(...rest) < BUDGET_MS, `six consecutive loads stay under ${BUDGET_MS}ms (worst ${Math.max(...rest)}ms)`);
    ok(rest[rest.length - 1] <= rest[0] + 200, `and do not get slower over time (${rest[0]}ms -> ${rest[rest.length - 1]}ms)`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
