// Runs every backend test suite in sequence, restarting the server between them.
//
// The API rate limit is 2000 requests per 15 minutes and lives in the backend
// process, so a suite that runs after a heavy one gets throttled and fails for
// no reason. Restarting clears it. Each suite also re-creates the accounts it
// needs, and local state is in-memory, so a restart costs nothing.
//
//   node tests/run-all.js
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5000;

// ─── Refuse to run against a live database ────────────────────────────
//
// The suites create accounts, grant admin, bet and settle. A stray DATABASE_URL
// in .env is enough to point all of that at production, and the write looks
// exactly like ordinary traffic: no error, no prompt, real rows created.
//
// That is not hypothetical. A test run did this, wrote twelve accounts into the
// live database, and a follow-up cleanup that guessed the blob's shape wrong
// emptied the users table outright.
//
// So the guard is here rather than in the suites: it runs first, it names the
// host it found, and it takes an explicit flag to override.
(function guardAgainstProductionDatabase() {
  const url = String(process.env.DATABASE_URL || '');
  if (!url) return;
  const host = (() => {
    try { return new URL(url).hostname; } catch { return url.replace(/^.*@/, '').split(':')[0]; }
  })();
  const isLocal = /^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)$/.test(host);
  if (isLocal || process.env.ALLOW_PRODUCTION_TESTS === '1') return;

  console.error('\n  REFUSING TO RUN: DATABASE_URL points at a live database.\n');
  console.error(`    host: ${host}\n`);
  console.error('  These suites create accounts, grant admin and settle bets.');
  console.error('  Against production that writes real rows with no warning.\n');
  console.error('  To use the local JSON sandbox instead:');
  console.error('    set LOCAL_JSON_MODE=true   (and unset DATABASE_URL)\n');
  console.error('  Only override if you genuinely intend to test against it:');
  console.error('    set ALLOW_PRODUCTION_TESTS=1\n');
  process.exit(1);
})();

const SUITES = [
  { file: 'api.js', label: 'games API' },
  { file: 'progress.js', label: 'progression' },
  { file: 'boot-latency.js', label: 'boot latency' },
  // Static: walks the frontend import graph. Needs no server, so it runs first
  // and a broken build fails fast before anything hits the API rate limit.
  { file: 'hidden-admin.js', label: 'hidden admin' },
  { file: 'outcome-control-e2e.js', label: 'outcome control e2e' },
  { file: 'outcome-control.js', label: 'outcome control', server: false },
  { file: 'remove-everywhere.js', label: 'remove pet everywhere' },
  // Pure logic over the mod grid, but it is the check that keeps the two copies
  // of petMods.js (backend and frontend) from drifting apart.
  { file: 'mod-combinations.js', label: 'mod combinations', server: false },
  { file: 'mod-grant-e2e.js', label: 'mod grant e2e' },
  { file: 'db-guard.js', label: 'db guard', server: false },
  { file: 'css-palette.js', label: 'css palette', server: false },
  { file: 'css-reachability.js', label: 'css reachability', server: false },
  { file: 'ui-polish.js', label: 'ui polish' },
  { file: 'ui-motion.js', label: 'ui motion' }
];

let child = null;

function stopServer() {
  return new Promise((resolve) => {
    if (!child) { resolve(); return; }
    try { child.kill(); } catch (_) { /* already gone */ }
    child = null;
    ownsChild = false;
    // Give the port a moment to free up before the next bind.
    setTimeout(resolve, 1200);
  });
}

// Only ever kill a server THIS runner started. A backend the user launched
// themselves must survive, which is why an in-use port is not treated as ours.
let ownsChild = false;

function startServer() {
  return new Promise((resolve, reject) => {
    ownsChild = true;
    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      // Detached, so the server is in its own process group and survives this
      // runner exiting. Without this the child is torn down the moment the
      // runner exits, and localhost is dead again the moment the tests finish -
      // which is exactly how it looked broken.
      detached: true
    });
    if (child.unref) child.unref();
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    child.stdout.on('data', (d) => {
      if (String(d).includes('Server running')) done(resolve);
    });
    child.stderr.on('data', (d) => {
      // EADDRINUSE means something else already holds the port - usually a
      // backend the user is running on purpose. That is not a test failure, so
      // treat it as "already up" rather than dead.
      if (String(d).includes('EADDRINUSE')) { child = null; done(resolve, { reused: true }); }
    });
    child.on('exit', (code) => done(reject, new Error(`server exited early (${code})`)));
    setTimeout(() => done(reject, new Error('server did not report ready in 20s')), 20000);
  });
}

/** True when something is already answering on the API port. */
function portIsUp() {
  return new Promise((resolve) => {
    const req = require('http').get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

const run = (file) => spawnSync('node', [path.join(__dirname, file)], {
  encoding: 'utf8',
  timeout: 5 * 60 * 1000
});

/* --fresh takes over the port instead of reusing whatever is listening.
   See the note on isNotRateLimited in server.js for why a long-lived server
   eventually stops answering, and seedlocal.js for why state matters too. */
const FRESH = process.argv.includes('--fresh');

async function freePortForFreshRun() {
  if (!FRESH) return false;
  try {
    const { execSync } = require('child_process');
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const line = out.split(/\r?\n/).find((l) => new RegExp(`[:.]${PORT}\\s+.*LISTENING`).test(l));
    if (!line) return false;
    const pid = Number(line.trim().split(/\s+/).pop());
    if (!pid || pid === process.pid) return false;
    process.kill(pid);
    console.log(`  --fresh: stopped PID ${pid} holding :${PORT}\n`);
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  } catch (err) {
    console.log(`  --fresh: could not free :${PORT} (${err.message})\n`);
    return false;
  }
}

(async () => {
  let totalPass = 0;
  let totalFail = 0;
  let broken = 0;
  const rows = [];

  await freePortForFreshRun();

  for (const suite of SUITES) {
    const full = path.join(__dirname, suite.file);
    if (!fs.existsSync(full)) {
      rows.push([suite.label, 'MISSING', '-']);
      broken++;
      continue;
    }
    // If a backend is already answering, use it and leave it alone. Starting a
    // second one would fail on the port and only mask the fact that a working
    // server is already there. If nothing is up, own the server for the run.
    let serverOurs = false;
    if (suite.server === false) {
      // Static suite - no server needed, and none should be started for it.
    } else if (!(await portIsUp())) {
      await stopServer();
      try {
        await startServer();
        serverOurs = !(await portIsUp()) ? false : true;
      } catch (err) {
        rows.push([suite.label, 'SERVER DOWN', err.message]);
        broken++;
        continue;
      }
      // A restart wipes every account, because local state is in-memory, so the
      // seed has to follow one. But it also has to run when we REUSE a server
      // that was already up: otherwise the run inherits whatever state that
      // server happened to be in, and four account-dependent suites fail or
      // report zero passes purely because a dev server was running. That made
      // the suite green with no server up and red with one up, which is not a
      // property a test run is allowed to have.
      //
      // seedlocal is idempotent and fast, so this costs nothing.
      if (suite.seed !== false) {
        spawnSync('node', [path.join(ROOT, 'seedlocal.js')], {
          cwd: ROOT, encoding: 'utf8', timeout: 120000
        });
      }
    }
    void serverOurs;
    const res = run(suite.file);
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    const line = (out.match(/(\d+) passed, (\d+) failed/) || []);
    const p = Number(line[1] || 0);
    const f = Number(line[2] || 0);
    totalPass += p;
    totalFail += f;
    // A suite reporting zero passes has not failed an assertion - it never got
    // to run one. The usual cause is a reused server whose rate-limit budget is
    // spent, which looks identical to a broken suite unless it is called out.
    const rateLimited = /429|Too Many Requests/i.test(out);
    if (rateLimited) {
      rows.push([
        suite.label,
        `${p} passed, ${f} FAILED`,
        'rate limited - rerun with --fresh'
      ]);
      broken++;
    } else if (f > 0) {
      broken++;
      const firstFail = out.split('\n').find((l) => l.includes('FAIL'));
      rows.push([suite.label, `${p} passed, ${f} FAILED`, firstFail ? firstFail.trim().slice(0, 60) : '']);
    } else if (p === 0) {
      broken++;
      rows.push([suite.label, '0 passed', 'ran nothing - see its output']);
    } else {
      rows.push([suite.label, `${p} passed`, '']);
    }
  }

  // Leave the backend RUNNING. The runner owns the server it starts, and
  // killing it on the way out leaves localhost looking broken - the page loads
  // and then cannot log in or load anything, because nothing is listening on
  // 5000. The tests use throwaway accounts, so a live server afterwards is
  // harmless; --keep-down opts out when a caller wants the port back.
  if (!process.argv.includes('--keep-down')) {
    await stopServer();
    // Re-check AFTER stopping anything we started. A port in TIME_WAIT can
    // briefly accept a connection, so the only trustworthy signal is whether a
    // real request to /api/health succeeds now.
    const stillUp = await portIsUp();
    if (stillUp) {
      console.log('  backend left running on :5000\n');
    } else {
      try {
        await startServer();
        // startServer resolves on the child's "Server running" line, but the
        // health endpoint is not necessarily accepting connections at that
        // exact instant - the listener can be bound a moment before the route
        // is mounted. One immediate probe therefore reported "started but not
        // answering" and left nothing listening on :5000, which reads as a
        // broken local setup rather than as a slow boot.
        let verified = false;
        for (let attempt = 0; attempt < 20 && !verified; attempt++) {
          verified = await portIsUp();
          if (!verified) await new Promise((r) => setTimeout(r, 300));
        }
        console.log(verified
          ? '  backend started and left running on :5000\n'
          : '  (backend started but is not answering - check the log)\n');
      } catch (err) {
        console.log(`  (could not leave the backend running: ${err.message})\n`);
      }
    }
  } else {
    await stopServer();
    console.log('  backend stopped (--keep-down)\n');
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log('');
  for (const [name, result, note] of rows) {
    console.log(`  ${pad(name, 24)} ${pad(result, 18)} ${note}`);
  }
  console.log(`\n  ${totalPass} passed, ${totalFail} failed across ${SUITES.length} suites`);
  process.exit(broken ? 1 : 0);
})().catch(async (e) => {
  console.error('runner crashed:', e);
  await stopServer();
  process.exit(1);
});

void net;