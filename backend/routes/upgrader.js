// Upgrader - risk your pets for an upgrade, or lose them.
//
// How a round works:
//   * The player stages pets worth P (the pot). These are AT RISK.
//   * The admin keeps the upgrader stocked with pets to pay out with.
//   * The player picks an upgradee (or several) out of that stock.
//   * A weighted roll decides the outcome. The chance is capped at 60%.
//
// A win CONSUMES the pot and replaces it with the upgradee - your pets come
// back better than they went in. A loss takes the pot and gives nothing; the
// pot goes onto the house shelf and becomes stock for somebody else's payout.
//
// House edge: the multiplier is DERIVED from the served chance rather than
// chosen freely, so that
//     chance x multiplier = 1 - HOUSE_EDGE = 0.90
// holds for every round regardless of what the player asked for. Because the
// pot is consumed either way, expected return is exactly 90% of what was put in
// and the edge is exactly 10%. Asking for 70% is served at the 60% ceiling,
// which only changes the shape of the game (a smaller chance carries a bigger
// payout), never the edge.
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { getTaxConfig, getTaxRecipient, collectItemTax } = require('../taxUtil');
const { emitToAll, emitToUser } = require('../realtime');
const { addNotification } = require('../notificationService');

const MAX_WIN_PERCENT = 60;
const HOUSE_EDGE = 0.10;
const RETURN_RATE = 1 - HOUSE_EDGE; // 0.90 - what a win must be worth on average
const MAX_ROUNDS_KEPT = 50;
// How far past the bonus target the cheapest-pet fallback may reach before the
// round is refused outright. Keeps a coarse shelf from paying out multiples of
// what was advertised.
const MAX_PAYOUT_OVERSHOOT = 1.25;

/**
 * The canonical value for an item, straight from the catalog.
 *
 * dbManager.addItemToUserInventory merges stacks by itemId and keeps whatever
 * value the FIRST stack happened to carry. If two stacks of the same pet were
 * cached with different values, merging them silently creates or destroys
 * value. Every stack this route moves is therefore stamped with the catalog
 * value, so all stacks of a pet always agree and merges conserve value.
 */
function catalogValue(itemId) {
  try {
    const itemsDb = dbManager.getItemsDb();
    const hit = (itemsDb.items || []).find((i) => String(i.id) === String(itemId) || String(i.itemId) === String(itemId));
    const n = hit && Number(hit.value);
    if (Number.isFinite(n)) return n;
  } catch { /* fall through to the caller's value */ }
  return null;
}

const stamp = (stack, fallback) => {
  const v = catalogValue(stack.itemId);
  return v === null ? { ...stack, value: Number(fallback) || 0 } : { ...stack, value: v };
};

/**
 * Credit a stack to a user without creating or destroying value.
 *
 * dbManager.addItemToUserInventory merges by itemId and keeps whatever value the
 * FIRST stack happened to carry, so crediting a catalog-priced pet into a stack
 * that was created with a stale or missing value mints (or burns) value. Align
 * the existing stack to the catalog value first, then add.
 */
function credit(userId, stack, qty) {
  const want = stamp(stack, stack.value).value;
  try {
    const inv = dbManager.getUserInventory(userId);
    const same = (inv.items || []).find((i) => String(i.itemId || i.id) === String(stack.itemId));
    if (same && Number(same.value) !== Number(want)) same.value = want;
  } catch { /* fall through to the plain credit */ }
  dbManager.addItemToUserInventory(userId, { ...stack, value: want }, qty);
}

/**
 * Take `qty` of itemId out of a user's inventory and return it stamped at the
 * catalog value, or null if they do not have it.
 *
 * The stack is revalued BEFORE the removal. Everything this route pays out or
 * restocks is priced at the catalog, so if the outgoing stack kept a stale
 * value the pot would be valued one way and credited back another, quietly
 * minting or burning value on every round.
 */
function debit(userId, itemId, qty) {
  const want = Math.max(1, parseInt(qty || 1, 10) || 1);
  const inv = dbManager.getUserInventory(userId);
  const stack = (inv.items || []).find((i) => String(i.itemId || i.id) === String(itemId));
  if (!stack || (stack.quantity || 0) < want) return null;
  const cv = catalogValue(itemId);
  if (cv !== null && Number(stack.value) !== cv) stack.value = cv;
  dbManager.removeItemFromUserInventory(userId, itemId, want);
  return {
    itemId: String(itemId),
    name: stack.name || stack.itemName || 'Item',
    rarity: stack.rarity || 'common',
    image: stack.image || stack.imageUrl || '',
    value: cv === null ? Number(stack.value) || 0 : cv,
    quantity: want
  };
}

function getStore() {
  const db = dbManager.getMainDb();
  if (!db.upgrader || typeof db.upgrader !== 'object') db.upgrader = {};
  if (!Array.isArray(db.upgrader.stock)) db.upgrader.stock = [];
  if (!Array.isArray(db.upgrader.rounds)) db.upgrader.rounds = [];
  if (!('active' in db.upgrader)) db.upgrader.active = null;
  return db.upgrader;
}

const totalValue = (stacks) => (Array.isArray(stacks) ? stacks : [])
  .reduce((s, it) => s + ((Number(it.value) || 0) * (Number(it.quantity) || 1)), 0);
const totalUnits = (stacks) => (Array.isArray(stacks) ? stacks : [])
  .reduce((s, it) => s + Math.max(1, parseInt(it.quantity || 1, 10) || 1), 0);

/** The chance actually served - the ceiling is what makes the edge real. */
function effectiveChance(requestedPercent) {
  const asked = Number(requestedPercent);
  const safe = Number.isFinite(asked) ? Math.max(0, asked) : 0;
  return Math.min(MAX_WIN_PERCENT, safe);
}

/**
 * The BONUS a win adds on top of the pot, as a multiple of the pot.
 *
 * The player gets their own pets back plus this bonus, and the bonus is taxed
 * like any other payout. So the size is derived so that
 *     chance x (1 + bonus x (1 - tax)) = RETURN_RATE
 * which makes the player's expected return exactly 90% of the pot - a true 10%
 * house edge - at every chance level, whether or not the request was capped.
 *
 * Folding the tax in matters. Leaving it out would mean the advertised 1.5x at
 * a 60% chance actually nets the player ~86%, and the edge would silently grow
 * as the chance fell (a 30% chance pays a bigger bonus, so more of it is taxed).
 * Deriving it also means a win can never be a loss: the floor is the pot back.
 */
function multiplierFor(chance, taxRate) {
  if (!(chance > 0)) return 0;
  const keep = 1 - Math.min(Math.max(Number(taxRate) || 0, 0), 0.95);
  return (RETURN_RATE / (chance / 100) - 1) / Math.max(keep, 0.05);
}

/** Weighted roll at exactly the advertised chance - deterministic for audit. */
function rollWin(percent, seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest();
  const n = h.readUInt32BE(0) / 0xffffffff; // 0..1
  return n * 100 < percent;
}

/**
 * Choose units from the upgradee stock worth as close to `target` as possible
 * WITHOUT ever exceeding it. Exceeding the target would quietly hand back the
 * house edge, so the greedy fill tops up small-to-large and stops short
 * rather than overshooting. The shortfall is reported to the player honestly.
 *
 * If nothing at all fits - the bonus is smaller than the cheapest pet on the
 * shelf - the single cheapest unit is taken, so a win is never worth nothing.
 * /round refuses a selection where that would overshoot badly, so this
 * fallback can only ever hand out one modest unit.
 */
function buildPayout(upgradees, targetValue) {
  const units = [];
  (upgradees || []).forEach((st, i) => {
    const qty = Math.max(1, parseInt(st.quantity || 1, 10) || 1);
    for (let k = 0; k < qty; k++) units.push({ index: i, value: Number(st.value || 0) });
  });
  if (!units.length) return [];
  units.sort((a, b) => b.value - a.value);

  const take = {};
  let gained = 0;
  // Big-to-small: take everything that still fits.
  for (const u of units) {
    if (gained + u.value <= targetValue) {
      take[u.index] = (take[u.index] || 0) + 1;
      gained += u.value;
    }
    if (gained >= targetValue) break;
  }
  // Top-up pass: anything skipped that now fits closes most of the gap.
  if (gained < targetValue) {
    for (const u of units) {
      if (gained >= targetValue) break;
      const already = take[u.index] || 0;
      if ((upgradees[u.index].quantity || 1) - already <= 0) continue;
      if (gained + u.value <= targetValue) {
        take[u.index] = already + 1;
        gained += u.value;
      }
    }
  }

  // Nothing fits at all: pay the cheapest single unit so a win is not worthless.
  if (gained <= 0) {
    const cheapest = units[units.length - 1];
    take[cheapest.index] = (take[cheapest.index] || 0) + 1;
  }

  const payout = [];
  (upgradees || []).forEach((st, i) => {
    const qty = take[i] || 0;
    if (qty > 0) payout.push({ ...st, quantity: qty });
  });
  return payout;
}

/**
 * What is left of the reserved upgradees once `paid` has been handed out.
 *
 * `paid` is matched against the reserved stacks IN ORDER. Subtracting the paid
 * quantity from every stack that shares an itemId instead would lose a unit per
 * extra stack, which quietly destroyed pets on any round where the shelf held
 * two stacks of the same pet.
 */
function leftoverStacks(reserved, paid) {
  const owed = new Map();
  for (const p of paid || []) {
    owed.set(String(p.itemId), (owed.get(String(p.itemId)) || 0) + (p.quantity || 1));
  }
  const leftovers = [];
  for (const u of reserved || []) {
    const key = String(u.itemId);
    const qty = Number(u.quantity) || 1;
    const use = Math.min(qty, owed.get(key) || 0);
    owed.set(key, (owed.get(key) || 0) - use);
    const left = qty - use;
    if (left > 0) leftovers.push({ ...u, quantity: left });
  }
  return leftovers;
}

/** Cheapest single unit in a set of stacks. */
function cheapestUnit(stacks) {
  let min = Infinity;
  for (const st of stacks || []) {
    const v = Number(st.value) || 0;
    if (v > 0 && v < min) min = v;
  }
  return min === Infinity ? 0 : min;
}

/**
 * Move up to `qty` of itemId out of the house stock.
 * Returns the stacks that were actually consumed, so the caller reserves the
 * real name/value rather than trusting the client or assuming one price.
 */
function takeFromStock(store, itemId, qty) {
  const taken = [];
  let remaining = qty;
  for (let i = store.stock.length - 1; i >= 0 && remaining > 0; i--) {
    if (String(store.stock[i].itemId) !== String(itemId)) continue;
    const take = Math.min(remaining, store.stock[i].quantity || 1);
    taken.push(stamp({ ...store.stock[i], quantity: take }));
    store.stock[i].quantity -= take;
    remaining -= take;
    if (store.stock[i].quantity <= 0) store.stock.splice(i, 1);
  }
  return taken;
}

/** Put stacks back on the house shelf. */
function restock(store, stacks) {
  for (const st of stacks || []) {
    if (!st || !(Number(st.quantity) > 0)) continue;
    const existing = store.stock.find(
      (s) => String(s.itemId) === String(st.itemId) && Number(s.value) === Number(st.value)
    );
    if (existing) {
      existing.quantity = (existing.quantity || 1) + st.quantity;
    } else {
      store.stock.push(stamp(st));
    }
  }
}

function formatRound(round) {
  if (!round) return null;
  return {
    id: round.id,
    status: round.status,
    userId: round.userId,
    username: round.username,
    avatar: round.avatar,
    potItems: round.potItems,
    potValue: round.potValue,
    upgradeeItems: round.upgradeeItems,
    upgradeeValue: totalValue(round.upgradeeItems),
    requestedPercent: round.requestedPercent,
    chance: round.chance,
    capped: round.requestedPercent > MAX_WIN_PERCENT,
    multiplier: round.multiplier,
    totalMultiplier: 1 + (round.multiplier || 0),
    targetValue: round.targetValue,
    houseEdge: HOUSE_EDGE,
    maxWinPercent: MAX_WIN_PERCENT,
    won: round.won,
    payout: round.payout,
    payoutValue: round.payoutValue,
    potBack: round.potBack || [],
    netValue: totalValue(round.potBack || []) + round.payoutValue,
    achievedPercent: round.potValue > 0 ? (round.payoutValue / round.potValue) * 100 : 0,
    taxAmount: round.taxAmount || 0,
    createdAt: round.createdAt,
    resolvedAt: round.resolvedAt
  };
}

// ── Admin: stock the upgrader ──────────────────────────────────────────────
router.post('/stock', authenticateAdmin, (req, res) => {
  try {
    const { selectedItems } = req.body || {};
    if (!Array.isArray(selectedItems) || !selectedItems.length) {
      return res.status(400).json({ message: 'Select at least one item to add to stock' });
    }
    const user = dbManager.getUsersDb().users.find((u) => u.id === req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const store = getStore();
    const taken = [];
    for (const sel of selectedItems) {
      const itemId = sel.itemId || sel.id;
      const qty = Math.max(1, parseInt(sel.quantity || 1, 10) || 1);
      const takenStack = debit(user.id, itemId, qty);
      if (!takenStack) {
        // put back anything already taken before refusing
        for (const st of taken) credit(user.id, st, st.quantity);
        return res.status(400).json({ message: `You do not have ${qty}x of ${sel.name || itemId}` });
      }
      taken.push(takenStack);
    }
    store.stock.push(...taken);
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    emitToAll('upgraderUpdate', { active: formatRound(store.active), stockValue: totalValue(store.stock) });
    res.json({ stock: store.stock, stockValue: totalValue(store.stock) });
  } catch (err) {
    console.error('Upgrader stock error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/stock', authenticateToken, (req, res) => {
  const store = getStore();
  res.json({ stock: store.stock, stockValue: totalValue(store.stock), stockUnits: totalUnits(store.stock) });
});

// ── Player: start a round ──────────────────────────────────────────────────
router.post('/round', authenticateToken, (req, res) => {
  try {
    const { potItems: potSel, upgradeeItems: upSel, targetPercent } = req.body || {};
    if (!Array.isArray(potSel) || !potSel.length) return res.status(400).json({ message: 'Select the pets you want to risk' });
    if (!Array.isArray(upSel) || !upSel.length) return res.status(400).json({ message: 'Select the upgrade you want' });

    const user = dbManager.getUsersDb().users.find((u) => u.id === req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const store = getStore();
    if (store.active && ['pending', 'spinning'].includes(store.active.status)) {
      return res.status(409).json({ message: 'Finish your current upgrade first' });
    }

    // The pot comes out of the player's own inventory.
    const taken = [];
    const rollback = () => {
      for (const st of taken) credit(user.id, st, st.quantity);
      dbManager.saveUsersDb();
    };
    try {
      for (const sel of potSel) {
        const itemId = sel.itemId || sel.id;
        const qty = Math.max(1, parseInt(sel.quantity || 1, 10) || 1);
        const takenStack = debit(user.id, itemId, qty);
        if (!takenStack) throw new Error(`You do not have ${qty}x of ${sel.name || itemId}`);
        taken.push(takenStack);
      }
    } catch (e) {
      rollback();
      return res.status(400).json({ message: e.message });
    }

    const potValue = totalValue(taken);
    if (potValue <= 0) {
      rollback();
      return res.status(400).json({ message: 'The pets you are upgrading must be worth something' });
    }

    const chance = effectiveChance(targetPercent);
    if (chance <= 0) {
      rollback();
      return res.status(400).json({ message: 'Pick a win chance above 0%' });
    }
    const multiplier = multiplierFor(chance, getTaxConfig().rate);
    const targetValue = potValue * multiplier;

    // The upgradee must come off the house shelf, not the player's pocket.
    const reserved = [];
    for (const sel of upSel) {
      const itemId = sel.itemId || sel.id;
      const wantQty = Math.max(1, parseInt(sel.quantity || 1, 10) || 1);
      const matches = store.stock.filter((s) => String(s.itemId) === String(itemId));
      const available = matches.reduce((s, x) => s + (x.quantity || 1), 0);
      if (available <= 0) {
        restock(store, reserved);
        rollback();
        return res.status(400).json({ message: `The upgrader is out of ${sel.name || itemId}` });
      }
      // Reserving exactly what left the shelf keeps the payout honest even if
      // the same item sits on the shelf at two different values, and never
      // trusts the name/value the client sent.
      const qty = Math.min(wantQty, available);
      for (const c of takeFromStock(store, itemId, qty)) reserved.push(c);
    }
    if (!reserved.length) {
      rollback();
      return res.status(400).json({ message: 'The upgrader is out of stock for that selection' });
    }

    // A win has to be able to pay the full multiplier. If the chosen upgradee
    // cannot cover the target the player would "win" and still walk away with
    // nothing, so refuse it here instead of burning their pot on a hollow win.
    const reservedValue = totalValue(reserved);
    if (reservedValue < targetValue) {
      restock(store, reserved);
      rollback();
      return res.status(400).json({
        message: `That upgrade is worth ${Math.round(reservedValue).toLocaleString()} but a ${chance}% win pays `
          + `${Math.round(targetValue).toLocaleString()}. Pick something worth at least that.`
      });
    }

    // The fallback in buildPayout pays the single cheapest unit when the bonus
    // is smaller than anything on offer. Allow that only within a sane margin,
    // otherwise the round would quietly pay far more than it advertised.
    const cheapest = cheapestUnit(reserved);
    if (cheapest > targetValue * MAX_PAYOUT_OVERSHOOT) {
      restock(store, reserved);
      rollback();
      return res.status(400).json({
        message: `The upgrader's cheapest pet is worth ${cheapest.toLocaleString()}, too much to pay a `
          + `${Math.round(targetValue).toLocaleString()} upgrade. Raise your win chance to pay less, `
          + 'or ask an admin to stock smaller pets.'
      });
    }

    const round = {
      id: uuidv4(),
      status: 'pending',
      userId: user.id,
      username: user.displayName || user.robloxUsername,
      avatar: user.avatar || '',
      potItems: taken,
      potValue,
      upgradeeItems: reserved,
      requestedPercent: Number(targetPercent) || 0,
      chance,
      multiplier,
      targetValue,
      houseEdge: HOUSE_EDGE,
      maxWinPercent: MAX_WIN_PERCENT,
      won: null,
      payout: [],
      payoutValue: 0,
      taxAmount: 0,
      rollSeed: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null
    };
    store.active = round;
    store.rounds.unshift(round);
    store.rounds = store.rounds.slice(0, MAX_ROUNDS_KEPT);
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    emitToAll('upgraderUpdate', { active: formatRound(round), stockValue: totalValue(store.stock) });
    res.status(201).json(formatRound(round));
  } catch (err) {
    console.error('Upgrader round error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * The roll and the payout are both decided and persisted HERE, before the
 * client animates anything, so a client cannot nudge the outcome by re-rolling
 * or by claiming without paying out.
 */
router.post('/round/:id/roll', authenticateToken, (req, res) => {
  try {
    const store = getStore();
    const round = store.active;
    if (!round || round.id !== req.params.id) return res.status(404).json({ message: 'No upgrade in progress' });
    if (round.status !== 'pending') return res.json(formatRound(round));
    if (round.userId !== req.user.userId) return res.status(403).json({ message: 'That is not your upgrade' });

    const seed = `${round.id}:${round.potValue}:${round.chance}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
    round.rollSeed = seed;
    round.won = rollWin(round.chance, seed);
    round.status = 'spinning';
    round.resolvedAt = new Date().toISOString();

    if (round.won) {
      // The pot is spent; what comes back is the upgrade, built from the
      // reserved stock up to the target. Tax is then taken off the payout,
      // exactly like every other game.
      let payout = buildPayout(round.upgradeeItems, round.targetValue);
      const tax = getTaxConfig();
      if (tax.rate > 0 && payout.length) {
        const split = collectItemTax(payout, tax.rate);
        payout = split.winnerStacks;
        round.taxItems = split.taxStacks;
        round.taxAmount = split.taxAmount;
      } else {
        round.taxItems = [];
        round.taxAmount = 0;
      }
      round.payout = payout;
      round.payoutValue = totalValue(payout);
      // The pot comes back untouched - the upgrade is the bonus on top, so a
      // win is never a loss. Nothing is restocked here.
      round.potBack = round.potItems;
    } else {
      round.taxItems = [];
      round.taxAmount = 0;
      round.payout = [];
      round.payoutValue = 0;
      round.potBack = [];
      // A loss really costs the pot - it becomes the house's stock.
      restock(store, round.potItems);
      // Nothing was paid out, so the reserved upgradees were never really
      // spent. They must go back on the shelf or the house destroys its own
      // stock on every loss.
      restock(store, round.upgradeeItems);
    }
    dbManager.saveMainDb();
    dbManager.saveUsersDb();

    res.json(formatRound(round));
  } catch (err) {
    console.error('Upgrader roll error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/** Client confirms the wheel has stopped; items actually move now. */
router.post('/round/:id/claim', authenticateToken, (req, res) => {
  try {
    const store = getStore();
    const round = store.active;
    if (!round || round.id !== req.params.id) return res.status(404).json({ message: 'No upgrade in progress' });
    if (round.userId !== req.user.userId) return res.status(403).json({ message: 'That is not your upgrade' });
    if (round.status === 'settled') return res.json(formatRound(round));
    if (round.status !== 'spinning') return res.status(409).json({ message: 'Roll the wheel first' });

    if (round.won) {
      // Pot back first, then the upgrade on top.
      for (const p of round.potBack || []) credit(round.userId, p, p.quantity || 1);
      for (const p of round.payout || []) credit(round.userId, p, p.quantity || 1);
      const recipient = getTaxRecipient();
      for (const t of round.taxItems || []) {
        if (recipient) credit(recipient.id, t, t.quantity || 1);
        else restock(store, [t]); // no tax pot configured - it stays on the shelf
      }
      // Whatever of the reserved upgradees was NOT paid out goes back on the
      // shelf. Matching in order is what keeps duplicate itemIds honest.
      //
      // The tax units left the reserved set too, so they have to be counted as
      // consumed here even though they were split off before round.payout was
      // narrowed to the winner's stacks. Comparing against round.payout alone
      // would hand the tax units back a second time and duplicate pets.
      const consumed = [...(round.payout || []), ...(round.taxItems || [])];
      restock(store, leftoverStacks(round.upgradeeItems, consumed));
    }
    // A loss already restocked the pot inside /roll, so nothing moves here.

    round.status = 'settled';
    round.settledAt = new Date().toISOString();
    store.active = null;
    dbManager.saveMainDb();
    dbManager.saveUsersDb();

    addNotification({
      userId: round.userId,
      type: round.won ? 'reward' : 'info',
      title: round.won ? 'Upgrade successful' : 'Upgrade failed',
      message: round.won
        ? `Upgraded ${round.potValue.toLocaleString()} AMP into ${round.payoutValue.toLocaleString()} AMP.`
        : `Lost ${round.potValue.toLocaleString()} AMP on the upgrade. Better luck next time.`
    });
    emitToUser(round.userId, 'inventoryUpdate', { userId: round.userId });
    emitToAll('upgraderUpdate', { active: null, stockValue: totalValue(store.stock) });

    res.json(formatRound(round));
  } catch (err) {
    console.error('Upgrader claim error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/state', authenticateToken, (req, res) => {
  const store = getStore();
  res.json({
    active: formatRound(store.active),
    // the full shelf, so the client can let the player pick an upgrade
    stock: store.stock,
    stockValue: totalValue(store.stock),
    stockUnits: totalUnits(store.stock),
    houseEdge: HOUSE_EDGE,
    maxWinPercent: MAX_WIN_PERCENT,
    taxRate: getTaxConfig().rate,
    history: store.rounds.slice(0, 20).map(formatRound)
  });
});

module.exports = router;
// Exported for tests: the cap, the derived multiplier, the roll and the
// payout are the parts that decide whether the game is fair.
module.exports.MAX_WIN_PERCENT = MAX_WIN_PERCENT;
module.exports.HOUSE_EDGE = HOUSE_EDGE;
module.exports.RETURN_RATE = RETURN_RATE;
module.exports.effectiveChance = effectiveChance;
module.exports.multiplierFor = multiplierFor;
module.exports.rollWin = rollWin;
module.exports.buildPayout = buildPayout;
module.exports.cheapestUnit = cheapestUnit;
module.exports.leftoverStacks = leftoverStacks;
module.exports.totalValue = totalValue;
