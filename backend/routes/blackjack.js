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

// Get game result from the PLAYER's point of view.
const getGameResult = (playerHand, dealerHand) => {
  const playerValue = calculateHandValue(playerHand);
  const dealerValue = calculateHandValue(dealerHand);
  const playerNatural = isBlackjack(playerHand);
  const dealerNatural = isBlackjack(dealerHand);

  // Naturals are decided before anything else. A two-card 21 beats any drawn
  // 21, and two naturals push.
  if (playerNatural && dealerNatural) return 'push';
  if (playerNatural) return 'blackjack';
  if (dealerNatural) return 'dealer_blackjack';

  if (playerValue > 21) return 'bust';
  if (dealerValue > 21) return 'dealer_bust';
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

// A joiner's wager has to land within this much of the dealer's, the same band
// RPS and Coinflip use. Publishes as minJoinValue / maxJoinValue so the client
// can show the range before anyone picks pets.
const VALUE_TOLERANCE = 0.05;

/* ──────────────────────────────────────────────────────────────────────────
 * Multiplayer Blackjack
 *
 * Structured like Coinflip. The CREATOR is the DEALER: they post their pets and
 * wait for somebody else to take the player seat.
 *
 *   1. Dealer posts a bet and the HOUSE BOT joins as the player.
 *   2. Dealer posts a bet and another PLAYER joins as the player.
 *
 * The player hits or stands. On a stand the dealer turns over the hole card and
 * plays to the rules; a bust ends the hand immediately. A natural on either
 * side settles on the deal. Tax applies to winnings like every other game.
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

// Public shape of a table. Never leaks a hand to somebody who should not see
// it: the dealer sees both hands, the player sees their own hand plus one dealer
// card, and spectators see no hands until the table is complete.
function publicTable(t, viewerId, reveal) {
  if (!t) return null;
  const completed = t.status === 'completed';
  const viewerIsCreator = !!viewerId && viewerId === t.creatorId;
  const viewerIsPlayer = !!viewerId && viewerId === t.opponentId;
  const showDealer = completed || !!reveal || viewerIsCreator;
  const showPlayer = completed || !!reveal || viewerIsCreator || viewerIsPlayer;

  const dealerHand = Array.isArray(t.dealerHand) ? t.dealerHand : [];
  const visibleDealer = showDealer
    ? dealerHand
    : dealerHand.length
      ? [dealerHand[0], { ...HIDDEN_CARD }]
      : [];

  // The creator deals and the joiner plays - the bot is just a joiner that is
  // not human. Named explicitly so the client never has to infer a seat.
  const dealerSeat = {
    id: t.creatorId,
    username: t.creatorUsername,
    avatar: t.creatorAvatar || '',
    isBot: t.creatorIsBot === true
  };
  const playerSeat = {
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
    // The joiner plays; the creator deals. The client uses these two flags to
    // decide whose turn it is, so they must not be inferred from ids here.
    playerId: t.opponentId || null,
    playerUsername: t.opponentUsername || null,
    playerAvatar: t.opponentAvatar || '',
    dealerSeat,
    playerSeat,
    playerHand: showPlayer ? (t.playerHand || []) : [],
    playerValue: showPlayer ? calculateHandValue(t.playerHand || []) : 0,
    dealerHand: visibleDealer,
    dealerValue: showDealer
      ? calculateHandValue(t.dealerHand || [])
      : calculateHandValue([t.dealerHand[0]].filter(Boolean)),
    result: t.result || null,
    payout: t.payout || 0,
    profit: t.profit || 0,
    dealerProfit: t.dealerProfit || 0,
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
    viewerIsCreator,
    viewerIsPlayer,
    // The band a joiner must land in, so the UI can show it up front instead of
    // refusing after someone has picked their pets.
    minJoinValue: Math.floor((t.creatorValue || 0) * (1 - VALUE_TOLERANCE)),
    maxJoinValue: Math.ceil((t.creatorValue || 0) * (1 + VALUE_TOLERANCE)),
    timeoutSeconds: t.status === 'waiting'
      ? Math.max(0, Math.round(((new Date(t.createdAt).getTime() + MATCH_TIMEOUT_MS) - Date.now()) / 1000))
      : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt || t.createdAt
  };
}

/**
 * The viewer's own table, in the same call as the board.
 *
 * The board maps every table through publicTable with a null viewer, so
 * viewerIsCreator and viewerIsPlayer are false everywhere in it - the client
 * cannot tell whose hand it is looking at. This attaches the viewer's own
 * table, properly resolved, so the page never has to guess.
 */
function withMyTable(db, viewerId) {
  const tables = (db.blackjackTables || [])
    .filter((t) => ['waiting', 'in_progress', 'completed'].includes(t.status))
    .slice(0, 25);
  const mine = tables.find(
    (t) => ['waiting', 'in_progress'].includes(t.status)
      && (t.creatorId === viewerId || t.opponentId === viewerId)
  ) || tables.find(
    (t) => t.creatorId === viewerId || t.opponentId === viewerId
  );
  return {
    tables: tables.map((t) => publicTable(t, viewerId, false)),
    myTable: mine ? publicTable(mine, viewerId, mine.status === 'completed') : null
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
 * counted as 11) must be hit. Every dealer draw goes through here so a table
 * and the house bot can never drift apart on the stopping rule.
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

// The board, plus the viewer's own table resolved for them.
router.get('/tables', authenticateToken, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    reclaimTables();
    res.json(withMyTable(db, req.user.userId));
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
      // Nobody ever sat down, so the dealer's stake simply goes back.
      returnDealerStock(t, t.creatorItems);
    } else {
      // Mid-hand: refund both seats' stakes unplayed.
      returnDealerStock(t, t.creatorItems);
      returnPlayerStock(t, t.opponentItems);
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
  // The creator is the dealer, so their hand is dealt first from the shared deck.
  table.dealerHand = [dealFrom(table.deck), dealFrom(table.deck)];
  table.playerHand = [dealFrom(table.deck), dealFrom(table.deck)];
  table.playerValue = calculateHandValue(table.playerHand);
  table.dealerValue = calculateHandValue(table.dealerHand);
}

/**
 * Naturals settle the moment the cards are dealt. A two-card 21 on either side
 * ends the hand at once; two naturals push. The dealer must not wait for the
 * player to act when they already have blackjack.
 */
function settleNaturals(table) {
  const playerNatural = isBlackjack(table.playerHand || []);
  const dealerNatural = isBlackjack(table.dealerHand || []);
  if (!playerNatural && !dealerNatural) return false;
  if (playerNatural && dealerNatural) settleTable(table, 'push');
  else if (playerNatural) settleTable(table, 'blackjack');
  else settleTable(table, 'dealer_blackjack');
  return true;
}

/**
 * Play the house bot's hand as the PLAYER, then let the creator's dealer hand
 * finish. This is the blackjack equivalent of Coinflip's one-click bot join:
 * the whole hand is resolved on the server, so the dealer has no button to
 * press after the bot sits down.
 */
function playBotHand(table) {
  if (!table || table.status !== 'in_progress') return;
  if (settleNaturals(table)) return;

  let guard = 0;
  while (guard++ < 20) {
    const value = calculateHandValue(table.playerHand || []);
    const mustHit = value < 17 || (value === 17 && isSoft17(table.playerHand || []));
    if (!mustHit) break;
    if (!table.deck || !table.deck.length) table.deck = shuffleDeck(createDeck());
    table.playerHand.push(dealFrom(table.deck));
  }
  table.playerValue = calculateHandValue(table.playerHand || []);

  if (table.playerValue > 21) {
    // The player busted, so the dealer wins without drawing another card.
    settleTable(table, 'bust');
    return;
  }

  playDealerHand(table);
  settleTable(table, getGameResult(table.playerHand || [], table.dealerHand || []));
}

// Create a bet. The creator is the DEALER: they stake their pets and wait for
// a player (or the house bot) to take the player seat and play against them.
router.post('/tables', authenticateToken, (req, res) => {
  try {
    const { selectedItems } = req.body || {};
    const userId = req.user.userId;
    if (!Array.isArray(selectedItems) || !selectedItems.length) {
      return res.status(400).json({ message: 'Select the pets you want to wager as the dealer' });
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
      // The creator deals, so their own inventory backs the dealer seat.
      dealerStockOwner: userId,
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

// Another player joins to take the PLAYER seat against the creator's hand.
//
// The wager has to be within VALUE_TOLERANCE of the dealer's, the same 5% band
// RPS and Coinflip use. Without it a player could join a 9,510 table with a
// single 4-value pet and be handed a 9,510 pot to lose.
router.post('/tables/:id/join', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { selectedItems } = req.body || {};
    const { db, table } = findTable(req.params.id);
    if (!table) return res.status(404).json({ message: 'Table not found' });
    if (table.status !== 'waiting') return res.status(400).json({ message: 'That table is no longer open' });
    if (table.creatorId === userId) return res.status(400).json({ message: 'You cannot play against yourself' });
    if (table.opponentId) return res.status(400).json({ message: 'That seat is taken' });
    if (!Array.isArray(selectedItems) || !selectedItems.length) {
      return res.status(400).json({ message: 'Select the pets you want to play with' });
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

    // The join has to be within 5% of the dealer's wager, or the pot is not a
    // contest. Checked on the server because the client can send anything.
    const lo = Math.floor((table.creatorValue || 0) * (1 - VALUE_TOLERANCE));
    const hi = Math.ceil((table.creatorValue || 0) * (1 + VALUE_TOLERANCE));
    if (value < lo || value > hi) {
      return res.status(400).json({
        message: `Your wager must be between ${lo.toLocaleString()} and ${hi.toLocaleString()} AMP to match this table.`
      });
    }

    for (const it of stacks) {
      dbManager.removeItemFromUserInventory(userId, it.itemId, it.quantity);
    }
    table.opponentId = userId;
    table.opponentUsername = user.displayName || user.robloxUsername;
    table.opponentAvatar = user.avatar || '';
    table.opponentItems = stacks;
    table.opponentValue = value;
    // A human joiner backs the player seat from their own inventory.
    table.playerStockOwner = userId;
    dealTableHand(table);

    // A natural on either side settles immediately; two naturals push.
    if (!settleNaturals(table)) {
      table.status = 'in_progress';
    }
    table.updatedAt = new Date().toISOString();
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    broadcastTables();

    res.json(publicTable(table, userId, false));
    void usersDb;
  } catch (err) {
    console.error('Error joining blackjack table:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// The house bot takes the PLAYER seat, so the creator deals. This is the
// "play the house" mode: the bot is the one who hits and stands.
router.post('/tables/:id/bot-join', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { db, table } = findTable(req.params.id);
    if (!table) return res.status(404).json({ message: 'Table not found' });
    if (table.creatorId !== userId) {
      return res.status(403).json({ message: 'Only the dealer can call the house bot' });
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

    // The bot sits in the PLAYER seat: it is the one who hits and stands,
    // while the creator deals. The bot's stake came from the house account,
    // so that is what must be refunded if the table is abandoned.
    table.opponentId = `bot-${pick.recipient.id}`;
    table.opponentUsername = pick.recipient.username || 'House Dealer';
    table.opponentAvatar = '';
    table.opponentItems = pick.items;
    table.opponentValue = pick.value;
    table.opponentIsBot = true;
    table.creatorIsBot = false; // the creator is a human, and they deal
    table.playerStockOwner = pick.recipient.id;
    dealTableHand(table);

    if (!settleNaturals(table)) {
      table.status = 'in_progress';
      // The bot has nobody to click for it, so it plays its whole hand now.
      // If the player stands, the dealer then plays in the same request.
      playBotHand(table);
    }
    table.updatedAt = new Date().toISOString();
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    broadcastTables();

    res.json(publicTable(table, userId, false));
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
    // The joiner is the player and takes the first turn. Only they may hit.
    if (table.opponentId !== userId) return res.status(403).json({ message: 'Not your hand' });
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
    res.json(publicTable(table, userId, false));
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
    // The joiner is the player; standing ends their turn and the dealer plays.
    if (table.opponentId !== userId) return res.status(403).json({ message: 'Not your hand' });
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

// Fallback for tables created before the bot became fully automatic. New
// bot-join requests resolve the whole hand already, so this only exists to
// finish a stale in-progress bot table without changing its outcome.
router.post('/tables/:id/bot-play', authenticateToken, (req, res) => {
  try {
    const { table } = findTable(req.params.id);
    if (!table) return res.status(404).json({ message: 'Table not found' });
    if (table.opponentIsBot !== true) return res.status(400).json({ message: 'That is not the house bot' });
    if (table.creatorId !== req.user.userId) {
      return res.status(403).json({ message: 'Only the dealer can finish the bot hand' });
    }
    if (table.status !== 'in_progress') return res.status(400).json({ message: 'Nothing for the bot to do' });

    playBotHand(table);
    table.updatedAt = new Date().toISOString();
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    broadcastTables();
    res.json(publicTable(table, req.user.userId, false));
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
    // publicTable decides visibility from the viewer's seat. A spectator gets
    // one dealer card, the player gets their own hand plus that one card, and
    // the dealer gets both hands.
    res.json(publicTable(table, req.user.userId, false));
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
  // deals and the JOINER plays - the house bot is simply a joiner that is not
  // human. One rule, no special cases: reading the seats twice under slightly
  // different logic is how payouts started inventing pets.
  const seats = {
    playerId: table.opponentId,
    playerItems: table.opponentItems,
    playerValue: table.opponentValue,
    dealerId: table.creatorId,
    dealerItems: table.creatorItems,
    dealerValue: table.creatorValue
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
  const toDealer = (items) => {
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

  /**
   * Take the house edge and the site tax out of a winner's winnings.
   *
   * The tax recipient is required for BOTH deductions: taking items and then
   * having nowhere to send them made pets vanish whenever the tax account was
   * unset. Winnings are paid net of what was actually collected, and the
   * collected stacks are returned so the caller can credit them.
   */
  const splitWinnings = (stacks) => {
    let winnings = (stacks || []).map((it) => ({ ...it }));
    const rakeStacks = [];
    const taxStacks = [];
    let rakeValue = 0;
    let taxValue = 0;

    if (recipient && winnings.length) {
      const rake = collectItemTax(winnings, HOUSE_EDGE);
      winnings = rake.winnerStacks;
      rakeStacks.push(...rake.taxStacks);
      rakeValue = rake.taxAmount;

      const tax = getTaxConfig();
      if (tax.rate > 0 && winnings.length) {
        const split = collectItemTax(winnings, tax.rate);
        winnings = split.winnerStacks;
        taxStacks.push(...split.taxStacks);
        taxValue = split.taxAmount;
      }
    }

    return {
      winnings,
      deductions: rakeStacks.concat(taxStacks),
      rakeValue,
      taxValue
    };
  };

  const valueOf = (stacks) => (stacks || []).reduce(
    (sum, it) => sum + (Number(it.value) || 0) * (Number(it.quantity) || 1),
    0
  );

  if (result === 'win' || result === 'blackjack' || result === 'dealer_bust') {
    // The player always gets their own stake back.
    toPlayer(playerSide.items);

    // The winnings are the dealer's stake. On a natural the extra half is
    // covered by the house, because the dealer only ever staked one pot. This
    // is the site's own money: the house is whoever the tax pot points at.
    let winnings = dealerSide.items.map((it) => ({ ...it }));
    let bonusShortfall = 0;
    if (result === 'blackjack') {
      const extra = Math.max(0, Math.round((dealerSide.value || 0) * (BLACKJACK_PAYOUT - 1)));
      const covered = takeFromHouse(extra);
      winnings = winnings.concat(covered.items);
      bonusShortfall = extra - covered.value;
    }

    const split = splitWinnings(winnings);
    toPlayer(split.winnings);
    if (recipient) {
      for (const st of split.deductions) {
        dbManager.addItemToUserInventory(recipient.id, st, st.quantity || 1);
      }
    }

    table.taxAmount = split.taxValue;
    table.rakeAmount = split.rakeValue;
    table.payout = valueOf(split.winnings);
    table.profit = table.payout;
    table.dealerProfit = -(dealerSide.value || 0);
    table.bonusShortfall = bonusShortfall;
    // Recorded rather than recomputed later, so the settled table carries the
    // winnings that were actually paid.
    table.winningStacks = split.winnings;
  } else if (result === 'push') {
    // Each side gets their own wager back and nothing more.
    toPlayer(playerSide.items);
    returnDealerStock(table, dealerSide.items);
    table.payout = 0;
    table.profit = 0;
    table.dealerProfit = 0;
  } else {
    // Loss, bust, or a dealer natural. The dealer's own stake comes back
    // untouched, and the player's wager becomes the dealer's winnings - also
    // subject to the same rake and tax as any other win on the site.
    returnDealerStock(table, dealerSide.items);
    const split = splitWinnings(playerSide.items);
    toDealer(split.winnings);
    if (recipient) {
      for (const st of split.deductions) {
        dbManager.addItemToUserInventory(recipient.id, st, st.quantity || 1);
      }
    }
    table.taxAmount = split.taxValue;
    table.rakeAmount = split.rakeValue;
    table.payout = 0;
    table.profit = -playerSide.value;
    table.dealerProfit = valueOf(split.winnings);
  }

  try {
    const usersDb = dbManager.getUsersDb();
    const playerWon = result === 'win' || result === 'blackjack' || result === 'dealer_bust';
    if (seats.playerId) bumpStats(usersDb, seats.playerId, playerWon);
    // The dealer is a real player too. Counting only the player seat made every
    // bot table invisible in the dealer's own statistics.
    if (seats.dealerId && seats.dealerId !== seats.playerId) {
      const dealerWon = ['loss', 'bust', 'dealer_blackjack'].includes(result);
      bumpStats(usersDb, seats.dealerId, dealerWon);
    }
  } catch { /* stats are not worth failing a settlement over */ }
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
      .filter((t) => t.status === 'completed' && t.opponentId === userId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
      .slice(0, 50)
      .map((t) => ({
        id: t.id,
        result: t.result || null,
        playerHand: t.playerHand || [],
        playerValue: calculateHandValue(t.playerHand || []),
        dealerHand: t.dealerHand || [],
        dealerValue: calculateHandValue(t.dealerHand || []),
        // What the player themselves had at risk, which is the joiner stake.
        betValue: t.opponentValue || 0,
        won: t.creatorValue || 0,
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
