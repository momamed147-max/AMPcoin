const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, authenticateAdmin, authenticateModerator } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { addNotification } = require('../notificationService');
const { emitToUser } = require('../realtime');

const ROBLOX_PROFILE_CACHE_TTL = 1000 * 60 * 60;
const OWNER_USERNAME = 'pooppantspro';

function canModerateTarget(actor, target) {
  if (String(target.robloxUsername || '').toLowerCase() === OWNER_USERNAME) return false;
  if (String(actor.userId) === String(target.id)) return false;
  if (actor.isAdmin !== true && (target.isAdmin === true || target.isModerator === true)) return false;
  return true;
}

function serializeMuteUser(user) {
  return {
    id: user.id,
    robloxUsername: user.robloxUsername || '',
    robloxDisplayName: user.robloxDisplayName || null,
    customDisplayName: user.customDisplayName || null,
    displayName: user.customDisplayName || user.displayName || user.robloxDisplayName || user.robloxUsername || 'Anonymous',
    avatar: user.avatar || '',
    isAdmin: user.isAdmin === true,
    isModerator: user.isModerator === true,
    isActive: user.isActive !== false,
    isBanned: user.isBanned === true,
    isFrozen: user.isFrozen === true,
    isMuted: user.isMuted === true,
    mutedAt: user.mutedAt || null,
    muteReason: user.muteReason || null
  };
}

const moderationCooldown = new Map();
function isModerationRateLimited(actorId, targetId) {
  const key = `${actorId}:${targetId}`;
  const now = Date.now();
  const last = moderationCooldown.get(key) || 0;
  if (now - last < 750) return true;
  if (moderationCooldown.size > 5000) {
    for (const [entryKey, timestamp] of moderationCooldown) {
      if (now - timestamp > 60_000) moderationCooldown.delete(entryKey);
    }
  }
  moderationCooldown.set(key, now);
  return false;
}

async function getRobloxUserIdFromUsername(robloxUsername) {
  try {
    const https = require('https');
    const postData = JSON.stringify({ usernames: [robloxUsername], excludeBannedUsers: false });
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
      const r = https.request(options, (resApi) => {
        let data = '';
        resApi.on('data', (c) => { data += c; });
        resApi.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.data && j.data.length > 0) resolve({ id: j.data[0].id, displayName: j.data[0].displayName });
            else resolve(null);
          } catch (e) { reject(e); }
        });
      });
      r.on('error', (err) => reject(err));
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
      r.write(postData);
      r.end();
    });
  } catch (e) {
    console.error('Roblox ID resolve error:', e.message);
    return null;
  }
}

async function getRobloxHeadshotUrl(robloxUserId, size = '150x150') {
  if (!robloxUserId) return null;
  try {
    const https = require('https');
    const options = {
      hostname: 'thumbnails.roblox.com',
      path: `/v1/users/avatar-headshot?userIds=${robloxUserId}&size=${size}&format=Png&isCircular=false`,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      timeout: 5000
    };
    return await new Promise((resolve, reject) => {
      const r = https.request(options, (resApi) => {
        let data = '';
        resApi.on('data', (c) => { data += c; });
        resApi.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.data && j.data.length > 0 && j.data[0].imageUrl) resolve(j.data[0].imageUrl);
            else resolve(null);
          } catch (e) { reject(e); }
        });
      });
      r.on('error', (err) => reject(err));
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
      r.end();
    });
  } catch (e) {
    console.error('Roblox headshot error:', e.message);
    return null;
  }
}

async function ensureUserProfileCached(user) {
  const now = Date.now();
  const usersDb = dbManager.getUsersDb();
  const idx = usersDb.users.findIndex(u => u.id === user.id);
  if (idx === -1) return { avatar: '', displayName: user.displayName || user.robloxUsername, robloxUserId: null };
  const dbUser = usersDb.users[idx];

  const cached = dbUser.avatar && dbUser.robloxUserId && dbUser.robloxDisplayName &&
    dbUser.avatarCachedAt && (now - dbUser.avatarCachedAt) < ROBLOX_PROFILE_CACHE_TTL;
  if (cached) {
    return {
      avatar: dbUser.avatar,
      displayName: dbUser.customDisplayName || dbUser.robloxDisplayName,
      robloxDisplayName: dbUser.robloxDisplayName,
      customDisplayName: dbUser.customDisplayName || null,
      robloxUserId: dbUser.robloxUserId
    };
  }

  let robloxUserId = dbUser.robloxUserId;
  let robloxDisplayName = dbUser.robloxDisplayName || (dbUser.customDisplayName ? null : dbUser.displayName) || dbUser.robloxUsername;
  if (!robloxUserId) {
    const res = await getRobloxUserIdFromUsername(dbUser.robloxUsername);
    if (res) {
      robloxUserId = res.id;
      robloxDisplayName = res.displayName || robloxDisplayName;
      dbUser.robloxUserId = robloxUserId;
    }
  }
  let avatar = dbUser.avatar || '';
  if (robloxUserId && !avatar) {
    const hs = await getRobloxHeadshotUrl(robloxUserId);
    avatar = hs || `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxUserId}&width=150&height=150&format=png`;
  }
  dbUser.avatar = avatar;
  dbUser.robloxDisplayName = robloxDisplayName;
  dbUser.avatarCachedAt = now;
  dbUser.updatedAt = new Date().toISOString();
  dbManager.saveUsersDb();
  return {
    avatar,
    displayName: dbUser.customDisplayName || robloxDisplayName,
    robloxDisplayName,
    customDisplayName: dbUser.customDisplayName || null,
    robloxUserId
  };
}

// Get recent chat messages
router.get('/messages', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const db = dbManager.getMainDb();
    if (pruneExpiredMessages(db)) dbManager.saveMainDb();
    const messages = (db.chatMessages || [])
      .slice(-parseInt(limit));

    res.json({ messages });
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Per-user message cooldown (5s) — in-memory, resets on restart
const chatCooldownMs = 5000;
const lastChatAt = new Map();

// Messages auto-delete 30 minutes after being sent
const CHAT_MESSAGE_TTL_MS = 30 * 60 * 1000;

function pruneExpiredMessages(db) {
  if (!Array.isArray(db.chatMessages) || db.chatMessages.length === 0) return false;
  const now = Date.now();
  const before = db.chatMessages.length;
  db.chatMessages = db.chatMessages.filter((m) => {
    const t = new Date(m.timestamp).getTime();
    if (isNaN(t)) return true; // keep undated legacy messages
    return now - t <= CHAT_MESSAGE_TTL_MS;
  });
  return db.chatMessages.length !== before;
}

// Background sweeper so old messages vanish even when nobody is chatting
setInterval(() => {
  try {
    const db = dbManager.getMainDb();
    if (pruneExpiredMessages(db)) dbManager.saveMainDb();
  } catch (e) {
    console.error('Chat prune error:', e.message);
  }
}, 5 * 60 * 1000);

// Send a chat message
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ message: 'Message cannot be empty' });
    }

    const now = Date.now();
    const last = lastChatAt.get(userId) || 0;
    const waitMs = chatCooldownMs - (now - last);
    if (waitMs > 0) {
      const retryAfter = Math.ceil(waitMs / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        message: `Slow down — wait ${retryAfter}s before sending again`,
        retryAfter
      });
    }
    lastChatAt.set(userId, now);

    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isMuted) {
      return res.status(403).json({ message: 'You are muted and cannot send messages' });
    }

    // Ensure user has Roblox profile (display name + avatar) cached
    const profile = await ensureUserProfileCached(user);
    const displayName = profile.displayName || user.robloxDisplayName || user.displayName || user.robloxUsername;
    const avatar = profile.avatar || user.avatar || '';

    const chatMessage = {
      id: uuidv4(),
      userId: user.id,
      robloxUsername: user.robloxUsername || '',
      username: displayName,
      displayName: displayName,
      customDisplayName: user.customDisplayName || null,
      robloxDisplayName: profile.robloxDisplayName || user.robloxDisplayName || null,
      avatar: avatar,
      robloxUserId: profile.robloxUserId || user.robloxUserId || null,
      isAdmin: user.isAdmin === true,
      isModerator: user.isModerator === true,
      message: message.trim(),
      timestamp: new Date().toISOString(),
      type: 'user_message'
    };

    const db = dbManager.getMainDb();
    db.chatMessages = db.chatMessages || [];
    pruneExpiredMessages(db);
    db.chatMessages.push(chatMessage);

    if (db.chatMessages.length > 1000) {
      db.chatMessages = db.chatMessages.slice(-1000);
    }

    dbManager.saveMainDb();

    // Real-time: broadcast message to ALL connected users
    const { emitToAll } = require('../realtime');
    emitToAll('chatMessage', chatMessage);

    res.status(201).json(chatMessage);
  } catch (error) {
    console.error('Error sending chat message:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get online users count
router.get('/online', (req, res) => {
  try {
    const onlineCount = Math.floor(Math.random() * 10) + 5;
    res.json({ count: onlineCount });
  } catch (error) {
    console.error('Error fetching online count:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Delete a message
router.delete('/messages/:messageId', authenticateAdmin, (req, res) => {
  try {
    const messageId = req.params.messageId;
    const db = dbManager.getMainDb();
    db.chatMessages = db.chatMessages || [];
    const messageIndex = db.chatMessages.findIndex(msg => msg.id === messageId);

    if (messageIndex === -1) {
      return res.status(404).json({ message: 'Message not found' });
    }

    db.chatMessages.splice(messageIndex, 1);
    dbManager.saveMainDb();

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Staff: Mute a user from chat. Moderators may mute regular users only.
router.put('/mute/:userId', authenticateModerator, (req, res) => {
  try {
    const userId = req.params.userId;
    const usersDb = dbManager.getUsersDb();
    const userIndex = (usersDb.users || []).findIndex(u => u.id === userId);

    if (userIndex === -1) {
      return res.status(404).json({ message: 'User not found' });
    }

    const targetUser = usersDb.users[userIndex];
    if (!canModerateTarget(req.user, targetUser)) {
      return res.status(403).json({ message: 'You cannot mute this account' });
    }
    if (targetUser.isMuted === true) {
      return res.json({ message: 'User is already muted', user: serializeMuteUser(targetUser), unchanged: true });
    }
    if (isModerationRateLimited(req.user.userId, userId)) {
      res.set('Retry-After', '1');
      return res.status(429).json({ message: 'Please wait before changing moderation again.' });
    }

    const reason = typeof req.body?.reason === 'string'
      ? req.body.reason.trim().slice(0, 160) || 'Muted by staff'
      : 'Muted by staff';
    targetUser.isMuted = true;
    targetUser.mutedAt = new Date().toISOString();
    targetUser.mutedBy = req.user.userId;
    targetUser.muteReason = reason;
    targetUser.updatedAt = new Date().toISOString();

    const db = dbManager.getMainDb();
    db.adminLogs = db.adminLogs || [];
    db.adminLogs.push({
      id: uuidv4(),
      adminId: req.user.userId,
      adminUsername: req.user.robloxUsername,
      action: 'mute_user',
      targetUserId: userId,
      targetUsername: targetUser.robloxUsername,
      reason,
      timestamp: new Date().toISOString()
    });

    addNotification({
      userId: targetUser.id,
      type: 'moderation',
      title: 'Chat access restricted',
      message: reason
    });
    emitToUser(targetUser.id, 'moderationUpdate', {
      userId: targetUser.id,
      isMuted: true,
      mutedAt: targetUser.mutedAt,
      muteReason: targetUser.muteReason
    });
    dbManager.saveUsersDb();
    dbManager.saveMainDb();

    res.json({ message: 'User muted successfully', user: serializeMuteUser(targetUser) });
  } catch (error) {
    console.error('Error muting user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Staff: Unmute a user from chat.
router.put('/unmute/:userId', authenticateModerator, (req, res) => {
  try {
    const userId = req.params.userId;
    const usersDb = dbManager.getUsersDb();
    const userIndex = (usersDb.users || []).findIndex(u => u.id === userId);

    if (userIndex === -1) {
      return res.status(404).json({ message: 'User not found' });
    }

    const targetUser = usersDb.users[userIndex];
    if (!canModerateTarget(req.user, targetUser)) {
      return res.status(403).json({ message: 'You cannot unmute this account' });
    }
    if (targetUser.isMuted !== true) {
      return res.json({ message: 'User is already unmuted', user: serializeMuteUser(targetUser), unchanged: true });
    }
    if (isModerationRateLimited(req.user.userId, userId)) {
      res.set('Retry-After', '1');
      return res.status(429).json({ message: 'Please wait before changing moderation again.' });
    }

    targetUser.isMuted = false;
    targetUser.mutedAt = null;
    targetUser.mutedBy = null;
    targetUser.muteReason = null;
    targetUser.updatedAt = new Date().toISOString();

    const db = dbManager.getMainDb();
    db.adminLogs = db.adminLogs || [];
    db.adminLogs.push({
      id: uuidv4(),
      adminId: req.user.userId,
      adminUsername: req.user.robloxUsername,
      action: 'unmute_user',
      targetUserId: userId,
      targetUsername: targetUser.robloxUsername,
      reason: 'Unmuted by staff',
      timestamp: new Date().toISOString()
    });

    addNotification({
      userId: targetUser.id,
      type: 'moderation',
      title: 'Chat access restored',
      message: 'You can send messages in chat again.'
    });
    emitToUser(targetUser.id, 'moderationUpdate', {
      userId: targetUser.id,
      isMuted: false,
      mutedAt: null,
      muteReason: null
    });
    dbManager.saveUsersDb();
    dbManager.saveMainDb();

    res.json({ message: 'User unmuted successfully', user: serializeMuteUser(targetUser) });
  } catch (error) {
    console.error('Error unmuting user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Clear chat
router.delete('/clear', authenticateAdmin, (req, res) => {
  try {
    const db = dbManager.getMainDb();
    db.chatMessages = [];
    dbManager.saveMainDb();
    res.json({ message: 'Chat cleared successfully' });
  } catch (error) {
    console.error('Error clearing chat:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;