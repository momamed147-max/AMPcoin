/**
 * Make run-all.js patient about the backend coming back up.
 *
 * WHY
 * ---
 * At the end of a run the runner stops the server it owns and starts a fresh
 * one, so localhost is left working. startServer() resolves on the child's
 * "Server running" stdout line, but the health endpoint is not necessarily
 * accepting connections at that instant: the listener is bound a moment before
 * the routes are mounted.
 *
 * The runner then probed once. A single early probe said "started but is not
 * answering" and left nothing listening - which looks exactly like a broken
 * local setup, and is a miserable thing to hand someone at the end of a green
 * run. The suites had already passed by then, so the only casualty was the
 * server left behind.
 *
 * Retried with a deadline instead.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'tests', 'run-all.js');
let src = fs.readFileSync(FILE, 'utf8');

const from = `        await startServer();
        const verified = await portIsUp();
        console.log(verified`;

const to = `        await startServer();
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
        console.log(verified`;

if (!src.includes(from)) {
  console.error('  anchor not found - has this already been applied?');
  process.exit(1);
}

src = src.replace(from, to);
fs.writeFileSync(FILE, src);
console.log('  run-all.js now waits for the backend to actually answer');