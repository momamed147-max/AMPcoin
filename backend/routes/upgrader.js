// Upgrader - risk your pets for an upgrade, or lose them.
//
// How a round works:
//   * The player picks the pets they are risking (the pot).
//   * The player picks the pets they want BACK, out of the house shelf.
//   * The game works out the multiplier and derives the odds from it.
//
// The player never sets a chance. They choose a target and the maths follows:
//
//     multiplier = upgradeValue / potValue        (1000 in, 2100 back = 2.1x)
//     chance     = (100 - houseEdge%) / multiplier (90 / 2.1 = 42.86%)
//
// so expected return is always exactly 90% of the pot and the house edge is
// exactly 10%, whatever the player picks. The chance is capped at 60%, which
// sets the smallest useful multiplier at 90/60 = 1.5x - anything below that
// would need odds above the cap, so it is refused rather than quietly paid less
// than the player asked for.
//
// A win CONSUMES the pot and pays the selected upgrade. A loss takes the pot
// and pays nothing. Either way the pot lands on the house shelf and becomes
// stock for somebody else's payout.
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
// The smallest multiplier that still fits under the 60% cap.
const MIN_MULTIPLIER = (RETURN_RATE * 100) / MAX_WIN_PERCENT; // 1.5
// Only one round runs at a time, so a player who starts one and closes the tab
// would otherwise block the whole upgrader permanently. Anything older than
// this is treated as abandoned: the pot comes back and the reserved upgradees
// go back on the shelf.
const ABANDONED_AFTER_MS = 5 * 60 * 1000;

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

// The shelf can accumulate two rows for the same catalog item across restocks.
// The UI selects by itemId, so expose one aggregated row per item; otherwise a
// duplicate itemId generated duplicate React keys and a quantity box that only
// counted one of the two stacks.
function mergeStockRows(stacks) {
  const byId = new Map();
  for (const raw of stacks || []) {
    const itemId = String(raw.itemId || raw.id || '');
    if (!itemId) continue;
    const qty = Math.max(1, parseInt(raw.quantity || 1, 10) || 1);
    const hit = byId.get(itemId);
    if (hit) {
      hit.quantity += qty;
    } else {
      byId.set(itemId, { ...raw, itemId, quantity: qty });
    }
  }
  return [...byId.values()];
}

const ampText = (n) => (Number(n) || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/** The multiplier a given upgrade selection represents. */
function multiplierFor(potValue, upgradeValue) {
  if (!(potValue > 0)) return 0;
  return upgradeValue / potValue;
}

/**
 * The odds the game offers for a multiplier: (100 - houseEdge) / multiplier.
 * 1000 in for 2100 back is 2.1x, and 90 / 2.1 = 42.86%.
 * Capped at MAX_WIN_PERCENT, which is why 1.5x is the smallest playable target.
 */
function chanceForMultiplier(mult) {
  if (!(mult > 0)) return 0;
  return Math.min(MAX_WIN_PERCENT, (RETURN_RATE * 100) / mult);
}

/** Weighted roll at exactly the advertised chance - deterministic for audit. */
function rollWin(percent, seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest();
  const n = h.readUInt32BE(0) / 0xffffffff; // 0..1
  return n * 100 < percent;
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
 * Free an abandoned round so it cannot wedge the upgrader for everybody.
 * Everything the round was holding is handed straight back: the pot to its
 * owner, the reserved upgradees to the shelf. Nothing is decided either way,
 * so nobody is charged for closing their tab.
 */
function reclaimAbandoned(store) {
  const active = store.active;
  if (!active) return null;
  const startedAt = new Date(active.createdAt || 0).getTime();
  if (!startedAt || Date.now() - startedAt < ABANDONED_AFTER_MS) return null;

  // A round that never rolled still owns the pot and the reserved upgrade.
  // A round that DID roll already moved both: /roll puts the pot on the shelf
  // and either pays the win (awaiting claim) or restocks the reserved upgrade
  // on a loss. Reclaiming those a second time duplicated every item, which was
  // both a free-pets bug and a way to get the pot back after losing.
  if (active.status === 'pending') {
    for (const st of active.potItems || []) credit(active.userId, st, st.quantity || 1);
    restock(store, active.upgradeeItems);
    active.status = 'abandoned';
  } else if (active.status === 'spinning') {
    if (active.won) {
      for (const st of active.payout || []) credit(active.userId, st, st.quantity || 1);
      const recipient = getTaxRecipient();
      for (const st of active.taxItems || []) {
        if (recipient) credit(recipient.id, st, st.quantity || 1);
        else restock(store, [st]);
      }
    }
    active.status = 'settled';
    emitToUser(active.userId, 'inventoryUpdate', { userId: active.userId });
  } else {
    return null;
  }

  active.resolvedAt = new Date().toISOString();
  store.active = null;
  dbManager.saveMainDb();
  dbManager.saveUsersDb();
  emitToAll('upgraderUpdate', { active: null, stockValue: totalValue(store.stock) });
  console.warn(`Upgrader: reclaimed abandoned round ${active.id} from ${active.username}`);
  return active;
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
    upgradeeValue: round.upgradeeValue || totalValue(round.upgradeeItems),
    multiplier: round.multiplier,
    chance: round.chance,
    houseEdge: HOUSE_EDGE,
    maxWinPercent: MAX_WIN_PERCENT,
    minMultiplier: MIN_MULTIPLIER,
    won: round.won,
    payout: round.payout,
    payoutValue: round.payoutValue,
    netValue: round.payoutValue,
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
    res.json({ stock: mergeStockRows(store.stock), stockValue: totalValue(store.stock) });
  } catch (err) {
    console.error('Upgrader stock error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/stock', authenticateToken, (req, res) => {
  const store = getStore();
  res.json({ stock: mergeStockRows(store.stock), stockValue: totalValue(store.stock), stockUnits: totalUnits(store.stock) });
});

// ── Player: start a round ──────────────────────────────────────────────────
router.post('/round', authenticateToken, (req, res) => {
  try {
    const { potItems: potSel, upgradeeItems: upSel } = req.body || {};
    if (!Array.isArray(potSel) || !potSel.length) return res.status(400).json({ message: 'Select the pets you want to risk' });
    if (!Array.isArray(upSel) || !upSel.length) return res.status(400).json({ message: 'Select the upgrade you want' });

    const user = dbManager.getUsersDb().users.find((u) => u.id === req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const store = getStore();
    reclaimAbandoned(store);
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

    // The upgradee must come off the house shelf, not the player's pocket.
    const reserved = [];
    for (const sel of upSel) {
      const itemId = sel.itemId || sel.id;
      const wantQty = Math.max(1, parseInt(sel.quantity || 1, 10) || 1);
      const matches = store.stock.filter((s) => String(s.itemId) === String(itemId));
      const available = matches.reduce((s, x) => s + (x.quantity || 1), 0);
      if (available < wantQty) {
        restock(store, reserved);
        rollback();
        return res.status(400).json({
          message: available <= 0
            ? `The upgrader is out of ${sel.name || itemId}`
            : `Only ${available} of ${sel.name || itemId} are on the shelf. Pick ${available} or fewer.`
        });
      }
      // Reserve exactly what the player selected. Paying a different amount
      // because the shelf changed under them would make the odds and the
      // advertised "you get back" value a lie.
      for (const c of takeFromStock(store, itemId, wantQty)) reserved.push(c);
    }
    if (!reserved.length) {
      rollback();
      return res.status(400).json({ message: 'The upgrader is out of stock for that selection' });
    }

    // The player picks the upgrade; the odds follow from the ratio. Below 1.5x
    // the odds needed to hold a 10% edge would beat the 60% cap, so refuse
    // rather than quietly paying less than they selected.
    const upgradeValue = totalValue(reserved);
    const multiplier = multiplierFor(potValue, upgradeValue);
    if (multiplier < MIN_MULTIPLIER) {
      restock(store, reserved);
      rollback();
      // Show the UNCAPPED odds, otherwise a hopeless selection reads as
      // "needs 60% but the maximum is 60%".
      const needed = (RETURN_RATE * 100) / multiplier;
      const wantedValue = ampText(potValue * MIN_MULTIPLIER);
      const short = upgradeValue < Math.round(potValue * MIN_MULTIPLIER) * 0.999;
      return res.status(400).json({
        message: short
          ? `Only ${ampText(upgradeValue)} of that upgrade is on the shelf, which is `
            + `${multiplier.toFixed(2)}x your pot. You need at least ${wantedValue} (${MIN_MULTIPLIER}x) `
            + 'to be playable.'
          : `That upgrade is ${multiplier.toFixed(2)}x your pot, which would need ${needed.toFixed(1)}% `
            + `to win, but the maximum is ${MAX_WIN_PERCENT}%. Pick something worth at least ${wantedValue}.`,
        potValue,
        available: upgradeValue,
        required: Math.round(potValue * MIN_MULTIPLIER),
        multiplier
      });
    }

    const chance = chanceForMultiplier(multiplier);

    const round = {
      id: uuidv4(),
      status: 'pending',
      userId: user.id,
      username: user.displayName || user.robloxUsername,
      avatar: user.avatar || '',
      potItems: taken,
      potValue,
      upgradeeItems: reserved,
      upgradeeValue: upgradeValue,
      multiplier,
      chance,
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
      // The player gets exactly the upgrade they picked. Tax is then taken off
      // the payout, exactly like every other game on the site.
      const tax = getTaxConfig();
      let payout = round.upgradeeItems;
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
    } else {
      round.taxItems = [];
      round.taxAmount = 0;
      round.payout = [];
      round.payoutValue = 0;
      // Nothing was paid out, so the reserved upgradees were never really
      // spent. They go back on the shelf or the house destroys its own stock.
      restock(store, round.upgradeeItems);
    }
    // Either way the pot is spent and becomes house stock. This is the whole
    // point of the game: 1000 in, 2100 back or nothing at all.
    restock(store, round.potItems);
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
      // The upgrade only. The pot was already moved to the house shelf in /roll.
      for (const p of round.payout || []) credit(round.userId, p, p.quantity || 1);
      const recipient = getTaxRecipient();
      for (const t of round.taxItems || []) {
        if (recipient) credit(recipient.id, t, t.quantity || 1);
        else restock(store, [t]); // no tax pot configured - it stays on the shelf
      }
    }
    // A loss already restocked the reserved upgradees and the pot in /roll,
    // so nothing else moves here.

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
        ? `Upgraded ${ampText(round.potValue)} AMP into ${ampText(round.payoutValue)} AMP at ${Math.round(round.chance)}%.`
        : `Lost ${ampText(round.potValue)} AMP on the upgrade. Better luck next time.`
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
  reclaimAbandoned(store);
  res.json({
    active: formatRound(store.active),
    // the full shelf, so the client can let the player pick an upgrade
    stock: mergeStockRows(store.stock),
    stockValue: totalValue(store.stock),
    stockUnits: totalUnits(store.stock),
    houseEdge: HOUSE_EDGE,
    maxWinPercent: MAX_WIN_PERCENT,
    minMultiplier: MIN_MULTIPLIER,
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
module.exports.MIN_MULTIPLIER = MIN_MULTIPLIER;
module.exports.multiplierFor = multiplierFor;
module.exports.chanceForMultiplier = chanceForMultiplier;
module.exports.rollWin = rollWin;
module.exports.cheapestUnit = cheapestUnit;
module.exports.totalValue = totalValue;
