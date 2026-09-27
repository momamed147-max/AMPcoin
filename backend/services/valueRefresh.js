// Elvebredd value refresh, shared by the CLI (backend/refreshValues.js) and the
// admin endpoint, so both take exactly the same path.
const { v4: uuidv4 } = require('uuid');
const dbManager = require('../db/dbHelper');

const FEED_URL = 'https://amvgg.net/wp-admin/admin-ajax.php';
const FEED_PAGE = 'https://amvgg.net/adopt-me-values-list/';
const FALLBACK_NONCE = '9135f81534';
const VALUE_MULTIPLIER = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

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
  } catch (e) {
    // fall through to the baked-in nonce
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

    const tier = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? null : Math.max(1, Math.round(n * VALUE_MULTIPLIER));
    };
    const base = Math.max(1, Math.round(rvalue * VALUE_MULTIPLIER));

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
      // Real per-pet tier values. They vary wildly (a mega is anywhere from
      // 1.3x to 7x its normal value) so they cannot be faked with a flat bonus.
      neonValue: tier(entry['nvalue - nopotion'] ?? entry.nvalue) ?? prior?.neonValue ?? null,
      megaValue: tier(entry['mvalue - nopotion'] ?? entry.mvalue) ?? prior?.megaValue ?? null,
      tradable: true,
      isEnabled: true,
      source: 'elvebredd',
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
    withMega: items.filter((i) => i.megaValue).length
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
