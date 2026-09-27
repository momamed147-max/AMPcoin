// CLI wrapper around the shared value refresh used by the admin endpoint.
//
//   node backend/refreshValues.js            dry run, changes nothing
//   node backend/refreshValues.js --apply    write
//   node backend/refreshValues.js --force    write even with withdrawals pending
//
// dbManager.saveItemsDb() is a deliberate no-op in the JSON sandbox, so in that
// mode the catalog file is written directly and then read back to confirm.
const fs = require('fs');
const path = require('path');
// Must match server.js, or LOCAL_JSON_MODE is invisible and every run tries to
// reach PostgreSQL.
require('dotenv').config();
const dbManager = require('./db/dbHelper');
const { planRefresh, applyRefresh, VALUE_MULTIPLIER } = require('./services/valueRefresh');

const fmt = (n) => Number(n || 0).toLocaleString();

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  console.log(`Elvebredd value refresh — ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  await dbManager.init();
  console.log(`  storage: ${dbManager.isSandbox() ? 'local JSON sandbox' : 'PostgreSQL'}`);

  const plan = await planRefresh();
  const { diff, outstanding, heldByPlayers, built } = plan;

  console.log(`  feed: ${built.items.length} pets (skipped ${built.skippedLow} common/uncommon)`);
  console.log(`  real tier values from the feed: ${built.withNeon} neon, ${built.withMega} mega`);
  console.log(`\n  diff vs current catalog (${diff.current} items):`);
  console.log(`    incoming   ${diff.incoming}`);
  console.log(`    added      ${diff.added}`);
  console.log(`    removed    ${diff.removed}`);
  console.log(`    re-priced  ${diff.repriced}`);
  console.log(`    gained tier values (neon/mega)  ${diff.tierAdded}`);

  if (diff.biggestMoves.length) {
    console.log('\n    biggest moves:');
    for (const m of diff.biggestMoves.slice(0, 10)) {
      const pct = m.from ? Math.round(((m.to - m.from) / m.from) * 100) : 0;
      console.log(`      ${m.name.padEnd(28)} ${String(fmt(m.from)).padStart(9)} -> ${String(fmt(m.to)).padStart(9)}  (${pct > 0 ? '+' : ''}${pct}%)`);
    }
  }
  if (diff.addedNames.length) {
    console.log('\n    new pets:');
    for (const i of diff.addedNames.slice(0, 10)) console.log(`      ${i.name.padEnd(28)} ${fmt(i.value)}`);
  }
  if (diff.removedNames.length) {
    console.log('\n    removed from catalog:');
    for (const i of diff.removedNames.slice(0, 10)) console.log(`      ${i.name} (${fmt(i.value)})`);
  }
  if (heldByPlayers.length) {
    console.log('\n  !! players still hold pets this refresh would remove:');
    for (const h of heldByPlayers) console.log(`      ${h.name} x${h.qty}`);
  }

  console.log(`\n  outstanding withdrawals: ${outstanding.total} (cash ${outstanding.cash}, items ${outstanding.item}, transactions ${outstanding.transactions})`);

  if (!apply) {
    console.log('\nDry run - nothing written. Re-run with --apply to write.');
    return;
  }

  if (outstanding.total > 0 && !force) {
    console.error('\nREFUSING TO APPLY: withdrawals are outstanding.');
    console.error('Re-pricing the catalog changes what those requests are worth.');
    console.error('Settle or cancel them first, or re-run with --force if you are sure.');
    process.exit(1);
  }

  const itemsDb = dbManager.getItemsDb();
  const backupPath = path.join(__dirname, 'db', `items.backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(itemsDb, null, 2));
  console.log(`\n  backup written to ${backupPath}`);

  const written = await applyRefresh();

  if (dbManager.isSandbox()) {
    const outPath = path.join(__dirname, 'db', 'items.json');
    fs.writeFileSync(outPath, JSON.stringify({ items: plan.items }, null, 2));
    const check = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const n = Array.isArray(check.items) ? check.items.length : 0;
    if (n !== written) {
      console.error(`\nWRITE FAILED: items.json holds ${n} items, expected ${written}.`);
      process.exit(1);
    }
    console.log(`  verified items.json now holds ${n} pets`);
  } else {
    console.log('  saved to PostgreSQL');
  }

  console.log(`  catalog replaced: ${written} pets at x${VALUE_MULTIPLIER} (source: elvebredd)`);
  console.log('  restart the backend if it is running, so it loads the new catalog.');
}

main().catch((e) => {
  console.error('Refresh failed:', e.message);
  process.exit(1);
});
