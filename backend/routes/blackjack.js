const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { getTaxConfig, getTaxRecipient } = require('../taxUtil');

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

// Public view of a game. The dealer's hole card stays hidden until reveal=true.
function publicGame(game, reveal) {
  const shown = !!reveal || game.status === 'completed';
  return {
    gameId: game.id,
    betValue: game.betValue || 0,
    wagerItems: game.wagerItems || [],
    playerHand: game.playerHand || [],
    playerValue: calculateHandValue(game.playerHand || []),
    dealerHand: shown ? (game.dealerHand || []) : [(game.dealerHand || [])[0], { ...HIDDEN_CARD }],
    dealerValue: shown
      ? calculateHandValue(game.dealerHand || [])
      : calculateHandValue([(game.dealerHand || [])[0]].filter(Boolean)),
    status: game.status,
    result: game.result || null,
    payout: game.payout || 0,
    profit: game.profit || 0,
    tax: game.taxAmount || 0,
    createdAt: game.createdAt
  };
}

function findGame(gameId) {
  const db = dbManager.getMainDb();
  db.blackjackGames = db.blackjackGames || [];
  return { db, game: db.blackjackGames.find((g) => g.id === gameId) };
}

/**
 * Refund any game whose player walked away mid-hand. Without this a single
 * closed tab locks that player's wagered items permanently.
 * Returns the games that were reclaimed.
 */
function reclaimAbandonedGames() {
  const db = dbManager.getMainDb();
  const now = Date.now();
  const reclaimed = [];
  for (const game of db.blackjackGames || []) {
    if (game.status !== 'in_progress') continue;
    const startedAt = new Date(game.updatedAt || game.createdAt || 0).getTime();
    if (!startedAt || now - startedAt < ABANDONED_AFTER_MS) continue;
    returnWagerToPlayer(game);
    game.status = 'abandoned';
    game.result = 'abandoned';
    game.payout = 0;
    game.profit = 0;
    game.completedAt = new Date().toISOString();
    recordTransaction(db, {
      userId: game.playerId,
      robloxUsername: game.playerName,
      amount: 0,
      type: 'blackjack_abandoned',
      metadata: { gameId: game.id, betValue: game.betValue, refunded: true }
    });
    reclaimed.push(game);
  }
  if (reclaimed.length) {
    dbManager.saveMainDb();
    dbManager.saveUsersDb();
    console.warn(`Blackjack: refunded ${reclaimed.length} abandoned game(s)`);
  }
  return reclaimed;
}

function recordTransaction(db, entry) {
  db.transactions = db.transactions || [];
  db.transactions.push({
    id: uuidv4(),
    status: 'completed',
    timestamp: new Date().toISOString(),
    ...entry
  });
}

// Send lost wager items to the tax recipient (house). Returns true when a
// recipient received them; false means they were burned (no recipient set).
function sendWagerToHouse(db, game) {
  const recipient = getTaxRecipient();
  const items = Array.isArray(game.wagerItems) ? game.wagerItems : [];
  if (recipient && items.length > 0) {
    for (const it of items) {
      dbManager.addItemToUserInventory(recipient.id, it, it.quantity || 1);
    }
  }
  recordTransaction(db, {
    userId: game.playerId,
    robloxUsername: game.playerName,
    amount: -(game.betValue || 0),
    type: 'blackjack_loss',
    metadata: {
      gameId: game.id,
      betValue: game.betValue,
      wagerItems: items.map((t) => ({
        itemId: t.itemId || t.id,
        name: t.name || t.itemName,
        quantity: t.quantity || 1,
        value: t.value || 0
      })),
      houseRecipientId: recipient ? recipient.id : null,
      houseRecipientUsername: recipient ? recipient.username : null
    }
  });
  return !!recipient;
}

function returnWagerToPlayer(game) {
  const items = Array.isArray(game.wagerItems) ? game.wagerItems : [];
  for (const it of items) {
    dbManager.addItemToUserInventory(game.playerId, it, it.quantity || 1);
  }
  return items;
}

function bumpStats(usersDb, userId, won) {
  const u = usersDb.users.find((x) => x.id === userId);
  if (!u) return;
  u.gamesPlayed = (u.gamesPlayed || 0) + 1;
  if (won) u.gamesWon = (u.gamesWon || 0) + 1;
  else u.gamesLost = (u.gamesLost || 0) + 1;
  u.updatedAt = new Date().toISOString();
}

// Start a new blackjack game. The player wagers ITEMS from their inventory
// (AMP balance is never touched for the wager). Wins pay AMP profit.
router.post('/start', authenticateToken, (req, res) => {
  try {
    const { selectedItems } = req.body;
    const userId = req.user.userId;

    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
      return res.status(400).json({ message: 'Please select at least one item to wager' });
    }

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find((u) => u.id === userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userInventory = dbManager.getUserInventory(userId);
    if (!userInventory || !userInventory.items || userInventory.items.length === 0) {
      return res.status(400).json({ message: 'You have no items in your inventory' });
    }

    // Clear out any hand this player abandoned, so their items are not stuck.
    reclaimAbandonedGames();

    // Validate ownership and lock the wagered items into the game
    const wagerStacks = [];
    for (const sel of selectedItems) {
      const invItem = userInventory.items.find((i) => i.itemId === sel.itemId || i.id === sel.itemId);
      const reqQty = sel.quantity || 1;
      if (!invItem || (invItem.quantity || 1) < reqQty) {
        return res.status(400).json({ message: `Insufficient quantity for item ${sel.name || sel.itemId}` });
      }
      wagerStacks.push({
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

    const betValue = wagerStacks.reduce((sum, it) => sum + ((it.value || 0) * (it.quantity || 1)), 0);
    if (betValue <= 0) {
      return res.status(400).json({ message: 'Wagered items have no value' });
    }

    for (const it of wagerStacks) {
      dbManager.removeItemFromUserInventory(userId, it.itemId, it.quantity);
    }

    // Create a new shuffled deck and deal (dealer hole card stored, masked in response)
    const deck = shuffleDeck(createDeck());
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    const newGame = {
      id: uuidv4(),
      playerId: userId,
      playerName: user.displayName || user.robloxUsername,
      wagerItems: wagerStacks,
      betValue,
      playerHand,
      dealerHand,
      deck,
      status: 'in_progress',
      playerTurn: true,
      result: null,
      payout: 0,
      profit: 0,
      taxAmount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const db = dbManager.getMainDb();
    db.blackjackGames = db.blackjackGames || [];
    db.blackjackGames.unshift(newGame);
    dbManager.saveMainDb();

    res.status(201).json({ ...publicGame(newGame, false), message: `Game started (${betValue.toLocaleString()} AMP wagered in items)` });
  } catch (error) {
    console.error('Error starting blackjack game:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Player hits (takes another card)
router.post('/:gameId/hit', authenticateToken, (req, res) => {
  try {
    const gameId = req.params.gameId;
    const userId = req.user.userId;

    const { db, game } = findGame(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    if (game.playerId !== userId) {
      return res.status(403).json({ message: 'Not authorized to access this game' });
    }

    if (game.status !== 'in_progress' || !game.playerTurn || !Array.isArray(game.wagerItems)) {
      return res.status(400).json({ message: 'Cannot hit at this time' });
    }

    if (!Array.isArray(game.deck) || game.deck.length === 0) {
      game.deck = shuffleDeck(createDeck());
    }

    game.playerHand.push(game.deck.pop());
    const playerValue = calculateHandValue(game.playerHand);

    // Check if player busted — wager goes to the house
    if (playerValue > 21) {
      game.status = 'completed';
      game.result = 'bust';
      game.playerTurn = false;
      game.payout = 0;
      game.profit = -(game.betValue || 0);
      game.completedAt = new Date().toISOString();

      const usersDb = dbManager.getUsersDb();
      sendWagerToHouse(db, game);
      bumpStats(usersDb, userId, false);
      dbManager.saveUsersDb();
    }

    game.updatedAt = new Date().toISOString();
    dbManager.saveMainDb();

    res.json(publicGame(game, game.status === 'completed'));
  } catch (error) {
    console.error('Error processing hit:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Player stands (ends their turn, dealer plays, game settles)
router.post('/:gameId/stand', authenticateToken, (req, res) => {
  try {
    const gameId = req.params.gameId;
    const userId = req.user.userId;

    const { db, game } = findGame(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    if (game.playerId !== userId) {
      return res.status(403).json({ message: 'Not authorized to access this game' });
    }

    if (game.status !== 'in_progress' || !game.playerTurn || !Array.isArray(game.wagerItems)) {
      return res.status(400).json({ message: 'Cannot stand at this time' });
    }

    game.playerTurn = false;

    if (!Array.isArray(game.deck)) game.deck = [];

    // Dealer plays according to rules (hits on 16 or less, stands on 17 or more)
    let dealerValue = calculateHandValue(game.dealerHand);
    while (dealerValue < 17) {
      if (game.deck.length === 0) {
        game.deck = shuffleDeck(createDeck());
      }
      game.dealerHand.push(game.deck.pop());
      dealerValue = calculateHandValue(game.dealerHand);
    }

    // Determine game result
    const playerValue = calculateHandValue(game.playerHand);
    const result = getGameResult(game.playerHand, game.dealerHand);

    game.result = result;
    game.status = 'completed';
    game.completedAt = new Date().toISOString();
    game.updatedAt = new Date().toISOString();

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find((u) => u.id === userId);

    if (result === 'win' || result === 'blackjack' || result === 'dealer_bust') {
      // Player keeps wagered items + earns AMP profit on the wager value
      const returned = returnWagerToPlayer(game);
      const grossProfit = result === 'blackjack'
        ? Math.round((game.betValue || 0) * 1.5)
        : Math.round(game.betValue || 0);
      const rate = getTaxConfig().rate;
      const taxAmount = Math.round(grossProfit * rate);
      const netProfit = grossProfit - taxAmount;

      if (user) user.balance = (user.balance || 0) + netProfit;

      game.payout = netProfit;
      game.profit = netProfit;
      game.taxAmount = taxAmount;
      game.returnedItems = returned;

      recordTransaction(db, {
        userId,
        robloxUsername: game.playerName,
        amount: netProfit,
        type: result === 'blackjack' ? 'blackjack_win_blackjack' : 'blackjack_win',
        metadata: { gameId: game.id, betValue: game.betValue, result, grossProfit, tax: taxAmount }
      });
      if (taxAmount > 0) {
        recordTransaction(db, {
          userId,
          robloxUsername: game.playerName,
          amount: -taxAmount,
          type: 'blackjack_tax',
          metadata: { gameId: game.id, taxRate: rate }
        });
      }
      bumpStats(usersDb, userId, true);
    } else if (result === 'push') {
      const returned = returnWagerToPlayer(game);
      game.payout = 0;
      game.profit = 0;
      game.returnedItems = returned;
      recordTransaction(db, {
        userId,
        robloxUsername: game.playerName,
        amount: 0,
        type: 'blackjack_push',
        metadata: { gameId: game.id, betValue: game.betValue, result }
      });
      bumpStats(usersDb, userId, false);
    } else {
      // loss — wager goes to the house (tax recipient)
      game.payout = 0;
      game.profit = -(game.betValue || 0);
      sendWagerToHouse(db, game);
      bumpStats(usersDb, userId, false);
    }

    dbManager.saveUsersDb();
    dbManager.saveMainDb();

    res.json({
      ...publicGame(game, true),
      playerValue,
      dealerValue
    });
  } catch (error) {
    console.error('Error processing stand:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get blackjack game by ID
router.get('/:gameId', authenticateToken, (req, res) => {
  try {
    const gameId = req.params.gameId;
    const { game } = findGame(gameId);

    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // Only reveal the hole card to the owner once the game is completed
    const reveal = game.status === 'completed' && req.user.userId === game.playerId;
    res.json(publicGame(game, reveal));
  } catch (error) {
    console.error('Error fetching blackjack game:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's blackjack history
router.get('/user/:userId/history', authenticateToken, (req, res) => {
  try {
    const userId = req.params.userId;
    const db = dbManager.getMainDb();
    const userGames = (db.blackjackGames || [])
      .filter((game) => game.playerId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Newest first

    res.json(userGames);
  } catch (error) {
    console.error('Error fetching user blackjack history:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all blackjack games
router.get('/', (req, res) => {
  try {
    const { status, userId } = req.query;
    const db = dbManager.getMainDb();
    let filteredGames = db.blackjackGames || [];

    if (status) {
      filteredGames = filteredGames.filter((game) => game.status === status);
    }

    if (userId) {
      filteredGames = filteredGames.filter((game) => game.playerId === userId);
    }

    res.json(filteredGames);
  } catch (error) {
    console.error('Error fetching blackjack games:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
