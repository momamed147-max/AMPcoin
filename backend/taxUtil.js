const crypto = require('crypto');
const dbManager = require('./db/dbHelper');

function readSetting(key) {
  try {
    const db = dbManager.getMainDb();
    const s = db.settings;
    if (Array.isArray(s)) {
      const found = s.find((x) => x.key === key);
      return found ? found.value : undefined;
    }
    if (s && typeof s === 'object') return s[key];
  } catch (e) { /* ignore */ }
  return undefined;
}

// Tax rate stored either as fraction (0.05) or percent (5) -> returns 0..1 fraction
function getTaxRate(key) {
  const v = parseFloat(readSetting(key));
  if (isNaN(v)) return 0;
  if (v <= 0) return 0;
  return v > 1 ? Math.min(v, 100) / 100 : Math.min(v, 1);
}

// Master tax switch + single percentage (10-30%).
function getTaxConfig() {
  const rawEnabled = readSetting('tax_enabled');
  let enabled;
  if (rawEnabled === undefined || rawEnabled === null || rawEnabled === '') {
    const legacy = parseFloat(readSetting('coinflip_fee_percentage'));
    enabled = !(isNaN(legacy)) && legacy > 0;
    if (readSetting('coinflip_fee_percentage') === undefined) enabled = true;
  } else {
    enabled = rawEnabled === true || rawEnabled === 1 ||
      String(rawEnabled).toLowerCase() === 'true' || String(rawEnabled) === '1';
  }
  let pct = parseFloat(readSetting('tax_percentage'));
  if (isNaN(pct)) {
    const legacy = parseFloat(readSetting('coinflip_fee_percentage'));
    pct = isNaN(legacy) ? 15 : (legacy <= 1 ? legacy * 100 : legacy);
  }
  pct = Math.min(30, Math.max(10, pct));
  return { enabled: !!enabled, percent: pct, rate: enabled ? pct / 100 : 0 };
}

// Admin-configured account that receives taxed items.
function getTaxRecipient() {
  try {
    const raw = readSetting('tax_recipient');
    if (!raw || !String(raw).trim()) return null;
    const key = String(raw).trim().toLowerCase();
    const usersDb = dbManager.getUsersDb();
    const u = (usersDb.users || []).find(
      (x) => String(x.id).toLowerCase() === key ||
        String(x.robloxUsername || '').toLowerCase() === key
    );
    if (!u) return null;
    return { id: u.id, username: u.robloxUsername, displayName: u.displayName || u.robloxUsername };
  } catch (e) {
    return null;
  }
}

function cloneStack(st) {
  return { ...st };
}

// Take items worth a set percentage of the pot (default 15%).
//
// Previously this took EVERY unit worth 10%-30% of the pot, so a pot of a few
// similar items had almost all of them removed and the winner was left with a
// single unit. Now the target is a share of the pot *by value*.
//
// Items are indivisible, so the exact figure is approached greedily: units are
// taken in random order while the running total stays within the target, and
// the winner is always left at least one unit.
function collectItemTax(potStacks, rate) {
  const stacks = Array.isArray(potStacks) ? potStacks : [];
  const potValue = stacks.reduce((s, it) => s + ((it.value || 0) * (it.quantity || 1)), 0);
  const totalUnits = stacks.reduce((s, it) => s + Math.max(1, parseInt(it.quantity || 1, 10) || 1), 0);

  const noTax = { winnerStacks: stacks.map(cloneStack), taxStacks: [], taxAmount: 0, potValue };

  // Nothing to take from a single-unit pot: the winner must receive something.
  if (!stacks.length || !(rate > 0) || potValue <= 0 || totalUnits <= 1) return noTax;

  const target = potValue * Math.min(Math.max(rate, 0), 0.95);

  // Expand every unit so a stack of 100 identical items is treated as 100 units.
  const units = [];
  stacks.forEach((st, si) => {
    const qty = Math.max(1, parseInt(st.quantity || 1, 10) || 1);
    for (let k = 0; k < qty; k++) units.push({ stackIndex: si, unitValue: st.value || 0 });
  });

  // Shuffle so which exact units go is random, not always the smallest.
  for (let i = units.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const tmp = units[i];
    units[i] = units[j];
    units[j] = tmp;
  }

  const takeQty = {};
  let taken = 0;
  let takenCount = 0;
  for (const { stackIndex, unitValue } of units) {
    if (takenCount >= units.length - 1) break;          // keep one unit for the winner
    if (taken + unitValue > target) continue;          // would overshoot the share
    takeQty[stackIndex] = (takeQty[stackIndex] || 0) + 1;
    taken += unitValue;
    takenCount++;
  }

  // Nothing fit inside the share (every unit is too big). Taking one anyway
  // would exceed the rate, so leave the pot alone.
  if (!takenCount) return noTax;

  const winnerStacks = [];
  const taxStacks = [];
  stacks.forEach((st, si) => {
    const take = takeQty[si] || 0;
    const total = Math.max(1, parseInt(st.quantity || 1, 10) || 1);
    const left = total - take;
    if (left > 0) winnerStacks.push({ ...st, quantity: left });
    if (take > 0) taxStacks.push({ ...st, quantity: take });
  });

  const taxAmount = taxStacks.reduce((s, it) => s + ((it.value || 0) * (it.quantity || 1)), 0);
  return { winnerStacks, taxStacks, taxAmount, potValue };
}

module.exports = { readSetting, getTaxRate, getTaxConfig, getTaxRecipient, collectItemTax };
