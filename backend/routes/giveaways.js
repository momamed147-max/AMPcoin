const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { addNotification } = require('../notificationService');
const { emitToAll } = require('../realtime');

// A user is eligible to join a giveaway only if they placed (created or
// joined) at least 1 coinflip bet in the 24h BEFORE the giveaway was made.
// The eligible list is snapshotted at creation time and stored on the giveaway.
const BET_WINDOW_MS = 24 * 60 * 60 * 1000;

// Giveaways auto-draw a winner this long after being created
const GW_DURATION_MS = 5 * 60 * 1000;

function computeEligibleUserIds(cutoffMs) {
  const db = dbManager.getMainDb();
  const usersDb = dbManager.getUsersDb();
  const coinflips = db.coinflips || [];
  return (usersDb.users || [])
    .filter((u) =>
      coinflips.some(
        (cf) =>
          (String(cf.creatorId) === String(u.id) || String(cf.opponentId) === String(u.id)) &&
          cf.createdAt &&
          new Date(cf.createdAt).getTime() >= cutoffMs
      )
    )
    .map((u) => String(u.id));
}

function publicGiveaway(gw) {
  return {
    id: gw.id,
    creatorId: gw.creatorId,
    creatorName: gw.creatorName,
    creatorAvatar: gw.creatorAvatar || '',
    item: gw.item,
    status: gw.status,
    entries: gw.entries,
    eligibleUserIds: gw.eligibleUserIds,
    winnerId: gw.winnerId || null,
    winnerName: gw.winnerName || null,
    createdAt: gw.createdAt,
    endedAt: gw.endedAt || null
  };
}

function giveawayChatMessage(gw) {
  return {
    id: uuidv4(),
    type: 'giveaway',
    userId: gw.creatorId,
    robloxUsername: gw.creatorRobloxUsername || '',
    displayName: gw.creatorName,
    avatar: gw.creatorAvatar || '',
    message: `${gw.creatorName} started a giveaway!`,
    timestamp: new Date().toISOString(),
    giveaway: publicGiveaway(gw)
  };
}

function pushChatMessage(db, chatMessage) {
  db.chatMessages = db.chatMessages || [];
  db.chatMessages.push(chatMessage);
  if (db.chatMessages.length > 1000) {
    db.chatMessages = db.chatMessages.slice(-1000);
  }
}

// Ends a giveaway: picks a winner (or refunds the creator), moves the item,
// syncs the chat card and returns the announcement message.
function finishGiveaway(db, gw) {
  let winMessage;
  if (gw.entries.length === 0) {
    dbManager.addItemToUserInventory(gw.creatorId, gw.escrow || gw.item, gw.item.quantity || 1);
    gw.status = 'ended';
    gw.winnerId = null;
    gw.winnerName = null;
    gw.endedAt = new Date().toISOString();
    winMessage = {
      id: uuidv4(),
      type: 'giveaway_win',
      userId: null,
      displayName: 'Giveaway',
      message: `Nobody joined the giveaway — ${gw.item.name} was returned to ${gw.creatorName}.`,
      timestamp: new Date().toISOString()
    };
  } else {
    const winner = gw.entries[Math.floor(Math.random() * gw.entries.length)];
    dbManager.addItemToUserInventory(winner.userId, gw.escrow || gw.item, gw.item.quantity || 1);
    gw.status = 'ended';
    gw.winnerId = winner.userId;
    gw.winnerName = winner.username;
    gw.endedAt = new Date().toISOString();
    winMessage = {
      id: uuidv4(),
      type: 'giveaway_win',
      userId: winner.userId,
      robloxUsername: winner.username,
      displayName: winner.username,
      avatar: winner.avatar || '',
      message: `🎉 ${winner.username} won ${gw.item.name} (${(gw.item.value || 0).toLocaleString()} AMP) in ${gw.creatorName}'s giveaway!`,
      timestamp: new Date().toISOString()
    };
    db.transactions = db.transactions || [];
    db.transactions.push({
      id: uuidv4(),
      userId: winner.userId,
      amount: 0,
      type: 'giveaway_win',
      status: 'completed',
      metadata: {
        giveawayId: gw.id,
        itemId: gw.item.itemId,
        itemName: gw.item.name,
        quantity: gw.item.quantity,
        value: gw.item.value
      },
      timestamp: new Date().toISOString()
    });
    addNotification({
      userId: winner.userId,
      type: 'giveaway',
      title: 'Giveaway won!',
      message: `You won ${gw.item.name} (${(gw.item.value || 0).toLocaleString()} AMP) from ${gw.creatorName}'s giveaway!`,
      imageUrl: gw.item.imageUrl || gw.item.image || ''
    });
  }

  // Keep the stored chat card in sync
  db.chatMessages = db.chatMessages || [];
  const card = db.chatMessages.find(
    (m) => m.type === 'giveaway' && m.giveaway && m.giveaway.id === gw.id
  );
  if (card) card.giveaway = publicGiveaway(gw);
  pushChatMessage(db, winMessage);

  return winMessage;
}

// Auto-draw expired giveaways (runs every 2s so the winner lands right at 0:00)
setInterval(() => {
  try {
    const db = dbManager.getMainDb();
    db.giveaways = db.giveaways || [];
    const now = Date.now();
    const expired = db.giveaways.filter(
      (g) => g.status === 'open' && g.endsAt && new Date(g.endsAt).getTime() <= now
    );
    for (const gw of expired) {
      const winMessage = finishGiveaway(db, gw);
      emitToAll('giveawayUpdate', publicGiveaway(gw));
      emitToAll('chatMessage', winMessage);
    }
    if (expired.length > 0) dbManager.saveMainDb();
  } catch (error) {
    console.error('Giveaway sweep error:', error.message);
  }
}, 2000);

// Create a giveaway — escrows the item from the creator's inventory
router.post('/', authenticateToken, (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { itemId, quantity = 1 } = req.body || {};
    if (!itemId) {
      return res.status(400).json({ message: 'You must pick an item to give away' });
    }

    const usersDb = dbManager.getUsersDb();
    const creator = (usersDb.users || []).find((u) => u.id === creatorId);
    if (!creator) {
      return res.status(404).json({ message: 'User not found' });
    }

    const qty = Math.max(1, parseInt(quantity || 1, 10) || 1);
    const inv = dbManager.getUserInventory(creatorId);
    const entry = ((inv && inv.items) || []).find((i) => i.itemId === itemId || i.id === itemId);
    if (!entry || (entry.quantity || 1) < qty) {
      return res.status(400).json({ message: 'You do not own that item' });
    }

    // Snapshot eligibility: >= 1 bet in the 24h before the giveaway is made
    const now = Date.now();
    const eligibleUserIds = computeEligibleUserIds(now - BET_WINDOW_MS);

    const itemSnapshot = {
      itemId: entry.itemId || entry.id,
      name: entry.name || entry.itemName || 'Unknown Item',
      itemName: entry.itemName || entry.name || 'Unknown Item',
      value: entry.value || 0,
      rarity: entry.rarity || 'common',
      quantity: qty,
      image: entry.imageUrl || entry.image || '',
      imageUrl: entry.imageUrl || entry.image || ''
    };

    // Escrow: take the item out of the creator's inventory right away.
    // It stays recorded on the giveaway (escrow) until it is paid out or refunded.
    dbManager.removeItemFromUserInventory(creatorId, itemSnapshot.itemId, qty);

    const giveaway = {
      id: uuidv4(),
      creatorId: creator.id,
      creatorRobloxUsername: creator.robloxUsername || '',
      creatorName: creator.customDisplayName || creator.robloxDisplayName || creator.displayName || creator.robloxUsername || 'Anonymous',
      creatorAvatar: creator.avatar || '',
      item: itemSnapshot,
      escrow: { ...itemSnapshot },
      status: 'open', // open | ended
      eligibleUserIds,
      entries: [],
      winnerId: null,
      winnerName: null,
      createdAt: new Date().toISOString(),
      endsAt: new Date(now + GW_DURATION_MS).toISOString(),
      endedAt: null
    };

    const db = dbManager.getMainDb();
    db.giveaways = db.giveaways || [];
    db.giveaways.unshift(giveaway);

    const chatMessage = giveawayChatMessage(giveaway);
    pushChatMessage(db, chatMessage);

    db.transactions = db.transactions || [];
    db.transactions.push({
      id: uuidv4(),
      userId: creatorId,
      robloxUsername: creator.robloxUsername,
      amount: 0,
      type: 'giveaway_create',
      status: 'completed',
      metadata: {
        giveawayId: giveaway.id,
        itemId: itemSnapshot.itemId,
        itemName: itemSnapshot.name,
        quantity: qty,
        value: itemSnapshot.value,
        eligibleCount: eligibleUserIds.length
      },
      timestamp: new Date().toISOString()
    });

    dbManager.saveMainDb();

    // Real-time: broadcast giveaway to all connected users
    emitToAll('giveawayUpdate', publicGiveaway(giveaway));
    emitToAll('inventoryUpdate', { userId: creatorId });

    res.status(201).json({ giveaway: publicGiveaway(giveaway), chatMessage });
  } catch (error) {
    console.error('Error creating giveaway:', error);
    res.status(500).json({ message: 'Server error creating giveaway' });
  }
});

// Join an open giveaway
router.post('/:id/join', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const db = dbManager.getMainDb();
    db.giveaways = db.giveaways || [];
    const gw = db.giveaways.find((g) => g.id === req.params.id);
    if (!gw) {
      return res.status(404).json({ message: 'Giveaway not found' });
    }
    if (gw.status !== 'open') {
      return res.status(400).json({ message: 'This giveaway has already ended' });
    }
    if (String(gw.creatorId) === String(userId)) {
      return res.status(400).json({ message: 'You cannot join your own giveaway' });
    }
    if (!gw.eligibleUserIds.map(String).includes(String(userId))) {
      return res.status(403).json({
        message: 'You need at least 1 bet in the 24h before this giveaway was made to join it'
      });
    }
    if (gw.entries.some((e) => String(e.userId) === String(userId))) {
      return res.status(400).json({ message: 'You already joined this giveaway' });
    }

    const usersDb = dbManager.getUsersDb();
    const user = (usersDb.users || []).find((u) => u.id === userId);
    gw.entries.push({
      userId,
      username: (user && (user.customDisplayName || user.robloxDisplayName || user.displayName || user.robloxUsername)) || 'Anonymous',
      avatar: (user && user.avatar) || '',
      at: new Date().toISOString()
    });
    dbManager.saveMainDb();

    // Real-time: broadcast updated giveaway to all users
    emitToAll('giveawayUpdate', publicGiveaway(gw));

    res.json({ giveaway: publicGiveaway(gw) });
  } catch (error) {
    console.error('Error joining giveaway:', error);
    res.status(500).json({ message: 'Server error joining giveaway' });
  }
});

// Draw a winner — creator only. With 0 entries the item is refunded.
router.post('/:id/draw', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const db = dbManager.getMainDb();
    db.giveaways = db.giveaways || [];
    const gw = db.giveaways.find((g) => g.id === req.params.id);
    if (!gw) {
      return res.status(404).json({ message: 'Giveaway not found' });
    }
    if (String(gw.creatorId) !== String(userId)) {
      return res.status(403).json({ message: 'Only the giveaway creator can draw a winner' });
    }
    if (gw.status !== 'open') {
      return res.status(400).json({ message: 'This giveaway has already ended' });
    }

    const winMessage = finishGiveaway(db, gw);

    dbManager.saveMainDb();

    // Real-time: broadcast ended giveaway to all users
    emitToAll('giveawayUpdate', publicGiveaway(gw));

    res.json({ giveaway: publicGiveaway(gw), winMessage });
  } catch (error) {
    console.error('Error drawing giveaway winner:', error);
    res.status(500).json({ message: 'Server error drawing giveaway winner' });
  }
});

// List recent giveaways (open ones first)
router.get('/', (req, res) => {
  try {
    const db = dbManager.getMainDb();
    db.giveaways = db.giveaways || [];
    const sorted = [...db.giveaways].sort((a, b) => {
      if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    res.json({ giveaways: sorted.slice(0, 20).map(publicGiveaway) });
  } catch (error) {
    console.error('Error listing giveaways:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
