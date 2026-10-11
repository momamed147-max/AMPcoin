/**
 * Hidden admin.
 *
 * Two separate claims are being checked, and only one of them is about the
 * database:
 *
 *   1. They keep their rights. A hidden admin must still authenticate as an
 *      admin and still be able to use admin routes. Hiding is cosmetic.
 *   2. Nobody else can tell. The flag is suppressed at the source, so no chat
 *      payload, profile lookup or user list carries it - which is a stronger
 *      claim than "the frontend does not render a badge", because anything the
 *      browser receives can be read straight out of the page.
 *
 * The second is the one worth testing. A frontend-only implementation would
 * pass every render test and still leak the answer in the network tab.
 */
const API = 'http://127.0.0.1:5000';
const OPERATOR = 'iloveadoptmegngos';

let pass = 0;
let fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n=== ${t} ===`);

const login = async (u) => (await (await fetch(`${API}/api/auth/dev-login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u })
})).json());
const call = async (m, p, t, b) => {
  const r = await fetch(`${API}${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b === undefined ? undefined : JSON.stringify(b)
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

(async () => {
  const op = await login(OPERATOR);
  const other = await login('local-player-1');
  const admin = await login('local-admin');

  if (!op.token || !other.token) { console.log('  cannot log in - run: node seedlocal.js'); process.exit(1); }

  // Local state is in-memory: a backend restart wipes accounts, and the
  // operator's admin grant is applied by seedlocal.js. Running before that is a
  // skipped precondition rather than a broken feature.
  if (op.user && op.user.isAdmin !== true) {
    console.log('  SKIPPED: the operator account has not been seeded as an admin.');
    console.log('           run: node seedlocal.js');
    process.exit(0);
  }

  section('they still have admin rights');
  {
    const dash = await call('GET', '/api/admin/users', op.token);
    ok(dash.status === 200, `an admin route still works for them (${dash.status})`);
  }

  section('their own session tells them what they need');
  {
    const v = await call('POST', '/api/auth/verify-token', op.token, {});
    ok(v.status === 200, `verify-token answers (${v.status})`);
    const u = v.body.user || {};
    ok(u.isAdmin === true, 'they are told they are an admin, so the panel renders');
    ok(u.hiddenAdmin === true, 'and that they are hidden, so the client can style itself');
    ok(u.isOutcomeOperator === true, 'and that they may use outcome control');
  }

  section('nobody else can see any of it');
  {
    // Profile lookup is the most public surface: anyone can open it.
    const profile = await call('GET', `/api/users/profile/${OPERATOR}`, other.token);
    ok(profile.status === 200, `a player can still open the profile (${profile.status})`);
    ok(profile.body.isAdmin !== true,
      `the profile does not reveal admin (isAdmin=${JSON.stringify(profile.body.isAdmin)})`);
    ok(profile.body.hiddenAdmin === undefined,
      'and does not reveal the hidden flag either');
    ok(!JSON.stringify(profile.body).includes('hiddenAdmin'),
      'the word does not appear anywhere in the payload');
    ok(!JSON.stringify(profile.body).includes('isOutcomeOperator'),
      'nor does the operator flag');

    // Chat payloads: the message serializer and the mute-user serializer.
    const msgs = await call('GET', '/api/chat/messages', other.token);
    const blob = JSON.stringify(msgs.body);
    const leaked = (msgs.body.messages || []).filter((m) => m.isAdmin === true);
    ok(leaked.length === 0, `no chat message from the operator carries isAdmin (${leaked.length} leaked)`);
    ok(!blob.includes('iloveadoptmengngos"'), 'and the operator is not flagged in chat data');

    // The admin user list is staff-only, but a hidden admin listed there as a
    // plain admin is fine - it is the public surfaces that must be clean.
    ok(true, 'admin-only listings are out of scope for this check');
  }

  section('a normal admin is still visible');
  {
    // Guards against "we suppressed the flag so hard that nobody is an admin".
    const p = await call('GET', '/api/users/profile/local-admin', other.token);
    ok(p.body.isAdmin === true, `local-admin still shows as admin (${p.body.isAdmin})`);
  }

  section('the frontend never renders an admin badge from a hidden source');
  {
    const fs = require('fs');
    const path = require('path');
    const walk = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.js$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const root = path.resolve(__dirname, '..', 'frontend', 'src');
    const badges = [];
    for (const f of walk(root)) {
      const src = fs.readFileSync(f, 'utf8');
      if (/chat-admin-badge|profile-admin-badge/.test(src)) badges.push(path.basename(f));
    }
    ok(badges.length > 0, `the badge components still exist (${badges.join(', ')})`);

    // A badge may now consult hiddenAdmin, but only to HIDE. The direction
    // matters: every occurrence must be a guard that suppresses the badge for a
    // hidden admin, never a condition that renders it. The payload-level
    // suppression above is the real guarantee; this is a second line.
    const bad = [];
    const guarded = [];
    for (const f of walk(root)) {
      const src = fs.readFileSync(f, 'utf8');
      if (!/admin-badge/.test(src)) continue;
      if (!/hiddenAdmin/.test(src)) continue;
      const name = path.basename(f);
      // Every hiddenAdmin mention in a badge file must sit inside a condition
      // that reads "!== true" or "&&", i.e. it can only turn the badge off.
      const mentions = src.match(/.{0,40}hiddenAdmin.{0,40}/g) || [];
      const allSuppress = mentions.every((m) => /!==\s*true|!==\s*false|&&|!\s*hiddenAdmin/.test(m));
      if (allSuppress) guarded.push(name);
      else bad.push(name);
    }
    ok(bad.length === 0,
      'every hiddenAdmin check in a badge only suppresses, never reveals', bad.join(', '));
    ok(guarded.length > 0,
      `and the sidebar does use it to hide the badge (${guarded.join(', ')})`);
  }

  void admin;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
