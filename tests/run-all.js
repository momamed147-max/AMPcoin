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

const SUITES = [
  { file: 'api.js', label: 'games API' },
  { file: 'progress.js', label: 'progression' },
  { file: 'boot-latency.js', label: 'boot latency' },
  // Static: walks the frontend import graph. Needs no server, so it runs first
  // and a broken build fails fast before anything hits the API rate limit.
  { file: 'outcome-control-e2e.js', label: 'outcome control e2e' },
  { file: 'outcome-control.js', label: 'outcome control', server: false },
  { file: 'css-palette.js', label: 'css palette', server: false },
  { file: 'css-reachability.js', label: 'css reachability', server: false }
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

(async () => {
  let totalPass = 0;
  let totalFail = 0;
  let broken = 0;
  const rows = [];

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
    }
    void serverOurs;
    const res = run(suite.file);
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    const line = (out.match(/(\d+) passed, (\d+) failed/) || []);
    const p = Number(line[1] || 0);
    const f = Number(line[2] || 0);
    totalPass += p;
    totalFail += f;
    if (f > 0) {
      broken++;
      const firstFail = out.split('\n').find((l) => l.includes('FAIL'));
      rows.push([suite.label, `${p} passed, ${f} FAILED`, firstFail ? firstFail.trim().slice(0, 60) : '']);
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
        const verified = await portIsUp();
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