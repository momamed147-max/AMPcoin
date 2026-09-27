// Safe refresh of the item catalog from the Elvebredd pet-value feed that
// amvgg.net proxies.
//
//   node backend/refreshValues.js            dry run, changes nothing
//   node backend/refreshValues.js --apply    write (backed up first)
//
// Unlike the original importAmvgg.js this:
//   * preserves existing item ids by name, so player inventories survive
//   * refuses to run while any withdrawal is outstanding
//   * backs up the catalog before writing
//   * reports a diff (added / removed / re-priced) instead of a silent wipe
//
// Storage is whichever the running config uses (PostgreSQL in production,
// local JSON in development) via dbManager.saveItemsDb().
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
// Must match server.js, otherwise LOCAL_JSON_MODE is invisible here and every
// run tries to reach PostgreSQL.
require('dotenv').config();
const dbManager = require('./db/dbHelper');

const FEED_URL = 'https://amvgg.net/wp-admin/admin-ajax.php';
const FEED_PAGE = 'https://amvgg.net/adopt-me-values-list/';
const FALLBACK_NONCE = '9135f81534';
const VALUE_MULTIPLIER = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Rarities that must never reach the catalog.
const EXCLUDED_RARITIES = new Set(['common', 'uncommon']);

function mapRarity(raw) {
  const r = String(raw || '').toLowerCase().trim();
  if (r.includes('ultra') || r.includes('epic')) return 'epic';
  if (r.includes('legend')) return 'legendary';
  if (r.includes('mythic')) return 'mythic';
  if (r.includes('rare')) return 'rare';
  if (r.includes('uncommon')) return 'uncommon';
  return 'common';
}

async function getNonce() {
  try {
    const r = await fetch(FEED_PAGE, { headers: { 'User-Agent': UA } });
    const html = await r.text();
    const m = html.match(/AMCCONFIG\s*=\s*\{[^}]*"nonce"\s*:\s*"([a-f0-9]+)"/);
    if (m) return m[1];
    console.warn('  ! nonce not found in page, using the baked-in fallback');
  } catch (e) {
    console.warn('  ! nonce fetch failed, using the baked-in fallback:', e.message);
  }
  return FALLBACK_NONCE;
}

async function fetchFeed() {
  const nonce = await getNonce();
  const params = new URLSearchParams();
  params.append('action', 'elvebredd_load_pet_data');
  params.append('nonce', nonce);

  const res = await fetch(FEED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Referer': FEED_PAGE
    },
    body: params
  });
  if (!res.ok) throw new Error(`feed responded ${res.status}`);
  const body = await res.json();
  if (!body?.data?.data) throw new Error('feed returned no data (the nonce may be stale)');
  const raw = body.data.data;
  return Array.isArray(raw) ? raw : Object.values(raw);
}

function buildItems(list, existingByName) {
  const now = new Date().toISOString();
  const seen = new Set();
  const items = [];
  let skippedLow = 0;
  let skippedNoImage = 0;
  let skippedNoValue = 0;

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String(entry.name || '').trim();
    const image = String(entry.image || '').trim();
    if (!name) continue;
    if (String(entry.type || '').toLowerCase() !== 'pets') continue;
    if (image.includes('gagpets')) continue;
    if (!image) { skippedNoImage++; continue; }

    const rawRarity = String(entry.rarity || '').toLowerCase().trim();
    if (EXCLUDED_RARITIES.has(rawRarity)) { skippedLow++; continue; }

    const rvalue = parseFloat(entry['rvalue - nopotion'] ?? entry.rvalue ?? entry.value);
    if (isNaN(rvalue)) { skippedNoValue++; continue; }

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const rarity = mapRarity(entry.rarity);
    // Commons can also arrive with a vague rarity label, so guard on the result.
    if (EXCLUDED_RARITIES.has(rarity)) { skippedLow++; continue; }

    // Keep the id this pet already had. Inventories reference it directly, so
    // regenerating ids would orphan anything a player is holding.
    const prior = existingByName.get(key);
    const id = prior?.itemId || prior?.id || `amvgg-${String(entry.id || '').trim() || uuidv4()}`;

    items.push({
      id,
      itemId: id,
      name,
      itemName: name,
      description: prior?.description || `Adopt Me pet • ${entry.rarity || rarity}`,
      imageUrl: image,
      image,
      rarity,
      baseValue: prior?.baseValue ?? Math.max(1, Math.round(rvalue * VALUE_MULTIPLIER)),
      value: Math.max(1, Math.round(rvalue * VALUE_MULTIPLIER)),
      tradable: true,
      isEnabled: true,
      source: 'elvebredd',
      createdAt: prior?.createdAt || now,
      updatedAt: now
    });
  }

  items.sort((a, b) => b.value - a.value);
  return { items, skippedLow, skippedNoImage, skippedNoValue };
}

// Anyone still holding a pet that the feed no longer lists.
function holdersOfRemoved(db, removedNames) {
  const byName = new Map();
  for (const inv of db.inventories || []) {
    if (!inv || !Array.isArray(inv.items)) continue;
    for (const it of inv.items) {
      const nm = String(it.name || it.itemName || '').toLowerCase();
      if (!removedNames.has(nm)) continue;
      byName.set(nm, (byName.get(nm) || 0) + ((it.quantity || 1)));
    }
  }
  return byName;
}

function outstandingWithdrawals(db) {
  const cash = (db.withdrawals || []).filter((w) => w?.status === 'pending');
  const items = (db.itemWithdrawals || []).filter((w) => w?.status === 'pending');
  const pendingTx = (db.transactions || []).filter((t) => t?.status === 'pending');
  return { cash: cash.length, item: items.length, transactions: pendingTx.length, total: cash.length + items.length + pendingTx.length };
}

const fmt = (n) => Number(n).toLocaleString();

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  console.log(`Elvebredd value refresh — ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  // The catalog is only in memory once the DB has been loaded, so a standalone
  // run has to boot it or every diff reads as "0 items, 577 added".
  await dbManager.init();
  console.log(`  storage: ${dbManager.isSandbox() ? 'local JSON sandbox' : 'PostgreSQL'}`);

  const list = await fetchFeed();
  console.log(`  feed: ${list.length} raw entries`);

  const itemsDb = dbManager.getItemsDb();
  const existing = itemsDb.items || [];
  const existingByName = new Map(existing.map((i) => [String(i.name || i.itemName || '').toLowerCase(), i]));
  const { items, skippedLow, skippedNoImage, skippedNoValue } = buildItems(list, existingByName);
  console.log(`  after filters: ${items.length} pets (skipped ${skippedLow} common/uncommon, ${skippedNoImage} without an image, ${skippedNoValue} without a value)`);

  const newByName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
  const added = items.filter((i) => !existingByName.has(i.name.toLowerCase()));
  const removed = existing.filter((i) => !newByName.has(String(i.name || i.itemName || '').toLowerCase()));
  const repriced = [];
  for (const i of items) {
    const prior = existingByName.get(i.name.toLowerCase());
    if (prior && Number(prior.value) !== Number(i.value)) repriced.push({ name: i.name, from: prior.value, to: i.value });
  }
  repriced.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));

  console.log(`\n  diff vs current catalog (${existing.length} items):`);
  console.log(`    added     ${added.length}`);
  console.log(`    removed   ${removed.length}`);
  console.log(`    re-priced ${repriced.length} of ${items.length}`);

  if (repriced.length) {
    const totalBefore = items.reduce((s, i) => s + Number(existingByName.get(i.name.toLowerCase())?.value || 0), 0);
    const totalAfter = items.reduce((s, i) => s + Number(i.value), 0);
    console.log(`    catalog total value ${fmt(totalBefore)} -> ${fmt(totalAfter)}`);
    console.log('\n    biggest moves:');
    repriced.slice(0, 10).forEach((r) => {
      const pct = r.from ? Math.round(((r.to - r.from) / r.from) * 100) : 0;
      console.log(`      ${r.name.padEnd(28)} ${String(fmt(r.from)).padStart(9)} -> ${String(fmt(r.to)).padStart(9)}  (${pct > 0 ? '+' : ''}${pct}%)`);
    });
  }
  if (added.length) {
    console.log('\n    new pets:');
    added.slice(0, 10).forEach((i) => console.log(`      ${i.name.padEnd(28)} ${fmt(i.value)} (${i.rarity})`));
    if (added.length > 10) console.log(`      ... and ${added.length - 10} more`);
  }
  if (removed.length) {
    console.log('\n    removed from catalog:');
    removed.slice(0, 10).forEach((i) => console.log(`      ${i.name} (${fmt(i.value)}, ${i.rarity})`));
    if (removed.length > 10) console.log(`      ... and ${removed.length - 10} more`);
  }

  const db = dbManager.getMainDb();
  const held = holdersOfRemoved(db, new Set(removed.map((i) => String(i.name || i.itemName || '').toLowerCase())));
  if (held.size) {
    console.log('\n  !! players still hold pets this refresh would remove:');
    for (const [nm, qty] of held) console.log(`      ${nm} x${qty}`);
  }

  const outstanding = outstandingWithdrawals(db);
  console.log(`\n  outstanding withdrawals: ${outstanding.total} (cash ${outstanding.cash}, items ${outstanding.item}, transactions ${outstanding.transactions})`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  if (outstanding.total > 0 && !force) {
    console.error('\nREFUSING TO APPLY: withdrawals are outstanding.');
    console.error('Re-pricing the catalog changes what those requests are worth.');
    console.error('Settle or cancel them first, or re-run with --force if you are sure.');
    process.exit(1);
  }

  const backupPath = path.join(__dirname, 'db', `items.backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(itemsDb, null, 2));
  console.log(`\n  backup written to ${backupPath}`);

  itemsDb.items = items;

  if (dbManager.isSandbox()) {
    // dbManager.saveItemsDb() is a deliberate no-op in the JSON sandbox, so
    // writing the file here is the only way the change actually lands.
    const outPath = path.join(__dirname, 'db', 'items.json');
    fs.writeFileSync(outPath, JSON.stringify({ items }, null, 2));
  } else {
    await dbManager.saveItemsDb();
  }

  // Never report success we have not confirmed. The sandbox path above is not
  // a no-op by accident, and a silent no-op here would look like a clean run.
  if (dbManager.isSandbox()) {
    const written = JSON.parse(fs.readFileSync(path.join(__dirname, 'db', 'items.json'), 'utf8'));
    const n = Array.isArray(written.items) ? written.items.length : 0;
    if (n !== items.length) {
      console.error(`\nWRITE FAILED: items.json holds ${n} items, expected ${items.length}.`);
      process.exit(1);
    }
    console.log(`  verified items.json now holds ${n} pets`);
  } else {
    console.log('  saved to PostgreSQL');
  }

  console.log(`  catalog replaced: ${items.length} pets at x${VALUE_MULTIPLIER} (source: elvebredd)`);
  console.log('  restart the backend if it is running, so it loads the new catalog.');
}

main().catch((e) => {
  console.error('Refresh failed:', e.message);
  process.exit(1);
});
