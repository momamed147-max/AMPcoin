const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { addNotification } = require('../notificationService');

const ROBLOX_PROFILE_CACHE_TTL = 1000 * 60 * 60; // 1 hour cache

async function getRobloxUserIdFromUsername(robloxUsername) {
  try {
    const https = require('https');
    const postData = JSON.stringify({
      usernames: [robloxUsername],
      excludeBannedUsers: false
    });

    const options = {
      hostname: 'users.roblox.com',
      path: '/v1/usernames/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json'
      },
      timeout: 5000
    };

    return await new Promise((resolve, reject) => {
      const reqApi = https.request(options, (resApi) => {
        let data = '';
        resApi.on('data', (chunk) => { data += chunk; });
        resApi.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.data && json.data.length > 0) {
              resolve({ id: json.data[0].id, displayName: json.data[0].displayName });
            } else {
              resolve(null);
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      reqApi.on('error', (err) => reject(err));
      reqApi.on('timeout', () => { reqApi.destroy(); reject(new Error('Request timeout')); });
      reqApi.write(postData);
      reqApi.end();
    });
  } catch (error) {
    console.error('Error resolving Roblox username to ID:', error);
    return null;
  }
}

async function getRobloxHeadshotUrl(robloxUserId, size = '420x420') {
  if (!robloxUserId) return null;
  try {
    const https = require('https');
    const options = {
      hostname: 'thumbnails.roblox.com',
      path: `/v1/users/avatar-headshot?userIds=${robloxUserId}&size=${size}&format=Png&isCircular=false`,
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      timeout: 5000
    };

    return await new Promise((resolve, reject) => {
      const reqApi = https.request(options, (resApi) => {
        let data = '';
        resApi.on('data', (chunk) => { data += chunk; });
        resApi.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.data && json.data.length > 0 && json.data[0].imageUrl) {
              resolve(json.data[0].imageUrl);
            } else {
              resolve(null);
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      reqApi.on('error', (err) => reject(err));
      reqApi.on('timeout', () => { reqApi.destroy(); reject(new Error('Request timeout')); });
      reqApi.end();
    });
  } catch (error) {
    console.error('Error fetching Roblox headshot URL:', error);
    return null;
  }
}

async function resolveAndCacheRobloxProfile(userId) {
  const usersDb = dbManager.getUsersDb();
  const idx = usersDb.users.findIndex(u => u.id === userId);
  if (idx === -1) return { avatar: '', displayName: '', robloxUserId: null };
  const dbUser = usersDb.users[idx];
  if (!dbUser.robloxUsername) return { avatar: '', displayName: '', robloxUserId: null };

  const now = Date.now();
  const profileCached =
    dbUser.avatar &&
    dbUser.robloxUserId &&
    dbUser.robloxDisplayName &&
    dbUser.avatarCachedAt &&
    (now - dbUser.avatarCachedAt) < ROBLOX_PROFILE_CACHE_TTL;

  if (profileCached) {
    return {
      avatar: dbUser.avatar,
      displayName: dbUser.customDisplayName || dbUser.robloxDisplayName,
      customDisplayName: dbUser.customDisplayName || null,
      robloxDisplayName: dbUser.robloxDisplayName,
      robloxUserId: dbUser.robloxUserId
    };
  }

  let robloxUserId = dbUser.robloxUserId;
  let robloxDisplayName = dbUser.robloxDisplayName || (dbUser.customDisplayName ? null : dbUser.displayName);
  if (!robloxUserId) {
    const resolved = await getRobloxUserIdFromUsername(dbUser.robloxUsername);
    if (resolved) {
      robloxUserId = resolved.id;
      robloxDisplayName = resolved.displayName || robloxDisplayName;
      dbUser.robloxUserId = robloxUserId;
    }
  }

  let avatarUrl = '';
  if (robloxUserId) {
    const hs = await getRobloxHeadshotUrl(robloxUserId);
    avatarUrl = hs || `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxUserId}&width=420&height=420&format=png`;
  }

  dbUser.avatar = avatarUrl;
  if (robloxDisplayName) dbUser.robloxDisplayName = robloxDisplayName;
  dbUser.avatarCachedAt = now;
  dbUser.updatedAt = new Date().toISOString();
  dbManager.saveUsersDb();

  return {
    avatar: avatarUrl,
    displayName: dbUser.customDisplayName || robloxDisplayName || dbUser.displayName,
    customDisplayName: dbUser.customDisplayName || null,
    robloxDisplayName: robloxDisplayName || null,
    robloxUserId: robloxUserId || null
  };
}

router.get('/profile/:robloxUsername', async (req, res) => {
  try {
    const robloxUsername = req.params.robloxUsername;
    const usersDb = dbManager.getUsersDb();
    let user = usersDb.users.find(u =>
      (u.robloxUsername && u.robloxUsername.toLowerCase() === robloxUsername.toLowerCase()) ||
      u.id === robloxUsername
    );

    let avatar = '';
    let displayName = '';
    let robloxUserId = null;

    if (user) {
      const profile = await resolveAndCacheRobloxProfile(user.id);
      avatar = profile.avatar;
      displayName = profile.displayName;
      robloxUserId = profile.robloxUserId;
    } else {
      const resolved = await getRobloxUserIdFromUsername(robloxUsername);
      if (resolved) {
        robloxUserId = resolved.id;
        displayName = resolved.displayName || robloxUsername;
        const hs = await getRobloxHeadshotUrl(resolved.id);
        avatar = hs || `https://www.roblox.com/headshot-thumbnail/image?userId=${resolved.id}&width=420&height=420&format=png`;
      }
    }

    res.json({
      avatar,
      displayName,
      customDisplayName: user?.customDisplayName || null,
      robloxDisplayName: user?.robloxDisplayName || (user ? null : displayName),
      robloxUserId
    });
  } catch (error) {
    console.error('Error fetching Roblox profile:', error);
    res.json({ avatar: '', displayName: '', robloxUserId: null });
  }
});

router.get('/avatar/:robloxUsername', async (req, res) => {
  try {
    const robloxUsername = req.params.robloxUsername;
    const usersDb = dbManager.getUsersDb();
    let user = usersDb.users.find(u =>
      (u.robloxUsername && u.robloxUsername.toLowerCase() === robloxUsername.toLowerCase()) ||
      u.id === robloxUsername
    );

    let avatarUrl = '';
    if (user) {
      const profile = await resolveAndCacheRobloxProfile(user.id);
      avatarUrl = profile.avatar;
    }

    if (!avatarUrl) {
      const resolved = await getRobloxUserIdFromUsername(robloxUsername);
      if (resolved) {
        const headshot = await getRobloxHeadshotUrl(resolved.id);
        avatarUrl = headshot || `https://www.roblox.com/headshot-thumbnail/image?userId=${resolved.id}&width=420&height=420&format=png`;
      }
    }

    res.json({ avatar: avatarUrl, robloxUserId: user?.robloxUserId || null });
  } catch (error) {
    console.error('Error fetching avatar:', error);
    res.json({ avatar: '', robloxUserId: null });
  }
});

// Helper to get inventory for a user by id or robloxUsername
function handleGetInventory(identifier, req, res) {
  try {
    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.id === identifier || u.robloxUsername === identifier);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const inventory = dbManager.getUserInventory(user.id);
    res.json(inventory);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

// Get logged-in user inventory
router.get('/inventory', authenticateToken, (req, res) => {
  handleGetInventory(req.user.userId, req, res);
});

// Get user inventory by id or robloxUsername (matches /api/users/inventory/:id)
router.get('/inventory/:identifier', authenticateToken, (req, res) => {
  handleGetInventory(req.params.identifier, req, res);
});

// Backward compatibility: /api/users/:userId/inventory
router.get('/:userId/inventory', authenticateToken, (req, res) => {
  handleGetInventory(req.params.userId, req, res);
});

// Get user by robloxUsername or id
router.get('/:robloxUsername', authenticateToken, (req, res) => {
  try {
    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.robloxUsername === req.params.robloxUsername || u.id === req.params.robloxUsername);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user profile
router.put('/:robloxUsername', authenticateToken, (req, res) => {
  try {
    const identifier = req.params.robloxUsername;
    const updates = req.body || {};
    const usersDb = dbManager.getUsersDb();

    const userIndex = usersDb.users.findIndex((u) =>
      String(u.robloxUsername).toLowerCase() === String(identifier).toLowerCase() ||
      String(u.id) === String(identifier)
    );
    if (userIndex === -1) {
      return res.status(404).json({ message: 'User not found' });
    }

    const targetUser = usersDb.users[userIndex];
    const ownsProfile = String(req.user.userId) === String(targetUser.id);
    if (!ownsProfile && !req.user.isAdmin) {
      return res.status(403).json({ message: 'You can only update your own profile' });
    }

    if (updates.displayName !== undefined) {
      if (typeof updates.displayName !== 'string' || updates.displayName.trim().length > 32) {
        return res.status(400).json({ message: 'Display name must be 32 characters or fewer' });
      }
      const nextDisplayName = updates.displayName.trim();
      targetUser.customDisplayName = nextDisplayName || null;
      targetUser.displayName = nextDisplayName || targetUser.robloxDisplayName || targetUser.robloxUsername;
    }

    if (typeof updates.avatar === 'string') {
      targetUser.avatar = updates.avatar.trim();
    }

    targetUser.updatedAt = new Date().toISOString();
    dbManager.saveUsersDb();

    const { password, ...updatedUser } = targetUser;
    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Unlink Discord account
router.delete('/unlink-discord', authenticateToken, (req, res) => {
  try {
    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find((u) => u.id === req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.discordId = null;
    user.discordUsername = null;
    user.discordAvatar = null;
    user.discordLinkedAt = null;
    user.updatedAt = new Date().toISOString();
    dbManager.saveUsersDb();
    const { password, ...clean } = user;
    res.json({ message: 'Discord unlinked', user: clean });
  } catch (error) {
    console.error('Error unlinking discord:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user statistics
router.get('/:robloxUsername/stats', authenticateToken, (req, res) => {
  try {
    const robloxUsername = req.params.robloxUsername;
    const usersDb = dbManager.getUsersDb();
    
    const user = usersDb.users.find(u => u.robloxUsername === robloxUsername || u.id === robloxUsername);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userStats = {
      gamesPlayed: user.gamesPlayed || 0,
      gamesWon: user.gamesWon || 0,
      gamesLost: user.gamesLost || 0,
      totalDeposited: user.totalDeposited || 0,
      totalWithdrawn: user.totalWithdrawn || 0,
      winRate: (user.gamesPlayed || 0) > 0 ? ((user.gamesWon || 0) / user.gamesPlayed) * 100 : 0,
      balance: user.balance || 0,
      joinedDate: user.createdAt
    };
    
    res.json(userStats);
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send an item tip to another user (1+ units of an owned stack)
router.post('/tip', authenticateToken, (req, res) => {
  try {
    const senderId = req.user.userId;
    const { recipientId, itemId, quantity = 1 } = req.body || {};

    if (!recipientId || !itemId) {
      return res.status(400).json({ message: 'Recipient and item are required' });
    }
    if (String(recipientId) === String(senderId)) {
      return res.status(400).json({ message: 'You cannot tip yourself' });
    }

    const usersDb = dbManager.getUsersDb();
    const recipient = (usersDb.users || []).find(
      (u) => u.id === recipientId || u.robloxUsername === recipientId
    );
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found' });
    }

    const qty = Math.max(1, parseInt(quantity || 1, 10) || 1);
    const inv = dbManager.getUserInventory(senderId);
    const entry = ((inv && inv.items) || []).find((i) => i.itemId === itemId || i.id === itemId);
    if (!entry || (entry.quantity || 1) < qty) {
      return res.status(400).json({ message: 'You do not own that item' });
    }

    const snapshot = {
      id: entry.itemId || entry.id,
      itemId: entry.itemId || entry.id,
      name: entry.name || entry.itemName || 'Unknown Item',
      itemName: entry.itemName || entry.name || 'Unknown Item',
      value: entry.value || 0,
      rarity: entry.rarity || 'common',
      quantity: qty,
      image: entry.imageUrl || entry.image || '',
      imageUrl: entry.imageUrl || entry.image || ''
    };

    dbManager.removeItemFromUserInventory(senderId, snapshot.itemId, qty);
    dbManager.addItemToUserInventory(recipient.id, snapshot, qty);

    const db = dbManager.getMainDb();
    db.transactions = db.transactions || [];
    db.transactions.push({
      id: uuidv4(),
      userId: senderId,
      robloxUsername: req.user.robloxUsername,
      amount: 0,
      type: 'tip',
      status: 'completed',
      metadata: {
        recipientId: recipient.id,
        recipientUsername: recipient.robloxUsername,
        itemId: snapshot.itemId,
        itemName: snapshot.name,
        quantity: qty,
        value: snapshot.value
      },
      timestamp: new Date().toISOString()
    });
    dbManager.saveMainDb();

    addNotification({
      userId: recipient.id,
      type: 'tip',
      title: 'Tip received',
      message: `${req.user.robloxUsername || 'Someone'} tipped you ${snapshot.name}!`,
      imageUrl: snapshot.imageUrl || snapshot.image || ''
    });

    // Real-time: notify both users their inventory changed
    const { emitToAll } = require('../realtime');
    emitToAll('inventoryUpdate', { userId: senderId });
    emitToAll('inventoryUpdate', { userId: recipient.id });

    res.json({ message: `Tipped ${snapshot.name} to ${recipient.displayName || recipient.robloxUsername}!` });
  } catch (error) {
    console.error('Error sending tip:', error);
    res.status(500).json({ message: 'Server error sending tip' });
  }
});

module.exports = router;