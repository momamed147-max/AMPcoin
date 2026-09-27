// Elvebredd value refresh, shared by the CLI (backend/refreshValues.js) and the
// admin endpoint, so both take exactly the same path.
const { v4: uuidv4 } = require('uuid');
const dbManager = require('../db/dbHelper');

const FEED_URL = 'https://amvgg.net/wp-admin/admin-ajax.php';
const FEED_PAGE = 'https://amvgg.net/adopt-me-values-list/';
const FALLBACK_NONCE = '9135f81534';
const VALUE_MULTIPLIER = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const SNAPSHOT_PATH = require('path').join(__dirname, '..', 'db', 'elvebredd-values.json');

const EXCLUDED_RARITIES = new Set(['common', 'uncommon']);

/**
 * Elvebredd's own figures, captured from their calculator page into
 * backend/db/elvebredd-values.json. This is the preferred source: the amvgg
 * feed is a third-party mirror and has drifted (359 of 577 base values and
 * over 540 tier values disagreed with Elvebredd's own site).
 *
 * Their site rejects automated clients (Cloudflare) and their robots.txt
 * disallows the paths the data lives on, so a live fetch is not something to
 * build against. The snapshot is therefore a point-in-time copy - refresh it by
 * re-capturing, or ask Elvebredd for an API key. The amvgg feed remains as a
 * fallback so the tool still works if the snapshot is missing.
 */
function readSnapshot() {
  try {
    const fs = require('fs');
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    if (!Array.isArray(raw?.pets) || raw.pets.length === 0) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

// Normalise a snapshot record into the same shape the amvgg feed produces, so
// buildItems() does not care which source it was given.
function snapshotToEntries(snapshot) {
  return snapshot.pets
    .filter((p) => p && p.name && !EXCLUDED_RARITIES.has(String(p.rarity || '').toLowerCase()))
    .map((p) => ({
      name: p.name,
      image: `https://elvebredd.com/images/pets/${p.name}.png`,
      rarity: p.rarity,
      type: 'pets',
      status: p.status || 'Ready',
      'rvalue - nopotion': p.r_np,
      'rvalue - ride': p.r_ride,
      'rvalue - fly': p.r_fly,
      'rvalue - fly&ride': p.r_fr,
      'nvalue - nopotion': p.n_np,
      'nvalue - ride': p.n_ride,
      'nvalue - fly': p.n_fly,
      'nvalue - fly&ride': p.n_fr,
      'mvalue - nopotion': p.m_np,
      'mvalue - ride': p.m_ride,
      'mvalue - fly': p.m_fly,
      'mvalue - fly&ride': p.m_fr
    }));
}

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
  } catch (e) {
    // fall through to the baked-in nonce
  }
  return FALLBACK_NONCE;
}

async function fetchFeed() {
  const snapshot = readSnapshot();
  if (snapshot) {
    const entries = snapshotToEntries(snapshot);
    console.log(`[values] using the elvebredd.com snapshot (${snapshot.generatedAt}) - ${entries.length} pets`);
    return entries;
  }
  console.log('[values] no snapshot found, falling back to the amvgg mirror');
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
  let skippedLow = 0, skippedNoImage = 0, skippedNoValue = 0;

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
    if (EXCLUDED_RARITIES.has(rarity)) { skippedLow++; continue; }

    // Keep the id the pet already had. Inventories reference it directly, so
    // regenerating ids would orphan anything a player is holding.
    const prior = existingByName.get(key);
    const id = prior?.itemId || prior?.id || `amvgg-${String(entry.id || '').trim() || uuidv4()}`;

    const scaled = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? null : Math.max(1, Math.round(n * VALUE_MULTIPLIER));
    };

    // The feed prices every combination, and the ratios are not constant:
    // fly and ride usually make a pet worth LESS, a mega can be 1.5x to 7x,
    // and a mega+fly can be half a plain mega. A flat percentage bonus cannot
    // represent this, so the whole grid is stored.
    const buildTier = (prefix, fallbackBase) => {
      const b = scaled(entry[`${prefix}value - nopotion`]) ?? fallbackBase;
      const fly = scaled(entry[`${prefix}value - fly`]) ?? b;
      const ride = scaled(entry[`${prefix}value - ride`]) ?? b;
      const flyRide = scaled(entry[`${prefix}value - fly&ride`]) ?? Math.min(fly, ride);
      return { base: b, fly, ride, flyRide };
    };

    const base = Math.max(1, Math.round(rvalue * VALUE_MULTIPLIER));
    const normal = buildTier('r', base);
    const neon = buildTier('n', null);
    const mega = buildTier('m', null);
    // The untouched figure from the source feed, kept so the x10 is auditable
    // rather than having to be taken on trust.
    const sourceValue = Math.round(rvalue * 100) / 100;
    // normalizeMods turns ['N'] into ['N','F','R'], so the NEON and MEGA columns
    // have always meant "tier + fly + ride". Keep that meaning.
    const neonValue = neon ? neon.flyRide : (prior?.neonValue ?? null);
    const megaValue = mega ? mega.flyRide : (prior?.megaValue ?? null);

    items.push({
      id,
      itemId: id,
      name,
      itemName: name,
      description: prior?.description || `Adopt Me pet • ${entry.rarity || rarity}`,
      imageUrl: image,
      image,
      rarity,
      baseValue: base,
      value: base,
      sourceValue,
      sourceMultiplier: VALUE_MULTIPLIER,
      variants: { normal, neon, mega },
      neonValue,
      megaValue,
      tradable: true,
      isEnabled: true,
      source: 'elvebredd',
      sourceGeneratedAt: existingByName.get(key)?.sourceGeneratedAt || null,
      createdAt: prior?.createdAt || now,
      updatedAt: now
    });
  }

  items.sort((a, b) => b.value - a.value);
  return {
    items,
    skippedLow,
    skippedNoImage,
    skippedNoValue,
    withNeon: items.filter((i) => i.neonValue).length,
    withMega: items.filter((i) => i.megaValue).length,
    withFlyRide: items.filter((i) => i.variants?.normal?.flyRide).length
  };
}

function outstandingWithdrawals(db) {
  const cash = (db.withdrawals || []).filter((w) => w?.status === 'pending');
  const items = (db.itemWithdrawals || []).filter((w) => w?.status === 'pending');
  const tx = (db.transactions || []).filter((t) => t?.status === 'pending');
  return { cash: cash.length, item: items.length, transactions: tx.length, total: cash.length + items.length + tx.length };
}

function holdersOfRemoved(db, removedNames) {
  const byName = new Map();
  for (const inv of db.inventories || []) {
    if (!inv || !Array.isArray(inv.items)) continue;
    for (const it of inv.items) {
      const nm = String(it.name || it.itemName || '').toLowerCase();
      if (!removedNames.has(nm)) continue;
      byName.set(nm, (byName.get(nm) || 0) + (it.quantity || 1));
    }
  }
  return byName;
}

/** Build the plan and the diff. Never writes. */
async function planRefresh() {
  const list = await fetchFeed();
  const itemsDb = dbManager.getItemsDb();
  const existing = itemsDb.items || [];
  const existingByName = new Map(existing.map((i) => [String(i.name || i.itemName || '').toLowerCase(), i]));
  const built = buildItems(list, existingByName);
  const { items } = built;

  const newByName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
  const added = items.filter((i) => !existingByName.has(i.name.toLowerCase()));
  const removed = existing.filter((i) => !newByName.has(String(i.name || i.itemName || '').toLowerCase()));

  const repriced = [];
  const tierAdded = [];
  for (const i of items) {
    const prior = existingByName.get(i.name.toLowerCase());
    if (!prior) continue;
    if (Number(prior.value) !== Number(i.value)) {
      repriced.push({ name: i.name, from: prior.value, to: i.value });
    }
    const hadNeon = Number.isFinite(Number(prior.neonValue)) && Number(prior.neonValue) > 0;
    const hadMega = Number.isFinite(Number(prior.megaValue)) && Number(prior.megaValue) > 0;
    if ((!hadNeon && i.neonValue) || (!hadMega && i.megaValue)) {
      tierAdded.push({ name: i.name, neon: i.neonValue, mega: i.megaValue });
    }
  }
  repriced.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));

  const db = dbManager.getMainDb();
  const held = holdersOfRemoved(db, new Set(removed.map((i) => String(i.name || i.itemName || '').toLowerCase())));

  return {
    built,
    items,
    diff: {
      current: existing.length,
      incoming: items.length,
      added: added.length,
      removed: removed.length,
      repriced: repriced.length,
      tierAdded: tierAdded.length,
      addedNames: added.slice(0, 25).map((i) => ({ name: i.name, value: i.value })),
      removedNames: removed.slice(0, 25).map((i) => ({ name: i.name, value: i.value })),
      biggestMoves: repriced.slice(0, 15)
    },
    outstanding: outstandingWithdrawals(db),
    heldByPlayers: [...held.entries()].map(([name, qty]) => ({ name, qty }))
  };
}

/** Write the planned catalog. Caller must have checked the withdrawal guard. */
async function applyRefresh() {
  const { items } = await planRefresh();
  const itemsDb = dbManager.getItemsDb();
  itemsDb.items = items;
  await dbManager.saveItemsDb();
  return items.length;
}

module.exports = {
  VALUE_MULTIPLIER,
  fetchFeed,
  buildItems,
  outstandingWithdrawals,
  planRefresh,
  applyRefresh
};
