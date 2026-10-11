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
  { file: 'progress.js', label: 'progression' }
];

let child = null;

function stopServer() {
  return new Promise((resolve) => {
    if (!child) { resolve(); return; }
    try { child.kill(); } catch (_) { /* already gone */ }
    child = null;
    // Give the port a moment to free up before the next bind.
    setTimeout(resolve, 1200);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    child.stdout.on('data', (d) => {
      if (String(d).includes('Server running')) done(resolve);
    });
    child.stderr.on('data', () => {});
    child.on('exit', (code) => done(reject, new Error(`server exited early (${code})`)));
    setTimeout(() => done(reject, new Error('server did not report ready in 20s')), 20000);
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
    await stopServer();
    try {
      await startServer();
    } catch (err) {
      rows.push([suite.label, 'SERVER DOWN', err.message]);
      broken++;
      continue;
    }
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

  await stopServer();

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