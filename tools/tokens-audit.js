const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src');
const cssFiles = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.css')) cssFiles.push(p);
  }
};
walk(SRC);

// Every custom property the codebase READS. A redesign that supplies only some
// of them leaves the rest falling back to whatever the old sheets happened to
// define, which is how a design system ends up looking like a mixture.
const declared = new Map();
const consumed = new Set();

for (const f of cssFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g)) {
    if (!declared.has(m[1])) declared.set(m[1], { value: m[2].trim(), file: path.relative(SRC, f) });
  }
  for (const m of src.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) consumed.add(m[1]);
}

const jsFiles = [];
const walkJs = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkJs(p); else if (p.endsWith('.js')) jsFiles.push(p);
  }
};
walkJs(SRC);
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/['"](--[a-zA-Z0-9-]+)['"]/g)) consumed.add(m[1]);
}

const onlyConsumed = [...consumed].filter((n) => declared.has(n)).sort();
const neverDeclared = [...consumed].filter((n) => !declared.has(n)).sort();

console.log(`\n  custom properties CONSUMED by the app : ${consumed.size}`);
console.log(`  ...and declared somewhere              : ${onlyConsumed.length}`);
console.log(`  ...consumed but NEVER declared         : ${neverDeclared.length}`);
if (neverDeclared.length) neverDeclared.forEach((n) => console.log(`      MISSING  ${n}`));

// Group the real ones so the system file can be organised the same way.
const groups = new Map();
for (const n of onlyConsumed) {
  const key = n.replace(/^--/, '').split('-')[0];
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(n);
}

console.log('\n  BY GROUP');
for (const [g, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n    ${g}  (${list.length})`);
  for (const n of list) {
    const d = declared.get(n);
    console.log(`      ${n.padEnd(24)} ${d.value.slice(0, 46).padEnd(48)} ${d.file}`);
  }
}
console.log('');