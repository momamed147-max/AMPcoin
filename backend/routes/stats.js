const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Load database
const usersDbPath = path.join(__dirname, '..', 'db', 'users.json');
const itemsDbPath = path.join(__dirname, '..', 'db', 'items.json');
const mainDbPath = path.join(__dirname, '..', 'db', 'db.json');

function safeLoad(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`stats.js: could not load ${p}, using defaults:`, e.message);
    return fallback;
  }
}

let usersDb = safeLoad(usersDbPath, { users: [] });
let itemsDb = safeLoad(itemsDbPath, { items: [] });
let db = safeLoad(mainDbPath, { transactions: [], coinflips: [], blackjackGames: [], jackpots: [] });

// Get global statistics
router.get('/global', (req, res) => {
  try {
    // Calculate global stats
    const totalWagered = db.transactions
      .filter(t => t.type.includes('win') || t.type.includes('loss'))
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const totalCoinflips = db.coinflips.length;
    const totalBlackjackGames = db.blackjackGames.length;
    
    const totalWins = db.transactions.filter(t => 
      t.type === 'coinflip_win' || t.type === 'blackjack_win'
    ).length;
    
    const totalLosses = db.transactions.filter(t => 
      t.type === 'coinflip_loss' || t.type === 'blackjack_loss'
    ).length;

    const totalTaxesCollected = db.transactions
      .filter(t => t.type.includes('tax'))
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const globalStats = {
      totalUsers: usersDb.users.length,
      totalItems: itemsDb.items.length,
      totalWagered,
      totalCoinflips,
      totalBlackjackGames,
      totalWins,
      totalLosses,
      totalTaxesCollected,
      totalBalance: usersDb.users.reduce((sum, user) => sum + user.balance, 0),
      totalDeposits: db.deposits?.length || 0,
      totalWithdrawals: db.withdrawals?.length || 0,
      totalTransactions: db.transactions.length,
      activeUsers: usersDb.users.filter(u => {
        const lastLogin = new Date(u.lastLogin);
        const today = new Date();
        return lastLogin.toDateString() === today.toDateString();
      }).length
    };

    res.json(globalStats);
  } catch (error) {
    console.error('Error fetching global stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user statistics
router.get('/user/:userId', (req, res) => {
  try {
    const userId = req.params.userId;
    const user = usersDb.users.find(u => u.id === userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's game history
    const userCoinflips = db.coinflips.filter(cf => 
      cf.creatorId === userId || cf.opponentId === userId
    );
    
    const userBlackjackGames = db.blackjackGames.filter(bg => bg.playerId === userId);

    const userStats = {
      user: {
        id: user.id,
        robloxUserId: user.robloxUserId || null,
        robloxUsername: user.robloxUsername || '',
        robloxDisplayName: user.robloxDisplayName || null,
        customDisplayName: user.customDisplayName || null,
        displayName: (user.customDisplayName || user.robloxDisplayName || user.displayName || user.robloxUsername || 'Anonymous'),
        avatar: user.avatar || (user.robloxUserId ? `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxUserId}&width=150&height=150&format=png` : ''),
        balance: user.balance,
        gamesPlayed: user.gamesPlayed || 0,
        gamesWon: user.gamesWon || 0,
        gamesLost: user.gamesLost || 0,
        winRate: user.gamesPlayed > 0 ? parseFloat(((user.gamesWon / user.gamesPlayed) * 100).toFixed(2)) : 0,
        totalDeposited: user.totalDeposited || 0,
        totalWithdrawn: user.totalWithdrawn || 0,
        highestStreak: user.highestStreak || 0,
        joinedDate: user.createdAt
      },
      games: {
        coinflips: userCoinflips.length,
        blackjack: userBlackjackGames.length,
        total: user.gamesPlayed
      }
    };

    res.json(userStats);
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

function getFallbackAvatarForUser(user) {
  if (user?.avatar) return user.avatar;
  if (user?.robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxUserId}&width=150&height=150&format=png`;
  }
  return '';
}

function getRobloxDisplayName(user) {
  return user?.customDisplayName || user?.robloxDisplayName || user?.displayName || user?.robloxUsername || 'Anonymous';
}

function buildLeaderboardEntry(user) {
  const winRate = user.gamesPlayed > 0
    ? parseFloat(((user.gamesWon / user.gamesPlayed) * 100).toFixed(2))
    : 0;
  return {
    id: user.id,
    robloxUserId: user.robloxUserId || null,
    robloxUsername: user.robloxUsername || '',
    robloxDisplayName: user.robloxDisplayName || null,
    customDisplayName: user.customDisplayName || null,
    displayName: getRobloxDisplayName(user),
    avatar: user.avatar || getFallbackAvatarForUser(user),
    balance: user.balance,
    gamesPlayed: user.gamesPlayed || 0,
    gamesWon: user.gamesWon || 0,
    gamesLost: user.gamesLost || 0,
    highestStreak: user.highestStreak || 0,
    totalDeposited: user.totalDeposited || 0,
    winRate
  };
}

router.get('/leaderboard', (req, res) => {
  try {
    const { limit = 10, sortBy = 'balance' } = req.query;

    let sortedUsers = [...usersDb.users]
      .filter(u => u.isActive && !u.isBanned)
      .sort((a, b) => {
        switch (sortBy) {
          case 'balance':
            return b.balance - a.balance;
          case 'gamesWon':
            return b.gamesWon - a.gamesWon;
          case 'winRate':
            const rateA = a.gamesPlayed > 0 ? (a.gamesWon / a.gamesPlayed) : 0;
            const rateB = b.gamesPlayed > 0 ? (b.gamesWon / b.gamesPlayed) : 0;
            return rateB - rateA;
          case 'highestStreak':
            return (b.highestStreak || 0) - (a.highestStreak || 0);
          case 'totalDeposited':
            return b.totalDeposited - a.totalDeposited;
          default:
            return b.balance - a.balance;
        }
      })
      .slice(0, parseInt(limit));

    const leaderboard = sortedUsers.map(buildLeaderboardEntry);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/top-players', (req, res) => {
  try {
    const { limit = 10, sortBy = 'balance' } = req.query;

    let sortedUsers = [...usersDb.users]
      .filter(u => u.isActive && !u.isBanned)
      .sort((a, b) => {
        switch (sortBy) {
          case 'balance':
            return b.balance - a.balance;
          case 'gamesWon':
            return b.gamesWon - a.gamesWon;
          case 'winRate':
            const rateA = a.gamesPlayed > 0 ? (a.gamesWon / a.gamesPlayed) : 0;
            const rateB = b.gamesPlayed > 0 ? (b.gamesWon / b.gamesPlayed) : 0;
            return rateB - rateA;
          case 'totalDeposited':
            return b.totalDeposited - a.totalDeposited;
          default:
            return b.balance - a.balance;
        }
      })
      .slice(0, parseInt(limit));

    const topPlayers = sortedUsers.map(buildLeaderboardEntry);
    res.json(topPlayers);
  } catch (error) {
    console.error('Error fetching top players:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get item statistics
router.get('/items', (req, res) => {
  try {
    const { limit = 10, sortBy = 'value' } = req.query;
    
    let sortedItems = [...itemsDb.items]
      .filter(item => item.isEnabled)
      .sort((a, b) => {
        switch(sortBy) {
          case 'value':
            return b.value - a.value;
          case 'rarity':
            const rarityOrder = { 'mythic': 5, 'legendary': 4, 'epic': 3, 'rare': 2, 'uncommon': 1, 'common': 0 };
            return rarityOrder[b.rarity] - rarityOrder[a.rarity];
          default:
            return b.value - a.value;
        }
      })
      .slice(0, parseInt(limit));

    res.json(sortedItems);
  } catch (error) {
    console.error('Error fetching item stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get game statistics
router.get('/games', (req, res) => {
  try {
    const gameStats = {
      coinflips: {
        total: db.coinflips.length,
        active: db.coinflips.filter(cf => cf.status === 'active' || cf.status === 'waiting').length,
        completed: db.coinflips.filter(cf => cf.status === 'completed').length
      },
      blackjack: {
        total: db.blackjackGames.length,
        active: db.blackjackGames.filter(bg => bg.status === 'active' || bg.status === 'player_turn').length,
        completed: db.blackjackGames.filter(bg => bg.status === 'completed').length
      }
    };

    res.json(gameStats);
  } catch (error) {
    console.error('Error fetching game stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;