const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { getTaxRecipient, collectItemTax, getTaxConfig } = require('../taxUtil');
const { addNotification } = require('../notificationService');

function formatCoinflip(cf) {
  if (!cf) return null;
  const creatorValue = Array.isArray(cf.creatorItems)
    ? cf.creatorItems.reduce((sum, item) => sum + (item.value * (item.quantity || 1)), 0)
    : 0;
  const opponentValue = Array.isArray(cf.opponentItems)
    ? cf.opponentItems.reduce((sum, item) => sum + (item.value * (item.quantity || 1)), 0)
    : 0;
  const totalValue = cf.totalValue || (creatorValue + opponentValue);

  return {
    id: cf.id,
    creatorId: cf.creatorId,
    creatorUsername: cf.creatorUsername,
    creatorAvatar: cf.creatorAvatar || '',
    creator: {
      id: cf.creatorId,
      displayName: cf.creatorUsername,
      avatar: cf.creatorAvatar || ''
    },
    opponentId: cf.opponentId || null,
    opponentUsername: cf.opponentUsername || null,
    opponentAvatar: cf.opponentAvatar || '',
    opponent: cf.opponentId ? {
      id: cf.opponentId,
      displayName: cf.opponentUsername,
      avatar: cf.opponentAvatar || ''
    } : null,
    creatorItems: cf.creatorItems || [],
    opponentItems: cf.opponentItems || [],
    totalValue: totalValue,
    creatorValue: creatorValue,
    opponentValue: opponentValue,
    minOpponentValue: typeof cf.minOpponentValue === 'number' ? cf.minOpponentValue : 0,
    maxOpponentValue: (typeof cf.maxOpponentValue === 'number' && isFinite(cf.maxOpponentValue)) ? cf.maxOpponentValue : 1000000000,
    taxRate: typeof cf.taxRate === 'number' ? cf.taxRate : 0,
    taxAmount: typeof cf.taxAmount === 'number' ? cf.taxAmount : 0,
    taxItems: Array.isArray(cf.taxItems) ? cf.taxItems : [],
    taxRecipientId: cf.taxRecipientId || null,
    taxRecipientUsername: cf.taxRecipientUsername || null,
    maxJoinPets: (typeof cf.maxJoinPets === 'number' && cf.maxJoinPets > 0) ? cf.maxJoinPets : null,
    status: cf.status,
    creatorSide: cf.creatorSide || cf.sideChosen || 'heads',
    sideChosen: cf.sideChosen || cf.creatorSide || 'heads',
    opponentSide: (cf.creatorSide || cf.sideChosen || 'heads') === 'tails' ? 'heads' : 'tails',
    winnerId: cf.winnerId || null,
    winnerUsername: cf.winnerUsername || null,
    winnerDisplayName: cf.winnerDisplayName || cf.winnerUsername || null,
    result: cf.result || null,
    outcome: cf.result || null,
    hash: cf.hash,
    serverSeed: cf.status === 'completed' ? cf.serverSeed : null, // reveal only when completed
    clientSeed: cf.clientSeed,
    nonce: cf.nonce,
    isCompleted: cf.status === 'completed',
    createdAt: cf.createdAt,
    updatedAt: cf.updatedAt,
    completedAt: cf.completedAt || null
  };
}

// Completed bets stay in the lobby for 10 minutes, but are RETAINED for
// history (30 days). Never hard-delete recent results — history depends on it.
const LOBBY_COMPLETED_MS = 10 * 60 * 1000;
const RETAIN_COMPLETED_MS = 30 * 24 * 3600 * 1000;

function isLobbyExpired(cf) {
  if (!cf || cf.status !== 'completed') return false;
  if (!cf.completedAt) return false;
  return Date.now() - new Date(cf.completedAt).getTime() >= LOBBY_COMPLETED_MS;
}

function isRetentionExpired(cf) {
  if (!cf || cf.status !== 'completed') return false;
  if (!cf.completedAt) return false; // legacy records without timestamp are kept
  return Date.now() - new Date(cf.completedAt).getTime() >= RETAIN_COMPLETED_MS;
}

function pruneExpiredCompleted(db) {
  if (!Array.isArray(db.coinflips) || db.coinflips.length === 0) return false;
  const before = db.coinflips.length;
  db.coinflips = db.coinflips.filter((cf) => !isRetentionExpired(cf));
  return db.coinflips.length !== before;
}

setInterval(() => {
  try {
    const db = dbManager.getMainDb();
    if (pruneExpiredCompleted(db)) dbManager.saveMainDb();
  } catch (e) {
    console.error('Coinflip prune error:', e.message);
  }
}, 60 * 1000);

// Get all active coinflips
router.get('/', (req, res) => {
  try {
    const { sort, status } = req.query;
    const db = dbManager.getMainDb();
    if (pruneExpiredCompleted(db)) dbManager.saveMainDb();
    let coinflips = [...(db.coinflips || [])];

    if (status) {
      coinflips = coinflips.filter(cf => cf.status === status);
    } else {
      // Waiting/active games plus recently completed ones (10 min lobby window)
      coinflips = coinflips.filter(cf =>
        cf.status === 'waiting' || cf.status === 'active' ||
        (cf.status === 'completed' && !isLobbyExpired(cf))
      );
    }

    let formatted = coinflips.map(formatCoinflip);

    // Apply sorting
    switch(sort) {
      case 'value_high':
        formatted.sort((a, b) => b.totalValue - a.totalValue);
        break;
      case 'value_low':
        formatted.sort((a, b) => a.totalValue - b.totalValue);
        break;
      case 'oldest':
        formatted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'newest':
      default:
        formatted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const activeCount = formatted.filter(cf => cf.status === 'waiting' || cf.status === 'active').length;
    const totalInGames = formatted.reduce((sum, cf) => sum + cf.totalValue, 0);

    res.json({
      coinflips: formatted,
      activeCount,
      totalInGames
    });
  } catch (error) {
    console.error('Error fetching coinflips:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper: live coinflip tax rate comes from the master tax switch
// (single 10-30% percentage). Kept as a function so call sites stay unchanged.
function getCoinflipTaxRate() {
  try {
    return getTaxConfig().rate;
  } catch (e) { /* ignore, default 0 */ }
  return 0;
}

// Create a new coinflip
router.post('/', authenticateToken, (req, res) => {
  try {
    const { selectedItems, minOpponentValue, maxOpponentValue, sideChosen, side, maxJoinPets } = req.body;
    const userId = req.user.userId;

    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
      return res.status(400).json({ message: 'Please select at least one item to bet' });
    }

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userInventory = dbManager.getUserInventory(userId);
    if (!userInventory || !userInventory.items || userInventory.items.length === 0) {
      return res.status(400).json({ message: 'User has no items in inventory' });
    }

    // Validate that user owns the selected items and quantities
    const detailedSelectedItems = [];
    for (const sel of selectedItems) {
      const invItem = userInventory.items.find(i => i.itemId === sel.itemId || i.id === sel.itemId);
      const reqQty = sel.quantity || 1;
      if (!invItem || (invItem.quantity || 1) < reqQty) {
        return res.status(400).json({ message: `Insufficient quantity for item ${sel.name || sel.itemId}` });
      }

      detailedSelectedItems.push({
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

    // Calculate total value
    const totalValue = detailedSelectedItems.reduce((sum, item) => sum + (item.value * item.quantity), 0);
    const chosenSide = (sideChosen || side || 'heads').toLowerCase() === 'tails' ? 'tails' : 'heads';

    // Deduct items from user inventory
    for (const item of detailedSelectedItems) {
      dbManager.removeItemFromUserInventory(userId, item.itemId, item.quantity);
    }

    // Generate provably fair seeds
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = req.body.clientSeed || crypto.randomBytes(16).toString('hex');
    const nonce = Date.now().toString();
    const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');

    // Join rule: opponent must cover 95%-105% of the creator's value.
    // Old clients may still send explicit bounds — respect them.
    const parsedMin = parseFloat(minOpponentValue);
    const parsedMax = parseFloat(maxOpponentValue);
    const safeMin = isNaN(parsedMin) ? Math.floor(totalValue * 0.95) : Math.max(0, parsedMin);
    let safeMax = isNaN(parsedMax) ? Math.ceil(totalValue * 1.05) : parsedMax;
    if (!isFinite(safeMax) || safeMax <= 0) safeMax = Math.ceil(totalValue * 1.05);

    let safeMaxJoinPets = null;
    if (maxJoinPets != null && maxJoinPets !== '') {
      const parsedPets = parseInt(maxJoinPets, 10);
      if (!isNaN(parsedPets)) {
        safeMaxJoinPets = Math.min(15, Math.max(1, parsedPets));
      }
    }

    const newCoinflip = {
      id: uuidv4(),
      creatorId: userId,
      creatorUsername: user.displayName || user.robloxUsername,
      creatorAvatar: user.avatar || '',
      opponentId: null,
      opponentUsername: null,
      opponentAvatar: '',
      creatorItems: detailedSelectedItems,
      opponentItems: [],
      totalValue: totalValue,
      creatorValue: totalValue,
      minOpponentValue: safeMin,
      maxOpponentValue: safeMax,
      maxJoinPets: safeMaxJoinPets,
      taxRate: getCoinflipTaxRate(),
      taxAmount: 0,
      creatorSide: chosenSide,
      sideChosen: chosenSide,
      status: 'waiting', // waiting for opponent
      serverSeed: serverSeed,
      clientSeed: clientSeed,
      nonce: nonce,
      hash: hash,
      winnerId: null,
      winnerUsername: null,
      result: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const db = dbManager.getMainDb();
    db.coinflips.unshift(newCoinflip);
    dbManager.saveMainDb();

    // Real-time: notify creator inventory changed + broadcast new coinflip to lobby
    const { emitToAll } = require('../realtime');
    emitToAll('inventoryUpdate', { userId });
    emitToAll('newCoinflip', formatCoinflip(newCoinflip));

    res.status(201).json(formatCoinflip(newCoinflip));
  } catch (error) {
    console.error('Error creating coinflip:', error);
    res.status(500).json({ message: 'Server error creating coinflip' });
  }
});

// Join an existing coinflip
router.post('/:id/join', authenticateToken, (req, res) => {
  try {
    const coinflipId = req.params.id;
    const userId = req.user.userId;
    const { selectedItems } = req.body;

    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
      return res.status(400).json({ message: 'Please select at least one item to match the bet' });
    }

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const db = dbManager.getMainDb();
    const coinflip = db.coinflips.find(cf => cf.id === coinflipId);
    if (!coinflip) {
      return res.status(404).json({ message: 'Coinflip not found' });
    }

    if (coinflip.status !== 'waiting') {
      return res.status(400).json({ message: 'This coinflip is no longer available' });
    }

    if (coinflip.creatorId === userId) {
      return res.status(400).json({ message: 'You cannot join your own coinflip' });
    }

    const userInventory = dbManager.getUserInventory(userId);
    if (!userInventory || !userInventory.items || userInventory.items.length === 0) {
      return res.status(400).json({ message: 'You have no items in your inventory' });
    }

    // Validate and collect opponent items
    const detailedOpponentItems = [];
    for (const sel of selectedItems) {
      const invItem = userInventory.items.find(i => i.itemId === sel.itemId || i.id === sel.itemId);
      const reqQty = sel.quantity || 1;
      if (!invItem || (invItem.quantity || 1) < reqQty) {
        return res.status(400).json({ message: `Insufficient quantity for item ${sel.name || sel.itemId}` });
      }

      detailedOpponentItems.push({
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

    // Check item value bounds (kept for old games only; new games accept any value).
    // Old records may have null/Infinity serialized — treat those as open range.
    const opponentPetCount = detailedOpponentItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
    const maxJoinPets = (typeof coinflip.maxJoinPets === 'number' && coinflip.maxJoinPets > 0)
      ? coinflip.maxJoinPets
      : null;
    if (maxJoinPets && opponentPetCount > maxJoinPets) {
      return res.status(400).json({
        message: `This bet allows at most ${maxJoinPets} pet${maxJoinPets === 1 ? '' : 's'}`
      });
    }

    const opponentTotalValue = detailedOpponentItems.reduce((sum, item) => sum + (item.value * item.quantity), 0);
    const minReq = typeof coinflip.minOpponentValue === 'number' ? coinflip.minOpponentValue : 0;
    const maxRaw = coinflip.maxOpponentValue;
    // Legacy bets created before the cap have huge/no max — fall back to ±5% band
    const maxReq = (typeof maxRaw === 'number' && isFinite(maxRaw) && maxRaw < 1000000000)
      ? maxRaw
      : Math.ceil((coinflip.creatorValue || 0) * 1.05);
    if (minReq > 0 && opponentTotalValue < minReq) {
      return res.status(400).json({
        message: `Selected value (${opponentTotalValue.toLocaleString()} AMP) is below required minimum (${minReq.toLocaleString()} AMP)`
      });
    }

    if (opponentTotalValue > maxReq) {
      return res.status(400).json({
        message: `Selected value (${opponentTotalValue.toLocaleString()} AMP) exceeds required maximum (${maxReq.toLocaleString()} AMP)`
      });
    }

    // Deduct items from opponent inventory
    for (const item of detailedOpponentItems) {
      dbManager.removeItemFromUserInventory(userId, item.itemId, item.quantity);
    }

    // Update coinflip with opponent details
    coinflip.opponentId = userId;
    coinflip.opponentUsername = user.displayName || user.robloxUsername;
    coinflip.opponentAvatar = user.avatar || '';
    coinflip.opponentItems = detailedOpponentItems;
    coinflip.totalValue = (coinflip.creatorValue || coinflip.totalValue) + opponentTotalValue;

    // Execute provably fair outcome
    const input = `${coinflip.serverSeed}:${coinflip.clientSeed}:${coinflip.nonce}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    const dec = parseInt(hash.substring(0, 8), 16);
    const outcome = dec % 2 === 0 ? 'heads' : 'tails';

    const creatorWon = (coinflip.creatorSide || 'heads') === outcome;
    const winnerId = creatorWon ? coinflip.creatorId : userId;
    const winnerUsername = creatorWon ? coinflip.creatorUsername : (user.displayName || user.robloxUsername);
    const loserId = creatorWon ? userId : coinflip.creatorId;

    coinflip.result = outcome;
    coinflip.winnerId = winnerId;
    coinflip.winnerUsername = winnerUsername;
    coinflip.winnerDisplayName = winnerUsername;
    coinflip.status = 'completed';
    coinflip.completedAt = new Date().toISOString();
    coinflip.updatedAt = new Date().toISOString();

    // House tax: take RANDOM item(s) from the pot worth ~taxRate of the pot
    // value and give them to the admin-configured tax recipient.
    // The winner keeps everything else.
    const liveTaxRate = getCoinflipTaxRate();
    const effectiveTaxRate = (typeof coinflip.taxRate === 'number' && coinflip.taxRate > 0)
      ? coinflip.taxRate
      : liveTaxRate;
    coinflip.taxRate = effectiveTaxRate;

    const potStacks = [...coinflip.creatorItems, ...detailedOpponentItems];
    const recipient = getTaxRecipient();
    let winnerStacks = potStacks;
    coinflip.taxItems = [];
    coinflip.taxAmount = 0;
    coinflip.taxRecipientId = recipient ? recipient.id : null;
    coinflip.taxRecipientUsername = recipient ? recipient.username : null;

    if (recipient && effectiveTaxRate > 0) {
      const split = collectItemTax(potStacks, effectiveTaxRate);
      winnerStacks = split.winnerStacks;
      coinflip.taxItems = split.taxStacks;
      coinflip.taxAmount = split.taxAmount;
      for (const t of split.taxStacks) {
        dbManager.addItemToUserInventory(recipient.id, t, t.quantity || 1);
      }
    }

    if (coinflip.taxAmount > 0) {
      db.transactions = db.transactions || [];
      db.transactions.push({
        id: uuidv4(),
        userId: winnerId,
        robloxUsername: winnerUsername,
        amount: -coinflip.taxAmount,
        type: 'coinflip_tax',
        status: 'completed',
        metadata: {
          coinflipId: coinflip.id,
          taxRate: effectiveTaxRate,
          taxRecipientId: coinflip.taxRecipientId,
          taxRecipientUsername: coinflip.taxRecipientUsername,
          taxItems: coinflip.taxItems.map((t) => ({
            itemId: t.itemId || t.id,
            name: t.name || t.itemName,
            quantity: t.quantity || 1,
            value: t.value || 0
          }))
        },
        timestamp: new Date().toISOString()
      });
    }

    // Award the remaining pot items to the winner's inventory
    for (const potItem of winnerStacks) {
      dbManager.addItemToUserInventory(winnerId, potItem, potItem.quantity || 1);
    }

    // Notify the winner that they received items
    const wonItemsCount = (winnerStacks || []).reduce((sum, it) => sum + (it.quantity || 1), 0);
    if (wonItemsCount > 0) {
      const firstWon = winnerStacks[0] || {};
      addNotification({
        userId: winnerId,
        type: 'items',
        title: 'Items received',
        message: `You won the coinflip and received ${wonItemsCount} item${wonItemsCount === 1 ? '' : 's'}!`,
        imageUrl: firstWon.imageUrl || firstWon.image || ''
      });
    }

    // Update users game statistics
    const winnerUser = usersDb.users.find(u => u.id === winnerId);
    if (winnerUser) {
      winnerUser.gamesPlayed = (winnerUser.gamesPlayed || 0) + 1;
      winnerUser.gamesWon = (winnerUser.gamesWon || 0) + 1;
      winnerUser.updatedAt = new Date().toISOString();
    }

    const loserUser = usersDb.users.find(u => u.id === loserId);
    if (loserUser) {
      loserUser.gamesPlayed = (loserUser.gamesPlayed || 0) + 1;
      loserUser.gamesLost = (loserUser.gamesLost || 0) + 1;
      loserUser.updatedAt = new Date().toISOString();
    }

    // Save DB
    dbManager.saveUsersDb();
    dbManager.saveMainDb();

    // Real-time: notify all affected users their inventory changed
    const { emitToAll } = require('../realtime');
    emitToAll('inventoryUpdate', { userId: winnerId });
    emitToAll('inventoryUpdate', { userId: loserId });
    if (coinflip.taxRecipientId && coinflip.taxAmount > 0) {
      emitToAll('inventoryUpdate', { userId: coinflip.taxRecipientId });
    }
    emitToAll('coinflipResult', formatCoinflip(coinflip));

    res.json(formatCoinflip(coinflip));
  } catch (error) {
    console.error('Error joining coinflip:', error);
    res.status(500).json({ message: 'Server error joining coinflip' });
  }
});

// Server-side house-bot join (creator only).
// The tax-recipient account joins the creator's open bet. No client secrets,
// no forged tokens — everything happens here in the DB.
router.post('/:id/bot-join', authenticateToken, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    const usersDb = dbManager.getUsersDb();
    const userId = req.user.userId;

    const coinflip = (db.coinflips || []).find((cf) => cf.id === req.params.id);
    if (!coinflip) return res.status(404).json({ message: 'Coinflip not found' });
    if (coinflip.creatorId !== userId) {
      return res.status(403).json({ message: 'Only the bet creator can add the bot' });
    }
    if (coinflip.status !== 'waiting' || coinflip.opponentId) {
      return res.status(400).json({ message: 'Bet is no longer open' });
    }

    const recipient = getTaxRecipient();
    if (!recipient) return res.status(400).json({ message: 'House bot is not configured' });
    const botUser = (usersDb.users || []).find((u) => u.id === recipient.id);
    if (!botUser) return res.status(400).json({ message: 'House bot account not found' });

    const botInventory = dbManager.getUserInventory(recipient.id);
    const pool = ((botInventory && botInventory.items) || [])
      .map((it) => ({
        itemId: it.itemId || it.id,
        name: it.name || it.itemName || 'Item',
        itemName: it.name || it.itemName || 'Item',
        value: Number(it.value || 0),
        quantity: Math.max(1, parseInt(it.quantity || 1, 10) || 1),
        rarity: it.rarity || 'common',
        image: it.imageUrl || it.image || '',
        imageUrl: it.imageUrl || it.image || ''
      }))
      .filter((it) => it.itemId && it.value > 0 && it.quantity > 0);
    if (pool.length === 0) {
      return res.status(400).json({ message: "Bot doesn't have valid balance" });
    }

    const minReq = typeof coinflip.minOpponentValue === 'number' ? coinflip.minOpponentValue : 0;
    const maxRaw = coinflip.maxOpponentValue;
    const maxReq = (typeof maxRaw === 'number' && isFinite(maxRaw)) ? maxRaw : 1000000000;
    const petCap = (typeof coinflip.maxJoinPets === 'number' && coinflip.maxJoinPets > 0)
      ? coinflip.maxJoinPets
      : null;
    const maxUnits = petCap && petCap > 0 ? petCap : Infinity;
    const target = Number(coinflip.creatorValue || 0) || Number(coinflip.totalValue || 0);

    // Pick bot items matching the bet's value band
    const desc = [...pool].sort((a, b) => b.value - a.value);
    const asc = [...pool].sort((a, b) => a.value - b.value);
    const build = (aimLo, aimHi) => {
      if (aimLo > aimHi || aimHi <= 0) return null;
      const aim = Math.min(aimHi, Math.max(aimLo, Math.round(aimLo + (aimHi - aimLo) / 2)));
      let total = 0;
      let units = 0;
      const pickedMap = new Map();
      const stock = new Map(pool.map((it) => [it.itemId, it.quantity]));
      const take = (it, qty) => {
        const avail = stock.get(it.itemId) || 0;
        const q = Math.min(qty, avail);
        if (q <= 0) return;
        stock.set(it.itemId, avail - q);
        const entry = pickedMap.get(it.itemId) || { ...it, quantity: 0 };
        entry.quantity += q;
        pickedMap.set(it.itemId, entry);
        total += it.value * q;
        units += q;
      };
      for (const it of desc) {
        if (total >= aim) break;
        const q = Math.min(Math.floor((aim - total) / it.value), stock.get(it.itemId) || 0);
        if (q > 0) take(it, q);
      }
      for (const it of asc) {
        while (total < aimLo) {
          if (units + 1 > maxUnits) break;
          if (total + it.value > aimHi) break;
          if (!(stock.get(it.itemId) > 0)) break;
          take(it, 1);
        }
        if (total >= aimLo) break;
      }
      if (total < aimLo || total > aimHi) return null;
      return { picked: [...pickedMap.values()], total, units };
    };

    let pick = null;
    if (target > 0) {
      const lo = Math.max(minReq, Math.floor(target * 0.9875));
      const hi = Math.min(maxReq, Math.ceil(target * 1.0125));
      if (hi >= 1 && lo <= hi) {
        const tight = build(Math.max(1, lo), hi);
        if (tight && tight.units <= maxUnits) pick = tight;
        else {
          const single = asc.find((it) => it.value >= lo && it.value <= hi);
          if (single) pick = { picked: [{ ...single, quantity: 1 }], total: single.value, units: 1 };
        }
      }
    }
    if (!pick) {
      if (minReq > 0) {
        const fallback = build(minReq, maxReq);
        if (fallback && fallback.units <= maxUnits) pick = fallback;
      } else {
        const smallest = asc.find((it) => it.value <= maxReq);
        if (smallest) pick = { picked: [{ ...smallest, quantity: 1 }], total: smallest.value, units: 1 };
      }
    }
    if (!pick) {
      return res.status(400).json({ message: "Bot doesn't have valid balance" });
    }

    // Deduct bot items
    for (const it of pick.picked) {
      dbManager.removeItemFromUserInventory(recipient.id, it.itemId, it.quantity || 1);
    }

    const botName = botUser.customDisplayName || botUser.displayName || botUser.robloxDisplayName || botUser.robloxUsername || 'House Bot';
    const botAvatar = botUser.avatar || '';
    const opponentTotalValue = pick.total;

    coinflip.opponentId = recipient.id;
    coinflip.opponentUsername = botName;
    coinflip.opponentAvatar = botAvatar;
    coinflip.opponentItems = pick.picked.map((it) => ({
      id: it.itemId,
      itemId: it.itemId,
      name: it.name || it.itemName,
      itemName: it.name || it.itemName,
      value: it.value || 0,
      rarity: it.rarity || 'common',
      quantity: it.quantity || 1,
      image: it.image || it.imageUrl || ''
    }));
    coinflip.totalValue = (coinflip.creatorValue || coinflip.totalValue) + opponentTotalValue;

    // House outcome: bot wins 70% of the time
    const creatorSide = (coinflip.creatorSide || coinflip.sideChosen || 'heads').toLowerCase() === 'tails' ? 'tails' : 'heads';
    const botWins = Math.random() < 0.7;
    const outcome = botWins ? (creatorSide === 'heads' ? 'tails' : 'heads') : creatorSide;

    const winnerId = botWins ? recipient.id : coinflip.creatorId;
    const winnerUsername = botWins ? botName : coinflip.creatorUsername;
    const loserId = botWins ? coinflip.creatorId : recipient.id;

    coinflip.result = outcome;
    coinflip.winnerId = winnerId;
    coinflip.winnerUsername = winnerUsername;
    coinflip.winnerDisplayName = winnerUsername;
    coinflip.status = 'completed';
    coinflip.completedAt = new Date().toISOString();
    coinflip.updatedAt = new Date().toISOString();

    const liveTaxRate = getCoinflipTaxRate();
    const effectiveTaxRate = (typeof coinflip.taxRate === 'number' && coinflip.taxRate > 0)
      ? coinflip.taxRate
      : liveTaxRate;
    coinflip.taxRate = effectiveTaxRate;

    const potStacks = [...coinflip.creatorItems, ...coinflip.opponentItems];
    const taxTo = getTaxRecipient();
    let winnerStacks = potStacks;
    coinflip.taxItems = [];
    coinflip.taxAmount = 0;
    coinflip.taxRecipientId = taxTo ? taxTo.id : null;
    coinflip.taxRecipientUsername = taxTo ? taxTo.username : null;

    if (taxTo && effectiveTaxRate > 0) {
      const split = collectItemTax(potStacks, effectiveTaxRate);
      winnerStacks = split.winnerStacks;
      coinflip.taxItems = split.taxStacks;
      coinflip.taxAmount = split.taxAmount;
      for (const t of split.taxStacks) {
        dbManager.addItemToUserInventory(taxTo.id, t, t.quantity || 1);
      }
    }

    if (coinflip.taxAmount > 0) {
      db.transactions = db.transactions || [];
      db.transactions.push({
        id: uuidv4(),
        userId: winnerId,
        robloxUsername: winnerUsername,
        amount: -coinflip.taxAmount,
        type: 'coinflip_tax',
        status: 'completed',
        metadata: {
          coinflipId: coinflip.id,
          taxRate: effectiveTaxRate,
          taxRecipientId: coinflip.taxRecipientId,
          taxRecipientUsername: coinflip.taxRecipientUsername,
          taxItems: coinflip.taxItems.map((t) => ({
            itemId: t.itemId || t.id,
            name: t.name || t.itemName,
            quantity: t.quantity || 1,
            value: t.value || 0
          }))
        },
        timestamp: new Date().toISOString()
      });
    }

    for (const potItem of winnerStacks) {
      dbManager.addItemToUserInventory(winnerId, potItem, potItem.quantity || 1);
    }

    const wonItemsCount = (winnerStacks || []).reduce((sum, it) => sum + (it.quantity || 1), 0);
    if (wonItemsCount > 0) {
      const firstWon = winnerStacks[0] || {};
      addNotification({
        userId: winnerId,
        type: 'items',
        title: 'Items received',
        message: `You won the coinflip and received ${wonItemsCount} item${wonItemsCount === 1 ? '' : 's'}!`,
        imageUrl: firstWon.imageUrl || firstWon.image || ''
      });
    }

    const winnerUser = usersDb.users.find((u) => u.id === winnerId);
    if (winnerUser) {
      winnerUser.gamesPlayed = (winnerUser.gamesPlayed || 0) + 1;
      winnerUser.gamesWon = (winnerUser.gamesWon || 0) + 1;
      winnerUser.updatedAt = new Date().toISOString();
    }

    const loserUser = usersDb.users.find((u) => u.id === loserId);
    if (loserUser) {
      loserUser.gamesPlayed = (loserUser.gamesPlayed || 0) + 1;
      loserUser.gamesLost = (loserUser.gamesLost || 0) + 1;
      loserUser.updatedAt = new Date().toISOString();
    }

    dbManager.saveUsersDb();
    dbManager.saveMainDb();

    const { emitToAll } = require('../realtime');
    emitToAll('inventoryUpdate', { userId: winnerId });
    emitToAll('inventoryUpdate', { userId: loserId });
    if (coinflip.taxRecipientId && coinflip.taxAmount > 0) {
      emitToAll('inventoryUpdate', { userId: coinflip.taxRecipientId });
    }
    emitToAll('coinflipResult', formatCoinflip(coinflip));

    res.json(formatCoinflip(coinflip));
  } catch (error) {
    console.error('Error in bot join:', error);
    res.status(500).json({ message: 'Server error in bot join' });
  }
});

// Cancel a waiting coinflip (creator only) — refunds wagered items
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    const idx = (db.coinflips || []).findIndex((cf) => cf.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ message: 'Coinflip not found' });
    }
    const cf = db.coinflips[idx];
    if (cf.creatorId !== req.user.userId) {
      return res.status(403).json({ message: 'Only the creator can cancel this bet' });
    }
    if (cf.status !== 'waiting') {
      return res.status(400).json({ message: 'Only waiting bets can be cancelled' });
    }

    // Refund creator items
    for (const it of (cf.creatorItems || [])) {
      dbManager.addItemToUserInventory(cf.creatorId, it, it.quantity || 1);
    }

    db.coinflips.splice(idx, 1);
    dbManager.saveMainDb();

    // Real-time: broadcast cancel + inventory update to all users
    const { emitToAll } = require('../realtime');
    emitToAll('coinflipCancelled', { id: cf.id });
    emitToAll('inventoryUpdate', { userId: cf.creatorId });

    res.json({ message: 'Bet cancelled — items refunded to your inventory' });
  } catch (error) {
    console.error('Error cancelling coinflip:', error);
    res.status(500).json({ message: 'Server error cancelling bet' });
  }
});

// Get coinflip by ID
router.get('/:id', (req, res) => {
  try {
    const db = dbManager.getMainDb();
    const coinflip = db.coinflips.find(cf => cf.id === req.params.id);
    if (!coinflip) {
      return res.status(404).json({ message: 'Coinflip not found' });
    }
    res.json(formatCoinflip(coinflip));
  } catch (error) {
    console.error('Error fetching coinflip:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get coinflip history for a user — every completed bet they played,
// newest first (retained 30 days, never trimmed to active-only)
router.get('/user/:userId/history', authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;
    const db = dbManager.getMainDb();
    const history = (db.coinflips || [])
      .filter(cf => (cf.creatorId === userId || cf.opponentId === userId) && cf.status === 'completed')
      .sort((a, b) => new Date(b.completedAt || b.updatedAt || 0) - new Date(a.completedAt || a.updatedAt || 0))
      .slice(0, 200)
      .map(formatCoinflip);

    res.json(history);
  } catch (error) {
    console.error('Error fetching coinflip history:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;