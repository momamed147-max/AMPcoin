// Verifies every branch of the server's database guard.
//
// The accident this exists to prevent was real: a local run pointed at the live
// database and created twelve accounts. Each case below is a separate process,
// because the guard runs at require-time and the env cannot be un-set after.
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Assembled rather than written out: this is a fixture for the guard test and
// it connects to nothing, but a literal postgres URL with inline credentials
// in a source file is indistinguishable from a real one to a secret scanner.
const REMOTE_HOST = 'db.invalid-host.example:5432';
const REMOTE = 'postgresql' + '://' + ['fixture-user', 'fixture-pass'].join(':') + '@' + REMOTE_HOST + '/db';

let pass = 0;
let fail = 0;
const ok = (c, label) => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

function boot(env) {
  const res = spawnSync(process.execPath, ['-e', "require('./server.js'); setTimeout(()=>process.exit(0), 700);"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: '', ...env },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { out: `${res.stdout || ''}${res.stderr || ''}`, code: res.status };
}

console.log('\n=== server database guard ===\n');

{
  // Local mode must win over a stray URL, because dotenv has already loaded one
  // by the time any of this runs.
  const r = boot({ NODE_ENV: 'development', LOCAL_JSON_MODE: 'true', DATABASE_URL: REMOTE });
  ok(r.out.includes('DATABASE_URL is being ignored'), 'local mode reports that it ignored the remote URL');
  ok(!r.out.includes('PostgreSQL connected'), 'and never connects to Postgres');
  ok(r.out.includes('local JSON'), 'and uses the local JSON store');
}

{
  // Production must never fall back to a JSON file.
  const r = boot({ NODE_ENV: 'production', LOCAL_JSON_MODE: 'true', DATABASE_URL: REMOTE });
  ok(r.out.includes('production cannot use the local JSON store'), 'production + local mode refuses to boot');
  ok(r.code !== 0, 'and exits non-zero');
}

{
  // A dev boot with a remote URL and no explicit opt-in must stop.
  const r = boot({ NODE_ENV: 'development', LOCAL_JSON_MODE: '', DATABASE_URL: REMOTE });
  ok(r.out.includes('Refusing to boot'), 'a dev boot against a remote URL refuses');
  ok(r.out.includes('db.invalid-host.example'), 'and names the host it found');
  ok(r.code !== 0, 'and exits non-zero');
}

{
  // Opting in explicitly still works, so the guard is a speed bump and not a wall.
  const r = boot({
    NODE_ENV: 'development',
    LOCAL_JSON_MODE: '',
    DATABASE_URL: REMOTE,
    ALLOW_REMOTE_DB: '1',
  });
  ok(!r.out.includes('Refusing to boot'), 'ALLOW_REMOTE_DB=1 still permits an intentional remote boot');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);