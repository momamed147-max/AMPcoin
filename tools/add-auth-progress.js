/**
 * Add a two-step progress indicator to the auth screen.
 *
 * WHY
 * ---
 * Signing in is two steps - get a code, then paste it into a Roblox bio - and
 * nothing said so. The second screen arrived looking like a different product
 * rather than the next page of the same flow, and the only way to find out was
 * to already be halfway through.
 *
 * This sits above the card's heading, outside the step branch, so it is
 * present on both steps and is the only thing on the screen that changes
 * between them. The step number, the handler, the error state and the
 * instruction list are all untouched.
 *
 * Rendered as a <ol> with the state on each item, so a screen reader hears
 * "Username, step 1 of 2" rather than two unlabelled dots.
 */
const fs = require('fs');

const PAGE = 'frontend/src/pages/LoginPage.js';
const raw = fs.readFileSync(PAGE, 'utf8');
// This file is CRLF on disk. Matching a multi-line anchor written with \n would
// never hit, so the anchor is matched with a tolerant pattern instead.
const anchorRe = /([ \t]*)<div className="auth-logo">\r?\n[ \t]*<Logo size=\{44\} textSize="1\.7rem" \/>\r?\n[ \t]*<\/div>\r?\n/;

const m = raw.match(anchorRe);
if (!m) {
  console.error('  could not find the auth-logo block to anchor on');
  process.exit(1);
}
if (raw.includes('auth-progress')) {
  console.log('  already present, nothing to do');
  process.exit(0);
}

const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const indent = m[1];

const lines = [
  '',
  `${indent}{/* Two steps, named. Without this the second screen reads as a`,
  `${indent}    different product rather than as the next page of this one. */}`,
  `${indent}<ol className="auth-progress">`,
  `${indent}  <li className={\`auth-progress-step \${step === 1 ? 'is-current' : 'is-done'}\`}>`,
  `${indent}    <span className="auth-progress-dot" aria-hidden="true" />`,
  `${indent}    Username`,
  `${indent}  </li>`,
  `${indent}  <li className="auth-progress-sep" aria-hidden="true" />`,
  `${indent}  <li className={\`auth-progress-step \${step === 2 ? 'is-current' : ''}\`}>`,
  `${indent}    <span className="auth-progress-dot" aria-hidden="true" />`,
  `${indent}    Verify`,
  `${indent}  </li>`,
  `${indent}</ol>`,
  ''
];

const src = raw.replace(anchorRe, (match) => match + lines.join(eol));
fs.writeFileSync(PAGE, src);
console.log('  added the two-step indicator above the card heading');