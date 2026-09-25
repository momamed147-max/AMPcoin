const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { getTaxConfig, getTaxRecipient, collectItemTax } = require('../taxUtil');
const { addNotification } = require('../notificationService');
const { emitToAll, emitToUser } = require('../realtime');

// RPS arena — item wagers escrowed server-side. Matches are cached in memory
// for fast reads and persisted to the main store so escrowed items survive a
// backend restart.
const MOVES = new Set(['rock', 'paper', 'scissors']);
const MATCH_TTL_MS = 30 * 60 * 1000;
const HISTORY_TTL_MS = 10 * 60 * 1000;
const VALUE_TOLERANCE = 0.05;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 5;
const matches = new Map();
const userMatches = new Map();
const choiceRate = new Map();
const actionRate = new Map();
let hydrated = false;

function clampRounds(value) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return MIN_ROUNDS;
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, parsed));
}

// Load any matches that were active before a restart so escrow is never lost.
function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  const stored = dbManager.getMainDb().rpsMatches;
  if (!Array.isArray(stored)) return;
  for (const match of stored) {
    if (!match?.id || !match?.playerOne) continue;
    matches.set(match.id, match);
    userMatches.set(match.playerOne.id, match.id);
    if (match.playerTwo?.id) userMatches.set(match.playerTwo.id, match.id);
  }
  if (matches.size > 0) console.log(`[RPS] Restored ${matches.size} match(es) from storage`);
}

function persistMatches() {
  const now = Date.now();
  const snapshot = [...matches.values()].filter((match) => {
    if (match.status === 'waiting' || match.status === 'playing') return true;
    return now - new Date(match.completedAt || match.updatedAt || match.createdAt).getTime() < HISTORY_TTL_MS;
  });  const db = dbManager.getMainDb();
  db.rpsMatches = snapshot;
  dbManager.saveMainDb();
}

function getUser(userId) {
  const usersDb = dbManager.getUsersDb();
  return (usersDb.users || []).find((user) => user.id === userId) || null;
}

function playerFor(user) {
  return {
    id: user.id,
    username: user.robloxUsername || user.displayName || 'Player',
    displayName: user.displayName || user.robloxUsername || 'Player',
    avatar: user.avatar || ''
  };
}

function itemStackKey(item) {
  return String(item?.itemId || item?.id || '');
}

function itemValue(item) {
  return Number(item?.value || 0) * Math.max(1, parseInt(item?.quantity || 1, 10) || 1);
}

function totalValue(items) {
  return (items || []).reduce((sum, item) => sum + itemValue(item), 0);
}

function isParticipant(match, userId) {
  return match && (match.playerOne.id === userId || match.playerTwo?.id === userId);
}

function getPlayer(match, userId) {
  if (!match) return null;
  if (match.playerOne.id === userId) return 'one';
  if (match.playerTwo?.id === userId) return 'two';
  return null;
}

function publicMatch(match, viewerId = null) {
  if (!match) return null;
  const viewerSide = viewerId ? getPlayer(match, viewerId) : null;
  // Whether a side is locked in is public (so the other side and any spectators
  // see "Picked side" live), but the move itself is only ever sent to its owner.
  const pickedOne = !!match.choices?.[match.playerOne.id];
  const pickedTwo = !!match.choices?.[match.playerTwo?.id];
  const ownChoice = viewerSide === 'one'
    ? (match.choices?.[match.playerOne.id] || null)
    : viewerSide === 'two'
      ? (match.choices?.[match.playerTwo.id] || null)
      : null;
  const lastRound = match.lastRound || null;
  const taxConfig = getTaxConfig();

  return {
    id: match.id,
    status: match.status,
    round: match.round,
    rounds: match.rounds || MIN_ROUNDS,
    creatorValue: match.creatorValue,
    minJoinValue: match.minJoinValue,
    maxJoinValue: match.maxJoinValue,
    potValue: match.potValue,
    playerOne: {
      ...match.playerOne,
      wins: match.playerOne.wins || 0,
      picked: pickedOne,
      choice: viewerSide === 'one' ? ownChoice : null
    },
    playerTwo: match.playerTwo ? {
      ...match.playerTwo,
      wins: match.playerTwo.wins || 0,
      picked: pickedTwo,
      choice: viewerSide === 'two' ? ownChoice : null
    } : null,
    lastRound,
    winnerId: match.winnerId || null,
    taxAmount: match.taxAmount || 0,
    taxPercent: taxConfig.rate > 0 ? taxConfig.percent : 0,
    taxRecipientUsername: match.taxRecipientUsername || null,
    viewerSide,
    isParticipant: !!viewerSide,
    createdAt: match.createdAt,
    completedAt: match.completedAt || null
  };
}

function publicLobby() {
  // Waiting + live matches are listed so anyone can spectate through the same
  // View modal the players use, and recent finishes stay visible briefly so
  // the result can still be read after the page refreshes.
  const now = Date.now();
  const openMatches = [...matches.values()]
    .filter((match) => {
      if (match.status === 'waiting' || match.status === 'playing') {
        return now - new Date(match.createdAt).getTime() < MATCH_TTL_MS;
      }
      return match.status === 'completed'
        && now - new Date(match.completedAt || match.updatedAt || match.createdAt).getTime() < HISTORY_TTL_MS;
    })
    .map((match) => publicMatch(match))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return {
    matches: openMatches,
    openCount: openMatches.filter((match) => match.status === 'waiting').length,
    activeCount: openMatches.filter((match) => match.status === 'playing').length,
    queueCount: openMatches.length,
    updatedAt: new Date().toISOString()
  };
}

function emitLobby() {
  emitToAll('rpsLobbyUpdate', publicLobby());
}

function emitMatch(match) {
  if (!match) return;
  emitToUser(match.playerOne.id, 'rpsMatchUpdate', publicMatch(match, match.playerOne.id));
  if (match.playerTwo) emitToUser(match.playerTwo.id, 'rpsMatchUpdate', publicMatch(match, match.playerTwo.id));
}

// A player may only hold one live RPS bet at a time. Scan every active match
// instead of trusting userMatches, which only remembers the most recent one.
function activeMatchFor(userId) {
  if (!userId) return null;
  for (const match of matches.values()) {
    if (match.status !== 'waiting' && match.status !== 'playing') continue;
    if (match.playerOne?.id === userId || match.playerTwo?.id === userId) {
      userMatches.set(userId, match.id);
      return match;
    }
  }
  userMatches.delete(userId);
  return null;
}

function takeInventoryItems(userId, selectedItems) {
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
    throw new Error('Select at least one item to bet');
  }
  const inventory = dbManager.getUserInventory(userId);
  const requested = new Map();
  for (const selected of selectedItems) {
    const key = itemStackKey(selected);
    const quantity = Math.max(1, parseInt(selected.quantity || 1, 10) || 1);
    if (!key) throw new Error('One of the selected items is invalid');
    requested.set(key, (requested.get(key) || 0) + quantity);
  }

  const detailed = [];
  for (const [key, requestedQuantity] of requested.entries()) {
    const stack = (inventory.items || []).find((item) => itemStackKey(item) === key);
    const available = Math.max(1, parseInt(stack?.quantity || 1, 10) || 1);
    if (!stack || requestedQuantity > available) {
      throw new Error(`You do not have enough of ${stack?.name || key}`);
    }
    detailed.push({
      id: stack.itemId || stack.id,
      itemId: stack.itemId || stack.id,
      name: stack.details?.name || stack.name || stack.itemName || 'Item',
      itemName: stack.details?.name || stack.itemName || stack.name || 'Item',
      value: Number(stack.value || stack.details?.value || 0),
      rarity: stack.details?.rarity || stack.rarity || 'common',
      quantity: requestedQuantity,
      image: stack.image || stack.imageUrl || stack.details?.imageUrl || '',
      mods: Array.isArray(stack.mods) ? stack.mods : []
    });
  }

  for (const item of detailed) dbManager.removeItemFromUserInventory(userId, item.itemId, item.quantity);
  return detailed;
}

function refundItems(userId, items) {
  for (const item of items || []) dbManager.addItemToUserInventory(userId, item, item.quantity || 1);
  emitToUser(userId, 'inventoryUpdate', { userId });
}

function resolveRound(choiceOne, choiceTwo) {
  if (choiceOne === choiceTwo) return 'draw';
  if (
    (choiceOne === 'rock' && choiceTwo === 'scissors') ||
    (choiceOne === 'paper' && choiceTwo === 'rock') ||
    (choiceOne === 'scissors' && choiceTwo === 'paper')
  ) return 'one';
  return 'two';
}

function isChoiceRateLimited(userId, matchId) {
  const key = `${userId}:${matchId}`;
  const now = Date.now();
  const previous = choiceRate.get(key) || 0;
  if (now - previous < 350) return true;
  choiceRate.set(key, now);
  return false;
}

// Coarse throttle so the escrow endpoints cannot be spammed.
function isActionRateLimited(userId, action, windowMs = 1500) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const previous = actionRate.get(key) || 0;
  if (now - previous < windowMs) return true;
  actionRate.set(key, now);
  return false;
}

function createWaitingMatch(user, items, rounds) {
  const value = totalValue(items);
  const now = new Date().toISOString();
  const match = {
    id: uuidv4(),
    status: 'waiting',
    round: 1,
    rounds: clampRounds(rounds),
    creatorValue: value,
    minJoinValue: Math.floor(value * (1 - VALUE_TOLERANCE)),
    maxJoinValue: Math.ceil(value * (1 + VALUE_TOLERANCE)),
    potValue: value,
    playerOne: { ...playerFor(user), wins: 0, items },
    playerTwo: null,
    choices: {},
    lastRound: null,
    winnerId: null,
    taxAmount: 0,
    taxItems: [],
    createdAt: now,
    updatedAt: now
  };
  matches.set(match.id, match);
  userMatches.set(user.id, match.id);
  persistMatches();
  return match;
}

function attachOpponent(match, user, items) {
  if (!match || match.status !== 'waiting' || match.playerOne.id === user.id) return false;
  const value = totalValue(items);
  if (value < match.minJoinValue || value > match.maxJoinValue) return false;
  match.playerTwo = { ...playerFor(user), wins: 0, items };
  match.potValue = match.creatorValue + value;
  match.status = 'playing';
  match.updatedAt = new Date().toISOString();
  userMatches.set(user.id, match.id);
  persistMatches();
  return true;
}

function settlePot(match, winnerId, reason) {
  const pot = [...(match.playerOne.items || []), ...(match.playerTwo?.items || [])];
  const taxConfig = getTaxConfig();
  const recipient = getTaxRecipient();
  let winnerStacks = pot;
  let taxStacks = [];
  let taxAmount = 0;

  if (taxConfig.rate > 0 && pot.length > 0) {
    const split = collectItemTax(pot, taxConfig.rate);
    winnerStacks = split.winnerStacks;
    taxStacks = split.taxStacks;
    taxAmount = split.taxAmount;
  }

  if (winnerId) {
    for (const item of winnerStacks) dbManager.addItemToUserInventory(winnerId, item, item.quantity || 1);
    emitToUser(winnerId, 'inventoryUpdate', { userId: winnerId });
    if (recipient) {
      for (const item of taxStacks) dbManager.addItemToUserInventory(recipient.id, item, item.quantity || 1);
      emitToUser(recipient.id, 'inventoryUpdate', { userId: recipient.id });
    }
  } else {
    // A completed draw/expiry returns each player's own stacks.
    refundItems(match.playerOne.id, match.playerOne.items || []);
    if (match.playerTwo) refundItems(match.playerTwo.id, match.playerTwo.items || []);
  }

  match.taxAmount = taxAmount;
  match.taxItems = taxStacks;
  match.taxRecipientUsername = recipient?.username || null;
  match.endReason = reason;

  const db = dbManager.getMainDb();
  db.transactions = db.transactions || [];
  db.transactions.push({
    id: uuidv4(),
    userId: winnerId || match.playerOne.id,
    robloxUsername: winnerId ? (winnerId === match.playerOne.id ? match.playerOne.username : match.playerTwo?.username) : match.playerOne.username,
    type: winnerId ? 'rps_result' : 'rps_refund',
    status: 'completed',
    amount: winnerId ? match.potValue - taxAmount : 0,
    metadata: { matchId: match.id, reason, potValue: match.potValue, taxAmount },
    timestamp: new Date().toISOString()
  });
  if (taxAmount > 0) {
    db.transactions.push({
      id: uuidv4(),
      userId: recipient?.id || null,
      robloxUsername: recipient?.username || null,
      type: 'rps_tax',
      status: 'completed',
      amount: -taxAmount,
      metadata: { matchId: match.id, taxAmount, recipientId: recipient?.id || null },
      timestamp: new Date().toISOString()
    });
  }
  dbManager.saveMainDb();

  if (winnerId) {
    addNotification({
      userId: winnerId,
      type: 'items',
      title: 'RPS pot won!',
      message: `You won ${winnerStacks.length} item stack${winnerStacks.length === 1 ? '' : 's'}${taxAmount ? ` after ${taxAmount.toLocaleString()} AMP tax` : ''}.`
    });
  }
}

function finishMatch(match, winnerId, reason = 'completed') {
  if (!match || match.status === 'completed') return match;
  match.status = 'completed';
  match.winnerId = winnerId || null;
  match.completedAt = new Date().toISOString();
  match.updatedAt = match.completedAt;
  settlePot(match, winnerId, reason);

  const usersDb = dbManager.getUsersDb();
  [match.playerOne, match.playerTwo].filter(Boolean).forEach((player) => {
    const user = (usersDb.users || []).find((candidate) => candidate.id === player.id);
    if (!user) return;
    user.gamesPlayed = Number(user.gamesPlayed || 0) + 1;
    if (winnerId && player.id === winnerId) user.gamesWon = Number(user.gamesWon || 0) + 1;
    else if (winnerId) user.gamesLost = Number(user.gamesLost || 0) + 1;
    user.updatedAt = match.completedAt;
  });
  dbManager.saveUsersDb();
  userMatches.delete(match.playerOne.id);
  if (match.playerTwo) userMatches.delete(match.playerTwo.id);
  persistMatches();
  emitMatch(match);
  emitLobby();
  return match;
}

function cleanupMatches() {
  const now = Date.now();
  let changed = false;
  for (const [id, match] of matches) {
    if (now - new Date(match.createdAt).getTime() < MATCH_TTL_MS) continue;
    changed = true;
    if (match.status === 'waiting') {
      refundItems(match.playerOne.id, match.playerOne.items || []);
      userMatches.delete(match.playerOne.id);
      matches.delete(id);
    } else if (match.status === 'playing') {
      finishMatch(match, null, 'expired');
    } else {
      matches.delete(id);
    }
  }
  if (changed) persistMatches();
}

const cleanupTimer = setInterval(cleanupMatches, 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

// Escrowed matches are loaded from the store on first touch.
router.use((req, res, next) => {
  ensureHydrated();
  next();
});

router.get('/lobby', authenticateToken, (req, res) => {
  try {
    res.json({ ...publicLobby(), match: publicMatch(activeMatchFor(req.user.userId), req.user.userId) });
  } catch (error) {
    console.error('RPS lobby error:', error);
    res.status(500).json({ message: 'Could not load the RPS lobby' });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const user = getUser(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (isActionRateLimited(user.id, 'create')) {
      return res.status(429).json({ message: 'Slow down — wait a moment before posting another bet.' });
    }
    if (activeMatchFor(user.id)) {
      return res.status(409).json({ message: 'You already have an active RPS bet — finish or cancel it first' });
    }
    const items = takeInventoryItems(user.id, req.body?.selectedItems);
    const match = createWaitingMatch(user, items, req.body?.rounds);
    emitToUser(user.id, 'inventoryUpdate', { userId: user.id });
    emitLobby();
    res.status(201).json({ match: publicMatch(match, user.id) });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Could not create the RPS bet' });
  }
});

router.post('/matches/:id/join', authenticateToken, (req, res) => {
  try {
    const match = matches.get(req.params.id);
    const user = getUser(req.user.userId);
    if (!match) return res.status(404).json({ message: 'RPS bet not found' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (match.status !== 'waiting') return res.status(409).json({ message: 'That RPS bet is no longer open' });
    if (match.playerOne.id === user.id) return res.status(400).json({ message: 'You cannot join your own bet' });
    if (activeMatchFor(user.id)) {
      return res.status(409).json({ message: 'You already have an active RPS bet — finish or leave that one first' });
    }
    if (isActionRateLimited(user.id, 'join')) {
      return res.status(429).json({ message: 'Slow down — wait a moment before joining another bet.' });
    }
    const items = takeInventoryItems(user.id, req.body?.selectedItems);
    const value = totalValue(items);
    if (value < match.minJoinValue || value > match.maxJoinValue) {
      for (const item of items) dbManager.addItemToUserInventory(user.id, item, item.quantity || 1);
      return res.status(400).json({ message: `Your wager must be between ${match.minJoinValue.toLocaleString()} and ${match.maxJoinValue.toLocaleString()} AMP.` });
    }
    if (!attachOpponent(match, user, items)) {
      for (const item of items) dbManager.addItemToUserInventory(user.id, item, item.quantity || 1);
      return res.status(409).json({ message: 'That RPS bet is no longer available' });
    }
    emitToUser(user.id, 'inventoryUpdate', { userId: user.id });
    emitToUser(match.playerOne.id, 'inventoryUpdate', { userId: match.playerOne.id });
    emitMatch(match);
    emitLobby();
    res.json({ match: publicMatch(match, user.id) });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Could not join the RPS bet' });
  }
});

router.post('/matches/:id/choice', authenticateToken, (req, res) => {
  try {
    const match = matches.get(req.params.id);
    const choice = String(req.body?.choice || '').toLowerCase();
    const userId = req.user.userId;
    if (!match) return res.status(404).json({ message: 'RPS match not found' });
    if (match.status !== 'playing') return res.status(409).json({ message: 'This match is not accepting moves' });
    if (!isParticipant(match, userId)) return res.status(403).json({ message: 'You are not in this match' });
    if (!MOVES.has(choice)) return res.status(400).json({ message: 'Choose rock, paper, or scissors' });
    if (match.choices[userId]) return res.status(409).json({ message: 'You already picked a side this round' });
    if (isChoiceRateLimited(userId, match.id)) return res.status(429).json({ message: 'Please wait before picking again.' });

    match.choices[userId] = choice;
    persistMatches();
    const oneChosen = match.choices[match.playerOne.id] || null;
    const twoChosen = match.choices[match.playerTwo.id] || null;
    if (!oneChosen || !twoChosen) {
      match.updatedAt = new Date().toISOString();
      emitMatch(match);
      // Broadcast the lock-in so the other player and any spectators see
      // "Picked side" immediately instead of waiting for a refresh.
      emitLobby();
      return res.json({ match: publicMatch(match, userId), waitingForOpponent: true });
    }

    const result = resolveRound(oneChosen, twoChosen);
    const roundWinnerId = result === 'one' ? match.playerOne.id : result === 'two' ? match.playerTwo.id : null;
    if (roundWinnerId) {
      if (roundWinnerId === match.playerOne.id) match.playerOne.wins += 1;
      else match.playerTwo.wins += 1;
    }
    match.lastRound = {
      round: match.round,
      playerOneChoice: oneChosen,
      playerTwoChoice: twoChosen,
      result,
      winnerId: roundWinnerId
    };
    match.choices = {};

    // Every turn is played out. Whoever holds the most round wins when the last
    // turn is done takes the pot; an even split returns both wagers.
    const totalRounds = match.rounds || MIN_ROUNDS;
    if (match.round >= totalRounds) {
      const oneWins = match.playerOne.wins || 0;
      const twoWins = match.playerTwo.wins || 0;
      if (oneWins > twoWins) finishMatch(match, match.playerOne.id, 'turns-complete');
      else if (twoWins > oneWins) finishMatch(match, match.playerTwo.id, 'turns-complete');
      else finishMatch(match, null, 'tied');
    } else {
      match.round += 1;
      match.updatedAt = new Date().toISOString();
      persistMatches();
      emitMatch(match);
      emitLobby();
    }
    res.json({ match: publicMatch(match, userId) });
  } catch (error) {
    console.error('RPS choice error:', error);
    res.status(500).json({ message: 'Could not record your RPS move' });
  }
});

router.post('/matches/:id/cancel', authenticateToken, (req, res) => {
  try {
    const match = matches.get(req.params.id);
    const userId = req.user.userId;
    if (!match) return res.status(404).json({ message: 'RPS match not found' });
    if (!isParticipant(match, userId)) return res.status(403).json({ message: 'You are not in this match' });
    if (match.status === 'waiting') {
      refundItems(match.playerOne.id, match.playerOne.items || []);
      userMatches.delete(match.playerOne.id);
      matches.delete(match.id);
      persistMatches();
      emitLobby();
      return res.json({ cancelled: true });
    }
    if (match.status === 'playing') {
      const opponentId = match.playerOne.id === userId ? match.playerTwo.id : match.playerOne.id;
      finishMatch(match, opponentId, 'forfeit');
      return res.json({ match: publicMatch(match, userId), cancelled: true });
    }
    res.json({ match: publicMatch(match, userId) });
  } catch (error) {
    console.error('RPS cancel error:', error);
    res.status(500).json({ message: 'Could not leave the RPS match' });
  }
});

module.exports = router;
