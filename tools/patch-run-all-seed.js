/**
 * Always seed, even when reusing a server that was already running.
 *
 * WHY
 * ---
 * run-all.js only re-seeded after a restart:
 *
 *     if (!(await portIsUp())) { startServer(); if (serverOurs) seed(); }
 *
 * which is right about the restart - local state is in memory, so a restart
 * wipes every account - and wrong about the rest. With any backend already up,
 * the seed was skipped entirely and the whole run silently inherited whatever
 * state that server happened to be in.
 *
 * The visible symptom was four suites failing or reporting zero passes, and
 * only when the suite was run with a dev server up: hidden admin, outcome
 * control e2e, remove-pet-everywhere and mod-grant-e2e. All four depend on the
 * accounts seedlocal.js creates. With no server up the runner started one,
 * seeded it, and 440/440 passed; with my own server up it inherited its state
 * and 20 failed. A test run that passes or fails depending on whether someone
 * happened to have a dev server running is not a test run.
 *
 * seedlocal.js is idempotent and fast, so running it unconditionally costs
 * almost nothing and makes the result independent of what was there before.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'tests', 'run-all.js');
let src = fs.readFileSync(FILE, 'utf8');

const from = `      // A restart wipes every account, because local state is in-memory. Suites
      // that rely on a pre-seeded account - the operator's admin grant above all
      // - would otherwise report zeroes that read like failures but mean only
      // "the seed never ran". Re-seeding after each restart makes the run
      // deterministic, and seedlocal is idempotent and fast.
      if (serverOurs && suite.seed !== false) {
        spawnSync('node', [path.join(ROOT, 'seedlocal.js')], {
          cwd: ROOT, encoding: 'utf8', timeout: 120000
        });
      }`;

const to = `      // A restart wipes every account, because local state is in-memory, so the
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
      }`;

if (!src.includes(from)) {
  console.error('  anchor not found - has this already been applied?');
  process.exit(1);
}

src = src.replace(from, to);
fs.writeFileSync(FILE, src);
console.log('  run-all.js now seeds unconditionally, so the run does not depend on prior state');