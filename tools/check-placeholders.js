const fs = require('fs');
const path = require('path');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const ROOT = path.join(__dirname, '..');
const roots = [path.join(ROOT, 'frontend', 'src'), path.join(ROOT, 'backend')];
const files = roots.flatMap((r) => walk(r)).filter((f) => /\.js$/.test(f) && !f.includes('node_modules'));

console.log('\n  any reference to a default placeholder that is NOT a plain literal?');
let suspicious = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/default-(item|avatar)/i.test(line)) return;
    // A literal is `'...default-item.svg'` with no interpolation or concatenation.
    const interpolated = /\$\{/.test(line) || /\+\s*[A-Za-z_$]/.test(line) || /`[^`]*\$\{/.test(line);
    if (interpolated) {
      suspicious++;
      console.log(`    ${f.replace(/.*(frontend\\src|backend)\\/, '$1/')}:${i + 1}  ${line.trim().slice(0, 100)}`);
    }
  });
}
console.log(suspicious ? `  ${suspicious} suspicious line(s)` : '  none - every reference is a literal');

console.log('\n  literals still pointing at the removed PNGs:');
let png = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const n = (src.match(/default-(item|avatar)\.png/g) || []).length;
  if (n) { png += n; console.log(`    ${f.replace(/.*(frontend\\src|backend)\\/, '$1/')}: ${n}`); }
}
console.log(png ? `  ${png} left` : '  none');
console.log('');