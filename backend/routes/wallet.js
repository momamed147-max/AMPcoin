const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { addNotification } = require('../notificationService');

// Public bot info for withdrawals (bot username + join link from admin settings)
router.get('/bot', (req, res) => {
  try {
    const db = dbManager.getMainDb();
    const settings = Array.isArray(db.settings) ? db.settings : [];
    const botUser = settings.find((s) => s.key === 'bot_user')?.value || '';
    const redirectLink = settings.find((s) => s.key === 'redirect_link')?.value || '';
    res.json({ botUser, redirectLink });
  } catch (error) {
    console.error('Error fetching bot info:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/withdraw-items', authenticateToken, (req, res) => {
  try {
    const { items, address } = req.body;
    const userId = req.user.userId;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items required' });
    }
    
    if (!address) {
      return res.status(400).json({ message: 'Address required' });
    }
    
    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userInventory = dbManager.getUserInventory(userId);
    if (!userInventory || !userInventory.items) {
      return res.status(400).json({ message: 'User has no inventory' });
    }
    
    // Check if all requested items exist in inventory
    for (const item of items) {
      const targetId = item.itemId || item.id;
      const invItem = userInventory.items.find(i => i.itemId === targetId || i.id === targetId);
      if (!invItem || invItem.quantity < 1) {
        return res.status(400).json({ message: `Item ${item.itemName || item.name} not available in inventory` });
      }
    }
    
    // Remove items from user inventory
    for (const item of items) {
      const targetId = item.itemId || item.id;
      dbManager.removeItemFromUserInventory(userId, targetId, 1);
    }
    
    const itemWithdrawal = {
      id: uuidv4(),
      userId,
      robloxUsername: user.robloxUsername,
      displayName: user.displayName || user.robloxDisplayName || user.robloxUsername,
      items: items.map(item => ({
        itemId: item.itemId || item.id,
        name: item.itemName || item.name,
        value: item.value || 0,
        rarity: item.rarity || 'common',
        image: item.image || item.imageUrl || '',
        quantity: 1
      })),
      totalValue: items.reduce((sum, item) => sum + (item.value || 0), 0),
      address,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const db = dbManager.getMainDb();
    db.itemWithdrawals = db.itemWithdrawals || [];
    db.itemWithdrawals.push(itemWithdrawal);
    dbManager.saveMainDb();

    // Real-time: notify user inventory changed
    const { emitToAll } = require('../realtime');
    emitToAll('inventoryUpdate', { userId });

    // Notify all admins of the withdrawal request
    try {
      const admins = (usersDb.users || []).filter((u) => u.isAdmin && u.id !== userId);
      const who = user.displayName || user.robloxDisplayName || user.robloxUsername || 'Someone';
      for (const admin of admins) {
        addNotification({
          userId: admin.id,
          type: 'withdrawal',
          title: 'Withdrawal request',
          message: `${who} requested withdrawal of ${itemWithdrawal.items.length} item(s) worth ${Number(itemWithdrawal.totalValue || 0).toLocaleString()} AMP`,
          imageUrl: ''
        });
      }
    } catch (e) {
      console.error('Admin withdraw notify failed:', e.message);
    }

    res.json({
      message: 'Item withdrawal request submitted successfully',
      itemWithdrawal
    });
  } catch (error) {
    console.error('Error processing item withdrawal:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a deposit request (player sends AMP, admin approves in panel)
router.post('/deposit', authenticateToken, (req, res) => {
  try {
    const { amount, address } = req.body;
    const userId = req.user.userId;

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const deposit = {
      id: uuidv4(),
      userId,
      robloxUsername: user.robloxUsername,
      amount: parsed,
      address: address || 'Deposit',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const db = dbManager.getMainDb();
    db.deposits = db.deposits || [];
    db.deposits.push(deposit);
    dbManager.saveMainDb();

    res.status(201).json({
      message: 'Deposit request submitted — an admin will approve it shortly',
      deposit
    });
  } catch (error) {
    console.error('Error processing deposit:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Public bot info for the deposit panel (bot username + join link from admin settings)
router.get('/bot-info', (req, res) => {
  try {
    const db = dbManager.getMainDb();
    const settings = Array.isArray(db.settings) ? db.settings : [];
    const botUser = settings.find(s => s.key === 'bot_user')?.value || '';
    const redirectLink = settings.find(s => s.key === 'redirect_link')?.value || '';
    const rawEnabled = settings.find(s => s.key === 'bot_enabled')?.value;
    const botEnabled = rawEnabled === undefined || rawEnabled === null || rawEnabled === ''
      ? true
      : (rawEnabled === true || rawEnabled === 1 || String(rawEnabled).toLowerCase() === 'true' || String(rawEnabled) === '1');
    res.json({ botUser, redirectLink, botEnabled });
  } catch (error) {
    console.error('Error fetching bot info:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's pending withdrawals
router.get('/withdrawals/:robloxUsername', authenticateToken, (req, res) => {
  try {
    const robloxUsername = req.params.robloxUsername;
    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.robloxUsername === robloxUsername || u.id === robloxUsername);
    const targetUserId = user ? user.id : req.user.userId;
    
    const db = dbManager.getMainDb();
    const fundWithdrawals = (db.withdrawals || []).filter(w => w.userId === targetUserId);
    const itemWithdrawals = (db.itemWithdrawals || []).filter(w => w.userId === targetUserId);
    
    res.json({
      fundWithdrawals,
      itemWithdrawals
    });
  } catch (error) {
    console.error('Error fetching withdrawals:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;