const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const dbManager = require('../db/dbHelper');
const { baseValueOf, moddedValue, normalizeMods } = require('../lib/petMods');
const { authenticateBot } = require('../middleware/botAuth');
const { addNotification } = require('../notificationService');
const { emitToAll } = require('../realtime');

/**
 * Trade bot API.
 *
 * The one rule that matters here: the client never tells us what something is
 * worth. Every value in this file is read from the server-side item catalog, so
 * a tampered or forged payload can move item quantities around but can never
 * invent credit. If the body contains `value` / `totalValue` fields they are
 * ignored and logged.
 */

const router = express.Router();

const MAX_QTY_PER_LINE = 500;

const botLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'bot',
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many trade bot requests. Slow down.' }
  }
});

router.use(authenticateBot, botLimiter);

const ok = (res, data, message) => res.json({ success: true, data, message });
const fail = (res, status, code, message, extra = {}) =>
  res.status(status).json({ success: false, error: { code, message, ...extra } });

// ── helpers ────────────────────────────────────────────────────────────────

/** Canonical, server-side unit price for a catalog item. */
function priceOf(catalogItem) {
  return moddedValue(baseValueOf(catalogItem), normalizeMods(catalogItem?.mods));
}

function catalog() {
  const itemsDb = dbManager.getItemsDb();
  return Array.isArray(itemsDb?.items) ? itemsDb.items : [];
}

/** Find a catalog entry by our id, or by a Roblox asset id if one is mapped. */
function findCatalogItem(rawId) {
  const wanted = String(rawId || '').trim();
  if (!wanted) return null;
  const lower = wanted.toLowerCase();
  return catalog().find((item) =>
    String(item.id) === wanted
    || (item.robloxAssetId != null && String(item.robloxAssetId) === wanted)
    || String(item.name || '').trim().toLowerCase() === lower
  ) || null;
}

function toStack(catalogItem, quantity) {
  return {
    id: catalogItem.id,
    itemId: catalogItem.id,
    name: catalogItem.name || catalogItem.itemName || 'Item',
    value: priceOf(catalogItem),
    rarity: catalogItem.rarity || 'common',
    image: catalogItem.imageUrl || catalogItem.image || '',
    mods: normalizeMods(catalogItem.mods),
    quantity
  };
}

function findUser(robloxUserId, robloxUsername) {
  const users = dbManager.getUsersDb().users || [];
  if (robloxUserId != null && String(robloxUserId).trim() !== '') {
    const byId = users.find((u) => String(u.robloxUserId) === String(robloxUserId).trim());
    if (byId) return byId;
  }
  if (robloxUsername) {
    const lower = String(robloxUsername).trim().toLowerCase();
    return users.find((u) => String(u.robloxUsername || '').toLowerCase() === lower) || null;
  }
  return null;
}

function botLedger() {
  const db = dbManager.getMainDb();
  if (!Array.isArray(db.tradeBotHeld)) {
    db.tradeBotHeld = [];
    db.tradeBotUpdatedAt = new Date().toISOString();
  }
  return db;
}

function adjustHeld(stacks, sign) {
  const db = botLedger();
  for (const stack of stacks) {
    const row = db.tradeBotHeld.find((h) => h.itemId === stack.itemId);
    if (row) row.quantity = Math.max(0, (row.quantity || 0) + sign * stack.quantity);
    else if (sign > 0) db.tradeBotHeld.push({ itemId: stack.itemId, name: stack.name, quantity: stack.quantity });
  }
  db.tradeBotHeld = db.tradeBotHeld.filter((h) => h.quantity > 0);
  db.tradeBotUpdatedAt = new Date().toISOString();
}

function findTransactionByTradeId(tradeId) {
  const db = dbManager.getMainDb();
  return (db.transactions || []).find((t) => t.tradeId && t.tradeId === tradeId) || null;
}

/** Warn loudly if a caller tried to send us a price. */
function noteIgnoredPrices(body) {
  const sent = [];
  if (body && typeof body === 'object') {
    if (body.totalValue != null) sent.push('totalValue');
    if (Array.isArray(body.items)) {
      body.items.forEach((item, i) => {
        if (item && item.value != null) sent.push(`items[${i}].value`);
      });
    }
  }
  if (sent.length) {
    console.warn(`[trade-bot] ignored client-supplied price field(s): ${sent.join(', ')} - server prices from the catalog only`);
  }
  return sent;
}

// ── POST /deposits ─────────────────────────────────────────────────────────

router.post('/deposits', (req, res) => {
  try {
    const { robloxUserId, robloxUsername, items, tradeId, timestamp } = req.body || {};
    const ignored = noteIgnoredPrices(req.body);

    if (!Array.isArray(items) || items.length === 0) {
      return fail(res, 400, 'ITEMS_REQUIRED', 'items must be a non-empty array of { id, quantity }.');
    }
    if (!tradeId || String(tradeId).length < 4) {
      return fail(res, 400, 'TRADE_ID_REQUIRED', 'tradeId is required so deposits can be de-duplicated.');
    }

    // Idempotency: the same trade must never be credited twice.
    const existing = findTransactionByTradeId(String(tradeId));
    if (existing) {
      console.log(`[trade-bot] duplicate deposit ignored tradeId=${tradeId}`);
      return ok(res, {
        depositId: existing.id,
        totalValue: existing.totalValue,
        duplicate: true
      }, 'Deposit already recorded - nothing changed.');
    }

    const user = findUser(robloxUserId, robloxUsername);
    if (!user) {
      return fail(res, 404, 'USER_NOT_FOUND', 'No account matches that Roblox user. They must sign in on the site first.');
    }

    // Price entirely from the catalog. Unknown ids are a hard failure so a
    // typo can never be silently credited as a 0-value item.
    const priced = [];
    const unknown = [];
    for (const line of items) {
      const qty = Math.max(1, Math.min(MAX_QTY_PER_LINE, parseInt(line?.quantity, 10) || 1));
      const catalogItem = findCatalogItem(line?.id);
      if (!catalogItem) {
        unknown.push(String(line?.id ?? ''));
        continue;
      }
      const stack = toStack(catalogItem, qty);
      priced.push(stack);
    }
    if (unknown.length) {
      return fail(res, 400, 'UNKNOWN_ITEM', 'These item ids are not in the site catalog.', { unknown });
    }

    const totalValue = priced.reduce((sum, stack) => sum + stack.value * stack.quantity, 0);

    // Credit the player's site inventory - the same store that withdraw-items
    // consumes. Cash is deliberately NOT credited as well: doing both would
    // turn every deposit into double the value.
    for (const stack of priced) {
      dbManager.addItemToUserInventory(user.id, stack, stack.quantity);
    }
    adjustHeld(priced, 1);

    const deposit = {
      id: `dep_${uuidv4()}`,
      type: 'deposit',
      userId: user.id,
      robloxUserId: user.robloxUserId,
      robloxUsername: user.robloxUsername,
      tradeId: String(tradeId),
      items: priced,
      totalValue,
      status: 'completed',
      source: 'trade-bot',
      ignoredClientPriceFields: ignored,
      createdAt: new Date().toISOString(),
      reportedAt: timestamp || null
    };

    const db = dbManager.getMainDb();
    db.transactions = db.transactions || [];
    db.transactions.push(deposit);
    dbManager.saveMainDb();
    dbManager.saveUsersDb();

    const inventory = dbManager.getUserInventory(user.id);
    emitToAll('inventoryUpdate', { userId: user.id });

    try {
      addNotification({
        userId: user.id,
        type: 'deposit',
        title: 'Deposit received',
        message: `${priced.length} item line(s) worth ${totalValue.toLocaleString()} AMP were added to your inventory.`
      });
    } catch (e) {
      console.error('[trade-bot] notification failed:', e.message);
    }

    console.log(`[trade-bot] deposit ${deposit.id} user=${user.robloxUsername} lines=${priced.length} value=${totalValue}`);

    return res.status(201).json({
      success: true,
      data: {
        depositId: deposit.id,
        totalValue,
        newInventoryValue: Number(inventory?.totalValue || 0),
        items: priced.map((s) => ({ id: s.itemId, name: s.name, unitValue: s.value, quantity: s.quantity }))
      },
      message: 'Deposit recorded successfully'
    });
  } catch (error) {
    console.error('[trade-bot] deposit failed:', error);
    return fail(res, 500, 'DEPOSIT_FAILED', 'Could not record the deposit.');
  }
});

// ── GET /pending-withdrawal ────────────────────────────────────────────────

router.get('/pending-withdrawal', (req, res) => {
  try {
    const { robloxUsername, robloxUserId } = req.query || {};
    const user = findUser(robloxUserId, robloxUsername);
    if (!user) return fail(res, 404, 'USER_NOT_FOUND', 'No account matches that Roblox user.');

    const db = dbManager.getMainDb();
    // Read-only: oldest pending first. Confirm is what transitions the record,
    // so polling this endpoint can never consume a withdrawal.
    const pending = (db.itemWithdrawals || [])
      .filter((w) => w.userId === user.id && w.status === 'pending')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];

    if (!pending) return ok(res, { hasPendingWithdrawal: false });

    return ok(res, {
      hasPendingWithdrawal: true,
      withdrawalId: pending.id,
      items: (pending.items || []).map((i) => ({ id: i.itemId, name: i.name, quantity: i.quantity || 1 })),
      totalValue: pending.totalValue || 0,
      requestedAt: Math.floor(new Date(pending.createdAt).getTime() / 1000)
    });
  } catch (error) {
    console.error('[trade-bot] pending-withdrawal failed:', error);
    return fail(res, 500, 'PENDING_CHECK_FAILED', 'Could not read pending withdrawals.');
  }
});

// ── POST /withdrawals/confirm ──────────────────────────────────────────────

router.post('/withdrawals/confirm', (req, res) => {
  try {
    const { robloxUserId, robloxUsername, tradeId, withdrawalId } = req.body || {};

    if (!tradeId || String(tradeId).length < 4) {
      return fail(res, 400, 'TRADE_ID_REQUIRED', 'tradeId is required.');
    }

    const already = findTransactionByTradeId(String(tradeId));
    if (already) {
      return ok(res, { withdrawalId: already.withdrawalId, duplicate: true }, 'Withdrawal already confirmed - nothing changed.');
    }

    const user = findUser(robloxUserId, robloxUsername);
    if (!user) return fail(res, 404, 'USER_NOT_FOUND', 'No account matches that Roblox user.');

    const db = dbManager.getMainDb();
    const pool = db.itemWithdrawals || [];
    const target = withdrawalId
      ? pool.find((w) => w.id === withdrawalId && w.userId === user.id)
      : pool
        .filter((w) => w.userId === user.id && w.status === 'pending')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];

    if (!target) return fail(res, 404, 'NO_PENDING_WITHDRAWAL', 'No pending withdrawal for that user.');
    if (target.status === 'completed') {
      return fail(res, 409, 'WITHDRAWAL_ALREADY_COMPLETED', 'That withdrawal was already completed.');
    }
    if (target.status === 'processing') {
      return fail(res, 409, 'WITHDRAWAL_IN_PROGRESS', 'That withdrawal is already being processed.');
    }

    // The items left the player's inventory when the request was created in
    // withdraw-items, so this only closes the record and updates the bot's
    // held count. Nothing is deducted twice.
    const stacks = (target.items || []).map((i) => ({ itemId: i.itemId, name: i.name, quantity: i.quantity || 1 }));
    adjustHeld(stacks, -1);

    target.status = 'completed';
    target.completedAt = new Date().toISOString();
    target.tradeId = String(tradeId);
    target.updatedAt = target.completedAt;

    db.transactions = db.transactions || [];
    db.transactions.push({
      id: uuidv4(),
      type: 'withdrawal',
      userId: user.id,
      robloxUsername: user.robloxUsername,
      tradeId: String(tradeId),
      withdrawalId: target.id,
      items: target.items,
      totalValue: target.totalValue || 0,
      status: 'completed',
      source: 'trade-bot',
      createdAt: new Date().toISOString()
    });

    dbManager.saveMainDb();
    emitToAll('inventoryUpdate', { userId: user.id });

    try {
      addNotification({
        userId: user.id,
        type: 'withdrawal',
        title: 'Withdrawal complete',
        message: 'Your items have been sent. Enjoy!'
      });
    } catch (e) {
      console.error('[trade-bot] notification failed:', e.message);
    }

    console.log(`[trade-bot] withdrawal ${target.id} completed user=${user.robloxUsername} tradeId=${tradeId}`);

    return ok(res, { withdrawalId: target.id, totalValue: target.totalValue || 0 }, 'Withdrawal confirmed and completed');
  } catch (error) {
    console.error('[trade-bot] confirm failed:', error);
    return fail(res, 500, 'CONFIRM_FAILED', 'Could not confirm the withdrawal.');
  }
});

// ── GET /inventory ─────────────────────────────────────────────────────────

router.get('/inventory', (req, res) => {
  try {
    const db = botLedger();
    const items = catalog();
    const inventory = db.tradeBotHeld.map((held) => {
      const catalogItem = items.find((i) => String(i.id) === String(held.itemId));
      return {
        id: held.itemId,
        name: held.name || catalogItem?.name || 'Item',
        quantity: held.quantity || 0,
        value: catalogItem ? priceOf(catalogItem) : 0
      };
    });
    return ok(res, {
      inventory,
      lastUpdated: db.tradeBotUpdatedAt || null
    });
  } catch (error) {
    console.error('[trade-bot] inventory failed:', error);
    return fail(res, 500, 'INVENTORY_FAILED', 'Could not read bot inventory.');
  }
});

// ── GET /catalog ───────────────────────────────────────────────────────────
// Lets the bot resolve a Roblox asset to your site item and price it without
// ever being trusted for the number.

router.get('/catalog', (req, res) => {
  try {
    const items = catalog().map((item) => ({
      id: item.id,
      robloxAssetId: item.robloxAssetId ?? null,
      name: item.name || item.itemName,
      rarity: item.rarity || 'common',
      mods: normalizeMods(item.mods),
      value: priceOf(item)
    }));
    return ok(res, { count: items.length, items });
  } catch (error) {
    console.error('[trade-bot] catalog failed:', error);
    return fail(res, 500, 'CATALOG_FAILED', 'Could not read the catalog.');
  }
});

module.exports = router;
