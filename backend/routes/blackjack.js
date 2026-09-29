const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { getTaxConfig, getTaxRecipient, collectItemTax } = require('../taxUtil');

// Create a standard 52-card deck
const createDeck = () => {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank, value: getCardValue(rank) });
    }
  }

  return deck;
};

// Get card value for blackjack
const getCardValue = (rank) => {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11; // Will handle ace as 1 or 11 later
  return parseInt(rank);
};

// Shuffle deck using Fisher-Yates algorithm
const shuffleDeck = (deck) => {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

// Calculate hand value considering aces
const calculateHandValue = (hand) => {
  let value = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.rank === 'A') {
      aces++;
      value += 11;
    } else {
      value += card.value;
    }
  }

  // Adjust for aces if value is over 21
  while (value > 21 && aces > 0) {
    value -= 10; // Convert ace from 11 to 1
    aces--;
  }

  return value;
};

// Check if hand is blackjack (21 with 2 cards)
const isBlackjack = (hand) => {
  return hand.length === 2 && calculateHandValue(hand) === 21;
};

// Get game result
const getGameResult = (playerHand, dealerHand) => {
  const playerValue = calculateHandValue(playerHand);
  const dealerValue = calculateHandValue(dealerHand);

  if (playerValue > 21) return 'bust';
  if (dealerValue > 21) return 'dealer_bust';
  if (isBlackjack(playerHand) && !isBlackjack(dealerHand)) return 'blackjack';
  if (playerValue === dealerValue) return 'push';
  if (playerValue > dealerValue) return 'win';
  return 'loss';
};

const HIDDEN_CARD = { suit: 'hidden', rank: 'hidden', value: 0 };

// A game holds the player's wagered items until they stand or bust. If they
// close the tab the items are locked forever with no way to get them back, so a
// stale game is refunded automatically.
const ABANDONED_AFTER_MS = 30 * 60 * 1000;

// How long a creator waits for an opponent before the round is called off.
const MATCH_TIMEOUT_MS = 90 * 1000;

/* ──────────────────────────────────────────────────────────────────────────
 * Multiplayer Blackjack
 *
 * Structured like Coinflip. The CREATOR is the player: they stake their pets
 * and play their own hand. Somebody else deals.
 *
 *   1. Player creates a bet and the HOUSE BOT takes the dealer seat.
 *   2. Player creates a bet and another PLAYER joins to deal.
 *
 * Either way the creator hits and stands, then the dealer turns over the hole
 * card and plays to the rules. A bust hands the pot to the dealer. Tax applies
 * to winnings like every other game on the site.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Pull items worth about `target` out of the house account.
 *
 * A natural pays 3:2 but the dealer only ever staked one pot, so the extra
 * half has to come from the site's own stock. Units are taken largest-first so
 * the target is approached closely instead of overshooting by a cheap item, and
 * the caller is told the shortfall so a thin house reports honestly rather than
 * promising 3:2 and paying less.
 */
function takeFromHouse(target) {
  const empty = { items: [], value: 0 };
  if (!(target > 0)) return empty;
  const recipient = getTaxRecipient();
  if (!recipient) return empty;

  const inventory = dbManager.getUserInventory(recipient.id);
  const stacks = (inventory && inventory.items) || [];
  if (!stacks.length) return empty;

  // One unit per stack entry, so a stack of 100 identical items is 100 chances.
  const units = [];
  stacks.forEach((st, si) => {
    const qty = Math.max(1, parseInt(st.quantity || 1, 10) || 1);
    for (let k = 0; k < qty; k++) units.push({ si, value: Number(st.value) || 0 });
  });
  // Largest first, then randomised among equals so it is not always the same
  // pets funding a natural.
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [units[i], units[j]] = [units[j], units[i]];
  }
  units.sort((a, b) => b.value - a.value);

  const take = {};
  let value = 0;
  for (const u of units) {
    if (value + u.value > target) continue;
    take[u.si] = (take[u.si] || 0) + 1;
    value += u.value;
  }

  const items = [];
  stacks.forEach((st, si) => {
    const n = take[si] || 0;
    if (!n) return;
    dbManager.removeItemFromUserInventory(recipient.id, st.itemId || st.id, n);
    items.push({ ...st, quantity: n });
  });
  return { items, value };
}

const BLACKJACK_PAYOUT = 1.5; // 3:2

// House edge. Blackjack with a dealer standing on all 17s sits close to
// break-even, so the edge is charged as a rake on winnings rather than by
// skewing the payout. It is a separate knob from the site-wide tax so the two
// can be tuned independently.
const HOUSE_EDGE = 0.10;

// Public shape of a table. Never leaks the dealer's hole card or the deck.
function publicTable(t, viewerId, reveal) {
  if (!t) return null;
  const shown = !!reveal || t.status === 'completed';
  const visibleDealer = shown
    ? t.dealerHand
    : [t.dealerHand[0], { ...HIDDEN_CARD }];

  // The creator plays; the joiner (a human or the house bot) deals. Named
  // explicitly so the client never has to infer a seat from an id.
  const playerSeat = {
    id: t.creatorId,
    username: t.creatorUsername,
    avatar: t.creatorAvatar || '',
    isBot: false
  };
  const dealerSeat = {
    id: t.opponentId || null,
    username: t.opponentUsername || null,
    avatar: t.opponentAvatar || '',
    isBot: t.opponentIsBot === true
  };

  return {
    id: t.id,
    status: t.status,
    creatorId: t.creatorId,
    creatorUsername: t.creatorUsername,
    creatorAvatar: t.creatorAvatar || '',
    creatorItems: t.creatorItems || [],
    creatorValue: t.creatorValue || 0,
    creatorIsBot: !!t.creatorIsBot,
    opponentId: t.opponentId || null,
    opponentUsername: t.opponentUsername || null,
    opponentAvatar: t.opponentAvatar || '',
    opponentItems: t.opponentItems || [],
    opponentValue: t.opponentValue || 0,
    opponentIsBot: !!t.opponentIsBot,
    potValue: (t.creatorValue || 0) + (t.opponentValue || 0),
    // The creator plays; the joiner deals. The client uses these two flags to
    // decide whose turn it is, so they must not be inferred from ids here.
    playerId: t.creatorId,
    playerUsername: t.creatorUsername,
    playerAvatar: t.creatorAvatar || '',
    dealerSeat,
    playerSeat,
    playerHand: t.playerHand || [],
    playerValue: calculateHandValue(t.playerHand || []),
    dealerHand: visibleDealer,
    dealerValue: shown
      ? calculateHandValue(t.dealerHand || [])
      : calculateHandValue([t.dealerHand[0]].filter(Boolean)),
    result: t.result || null,
    payout: t.payout || 0,
    profit: t.profit || 0,
    tax: t.taxAmount || 0,
    rake: t.rakeAmount || 0,
    // Non-zero when the house could not cover the full 3:2 on a natural.
    bonusShortfall: t.bonusShortfall || 0,
    // The individual winnings, so a client can tell a pot too coarse to take a
    // proportional share from without over-charging.
    winningUnits: t.winningStacks
      ? t.winningStacks.map((it) => Number(it.value) || 0)
      : [],
    houseRule: HOUSE_RULE,
    blackjackPays: '3:2',
    houseEdge: HOUSE_EDGE,
    viewerIsCreator: viewerId === t.creatorId,
    viewerIsPlayer: viewerId === t.creatorId,
    timeoutSeconds: t.status === 'waiting'
      ? Math.max(0, Math.round(((new Date(t.createdAt).getTime() + MATCH_TIMEOUT_MS) - Date.now()) / 1000))
      : null,
    createdAt: t.createdAt
  };
}

function findTable(tableId) {
  const db = dbManager.getMainDb();
  db.blackjackTables = db.blackjackTables || [];
  return { db, table: db.blackjackTables.find((t) => t.id === tableId) };
}

function dealFrom(deck) {
  return deck.pop();
}

/** True when the hand totals 21 using an ace counted as 11. */
function isSoft17(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') { aces++; total += 11; } else total += c.value;
  }
  return aces > 0 && total === 21;
}

/**
 * Play the dealer's hand to the rules: stand on 17, but a SOFT 17 (an ace
 * counted as 11) must be hit. Every dealer draw goes through here so the solo
 * game, the table game and the bot all obey the same rule.
 */
function playDealerHand(table) {
  if (!Array.isArray(table.deck) || !table.deck.length) table.deck = shuffleDeck(createDeck());
  let value = calculateHandValue(table.dealerHand);
  let guard = 0;
  while (value < 17 || (value === 17 && isSoft17(table.dealerHand))) {
    if (guard++ > 20) break; // a full deck can never legitimately run this long
    if (!table.deck.length) table.deck = shuffleDeck(createDeck());
    table.dealerHand.push(dealFrom(table.deck));
    value = calculateHandValue(table.dealerHand);
  }
  table.dealerValue = value;
  return value;
}

const HOUSE_RULE = 'dealer stands on flat 17 and hits soft 17';

function bumpStats(usersDb, userId, won) {
  const u = usersDb.users.find((x) => x.id === userId);
  if (!u) return;
  u.gamesPlayed = (u.gamesPlayed || 0) + 1;
  if (won) u.gamesWon = (u.gamesWon || 0) + 1;
  else u.gamesLost = (u.gamesLost || 0) + 1;
  u.updatedAt = new Date().toISOString();
}

// Get blackjack game by ID
//
// NOTE: '/:gameId' below is a one-segment catch-all for the solo game, so
// every named collection route has to be registered BEFORE it. '/tables' used
// to live further down this file and was silently swallowed by the catch-all,
// which answered every list request with "Game not found".
router.get('/tables', authenticateToken, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    reclaimTables();
    const tables = (db.blackjackTables || [])
      .filter((t) => ['waiting', 'in_progress', 'completed'].includes(t.status))
      .slice(0, 25);
    res.json({ tables: tables.map((t) => publicTable(t, req.user.userId, false)) });
  } catch (err) {
    console.error('Error listing blackjack tables:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
/* ── multiplayer tables ─────────────────────────────────────────────────── */

const { emitToAll, emitToUser } = require('../realtime');

const broadcastTables = () => {
  const db = dbManager.getMainDb();
  emitToAll('blackjackTables', { tables: (db.blackjackTables || []).map((t) => publicTable(t, null, false)) });
};

/**
 * Give a table its wagers back when nobody finished the hand: no opponent ever
 * sat down, or the player vanished mid-hand.
 *
 * Without this, a player who opened a table and closed the tab would have their
 * pets held hostage indefinitely, and a 'waiting' table would block the slot
 * forever. Tables that already settled are left strictly alone - re-running this
 * over a completed table is exactly the double-payout bug the settlement guard
 * exists to prevent.
 */
function reclaimTables() {
  const db = dbManager.getMainDb();
  const now = Date.now();
  const reclaimed = [];
  for (const t of db.blackjackTables || []) {
    if (!['waiting', 'in_progress'].includes(t.status)) continue;
    const stamp = new Date(t.updatedAt || t.createdAt || 0).getTime();
    if (!stamp) continue;
    // A waiting table only needs to wait out the match timer; a live hand gets
    // the full grace period so a slow player is never robbed mid-hand.
    const limit = t.status === 'waiting' ? MATCH_TIMEOUT_MS : ABANDONED_AFTER_MS;
    if (now - stamp < limit) continue;

    if (t.status === 'waiting') {
      // Nobody ever sat down, so the creator's stake simply goes back.
      returnPlayerStock(t, t.creatorItems);
    } else {
      // Mid-hand: refund both seats' stakes unplayed.
      returnPlayerStock(t, t.creatorItems);
      returnDealerStock(t, t.opponentItems);
    }
    t.status = 'abandoned';
    t.result = 'abandoned';
    t.payout = 0;
    t.profit = 0;
    t.settled = true;
    t.completedAt = new Date().toISOString();
    reclaimed.push(t);
  }
  if (reclaimed.length) {
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    console.warn(`Blackjack: reclaimed ${reclaimed.length} abandoned table(s)`);
  }
  return reclaimed;
}

/** Put a table's unused dealer stock back where it came from. */
function pickBotItems(target) {
  const recipient = getTaxRecipient();
  if (!recipient) return null;
  const inv = dbManager.getUserInventory(recipient.id);
  const pool = ((inv && inv.items) || [])
    .map((it) => ({
      itemId: String(it.itemId || it.id),
      name: it.name || it.itemName || 'Item',
      itemName: it.name || it.itemName || 'Item',
      value: Number(it.value || 0),
      quantity: Math.max(1, parseInt(it.quantity || 1, 10) || 1),
      rarity: it.rarity || 'common',
      image: it.imageUrl || it.image || '',
      imageUrl: it.imageUrl || it.image || ''
    }))
    .filter((it) => it.itemId && it.value > 0 && it.quantity > 0);
  if (!pool.length) return null;

  const asc = [...pool].sort((a, b) => a.value - b.value);
  const desc = [...pool].sort((a, b) => b.value - a.value);
  const stock = new Map(pool.map((it) => [it.itemId, it.quantity]));
  const picked = new Map();
  let total = 0;

  // Positive q takes units, negative q puts them back. The two directions must
  // be handled separately: Math.min(q, avail) with a negative q is always
  // negative, so an undo would silently do nothing and the search would keep
  // building on units it thought it had removed.
  const take = (it, q) => {
    const avail = stock.get(it.itemId) || 0;
    if (q < 0) {
      const entry = picked.get(it.itemId);
      if (!entry || entry.quantity < 1) return;
      entry.quantity -= 1;
      if (entry.quantity === 0) picked.delete(it.itemId);
      stock.set(it.itemId, avail + 1);
      total -= it.value;
      return;
    }
    const n = Math.min(q, avail);
    if (n <= 0) return;
    stock.set(it.itemId, avail - n);
    const entry = picked.get(it.itemId) || { ...it, quantity: 0 };
    entry.quantity += n;
    picked.set(it.itemId, entry);
    total += it.value * n;
  };

  // Put a whole stack back on the shelf and take it out of the pick.
  const dropStack = (itemId) => {
    const entry = picked.get(itemId);
    if (!entry) return 0;
    const value = entry.value * entry.quantity;
    stock.set(itemId, (stock.get(itemId) || 0) + entry.quantity);
    picked.delete(itemId);
    total -= value;
    return value;
  };

  if (target > 0) {
    // Aim within 1.25% of the target.
    const lo = Math.max(1, Math.floor(target * 0.9875));
    const hi = Math.ceil(target * 1.0125);

    // Bounded search over 1-3 units. A greedy fill strands itself whenever no
    // single stack fits the band, and a two-unit search still misses targets
    // like 19020 that need 2020 + 8440 + 8440. Three covers every real case and
    // keeps the work trivial.
    let solved = false;
    const avail = (it) => (stock.get(it.itemId) || 0) > 0;
    for (let i = 0; i < asc.length && !solved; i++) {
      const a = asc[i];
      if (!avail(a)) continue;
      if (a.value >= lo && a.value <= hi) { take(a, 1); solved = true; break; }
      if (a.value > hi) break; // ascending: nothing later can start us either
      take(a, 1);

      for (let j = 0; j < asc.length && !solved; j++) {
        const b = asc[j];
        if (!avail(b) || (j === i && (stock.get(a.itemId) || 0) < 1)) continue;
        if (total + b.value > hi) break;
        take(b, 1);

        for (let k = j; k < asc.length && !solved; k++) {
          const c = asc[k];
          if (!avail(c)) continue;
          if (j === i && k === i && (stock.get(a.itemId) || 0) < 1) continue;
          if (total + c.value > hi) break;
          take(c, 1);
          if (total >= lo) solved = true;
          else take(c, -1); // over-shot the floor; undo and try a bigger filler
        }
        if (!solved) take(b, -1);
      }
      if (!solved) dropStack(a.itemId);
    }

    // Nothing landed in the band: take the closest sensible approximation
    // rather than nothing, so the bot can still play.
    if (!solved) {
      for (const it of desc) {
        if (total >= lo) break;
        take(it, Math.floor((lo - total) / it.value));
      }
      for (const it of asc) {
        if (total >= lo) break;
        if (total + it.value > hi) break;
        take(it, 1);
      }
    }
  }
  if (total <= 0) {
    const smallest = asc[0];
    take(smallest, 1);
  }
  if (total <= 0) return null;
  return { recipient, items: [...picked.values()], value: total };
}

/**
 * Put a seat's unused stock back where it came from.
 *
 * ownerKey names which recorded account backs the seat, because on a bot
 * table the dealer is the synthetic id "bot-<userId>" and credits must land on
 * the real user rather than inventing an inventory nobody can spend from.
 */
function returnStock(t, items, ownerKey) {
  let owner = t[ownerKey];
  if (!owner) return;
  if (typeof owner === 'string' && owner.startsWith('bot-')) owner = owner.slice(4);
  if (!owner) return;
  for (const it of items || []) {
    dbManager.addItemToUserInventory(owner, it, it.quantity || 1);
  }
}

const returnDealerStock = (t, items) => returnStock(t, items, 'dealerStockOwner');
const returnPlayerStock = (t, items) => returnStock(t, items, 'playerStockOwner');

function dealTableHand(table) {
  table.deck = shuffleDeck(createDeck());
  // The creator is the player and acts first, so their cards come first.
  table.playerHand = [dealFrom(table.deck), dealFrom(table.deck)];
  table.dealerHand = [dealFrom(table.deck), dealFrom(table.deck)];
  table.playerValue = calculateHandValue(table.playerHand);
  table.dealerValue = calculateHandValue(table.dealerHand);
}

// Create a bet. The creator is the PLAYER: they stake their pets and play the
// hand. Either the house bot or another player joins to take the dealer seat.
router.post('/tables', authenticateToken, (req, res) => {
  try {
    const { selectedItems } = req.body || {};
    const userId = req.user.userId;
    if (!Array.isArray(selectedItems) || !selectedItems.length) {
      return res.status(400).json({ message: 'Select the pets you want to play with' });
    }
    reclaimTables();

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find((u) => u.id === userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const inventory = dbManager.getUserInventory(userId);
    const wagerStacks = [];
    for (const sel of selectedItems) {
      const itemId = sel.itemId || sel.id;
      const qty = Math.max(1, parseInt(sel.quantity || 1, 10) || 1);
      const stack = (inventory.items || []).find((i) => String(i.itemId || i.id) === String(itemId));
      if (!stack || (stack.quantity || 0) < qty) {
        return res.status(400).json({ message: `You do not have ${qty}x of ${sel.name || itemId}` });
      }
      wagerStacks.push({
        itemId: String(itemId),
        name: stack.name || stack.itemName || 'Item',
        itemName: stack.name || stack.itemName || 'Item',
        value: Number(stack.value) || 0,
        rarity: stack.rarity || 'common',
        quantity: qty,
        image: stack.image || stack.imageUrl || ''
      });
    }
    const value = wagerStacks.reduce((s, it) => s + it.value * it.quantity, 0);
    if (value <= 0) return res.status(400).json({ message: 'Those pets have no value' });

    for (const it of wagerStacks) {
      dbManager.removeItemFromUserInventory(userId, it.itemId, it.quantity);
    }

    const table = {
      id: uuidv4(),
      status: 'waiting',
      creatorId: userId,
      creatorUsername: user.displayName || user.robloxUsername,
      creatorAvatar: user.avatar || '',
      creatorItems: wagerStacks,
      creatorValue: value,
      // The creator is the player, so their own inventory backs their stake.
      playerStockOwner: userId,
      opponentId: null,
      opponentUsername: null,
      opponentAvatar: '',
      opponentItems: [],
      opponentValue: 0,
      opponentIsBot: false,
      // True when the creator is the house dealer bot rather than a human.
      creatorIsBot: false,
      deck: null,
      dealerHand: [],
      playerHand: [],
      playerValue: 0,
      dealerValue: 0,
      result: null,
      payout: 0,
      profit: 0,
      taxAmount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const db = dbManager.getMainDb();
    db.blackjackTables = db.blackjackTables || [];
    db.blackjackTables.unshift(table);
    // keep the list from growing forever
    db.blackjackTables = db.blackjackTables.slice(0, 60);
    dbManager.saveMainDb();
    broadcastTables();

    res.status(201).json(publicTable(table, userId, false));
  } catch (err) {
    console.error('Error creating blackjack table:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Another player joins to take the DEALER seat against the creator's hand.
router.post('/tables/:id/join', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { selectedItems } = req.body || {};
    const { db, table } = findTable(req.params.id);
    if (!table) return res.status(404).json({ message: 'Table not found' });
    if (table.status !== 'waiting') return res.status(400).json({ message: 'That table is no longer open' });
    if (table.creatorId === userId) return res.status(400).json({ message: 'You cannot deal against yourself' });
    if (table.opponentId) return res.status(400).json({ message: 'That seat is taken' });
    if (!Array.isArray(selectedItems) || !selectedItems.length) {
      return res.status(400).json({ message: 'Select the pets to deal with' });
    }

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find((u) => u.id === userId);
    const inventory = dbManager.getUserInventory(userId);
    const stacks = [];
    for (const sel of selectedItems) {
      const itemId = sel.itemId || sel.id;
      const qty = Math.max(1, parseInt(sel.quantity || 1, 10) || 1);
      const stack = (inventory.items || []).find((i) => String(i.itemId || i.id) === String(itemId));
      if (!stack || (stack.quantity || 0) < qty) {
        return res.status(400).json({ message: `You do not have ${qty}x of ${sel.name || itemId}` });
      }
      stacks.push({
        itemId: String(itemId),
        name: stack.name || stack.itemName || 'Item',
        itemName: stack.name || stack.itemName || 'Item',
        value: Number(stack.value) || 0,
        rarity: stack.rarity || 'common',
        quantity: qty,
        image: stack.image || stack.imageUrl || ''
      });
    }
    const value = stacks.reduce((s, it) => s + it.value * it.quantity, 0);
    if (value <= 0) return res.status(400).json({ message: 'Those pets have no value' });

    for (const it of stacks) {
      dbManager.removeItemFromUserInventory(userId, it.itemId, it.quantity);
    }
    table.opponentId = userId;
    table.opponentUsername = user.displayName || user.robloxUsername;
    table.opponentAvatar = user.avatar || '';
    table.opponentItems = stacks;
    table.opponentValue = value;
    // A human joiner backs the dealer seat from their own inventory.
    table.dealerStockOwner = userId;
    dealTableHand(table);

    // A natural on the deal settles immediately, like any blackjack table.
    if (table.playerValue === 21 && table.dealerValue !== 21) {
      settleTable(table, 'blackjack');
    } else if (table.playerValue === 21 && table.dealerValue === 21) {
      settleTable(table, 'push');
    } else {
      table.status = 'in_progress';
    }
    table.updatedAt = new Date().toISOString();
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    broadcastTables();

    res.json(publicTable(table, userId, table.status === 'completed'));
    void usersDb;
  } catch (err) {
    console.error('Error joining blackjack table:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// The house dealer bot takes the seat and the hand is dealt.
router.post('/tables/:id/bot-join', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { db, table } = findTable(req.params.id);
    if (!table) return res.status(404).json({ message: 'Table not found' });
    if (table.creatorId !== userId) {
      return res.status(403).json({ message: 'Only the player can call the dealer' });
    }
    if (table.status !== 'waiting' || table.opponentId) {
      return res.status(400).json({ message: 'That table is no longer open' });
    }

    const pick = pickBotItems(table.creatorValue);
    if (!pick) {
      return res.status(400).json({ message: "The house dealer has no pets to wager. Ask an admin to stock the bot." });
    }
    for (const it of pick.items) {
      dbManager.removeItemFromUserInventory(pick.recipient.id, it.itemId, it.quantity || 1);
    }

    // The bot takes the DEALER seat. The creator keeps the player seat and
    // hits/stands; the dealer turns over and plays after they stand or bust.
    table.opponentId = `bot-${pick.recipient.id}`;
    table.opponentUsername = pick.recipient.username || 'House Dealer';
    table.opponentAvatar = '';
    table.opponentItems = pick.items;
    table.opponentValue = pick.value;
    table.opponentIsBot = true;
    table.creatorIsBot = false; // the creator is a human, and they play
    // The bot's stake came from the house account, so that is what must be
    // refunded if this table is abandoned.
    table.dealerStockOwner = pick.recipient.id;
    dealTableHand(table);

    if (table.playerValue === 21 && table.dealerValue !== 21) {
      settleTable(table, 'blackjack');
    } else if (table.playerValue === 21 && table.dealerValue === 21) {
      settleTable(table, 'push');
    } else {
      table.status = 'in_progress';
    }
    table.updatedAt = new Date().toISOString();
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    broadcastTables();

    res.json(publicTable(table, userId, table.status === 'completed'));
  } catch (err) {
    console.error('Error adding bot to blackjack table:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// The seated player hits.
router.post('/tables/:id/hit', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { db, table } = findTable(req.params.id);
    if (!table) return res.status(404).json({ message: 'Table not found' });
    // The creator is the player and takes the first turn. Only they may hit.
    if (table.creatorId !== userId) return res.status(403).json({ message: 'Not your hand' });
    if (table.status !== 'in_progress') return res.status(400).json({ message: 'Cannot hit right now' });

    if (!table.deck || !table.deck.length) table.deck = shuffleDeck(createDeck());
    table.playerHand.push(dealFrom(table.deck));
    table.playerValue = calculateHandValue(table.playerHand);

    if (table.playerValue > 21) {
      // A bust hands the pot straight to the dealer, per the rules.
      settleTable(table, 'bust');
    }
    table.updatedAt = new Date().toISOString();
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    broadcastTables();
    res.json(publicTable(table, userId, table.status === 'completed'));
  } catch (err) {
    console.error('Error hitting on blackjack table:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// The seated player stands, then the dealer plays to the house rules.
router.post('/tables/:id/stand', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { db, table } = findTable(req.params.id);
    if (!table) return res.status(404).json({ message: 'Table not found' });
    // The creator is the player; standing ends their turn and the dealer plays.
    if (table.creatorId !== userId) return res.status(403).json({ message: 'Not your hand' });
    if (table.status !== 'in_progress') return res.status(400).json({ message: 'Cannot stand right now' });

    // Dealer stands on flat 17 and hits a soft 17.
    playDealerHand(table);

    const result = getGameResult(table.playerHand, table.dealerHand);
    settleTable(table, result);
    table.updatedAt = new Date().toISOString();
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    broadcastTables();
    res.json(publicTable(table, userId, true));
  } catch (err) {
    console.error('Error standing on blackjack table:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// The house dealer plays its own hand. The bot is the dealer on its own
// tables, so this is the dealer taking its turn after the player has stood.
router.post('/tables/:id/bot-play', authenticateToken, (req, res) => {
  try {
    const { table } = findTable(req.params.id);
    if (!table) return res.status(404).json({ message: 'Table not found' });
    if (table.opponentIsBot !== true) return res.status(400).json({ message: 'That is not the house dealer' });
    if (table.status !== 'in_progress') return res.status(400).json({ message: 'Nothing for the dealer to do' });

    playDealerHand(table);
    settleTable(table, getGameResult(table.playerHand, table.dealerHand));
    table.updatedAt = new Date().toISOString();
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    broadcastTables();
    res.json(publicTable(table, req.user.userId, true));
  } catch (err) {
    console.error('Error playing the bot hand:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Read one table.
router.get('/tables/:id', authenticateToken, (req, res) => {
  try {
    const { table } = findTable(req.params.id);
    if (!table) return res.status(404).json({ message: 'Table not found' });
    const reveal = table.status === 'completed'
      || table.creatorId === req.user.userId
      || table.opponentId === req.user.userId;
    res.json(publicTable(table, req.user.userId, reveal));
  } catch (err) {
    console.error('Error fetching blackjack table:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Settle a table, exactly once.
 *
 * Every route that can end a hand calls this, and two of them can fire for the
 * same table (a hit that busts, or a stand racing a reconnect). Without the
 * guard the second call paid the wagers out a second time, inventing pets out
 * of nothing - which is what the conservation test caught.
 */
function settleTable(table, result) {
  if (table.settled === true || table.status === 'completed') {
    return { alreadySettled: true, result: table.result };
  }
  table.settled = true;
  table.result = result;
  table.status = 'completed';
  table.completedAt = new Date().toISOString();
  table.playerValue = calculateHandValue(table.playerHand);
  table.dealerValue = calculateHandValue(table.dealerHand);


  // The two seats, resolved ONCE and used by every branch below. The CREATOR
  // plays and the JOINER deals - the house bot is simply a joiner that is not
  // human. One rule, no special cases: reading the seats twice under slightly
  // different logic is how payouts started inventing pets.
  const seats = {
    playerId: table.creatorId,
    playerItems: table.creatorItems,
    playerValue: table.creatorValue,
    dealerId: table.opponentId,
    dealerItems: table.opponentItems,
    dealerValue: table.opponentValue
  };

  // A bot's seat id is synthetic ("bot-<realUserId>"), so it must be resolved
  // back to the real account before any credit is made against it. Crediting
  // "bot-..." created a brand new inventory nobody can ever spend from, which
  // is how a losing player's wager used to disappear.
  const realAccount = (id) => (typeof id === 'string' && id.startsWith('bot-')
    ? id.slice('bot-'.length)
    : id);
  seats.dealerId = realAccount(seats.dealerId);
  seats.playerId = realAccount(seats.playerId);

  if (!seats.playerId) {
    console.warn(`Blackjack: table ${table.id} settled with no seated player, skipping payouts`);
    return { alreadySettled: false, result, noPlayer: true };
  }
  const playerSide = { items: seats.playerItems, value: seats.playerValue };
  const dealerSide = { items: seats.dealerItems, value: seats.dealerValue };
  const recipient = getTaxRecipient();
  // Losing wagers go to the dealer seat, exactly once. Fall back to the tax
  // recipient only if there is genuinely no dealer account.
  const dealerSeatId = seats.dealerId || (recipient && recipient.id);
  const toHouse = (items) => {
    if (!dealerSeatId) return;
    for (const it of items || []) {
      dbManager.addItemToUserInventory(dealerSeatId, it, it.quantity || 1);
    }
  };
  const toPlayer = (items) => {
    for (const it of items || []) {
      dbManager.addItemToUserInventory(seats.playerId, it, it.quantity || 1);
    }
  };

  if (result === 'win' || result === 'blackjack' || result === 'dealer_bust') {
    // The player always gets their own stake back.
    toPlayer(playerSide.items);

    // The winnings are the dealer's stake, and on a natural the extra half is
    // covered by the house, because the dealer only ever staked one pot. This
    // is the site's own money: the house is whoever the tax pot points at, and
    // the dealer's own stake is the pot in front of them.
    const dealerPot = dealerSide.value || 0;
    let winnings = dealerSide.items.map((it) => ({ ...it }));
    let bonusShortfall = 0;
    if (result === 'blackjack') {
      const extra = Math.max(0, Math.round(dealerPot * (BLACKJACK_PAYOUT - 1)));
      const covered = takeFromHouse(extra);
      winnings = winnings.concat(covered.items);
      bonusShortfall = extra - covered.value;
    }

    // The house edge and the site tax are then actually taken off the winnings
    // as items, exactly like every other game. Previously both were computed
    // and displayed while the player was handed the dealer's stake in full, so
    // the "10% house edge" collected nothing at all.
    const tax = getTaxConfig();
    let rakeStacks = [];
    let rakeValue = 0;
    if (winnings.length) {
      const rake = collectItemTax(winnings, HOUSE_EDGE);
      winnings = rake.winnerStacks;
      rakeStacks = rake.taxStacks;
      rakeValue = rake.taxAmount;
    }
    let taxStacks = [];
    let taxValue = 0;
    if (tax.rate > 0 && winnings.length) {
      const split = collectItemTax(winnings, tax.rate);
      winnings = split.winnerStacks;
      taxStacks = split.taxStacks;
      taxValue = split.taxAmount;
    }

    toPlayer(winnings);
    for (const st of rakeStacks.concat(taxStacks)) {
      if (recipient) dbManager.addItemToUserInventory(recipient.id, st, st.quantity || 1);
    }

    table.taxAmount = taxValue;
    table.rakeAmount = rakeValue;
    // Profit is the value of the winnings the player actually holds, so the
    // figure on screen can never disagree with their inventory.
    table.payout = winnings.reduce((s, it) => s + (Number(it.value) || 0) * (Number(it.quantity) || 1), 0);
    table.profit = table.payout;
    table.bonusShortfall = bonusShortfall;
    // Recorded rather than recomputed later, so the settled table carries the
    // winnings that were actually paid.
    table.winningStacks = winnings;
  } else if (result === 'push') {
    // Each side gets their own wager back and nothing more. Crediting the
    // dealer's stake to the player here would hand over the whole pot.
    toPlayer(playerSide.items);
    returnDealerStock(table, dealerSide.items);
    table.payout = 0;
    table.profit = 0;
  } else {
    // Loss or bust. The dealer's own stake comes back untouched, and the
    // player's wager is added to it. Nothing goes back to the player - that is
    // what losing means.
    returnDealerStock(table, dealerSide.items);
    toHouse(playerSide.items);
    table.payout = 0;
    table.profit = -playerSide.value;
  }

  if (seats.playerId) {
    try {
      const usersDb = dbManager.getUsersDb();
      bumpStats(usersDb, seats.playerId, result === 'win' || result === 'blackjack' || result === 'dealer_bust');
    } catch { /* stats are not worth failing a settlement over */ }
  }
}

// Get a user's blackjack history.
//
// Hands are read back off the settled tables rather than a separate log: the
// table IS the record. The old solo game kept its own blackjackGames list,
// which nothing writes to any more, so a history built from it was always
// empty. The field names here match what the page renders.
router.get('/user/:userId/history', authenticateToken, (req, res) => {
  try {
    const userId = req.params.userId;
    const db = dbManager.getMainDb();
    const history = (db.blackjackTables || [])
      .filter((t) => t.status === 'completed' && t.creatorId === userId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
      .slice(0, 50)
      .map((t) => ({
        id: t.id,
        result: t.result || null,
        playerHand: t.playerHand || [],
        playerValue: calculateHandValue(t.playerHand || []),
        dealerHand: t.dealerHand || [],
        dealerValue: calculateHandValue(t.dealerHand || []),
        // What the player themselves had at risk, which is the creator stake.
        betValue: t.creatorValue || 0,
        won: t.opponentValue || 0,
        profit: t.profit || 0,
        tax: t.taxAmount || 0,
        rake: t.rakeAmount || 0,
        createdAt: t.createdAt
      }));
    res.json(history);
  } catch (error) {
    console.error('Error fetching user blackjack history:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
