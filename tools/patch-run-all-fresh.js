/**
 * Give run-all.js a --fresh flag, and say something useful when a reused
 * server has run out of rate-limit budget.
 *
 * WHY
 * ---
 * The runner reuses an already-listening backend rather than killing one the
 * developer started, which is the right default: it never destroys someone's
 * running session. But it has a failure mode that looks like a broken test
 * suite.
 *
 * The API limiter allows 2000 requests per 15 minutes per process. Run the
 * suites a few times against the same long-lived dev server and the budget is
 * gone, so every suite that logs in gets a 429 instead of a token and reports
 * zero passes - with no mention of why. Four suites did exactly that, and the
 * first instinct was that the redesign had broken them.
 *
 * --fresh stops whatever is on the port and starts a clean server, so the run
 * gets empty limiter counters and empty in-memory state.
 *
 * The diagnostic matters more than the flag. A 429 in a suite output is a
 * server-state problem, not a product problem, and the output now says so.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'tests', 'run-all.js');
let src = fs.readFileSync(FILE, 'utf8');

/* 1. --fresh: take over the port. */
const startAnchor = `(async () => {
  let totalPass = 0;
  let totalFail = 0;
  let broken = 0;
  const rows = [];`;

const startReplacement = `/* --fresh takes over the port instead of reusing whatever is listening.
   See the note on isNotRateLimited in server.js for why a long-lived server
   eventually stops answering, and seedlocal.js for why state matters too. */
const FRESH = process.argv.includes('--fresh');

async function freePortForFreshRun() {
  if (!FRESH) return false;
  try {
    const { execSync } = require('child_process');
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const line = out.split(/\\r?\\n/).find((l) => new RegExp(\`[:.]$\{PORT}\\\\s+.*LISTENING\`).test(l));
    if (!line) return false;
    const pid = Number(line.trim().split(/\\s+/).pop());
    if (!pid || pid === process.pid) return false;
    process.kill(pid);
    console.log(\`  --fresh: stopped PID \${pid} holding :\${PORT}\\n\`);
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  } catch (err) {
    console.log(\`  --fresh: could not free :\${PORT} (\${err.message})\\n\`);
    return false;
  }
}

(async () => {
  let totalPass = 0;
  let totalFail = 0;
  let broken = 0;
  const rows = [];

  await freePortForFreshRun();`;

if (!src.includes(startAnchor)) { console.error('  start anchor not found'); process.exit(1); }
src = src.replace(startAnchor, startReplacement);

/* 2. Say so when a reused server is the reason for a zero. */
const tallyAnchor = `    if (f > 0) {
      broken++;
      const firstFail = out.split('\\n').find((l) => l.includes('FAIL'));
      rows.push([suite.label, \`\${p} passed, \${f} FAILED\`, firstFail ? firstFail.trim().slice(0, 60) : '']);
    } else {
      rows.push([suite.label, \`\${p} passed\`, '']);
    }`;

const tallyReplacement = `    // A suite reporting zero passes has not failed an assertion - it never got
    // to run one. The usual cause is a reused server whose rate-limit budget is
    // spent, which looks identical to a broken suite unless it is called out.
    const rateLimited = /429|Too Many Requests/i.test(out);
    if (rateLimited) {
      rows.push([
        suite.label,
        \`\${p} passed, \${f} FAILED\`,
        'rate limited - rerun with --fresh'
      ]);
      broken++;
    } else if (f > 0) {
      broken++;
      const firstFail = out.split('\\n').find((l) => l.includes('FAIL'));
      rows.push([suite.label, \`\${p} passed, \${f} FAILED\`, firstFail ? firstFail.trim().slice(0, 60) : '']);
    } else if (p === 0) {
      broken++;
      rows.push([suite.label, '0 passed', 'ran nothing - see its output']);
    } else {
      rows.push([suite.label, \`\${p} passed\`, '']);
    }`;

if (!src.includes(tallyAnchor)) { console.error('  tally anchor not found'); process.exit(1); }
src = src.replace(tallyAnchor, tallyReplacement);

fs.writeFileSync(FILE, src);
console.log('  run-all.js: added --fresh and a rate-limit diagnostic');