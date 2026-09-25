const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateAdmin, authenticateStaff } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { addNotification } = require('../notificationService');

function serializeStaffUser(user, includePrivateFields = false) {
  const { password, ...safeUser } = user;
  if (includePrivateFields) {
    return {
      ...safeUser,
      isAdmin: safeUser.isAdmin === true,
      isModerator: safeUser.isModerator === true,
      isMuted: safeUser.isMuted === true
    };
  }

  return {
    id: safeUser.id,
    robloxUserId: safeUser.robloxUserId || null,
    robloxUsername: safeUser.robloxUsername || '',
    robloxDisplayName: safeUser.robloxDisplayName || null,
    customDisplayName: safeUser.customDisplayName || null,
    displayName: safeUser.displayName || safeUser.robloxDisplayName || safeUser.robloxUsername || 'Anonymous',
    avatar: safeUser.avatar || '',
    isAdmin: safeUser.isAdmin === true,
    isModerator: safeUser.isModerator === true,
    isActive: safeUser.isActive !== false,
    isBanned: safeUser.isBanned === true,
    isFrozen: safeUser.isFrozen === true,
    isMuted: safeUser.isMuted === true,
    mutedAt: safeUser.mutedAt || null,
    muteReason: safeUser.muteReason || null,
    createdAt: safeUser.createdAt || null,
    lastLogin: safeUser.lastLogin || null
  };
}

// Staff dashboard stats. Moderators receive only safe operational counters.
function dashboardStats(req, res) {
  try {
    const usersDb = dbManager.getUsersDb();
    const itemsDb = dbManager.getItemsDb();
    const db = dbManager.getMainDb();
    const users = usersDb.users || [];
    const today = new Date();

    const stats = {
      role: req.user.role,
      totalUsers: users.length,
      activeUsers: users.filter((user) => user.isActive !== false && !user.isBanned).length,
      mutedUsers: users.filter((user) => user.isMuted === true).length,
      bannedUsers: users.filter((user) => user.isBanned === true).length,
      totalCoinflips: (db.coinflips || []).length,
      totalBlackjackGames: (db.blackjackGames || []).length,
      totalChatMessages: (db.chatMessages || []).length,
      dailyActiveUsers: users.filter((user) => {
        const lastLogin = new Date(user.lastLogin);
        return !Number.isNaN(lastLogin.getTime()) && lastLogin.toDateString() === today.toDateString();
      }).length
    };

    if (req.user.isAdmin) {
      stats.totalItems = (itemsDb.items || []).length;
      stats.totalTransactions = (db.transactions || []).length;
      stats.totalDeposits = (db.deposits || []).length;
      stats.totalWithdrawals = (db.withdrawals || []).length;
      stats.totalBalance = users.reduce((sum, user) => sum + (user.balance || 0), 0);
    }

    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

router.get('/dashboard', authenticateStaff, dashboardStats);
// Alias used by the frontend admin panel
router.get('/stats', authenticateStaff, dashboardStats);

// Get all users. Moderators receive a deliberately limited projection.
router.get('/users', authenticateStaff, (req, res) => {
  try {
    const { search, page = 1, limit = 1000 } = req.query;
    const usersDb = dbManager.getUsersDb();
    let users = [...(usersDb.users || [])];

    if (search) {
      const term = String(search).toLowerCase();
      users = users.filter((user) =>
        (user.displayName && user.displayName.toLowerCase().includes(term)) ||
        (user.customDisplayName && user.customDisplayName.toLowerCase().includes(term)) ||
        (user.robloxUsername && user.robloxUsername.toLowerCase().includes(term)) ||
        (user.id && user.id.toLowerCase().includes(term))
      );
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 1000);
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const startIndex = (safePage - 1) * safeLimit;
    const paginatedUsers = users.slice(startIndex, startIndex + safeLimit);
    const includePrivateFields = !!req.user.isAdmin;

    res.json({
      users: paginatedUsers.map((user) => serializeStaffUser(user, includePrivateFields)),
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(users.length / safeLimit) || 1,
        total: users.length
      },
      role: req.user.role
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user by ID or robloxUsername
router.get('/users/:robloxUsername', authenticateAdmin, (req, res) => {
  try {
    const robloxUsername = req.params.robloxUsername;
    const usersDb = dbManager.getUsersDb();
    const db = dbManager.getMainDb();

    const user = usersDb.users.find(u => u.robloxUsername === robloxUsername || u.id === robloxUsername);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's inventory
    const inventory = dbManager.getUserInventory(user.id);
    
    // Get user's transactions
    const transactions = (db.transactions || []).filter(t => t.userId === user.id);
    
    // Get user's game history
    const coinflipHistory = (db.coinflips || []).filter(cf => 
      cf.creatorId === user.id || cf.opponentId === user.id
    );
    
    const blackjackHistory = (db.blackjackGames || []).filter(bg => 
      bg.playerId === user.id
    );

    res.json({
      user: serializeStaffUser(user, true),
      inventory,
      transactions,
      gameHistory: {
        coinflip: coinflipHistory,
        blackjack: blackjackHistory
      }
    });
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user balance (give/remove AMPcoin)
router.put('/users/:robloxUsername/balance', authenticateAdmin, (req, res) => {
  try {
    const { amount, action, reason } = req.body;
    const robloxUsername = req.params.robloxUsername;
    const usersDb = dbManager.getUsersDb();
    const db = dbManager.getMainDb();
    
    const user = usersDb.users.find(u => u.robloxUsername === robloxUsername || u.id === robloxUsername);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    let newBalance;
    if (action === 'add') {
      user.balance = (user.balance || 0) + parsedAmount;
      newBalance = user.balance;
    } else if (action === 'remove') {
      if ((user.balance || 0) < parsedAmount) {
        return res.status(400).json({ message: 'Insufficient balance to remove' });
      }
      user.balance = (user.balance || 0) - parsedAmount;
      newBalance = user.balance;
    } else {
      return res.status(400).json({ message: 'Invalid action. Use "add" or "remove"' });
    }

    user.updatedAt = new Date().toISOString();

    // Record admin action
    const adminLog = {
      id: uuidv4(),
      adminId: req.user.userId,
      adminUsername: req.user.robloxUsername,
      action: `balance_${action}`,
      targetUsername: user.robloxUsername,
      oldValue: action === 'add' ? user.balance - parsedAmount : user.balance + parsedAmount,
      newValue: newBalance,
      reason: reason || 'Admin adjustment',
      timestamp: new Date().toISOString()
    };

    // Record transaction
    const transaction = {
      id: uuidv4(),
      userId: user.id,
      robloxUsername: user.robloxUsername,
      amount: action === 'add' ? parsedAmount : -parsedAmount,
      type: `admin_balance_${action}`,
      status: 'completed',
      metadata: {
        adminId: req.user.userId,
        reason: reason || 'Admin adjustment'
      },
      timestamp: new Date().toISOString()
    };

    db.adminLogs = db.adminLogs || [];
    db.adminLogs.push(adminLog);
    db.transactions = db.transactions || [];
    db.transactions.push(transaction);

    dbManager.saveUsersDb();
    dbManager.saveMainDb();

    res.json({
      message: `Balance ${action === 'add' ? 'added' : 'removed'} successfully`,
      newBalance,
      transaction
    });
  } catch (error) {
    console.error('Error updating user balance:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle user account status
router.put('/users/:robloxUsername/status', authenticateAdmin, (req, res) => {
  try {
    const { status, reason } = req.body;
    const robloxUsername = req.params.robloxUsername;
    const usersDb = dbManager.getUsersDb();
    const db = dbManager.getMainDb();
    
    const user = usersDb.users.find(u => u.robloxUsername === robloxUsername || u.id === robloxUsername);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (status !== 'active' && status !== 'inactive' && status !== 'banned') {
      return res.status(400).json({ message: 'Invalid status. Use "active", "inactive", or "banned"' });
    }

    user.isActive = status === 'active';
    user.isBanned = status === 'banned';
    user.updatedAt = new Date().toISOString();

    const adminLog = {
      id: uuidv4(),
      adminId: req.user.userId,
      adminUsername: req.user.robloxUsername,
      action: 'account_status_change',
      targetUsername: user.robloxUsername,
      newValue: status,
      reason: reason || 'Account status change',
      timestamp: new Date().toISOString()
    };

    db.adminLogs = db.adminLogs || [];
    db.adminLogs.push(adminLog);

    dbManager.saveUsersDb();
    dbManager.saveMainDb();

    res.json({
      message: `User status updated to ${status}`,
      user: serializeStaffUser(user, true)
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Set admin status for a user. Explicit state changes prevent accidental
// self-demotion and protect the last active administrator.
router.put('/users/:robloxUsername/admin', authenticateAdmin, (req, res) => {
  try {
    const identifier = req.params.robloxUsername;
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'enabled must be true or false' });
    }

    const usersDb = dbManager.getUsersDb();
    const db = dbManager.getMainDb();
    const user = (usersDb.users || []).find((candidate) =>
      candidate.id === identifier ||
      String(candidate.robloxUsername || '').toLowerCase() === String(identifier).toLowerCase()
    );
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isOwner = String(user.robloxUsername || '').toLowerCase() === 'pooppantspro';
    if (!enabled && isOwner) {
      return res.status(403).json({ message: 'The owner account cannot be demoted' });
    }
    if (!enabled && String(user.id) === String(req.user.userId)) {
      return res.status(403).json({ message: 'You cannot demote your own account' });
    }
    if (!enabled && user.isAdmin === true) {
      const otherActiveAdmins = (usersDb.users || []).filter((candidate) =>
        candidate.id !== user.id &&
        candidate.isAdmin === true &&
        candidate.isActive !== false &&
        candidate.isBanned !== true
      );
      if (otherActiveAdmins.length === 0) {
        return res.status(409).json({ message: 'At least one active admin must remain' });
      }
    }
    if (user.isAdmin === enabled) {
      return res.json({
        message: enabled ? `${user.robloxUsername} is already an admin` : `${user.robloxUsername} is already not an admin`,
        user: serializeStaffUser(user, true),
        unchanged: true
      });
    }

    user.isAdmin = enabled;
    user.isModerator = false;
    user.updatedAt = new Date().toISOString();

    db.adminLogs = db.adminLogs || [];
    db.adminLogs.push({
      id: uuidv4(),
      adminId: req.user.userId,
      adminUsername: req.user.robloxUsername,
      action: enabled ? 'made_admin' : 'removed_admin',
      targetUserId: user.id,
      targetUsername: user.robloxUsername,
      timestamp: new Date().toISOString()
    });

    dbManager.saveUsersDb();
    dbManager.saveMainDb();

    res.json({
      message: enabled ? `${user.robloxUsername} is now an admin` : `${user.robloxUsername} is no longer an admin`,
      user: serializeStaffUser(user, true)
    });
  } catch (error) {
    console.error('Error updating admin role:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Grant or revoke moderator access. Only full admins can change roles.
router.put('/users/:robloxUsername/moderator', authenticateAdmin, (req, res) => {
  try {
    const identifier = req.params.robloxUsername;
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'enabled must be true or false' });
    }

    const usersDb = dbManager.getUsersDb();
    const user = (usersDb.users || []).find((candidate) =>
      candidate.id === identifier ||
      String(candidate.robloxUsername || '').toLowerCase() === String(identifier).toLowerCase()
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (String(user.robloxUsername || '').toLowerCase() === 'pooppantspro') {
      return res.status(403).json({ message: 'The owner account cannot be changed to moderator' });
    }
    if (user.isAdmin === true) {
      return res.status(400).json({ message: 'Administrators already have full access' });
    }

    user.isModerator = enabled;
    user.updatedAt = new Date().toISOString();

    const db = dbManager.getMainDb();
    db.adminLogs = db.adminLogs || [];
    db.adminLogs.push({
      id: uuidv4(),
      adminId: req.user.userId,
      adminUsername: req.user.robloxUsername,
      action: enabled ? 'made_moderator' : 'removed_moderator',
      targetUserId: user.id,
      targetUsername: user.robloxUsername,
      timestamp: new Date().toISOString()
    });

    dbManager.saveUsersDb();
    dbManager.saveMainDb();
    res.json({
      message: enabled ? `${user.robloxUsername} is now a moderator` : `${user.robloxUsername} is no longer a moderator`,
      user: serializeStaffUser(user, true)
    });
  } catch (error) {
    console.error('Error updating moderator role:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add item to user inventory
router.post('/user/:userId/add-item', authenticateAdmin, (req, res) => {
  try {
    const { userId } = req.params;
    const { itemId, petId, quantity = 1, mods = [] } = req.body;
    const targetItemId = itemId || petId;

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const itemsDb = dbManager.getItemsDb();
    const item = itemsDb.items.find(i => i.id === targetItemId || i.itemId === targetItemId);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Optional pet modifiers: F +5%, R +5%, M +20%, N +8% on base value.
    // Modded copies get a distinct itemId suffix so they stack separately
    // from unmodded copies in the user's inventory.
    const MOD_BONUS = { F: 0.05, R: 0.05, M: 0.20, N: 0.08 };
    let cleanMods = Array.isArray(mods) ? [...new Set(mods)].filter((m) => MOD_BONUS[m]) : [];
    // M = Mega+Fly+Ride, N = Neon+Fly+Ride; M and N mutually exclusive (Mega wins)
    if (cleanMods.includes('M')) cleanMods = [...cleanMods.filter((m) => m !== 'N'), 'M', 'F', 'R'];
    else if (cleanMods.includes('N')) cleanMods = [...cleanMods, 'N', 'F', 'R'];
    cleanMods = [...new Set(cleanMods)];
    // Display order: M/N first, then F, then R (e.g. MFR, NFR)
    const ORDER = { M: 0, N: 0, F: 1, R: 2 };
    cleanMods.sort((a, b) => (ORDER[a] ?? 3) - (ORDER[b] ?? 3));
    let itemToGive = item;
    if (cleanMods.length > 0) {
      const base = Number(item.baseValue);
      const baseValue = (!isNaN(base) && base >= 0) ? base : Number(item.value || 0);
      const mult = 1 + cleanMods.reduce((s, m) => s + MOD_BONUS[m], 0);
      const moddedValue = Math.round(baseValue * mult);
      const suffix = cleanMods.join('');
      itemToGive = {
        ...item,
        itemId: `${item.itemId || item.id}:${suffix}`,
        id: `${item.id || item.itemId}:${suffix}`,
        name: `${item.name || item.itemName}${cleanMods.length ? ` (${cleanMods.join('')})` : ''}`,
        itemName: `${item.itemName || item.name}${cleanMods.length ? ` (${cleanMods.join('')})` : ''}`,
        value: moddedValue,
        baseValue,
        mods: cleanMods
      };
    }

    const inventory = dbManager.addItemToUserInventory(userId, itemToGive, quantity);

    const db = dbManager.getMainDb();
    const adminLog = {
      id: uuidv4(),
      adminId: req.user.userId,
      adminUsername: req.user.robloxUsername,
      action: 'add_item_to_user',
      targetUserId: userId,
      targetUsername: user.robloxUsername,
      itemId: item.id,
      itemName: item.name,
      quantity: quantity,
      timestamp: new Date().toISOString()
    };
    db.adminLogs = db.adminLogs || [];
    db.adminLogs.push(adminLog);
    dbManager.saveMainDb();

    res.json({
      message: 'Item added to user inventory successfully',
      inventory: dbManager.getUserInventory(userId)
    });
  } catch (error) {
    console.error('Error adding item to user inventory:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Alias for add-pet to user inventory
router.post('/user/:userId/add-pet', authenticateAdmin, (req, res) => {
  const { userId } = req.params;
  const { petId, itemId, quantity = 1, mods = [] } = req.body;
  const targetId = petId || itemId;

  const usersDb = dbManager.getUsersDb();
  const user = usersDb.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const itemsDb = dbManager.getItemsDb();
  const item = itemsDb.items.find(i => i.id === targetId || i.itemId === targetId);
  if (!item) {
    return res.status(404).json({ message: 'Pet not found' });
  }

  const MOD_BONUS = { F: 0.05, R: 0.05, M: 0.20, N: 0.08 };
  let cleanMods = Array.isArray(mods) ? [...new Set(mods)].filter((m) => MOD_BONUS[m]) : [];
    // M = Mega+Fly+Ride, N = Neon+Fly+Ride; M and N mutually exclusive (Mega wins)
    if (cleanMods.includes('M')) cleanMods = [...cleanMods.filter((m) => m !== 'N'), 'M', 'F', 'R'];
    else if (cleanMods.includes('N')) cleanMods = [...cleanMods, 'N', 'F', 'R'];
    cleanMods = [...new Set(cleanMods)];
    // Display order: M/N first, then F, then R (e.g. MFR, NFR)
    const ORDER = { M: 0, N: 0, F: 1, R: 2 };
    cleanMods.sort((a, b) => (ORDER[a] ?? 3) - (ORDER[b] ?? 3));
  let itemToGive = item;
  if (cleanMods.length > 0) {
    const base = Number(item.baseValue);
    const baseValue = (!isNaN(base) && base >= 0) ? base : Number(item.value || 0);
    const mult = 1 + cleanMods.reduce((s, m) => s + MOD_BONUS[m], 0);
    const moddedValue = Math.round(baseValue * mult);
    const suffix = cleanMods.join('');
    itemToGive = {
      ...item,
      itemId: `${item.itemId || item.id}:${suffix}`,
      id: `${item.id || item.itemId}:${suffix}`,
      name: `${item.name || item.itemName}${cleanMods.length ? ` (${cleanMods.join('')})` : ''}`,
      itemName: `${item.itemName || item.name}${cleanMods.length ? ` (${cleanMods.join('')})` : ''}`,
      value: moddedValue,
      baseValue,
      mods: cleanMods
    };
  }

  dbManager.addItemToUserInventory(userId, itemToGive, quantity);

  const db = dbManager.getMainDb();
  db.adminLogs = db.adminLogs || [];
  db.adminLogs.push({
    id: uuidv4(),
    adminId: req.user.userId,
    adminUsername: req.user.robloxUsername,
    action: 'add_pet_to_user',
    targetUserId: userId,
    targetUsername: user.robloxUsername,
    itemId: item.id,
    itemName: item.name,
    quantity,
    timestamp: new Date().toISOString()
  });
  dbManager.saveMainDb();

  res.json({
    message: 'Pet added to user inventory successfully',
    inventory: dbManager.getUserInventory(userId)
  });
});

// Remove item / pet from user inventory
router.delete('/user/:userId/remove-pet/:petId', authenticateAdmin, (req, res) => {
  try {
    const { userId, petId } = req.params;
    const { quantity = 1 } = req.body || {};

    const success = dbManager.removeItemFromUserInventory(userId, petId, quantity);
    if (!success) {
      return res.status(404).json({ message: 'Item not found in user inventory' });
    }

    const db = dbManager.getMainDb();
    db.adminLogs = db.adminLogs || [];
    db.adminLogs.push({
      id: uuidv4(),
      adminId: req.user.userId,
      adminUsername: req.user.robloxUsername,
      action: 'remove_pet_from_user',
      targetUserId: userId,
      petId,
      timestamp: new Date().toISOString()
    });
    dbManager.saveMainDb();

    res.json({
      message: 'Pet removed from user inventory successfully',
      inventory: dbManager.getUserInventory(userId)
    });
  } catch (error) {
    console.error('Error removing pet from user inventory:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all items
router.get('/items', authenticateAdmin, (req, res) => {
  try {
    const { search, rarity, enabled } = req.query;
    const itemsDb = dbManager.getItemsDb();
    let items = [...(itemsDb.items || [])];

    if (search) {
      const term = search.toLowerCase();
      items = items.filter(item => 
        (item.name && item.name.toLowerCase().includes(term)) ||
        (item.description && item.description.toLowerCase().includes(term))
      );
    }

    if (rarity) {
      items = items.filter(item => item.rarity === rarity);
    }

    if (enabled !== undefined) {
      items = items.filter(item => item.isEnabled === (enabled === 'true'));
    }

    res.json(items);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all coinflips
router.get('/coinflips', authenticateAdmin, (req, res) => {
  try {
    const { status, dateFrom, dateTo } = req.query;
    const db = dbManager.getMainDb();
    let coinflips = [...(db.coinflips || [])];

    if (status) {
      coinflips = coinflips.filter(cf => cf.status === status);
    }

    if (dateFrom) {
      coinflips = coinflips.filter(cf => new Date(cf.createdAt) >= new Date(dateFrom));
    }

    if (dateTo) {
      coinflips = coinflips.filter(cf => new Date(cf.createdAt) <= new Date(dateTo));
    }

    res.json(coinflips);
  } catch (error) {
    console.error('Error fetching coinflips:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete every user except POOpPANTSpro (+ their inventories, trades, offers).
// OWNER ONLY. Used to reset the player base while keeping the owner account.
router.post('/wipe-users', authenticateAdmin, (req, res) => {
  try {
    const who = String(req.user.robloxUsername || '').toLowerCase();
    if (who !== 'pooppantspro') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    const usersDb = dbManager.getUsersDb();
    const db = dbManager.getMainDb();

    const doomed = (usersDb.users || []).filter(
      (u) => String(u.robloxUsername || '').toLowerCase() !== 'pooppantspro'
    );
    const doomedIds = new Set(doomed.map((u) => u.id));

    // Drop their inventories
    let wipedInventories = 0;
    const invs = db.inventories || [];
    const invList = Array.isArray(invs) ? invs : Object.values(invs);
    for (const inv of invList) {
      const ownerId = inv.userId || inv.id;
      if (ownerId && doomedIds.has(ownerId)) {
        if (Array.isArray(inv.items) && inv.items.length > 0) wipedInventories++;
        inv.items = [];
        inv.totalValue = 0;
      }
    }

    // Close trades they created, strip their offers from others' trades
    let closedTrades = 0;
    let strippedOffers = 0;
    for (const t of db.trades || []) {
      if (t.status !== 'open') continue;
      if (doomedIds.has(t.creatorId)) {
        t.status = 'cancelled';
        t.updatedAt = new Date().toISOString();
        closedTrades++;
      } else if (Array.isArray(t.offers)) {
        const before = t.offers.length;
        t.offers = t.offers.filter((o) => !doomedIds.has(o.userId));
        strippedOffers += before - t.offers.length;
      }
    }

    usersDb.users = (usersDb.users || []).filter(
      (u) => String(u.robloxUsername || '').toLowerCase() === 'pooppantspro'
    );

    dbManager.saveUsersDb();
    dbManager.saveMainDb();

    try {
      const { emitToAll } = require('../realtime');
      emitToAll('inventoryUpdate', { all: true });
      emitToAll('tradeUpdate', { at: new Date().toISOString() });
    } catch (_) { /* ignore */ }

    res.json({
      wipedUsers: doomed.length,
      wipedInventories,
      closedTrades,
      strippedOffers,
      remainingUsers: usersDb.users.length
    });
  } catch (error) {
    console.error('Error wiping users:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove every inventory copy of items matching a name — OWNER ONLY.
// Used to wipe a specific pet (e.g. "Bat Dragon (MFR)") from all users.
router.post('/remove-item-everywhere', authenticateAdmin, (req, res) => {
  try {
    const who = String(req.user.robloxUsername || '').toLowerCase();
    if (who !== 'pooppantspro') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    const name = String(req.body.name || '').trim().toLowerCase();
    if (!name) return res.status(400).json({ message: 'name is required' });

    const db = dbManager.getMainDb();
    let purgedStacks = 0;
    let purgedUnits = 0;
    const invs = db.inventories || [];
    const list = Array.isArray(invs) ? invs : Object.values(invs);
    for (const inv of list) {
      if (!inv || !Array.isArray(inv.items)) continue;
      const kept = [];
      for (const it of inv.items) {
        const n = String(it.name || it.itemName || '').toLowerCase();
        if (n === name || n.includes(name)) {
          purgedStacks += 1;
          purgedUnits += Math.max(1, parseInt(it.quantity || 1, 10) || 1);
        } else {
          kept.push(it);
        }
      }
      inv.items = kept;
      inv.totalValue = kept.reduce((s, i) => s + ((i.value || 0) * (i.quantity || 1)), 0);
    }
    dbManager.saveMainDb();

    try {
      const { emitToAll } = require('../realtime');
      emitToAll('inventoryUpdate', { all: true });
    } catch (_) { /* ignore */ }

    res.json({ purgedStacks, purgedUnits });
  } catch (error) {
    console.error('Error removing item everywhere:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// One-shot purge: delete ALL common + uncommon pets from the catalog and
// strip them from every user inventory. OWNER ONLY (POOpPANTSpro).
router.post('/purge-commons', authenticateAdmin, (req, res) => {
  try {
    const who = String(req.user.robloxUsername || '').toLowerCase();
    if (who !== 'pooppantspro') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    const isLow = (r) => ['common', 'uncommon'].includes(String(r || '').toLowerCase());

    const itemsDb = dbManager.getItemsDb();
    const before = (itemsDb.items || []).length;
    const removed = (itemsDb.items || []).filter((i) => isLow(i.rarity));
    const removedIds = new Set(removed.map((i) => i.itemId || i.id));
    itemsDb.items = (itemsDb.items || []).filter((i) => !isLow(i.rarity));
    dbManager.saveItemsDb();

    // Strip from all inventories (match base id too, e.g. modded "id:FR" copies)
    const db = dbManager.getMainDb();
    let purgedStacks = 0;
    const invs = db.inventories || [];
    const list = Array.isArray(invs) ? invs : Object.values(invs);
    for (const inv of list) {
      if (!inv || !Array.isArray(inv.items)) continue;
      const n0 = inv.items.length;
      inv.items = inv.items.filter((it) => {
        const base = String(it.itemId || it.id || '').split(':')[0];
        return !removedIds.has(it.itemId) && !removedIds.has(it.id) && !removedIds.has(base);
      });
      purgedStacks += n0 - inv.items.length;
      inv.totalValue = inv.items.reduce((s, i) => s + ((i.value || 0) * (i.quantity || 1)), 0);
    }
    dbManager.saveMainDb();

    res.json({
      removedCatalog: before - (itemsDb.items || []).length,
      remainingCatalog: (itemsDb.items || []).length,
      purgedStacks
    });
  } catch (error) {
    console.error('Error purging commons:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all blackjack games
router.get('/blackjack', authenticateAdmin, (req, res) => {
  try {
    const { status, dateFrom, dateTo } = req.query;
    const db = dbManager.getMainDb();
    let games = [...(db.blackjackGames || [])];

    if (status) {
      games = games.filter(game => game.status === status);
    }

    if (dateFrom) {
      games = games.filter(game => new Date(game.createdAt) >= new Date(dateFrom));
    }

    if (dateTo) {
      games = games.filter(game => new Date(game.createdAt) <= new Date(dateTo));
    }

    res.json(games);
  } catch (error) {
    console.error('Error fetching blackjack games:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get tax collection history — enriched with coinflip details
router.get('/tax-history', authenticateAdmin, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    const transactions = (db.transactions || []).filter(t => t.type === 'coinflip_tax');
    const coinflips = db.coinflips || [];
    const allCoinflips = [...coinflips]; // include completed ones from history

    const taxRecords = transactions.map(t => {
      const cf = allCoinflips.find(c => c.id === t.metadata?.coinflipId);
      const totalPets = cf
        ? ((cf.creatorItems || []).reduce((s, i) => s + (i.quantity || 1), 0) +
           (cf.opponentItems || []).reduce((s, i) => s + (i.quantity || 1), 0))
        : null;

      return {
        id: t.id,
        coinflipId: t.metadata?.coinflipId || null,
        winnerUsername: t.robloxUsername || t.userId,
        winnerDisplayName: t.metadata?.winnerDisplayName || t.robloxUsername || t.userId,
        taxRecipientUsername: t.metadata?.taxRecipientUsername || '—',
        taxRate: t.metadata?.taxRate || 0,
        totalPets,
        taxItems: (t.metadata?.taxItems || []).map(i => ({
          name: i.name || i.itemId,
          quantity: i.quantity || 1,
          value: i.value || 0
        })),
        taxValue: (t.metadata?.taxItems || []).reduce((s, i) => s + (i.value || 0) * (i.quantity || 1), 0),
        timestamp: t.timestamp
      };
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ taxRecords });
  } catch (error) {
    console.error('Error fetching tax history:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all transactions
router.get('/transactions', authenticateAdmin, (req, res) => {
  try {
    const { type, userId, dateFrom, dateTo } = req.query;
    const db = dbManager.getMainDb();
    let transactions = [...(db.transactions || [])];

    if (type) {
      transactions = transactions.filter(t => t.type === type);
    }

    if (userId) {
      transactions = transactions.filter(t => t.userId === userId);
    }

    if (dateFrom) {
      transactions = transactions.filter(t => new Date(t.timestamp) >= new Date(dateFrom));
    }

    if (dateTo) {
      transactions = transactions.filter(t => new Date(t.timestamp) <= new Date(dateTo));
    }

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all deposits
router.get('/deposits', authenticateAdmin, (req, res) => {
  try {
    const { status, userId, dateFrom, dateTo } = req.query;
    const db = dbManager.getMainDb();
    let deposits = [...(db.deposits || [])];

    if (status) {
      deposits = deposits.filter(d => d.status === status);
    }

    if (userId) {
      deposits = deposits.filter(d => d.userId === userId);
    }

    if (dateFrom) {
      deposits = deposits.filter(d => new Date(d.timestamp) >= new Date(dateFrom));
    }

    if (dateTo) {
      deposits = deposits.filter(d => new Date(d.timestamp) <= new Date(dateTo));
    }

    res.json(deposits);
  } catch (error) {
    console.error('Error fetching deposits:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get pending transactions (both fund and item withdrawals)
router.get('/transactions/pending', authenticateAdmin, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    const usersDb = dbManager.getUsersDb();

    const pendingFundWithdrawals = Array.isArray(db.withdrawals) 
      ? db.withdrawals.filter(w => w?.status === 'pending') 
      : [];
      
    const pendingItemWithdrawals = Array.isArray(db.itemWithdrawals)
      ? db.itemWithdrawals.filter(w => w?.status === 'pending')
      : [];

    const pendingTransactions = Array.isArray(db.transactions)
      ? db.transactions.filter(t => t?.status === 'pending')
      : [];
    
    const allPending = [
      ...pendingFundWithdrawals.map(w => {
        const u = usersDb.users.find(u => u.robloxUsername === w.robloxUsername || u.id === w.userId);
        return {
          id: w.id,
          type: 'fund_withdrawal',
          amount: w.amount || 0,
          status: w.status,
          robloxUsername: w.robloxUsername || u?.robloxUsername || '',
          displayName: u?.displayName || u?.robloxDisplayName || w.robloxUsername || '',
          userName: u?.displayName || w.robloxUsername || w.userId || 'Unknown User',
          userId: w.userId || u?.id || '',
          address: w.address || '',
          createdAt: w.createdAt || w.timestamp || new Date().toISOString()
        };
      }),
      ...pendingItemWithdrawals.map(w => {
        const u = usersDb.users.find(u => u.id === w.userId);
        return {
          id: w.id,
          type: 'item_withdrawal',
          items: Array.isArray(w.items) ? w.items : [],
          totalValue: typeof w.totalValue === 'number' ? w.totalValue : 0,
          amount: typeof w.totalValue === 'number' ? w.totalValue : 0,
          status: w.status,
          robloxUsername: w.robloxUsername || u?.robloxUsername || '',
          displayName: w.displayName || u?.displayName || u?.robloxDisplayName || w.robloxUsername || '',
          userName: u?.displayName || w.userId || 'Unknown User',
          userId: w.userId || '',
          address: w.address || '',
          createdAt: w.createdAt || new Date().toISOString()
        };
      }),
      ...pendingTransactions.map(t => ({
        id: t.id,
        type: t.type || 'transaction',
        amount: t.amount || 0,
        status: t.status || 'pending',
        userName: t.robloxUsername || t.userId || 'Unknown User',
        userId: t.userId || '',
        createdAt: t.timestamp || new Date().toISOString()
      }))
    ];
    
    res.json({ transactions: allPending });
  } catch (error) {
    console.error('Error fetching pending transactions:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update transaction status (handles approve, pending, reject from Admin Panel)
router.put('/transactions/:transactionId/status', authenticateAdmin, (req, res) => {
  try {
    const { status, reason } = req.body;
    const transactionId = req.params.transactionId;
    const db = dbManager.getMainDb();

    let transaction = (db.transactions || []).find(t => t.id === transactionId);
    let withdrawal = (db.withdrawals || []).find(w => w.id === transactionId);
    let itemWithdrawal = (db.itemWithdrawals || []).find(w => w.id === transactionId);

    if (!transaction && !withdrawal && !itemWithdrawal) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (transaction) {
      transaction.status = status;
      transaction.updatedAt = new Date().toISOString();
    }
    if (withdrawal) {
      withdrawal.status = status;
      withdrawal.updatedAt = new Date().toISOString();
    }
    if (itemWithdrawal) {
      itemWithdrawal.status = status;
      itemWithdrawal.updatedAt = new Date().toISOString();
    }

    // Notify the owner when their withdrawal completes
    if (status === 'completed') {
      const ownerId = (withdrawal && withdrawal.userId) || (itemWithdrawal && itemWithdrawal.userId);
      if (ownerId) {
        addNotification({
          userId: ownerId,
          type: 'withdrawal',
          title: 'Withdrawal completed',
          message: itemWithdrawal
            ? 'Your item withdrawal was completed — check your Roblox inventory!'
            : 'Your withdrawal was completed successfully!',
          imageUrl: (itemWithdrawal && itemWithdrawal.imageUrl) || ''
        });
      }
    }

    const adminLog = {
      id: uuidv4(),
      adminId: req.user.userId,
      adminUsername: req.user.robloxUsername,
      action: 'transaction_status_update',
      targetId: transactionId,
      newValue: status,
      reason: reason || 'Admin transaction update',
      timestamp: new Date().toISOString()
    };
    db.adminLogs = db.adminLogs || [];
    db.adminLogs.push(adminLog);

    dbManager.saveMainDb();

    res.json({
      message: `Transaction status updated to ${status}`,
      status,
      id: transactionId,
      amount: transaction?.amount || withdrawal?.amount || itemWithdrawal?.totalValue || 0
    });
  } catch (error) {
    console.error('Error updating transaction status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all withdrawals
router.get('/withdrawals', authenticateAdmin, (req, res) => {
  try {
    const { status, userId, dateFrom, dateTo } = req.query;
    const db = dbManager.getMainDb();
    
    let fundWithdrawals = [...(db.withdrawals || [])];
    let itemWithdrawals = [...(db.itemWithdrawals || [])];

    if (status) {
      fundWithdrawals = fundWithdrawals.filter(w => w.status === status);
      itemWithdrawals = itemWithdrawals.filter(w => w.status === status);
    }

    if (userId) {
      fundWithdrawals = fundWithdrawals.filter(w => w.userId === userId);
      itemWithdrawals = itemWithdrawals.filter(w => w.userId === userId);
    }

    if (dateFrom) {
      fundWithdrawals = fundWithdrawals.filter(w => new Date(w.timestamp || w.createdAt) >= new Date(dateFrom));
      itemWithdrawals = itemWithdrawals.filter(w => new Date(w.createdAt) >= new Date(dateFrom));
    }

    if (dateTo) {
      fundWithdrawals = fundWithdrawals.filter(w => new Date(w.timestamp || w.createdAt) <= new Date(dateTo));
      itemWithdrawals = itemWithdrawals.filter(w => new Date(w.createdAt) <= new Date(dateTo));
    }

    res.json({
      fundWithdrawals,
      itemWithdrawals
    });
  } catch (error) {
    console.error('Error fetching withdrawals:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update withdrawal status
router.put('/withdrawals/:withdrawalId/status', authenticateAdmin, (req, res) => {
  try {
    const { status, reason } = req.body;
    const withdrawalId = req.params.withdrawalId;
    const db = dbManager.getMainDb();
    
    let withdrawal = (db.withdrawals || []).find(w => w.id === withdrawalId);
    let itemWithdrawal = (db.itemWithdrawals || []).find(w => w.id === withdrawalId);
    
    if (!withdrawal && !itemWithdrawal) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }

    if (withdrawal) {
      withdrawal.status = status;
      withdrawal.updatedAt = new Date().toISOString();
    }
    if (itemWithdrawal) {
      itemWithdrawal.status = status;
      itemWithdrawal.updatedAt = new Date().toISOString();
    }

    dbManager.saveMainDb();

    res.json({
      message: `Withdrawal status updated to ${status}`,
      status
    });
  } catch (error) {
    console.error('Error updating withdrawal status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Ensure settings storage is the canonical array shape (dbHelper may load an object)
function ensureSettingsArray(db) {
  if (!Array.isArray(db.settings)) {
    const obj = (db.settings && typeof db.settings === 'object') ? db.settings : {};
    db.settings = Object.entries(obj).map(([key, value]) => ({
      id: uuidv4(), key, value, category: 'taxes',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }));
  }
  return db.settings;
}

function readStringSetting(settings, key) {
  if (Array.isArray(settings)) return settings.find(s => s.key === key)?.value ?? '';
  if (settings && typeof settings === 'object') return settings[key] ?? '';
  return '';
}

// Get tax settings: master switch + single 10-30% rate + recipient
router.get('/taxes', authenticateAdmin, (req, res) => {
  try {
    const { getTaxConfig } = require('../taxUtil');
    const cfg = getTaxConfig();
    const db = dbManager.getMainDb();
    res.json({
      taxEnabled: cfg.enabled,
      taxPercent: cfg.percent,
      taxRecipient: String(readStringSetting(db.settings, 'tax_recipient') || '')
    });
  } catch (error) {
    console.error('Error fetching tax settings:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update tax settings: { taxEnabled: bool, taxPercent: 10-30, taxRecipient: id/username }
router.put('/taxes', authenticateAdmin, (req, res) => {
  try {
    const { taxEnabled, taxPercent, taxRecipient } = req.body;
    const db = dbManager.getMainDb();
    ensureSettingsArray(db);

    const enabled = !!(taxEnabled === true || taxEnabled === 1 ||
      String(taxEnabled).toLowerCase() === 'true' || String(taxEnabled) === '1');
    let pct = parseFloat(taxPercent);
    if (isNaN(pct)) {
      const cur = db.settings.find(s => s.key === 'tax_percentage');
      pct = cur ? parseFloat(cur.value) : 15;
      if (isNaN(pct)) pct = 15;
    }
    pct = Math.min(30, Math.max(10, pct));

    const upsert = (key, value, description) => {
      let setting = db.settings.find(s => s.key === key);
      if (setting) {
        setting.value = value;
        setting.updatedAt = new Date().toISOString();
      } else {
        db.settings.push({
          id: uuidv4(),
          key,
          value,
          description,
          category: 'taxes',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    };

    upsert('tax_enabled', enabled, 'Master tax switch');
    upsert('tax_percentage', pct, 'House tax percentage (10-30)');
    // Keep legacy per-game keys in sync so nothing reads a stale rate
    upsert('coinflip_fee_percentage', pct / 100, 'Coinflip tax (mirrors master tax)');
    upsert('blackjack_fee_percentage', pct / 100, 'Blackjack tax (mirrors master tax)');

    // Tax recipient: user id or roblox username that receives taxed items.
    let recipientSetting = db.settings.find(s => s.key === 'tax_recipient');
    const recipientValue = (taxRecipient === undefined || taxRecipient === null)
      ? (recipientSetting ? recipientSetting.value : '')
      : String(taxRecipient).trim();
    if (recipientSetting) {
      recipientSetting.value = recipientValue;
      recipientSetting.updatedAt = new Date().toISOString();
    } else {
      db.settings.push({
        id: uuidv4(),
        key: 'tax_recipient',
        value: recipientValue,
        description: 'User (id or roblox username) that receives taxed items',
        category: 'taxes',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    dbManager.saveMainDb();

    res.json({ taxEnabled: enabled, taxPercent: pct, taxRecipient: recipientValue });
  } catch (error) {
    console.error('Error updating tax settings:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get tax recipients
router.get('/tax-recipients', authenticateAdmin, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    res.json(db.taxRecipients || []);
  } catch (error) {
    console.error('Error fetching tax recipients:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get admin logs
router.get('/logs', authenticateAdmin, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    const logs = [...(db.adminLogs || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(logs);
  } catch (error) {
    console.error('Error fetching admin logs:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

function normBool(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return fallback;
}

// Get admin settings
router.get('/settings', authenticateAdmin, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    ensureSettingsArray(db);
    const botUser = db.settings.find(s => s.key === 'bot_user')?.value || '';
    const redirectLink = db.settings.find(s => s.key === 'redirect_link')?.value || '';
    const botEnabledRaw = db.settings.find(s => s.key === 'bot_enabled')?.value;
    const botEnabled = normBool(botEnabledRaw, true);
    
    res.json({ settings: { botUser, redirectLink, botEnabled } });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update admin settings
router.put('/settings', authenticateAdmin, (req, res) => {
  try {
    const { botUser, redirectLink, botEnabled } = req.body;
    const db = dbManager.getMainDb();
    ensureSettingsArray(db);
    
    let botUserSetting = db.settings.find(s => s.key === 'bot_user');
    if (botUserSetting) {
      botUserSetting.value = botUser;
      botUserSetting.updatedAt = new Date().toISOString();
    } else {
      db.settings.push({
        id: uuidv4(),
        key: 'bot_user',
        value: botUser,
        description: 'Bot user identifier for transactions',
        category: 'bot',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    let redirectLinkSetting = db.settings.find(s => s.key === 'redirect_link');
    if (redirectLinkSetting) {
      redirectLinkSetting.value = redirectLink;
      redirectLinkSetting.updatedAt = new Date().toISOString();
    } else {
      db.settings.push({
        id: uuidv4(),
        key: 'redirect_link',
        value: redirectLink,
        description: 'Redirect link for bot transactions',
        category: 'bot',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    const enabled = normBool(botEnabled, true);
    let botEnabledSetting = db.settings.find(s => s.key === 'bot_enabled');
    if (botEnabledSetting) {
      botEnabledSetting.value = enabled;
      botEnabledSetting.updatedAt = new Date().toISOString();
    } else {
      db.settings.push({
        id: uuidv4(),
        key: 'bot_enabled',
        value: enabled,
        description: 'Master switch for the trade bot',
        category: 'bot',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    dbManager.saveMainDb();
    res.json({ settings: { botUser, redirectLink, botEnabled: enabled } });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;