/**
 * Every mod combination must be independently selectable and independently
 * priced.
 *
 * Previously Mega and Neon dragged Fly and Ride in automatically, so (M) and
 * (N) could not exist. The catalog has always carried all twelve grid cells
 * (three tiers x four states) - variantCellFor just never went looking for the
 * bare-tier ones. These tests pin that down, because the risk here is not that
 * bare M fails, it is that it silently resolves to the same cell as MFR and two
 * differently named items end up worth the same.
 *
 * The load-bearing check is the last one: the 71 modded stacks that actually
 * exist in production are MFR, NFR, FR and R, and none of them may move value.
 */
const path = require('path');
const fs = require('fs');

const api = require(path.join(__dirname, '..', 'backend', 'lib', 'petMods.js'));

let pass = 0;
let fail = 0;
const ok = (c, label) => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

const catalog = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'backend', 'db', 'items.json'), 'utf8'
));
const items = Array.isArray(catalog) ? catalog : (catalog.items || []);

console.log('\n=== Mega and Neon can be selected on their own ===\n');

{
  ok(JSON.stringify(api.normalizeMods(['M'])) === JSON.stringify(['M']),
    "normalizeMods(['M']) stays ['M'] instead of becoming ['M','F','R']");
  ok(JSON.stringify(api.normalizeMods(['N'])) === JSON.stringify(['N']),
    "normalizeMods(['N']) stays ['N'] instead of becoming ['N','F','R']");
  ok(JSON.stringify(api.normalizeMods(['M', 'F'])) === JSON.stringify(['M', 'F']),
    "Mega + Fly keeps just those two");
  ok(JSON.stringify(api.normalizeMods(['F'])) === JSON.stringify(['F']),
    "Fly alone is still Fly alone");
  ok(JSON.stringify(api.normalizeMods(['R'])) === JSON.stringify(['R']),
    "Ride alone is still Ride alone");
}

console.log('\n=== Mega and Neon remain mutually exclusive ===\n');

{
  // There is no grid cell for a pet that is both, so one must lose. This is a
  // real constraint, not the old bundling.
  ok(!api.normalizeMods(['M', 'N']).includes('N'), "M wins over N");
  ok(!api.normalizeMods(['N', 'M']).includes('M') === false,
    "M wins over N regardless of argument order (deterministic, not first-wins)");
  ok(api.normalizeMods(['M', 'N', 'F']).includes('M'), "M survives and F is kept");
}

console.log('\n=== all twelve grid cells resolve ===\n');

{
  const cases = [
    [[], ['normal', 'base']],
    [['F'], ['normal', 'fly']],
    [['R'], ['normal', 'ride']],
    [['F', 'R'], ['normal', 'flyRide']],
    [['M'], ['mega', 'base']],
    [['M', 'F'], ['mega', 'fly']],
    [['M', 'R'], ['mega', 'ride']],
    [['M', 'F', 'R'], ['mega', 'flyRide']],
    [['N'], ['neon', 'base']],
    [['N', 'F'], ['neon', 'fly']],
    [['N', 'R'], ['neon', 'ride']],
    [['N', 'F', 'R'], ['neon', 'flyRide']],
  ];
  const seen = new Set();
  for (const [mods, expected] of cases) {
    const got = api.variantCellFor(mods);
    ok(got[0] === expected[0] && got[1] === expected[1],
      `${JSON.stringify(mods).padEnd(20)} -> ${got[0]}.${got[1]}${got[0] === expected[0] && got[1] === expected[1] ? '' : ` (expected ${expected.join('.')})`}`);
    seen.add(`${got[0]}.${got[1]}`);
  }
  ok(seen.size === 12, `all 12 cells are reachable (got ${seen.size})`);
}

console.log('\n=== bare M and N are priced differently from MFR and NFR ===\n');

{
  // The whole point. (M) must land in a different CELL from (MFR), and in
  // practice a different VALUE - otherwise (M) is just a differently-named copy
  // of (MFR) and the new option is cosmetic.
  //
  // On a handful of cheap pets the source feed happens to quote the same figure
  // for base and fly&ride, so the two coincide numerically. That is the data's
  // own shape, not a lookup bug, so it is reported rather than asserted away.
  let differing = 0;
  let coincident = 0;
  let checked = 0;
  const samples = [];
  const sameAs = [];
  for (const item of items) {
    const v = item.variants;
    if (!v?.mega || !v?.neon) continue;
    checked++;
    const bare = Number(v.mega.base);
    const bundled = Number(v.mega.flyRide);
    if (!Number.isFinite(bare) || !Number.isFinite(bundled)) continue;
    if (bare === bundled) {
      coincident++;
      if (sameAs.length < 4) sameAs.push(`${item.name} (${bare})`);
    } else differing++;
    if (samples.length < 3) {
      samples.push(`${item.name}: mega.base=${bare} vs mega.flyRide=${bundled}`);
    }
  }
  ok(checked === items.length, `every catalog pet carries a full grid (${checked}/${items.length})`);
  ok(differing > checked * 0.95,
    `bare Mega and Mega+Fly+Ride differ on ${differing}/${checked} pets`);
  ok(api.variantCellFor(['M']).join('.') !== api.variantCellFor(['M', 'F', 'R']).join('.'),
    "a bare M resolves to a different grid cell from MFR, so they are distinct items");
  samples.forEach((s) => console.log(`         ${s}`));
  console.log('         (Fly and Ride make most pets worth LESS, so bare Mega is the bigger figure.)');
  if (coincident) {
    console.log(`         ${coincident} cheap pets quote the same figure for base and fly&ride:`);
    console.log(`           ${sameAs.join(', ')}`);
  }
}

console.log('\n=== the frontend copy agrees with the backend ===\n');

{
  // Two copies of this logic exist. If they drift, the admin panel previews a
  // different number from the one the server actually grants.
  const fePath = path.join(__dirname, '..', 'frontend', 'src', 'lib', 'petMods.js');
  const src = fs.readFileSync(fePath, 'utf8');

  // The file is ESM and this suite is CommonJS, so strip the export keywords
  // and hand the functions back explicitly.
  const body = src
    .replace(/export\s+(const|function)/g, '$1')
    .concat('\nmodule.exports = { normalizeMods, variantCellFor, MOD_BONUS };');
  const mod = { exports: {} };
  new Function('module', 'exports', body)(mod, mod.exports);
  const fe = mod.exports;

  ok(typeof fe.normalizeMods === 'function' && typeof fe.variantCellFor === 'function',
    'the frontend module exports both functions');

  const combos = [[], ['F'], ['R'], ['F', 'R'], ['M'], ['M', 'F'], ['M', 'R'], ['M', 'F', 'R'],
    ['N'], ['N', 'F'], ['N', 'R'], ['N', 'F', 'R'], ['M', 'N']];
  let same = true;
  for (const mods of combos) {
    const a = JSON.stringify(api.normalizeMods(mods));
    const b = JSON.stringify(fe.normalizeMods(mods));
    if (a !== b) { same = false; console.log(`         normalizeMods(${JSON.stringify(mods)}): backend ${a} vs frontend ${b}`); }
    const ca = api.variantCellFor(mods).join('.');
    const cb = fe.variantCellFor(mods).join('.');
    if (ca !== cb) { same = false; console.log(`         variantCellFor(${JSON.stringify(mods)}): backend ${ca} vs frontend ${cb}`); }
  }
  ok(same, `frontend and backend agree on all ${combos.length} combinations checked`);
}

console.log('\n=== existing modded items do not move ===\n');

{
  // What production actually holds, read from the inventory snapshot earlier:
  // MFR x32, NFR x21, FR x6, R x12 across 9 users, and zero bare M or N.
  // Every one of those must resolve to exactly the cell it resolved to before.
  const existing = [
    ['MFR', ['mega', 'flyRide']],
    ['NFR', ['neon', 'flyRide']],
    ['FR', ['normal', 'flyRide']],
    ['R', ['normal', 'ride']],
  ];
  for (const [suffix, expected] of existing) {
    const mods = suffix.split('');
    const got = api.variantCellFor(mods);
    ok(got[0] === expected[0] && got[1] === expected[1],
      `existing (${suffix}) still resolves to ${got[0]}.${got[1]}`);
  }
  // Compare as sets: a sorted-string comparison would silently depend on
  // alphabetical order rather than on membership.
  const sameSet = (mods, expected) => {
    const got = [...api.normalizeMods(mods)].sort().join('');
    return got === [...expected].sort().join('');
  };
  ok(sameSet('MFR'.split(''), ['M', 'F', 'R']), "an existing (MFR) normalises unchanged");
  ok(sameSet('NFR'.split(''), ['N', 'F', 'R']), "an existing (NFR) normalises unchanged");
  ok(sameSet('FR'.split(''), ['F', 'R']), "an existing (FR) normalises unchanged");
  ok(sameSet('R'.split(''), ['R']), "an existing (R) normalises unchanged");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);