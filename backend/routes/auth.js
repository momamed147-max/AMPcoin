const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const dbManager = require('../db/dbHelper');
const { jwtSecret } = require('../jwtSecret');

const router = express.Router();

const ROBLOX_THUMBNAIL_CACHE_TTL = 1000 * 60 * 60;

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
            if (json.data && json.data.length > 0) { resolve(json.data[0].id); }
            else { resolve(null); }
          } catch (e) { reject(e); }
        });
      });
      reqApi.on('error', (err) => reject(err));
      reqApi.on('timeout', () => { reqApi.destroy(); reject(new Error('timeout')); });
      reqApi.write(postData);
      reqApi.end();
    });
  } catch (error) {
    console.error('Roblox user ID resolve error:', error.message);
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
      headers: { 'Accept': 'application/json' },
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
            } else { resolve(null); }
          } catch (e) { reject(e); }
        });
      });
      reqApi.on('error', (err) => reject(err));
      reqApi.on('timeout', () => { reqApi.destroy(); reject(new Error('timeout')); });
      reqApi.end();
    });
  } catch (error) {
    console.error('Roblox headshot fetch error:', error.message);
    return null;
  }
}

function safeToLower(v) {
  if (v == null) return '';
  try { return String(v).toLowerCase(); } catch (_) { return ''; }
}

async function safeBcryptCompare(plain, hash) {
  try {
    if (!plain || !hash || typeof hash !== 'string' || hash.length < 20) return false;
    return await bcrypt.compare(String(plain), hash);
  } catch (err) {
    console.error('[auth] bcrypt.compare failed (malformed hash?):', err.message);
    return false;
  }
}

function safeSaveUsersDb() {
  try { dbManager.saveUsersDb(); return true; }
  catch (err) { console.error('[auth] saveUsersDb failed:', err.message); return false; }
}

function safeGetUserInventory(userId) {
  try { return dbManager.getUserInventory(userId); }
  catch (err) { console.error('[auth] getUserInventory failed:', err.message); return null; }
}

async function resolveAndCacheAvatar(userId) {
  try {
    const usersDb = dbManager.getUsersDb();
    const idx = usersDb.users.findIndex(u => u.id === userId);
    if (idx === -1) return '';
    const user = usersDb.users[idx];
    const now = Date.now();
    if (user.avatar && user.robloxUserId && user.avatarCachedAt && (now - user.avatarCachedAt) < ROBLOX_THUMBNAIL_CACHE_TTL) {
      return user.avatar || '';
    }
    let robloxUserId = user.robloxUserId;
    if (!robloxUserId) {
      robloxUserId = await getRobloxUserIdFromUsername(user.robloxUsername);
      if (robloxUserId) user.robloxUserId = robloxUserId;
    }
    let avatarUrl = '';
    if (robloxUserId) {
      const hs = await getRobloxHeadshotUrl(robloxUserId);
      avatarUrl = hs || `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxUserId}&width=420&height=420&format=png`;
    }
    user.avatar = avatarUrl;
    user.avatarCachedAt = now;
    user.updatedAt = new Date().toISOString();
    safeSaveUsersDb();
    return avatarUrl || '';
  } catch (err) {
    console.error('[auth] resolveAndCacheAvatar error:', err.message);
    return '';
  }
}

router.post('/register', async (req, res) => {
  try {
    const body = req.body || {};
    const robloxUsername = typeof body.robloxUsername === 'string' ? body.robloxUsername.trim() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    if (!robloxUsername || !displayName || !password || !confirmPassword) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const usersDb = dbManager.getUsersDb();
    const existingUser = Array.isArray(usersDb.users)
      ? usersDb.users.find(u => safeToLower(u.robloxUsername) === safeToLower(robloxUsername))
      : null;
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    let hashedPassword;
    try {
      const saltRounds = 10;
      hashedPassword = await bcrypt.hash(password, saltRounds);
    } catch (err) {
      console.error('[auth] bcrypt.hash error:', err.message);
      return res.status(500).json({ message: 'Unable to create account at this time' });
    }

    const newUser = {
      id: uuidv4(),
      robloxUsername,
      displayName,
      password: hashedPassword,
      avatar: '',
      robloxUserId: null,
      robloxDisplayName: null,
      avatarCachedAt: 0,
      balance: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      isAdmin: false,
      isActive: true,
      isFrozen: false,
      isBanned: false,
      status: 'active',
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!Array.isArray(usersDb.users)) usersDb.users = [];
    usersDb.users.push(newUser);
    safeSaveUsersDb();

    safeGetUserInventory(newUser.id);

    setImmediate(async () => { try { await resolveAndCacheAvatar(newUser.id); } catch (_) {} });

    const token = jwt.sign(
      {
        userId: newUser.id,
        robloxUsername: newUser.robloxUsername,
        isAdmin: !!newUser.isAdmin
      },
      jwtSecret(),
      { expiresIn: '24h' }
    );

    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json({ token, user: userWithoutPassword });
  } catch (error) {
    console.error('Registration error:', error.message);
    console.error(error.stack);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const body = req.body || {};
    const robloxUsername = typeof body.robloxUsername === 'string' ? body.robloxUsername.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!robloxUsername || !password) {
      return res.status(400).json({ message: 'Roblox username and password are required' });
    }

    const usersDb = dbManager.getUsersDb();
    if (!usersDb || !Array.isArray(usersDb.users)) {
      return res.status(500).json({ message: 'Server is initializing, please try again' });
    }

    const key = safeToLower(robloxUsername);
    const user = usersDb.users.find(u =>
      safeToLower(u.robloxUsername) === key ||
      String(u.id || '') === String(robloxUsername) ||
      safeToLower(u.username) === key
    );

    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive || user.isFrozen || user.isBanned || (user.status && user.status === 'banned')) {
      return res.status(403).json({ message: 'Account is deactivated, banned, or frozen' });
    }

    const isMatch = await safeBcryptCompare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    user.lastLogin = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    safeSaveUsersDb();

    safeGetUserInventory(user.id);

    setImmediate(async () => { try { await resolveAndCacheAvatar(user.id); } catch (_) {} });

    let freshUser = user;
    try {
      const found = usersDb.users.find(u => u.id === user.id);
      if (found) freshUser = found;
    } catch (_) {}

    const token = jwt.sign(
      {
        userId: user.id,
        robloxUsername: user.robloxUsername,
        isAdmin: !!user.isAdmin
      },
      jwtSecret(),
      { expiresIn: '24h' }
    );

    const { password: _, ...userWithoutPassword } = freshUser || user;
    res.json({ token, user: userWithoutPassword });
  } catch (error) {
    console.error('Login error:', error.message);
    console.error(error.stack);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// ---------- Roblox bio-verified registration ----------
// Step 1 (public): resolve a Roblox username -> id, displayName, thumbnail.
// 404 = no such Roblox account. 400 = already registered here.
router.get('/roblox/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!username) return res.status(400).json({ message: 'Username required' });

    const usersDb = dbManager.getUsersDb();
    const taken = Array.isArray(usersDb.users)
      ? usersDb.users.find((u) => safeToLower(u.robloxUsername) === safeToLower(username))
      : null;
    if (taken) return res.status(400).json({ message: 'This Roblox account is already registered' });

    const https = require('https');
    const postData = JSON.stringify({ usernames: [username], excludeBannedUsers: false });
    const resolved = await new Promise((resolve) => {
      const r = https.request({
        hostname: 'users.roblox.com', path: '/v1/usernames/users', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 6000
      }, (rs) => {
        let d = '';
        rs.on('data', (c) => { d += c; });
        rs.on('end', () => {
          try {
            const j = JSON.parse(d);
            resolve(j.data && j.data.length > 0 ? j.data[0] : null);
          } catch (_) { resolve(null); }
        });
      });
      r.on('error', () => resolve(null));
      r.on('timeout', () => { r.destroy(); resolve(null); });
      r.write(postData);
      r.end();
    });

    if (!resolved) return res.status(404).json({ message: 'Roblox user not found — check the spelling' });

    let avatar = '';
    try {
      const thumb = await new Promise((resolve) => {
        const r = https.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${resolved.id}&size=150x150&format=Png&isCircular=false`, (rs) => {
          let d = '';
          rs.on('data', (c) => { d += c; });
          rs.on('end', () => {
            try {
              const j = JSON.parse(d);
              resolve(j.data && j.data[0] ? j.data[0].imageUrl : null);
            } catch (_) { resolve(null); }
          });
        });
        r.on('error', () => resolve(null));
        r.setTimeout(6000, () => { r.destroy(); resolve(null); });
      });
      avatar = thumb || `https://www.roblox.com/headshot-thumbnail/image?userId=${resolved.id}&width=150&height=150&format=png`;
    } catch (_) { avatar = ''; }

    res.json({
      robloxUserId: resolved.id,
      robloxUsername: resolved.name || username,
      displayName: resolved.displayName || resolved.name || username,
      avatar
    });
  } catch (error) {
    console.error('Roblox resolve error:', error.message);
    res.status(500).json({ message: 'Could not reach Roblox, try again' });
  }
});

const VERIFY_WORDS = [
  'cow', 'sheep', 'couch', 'apple', 'river', 'cloud', 'tiger', 'piano', 'comet', 'forest',
  'guitar', 'harbor', 'island', 'jungle', 'kite', 'lemon', 'magnet', 'noodle', 'ocean', 'pepper',
  'quartz', 'rocket', 'shadow', 'thunder', 'umbrella', 'valley', 'window', 'xenon', 'yogurt', 'zebra',
  'anchor', 'bridge', 'candle', 'dolphin', 'ember', 'falcon', 'glacier', 'honey', 'ivory', 'jacket',
  'koala', 'lantern', 'meadow', 'north', 'orbit', 'panda', 'quilt', 'raven', 'saddle', 'tulip',
  'unicorn', 'violin', 'whale', 'xylophone', 'yarn', 'zephyr', 'acorn', 'bison', 'coral', 'donut',
  'eagle', 'fern', 'grove', 'heron', 'ink', 'jaguar', 'kiwi', 'lilac', 'mango', 'newt',
  'onyx', 'plum', 'quail', 'ridge', 'stone', 'toast', 'urchin', 'vapor', 'willow', 'yacht'
];

// Pending verification codes: username(lower) -> { code, robloxUserId, displayName, avatar, expires }
const pendingVerifications = new Map();

function makeVerifyCode() {
  const words = [];
  while (words.length < 7) {
    const word = VERIFY_WORDS[Math.floor(Math.random() * VERIFY_WORDS.length)];
    if (!words.includes(word)) words.push(word);
  }
  return words.join(' ');
}

// Step 2: confirm "is this u?" -> backend issues the bio code.
router.post('/verify-request', async (req, res) => {
  try {
    const robloxUsername = typeof (req.body || {}).robloxUsername === 'string'
      ? req.body.robloxUsername.trim() : '';
    if (!robloxUsername) return res.status(400).json({ message: 'Username required' });

    const usersDb = dbManager.getUsersDb();
    // NOTE: already-registered users are allowed — the same code flow
    // handles both first-time registration and returning-user login.

    // Re-resolve live from Roblox so the code binds to the real account
    const https = require('https');
    const postData = JSON.stringify({ usernames: [robloxUsername], excludeBannedUsers: false });
    const resolved = await new Promise((resolve) => {
      const r = https.request({
        hostname: 'users.roblox.com', path: '/v1/usernames/users', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 6000
      }, (rs) => {
        let d = '';
        rs.on('data', (c) => { d += c; });
        rs.on('end', () => {
          try {
            const j = JSON.parse(d);
            resolve(j.data && j.data.length > 0 ? j.data[0] : null);
          } catch (_) { resolve(null); }
        });
      });
      r.on('error', () => resolve(null));
      r.on('timeout', () => { r.destroy(); resolve(null); });
      r.write(postData);
      r.end();
    });
    if (!resolved) return res.status(404).json({ message: 'Roblox user not found' });

    const code = makeVerifyCode();
    pendingVerifications.set(safeToLower(robloxUsername), {
      code,
      robloxUserId: resolved.id,
      robloxUsername: resolved.name || robloxUsername,
      displayName: resolved.displayName || resolved.name || robloxUsername,
      expires: Date.now() + 30 * 60 * 1000
    });

    res.json({ code });
  } catch (error) {
    console.error('Verify-request error:', error.message);
    res.status(500).json({ message: 'Could not create verification code' });
  }
});

// Step 3: verify the bio contains the code -> log in existing user or create account.
// Passwordless: the Roblox bio code is the only credential.
router.post('/verify-and-register', async (req, res) => {
  try {
    const body = req.body || {};
    const robloxUsername = typeof body.robloxUsername === 'string' ? body.robloxUsername.trim() : '';
    if (!robloxUsername) {
      return res.status(400).json({ message: 'Username is required' });
    }

    const usersDb = dbManager.getUsersDb();
    const existing = Array.isArray(usersDb.users)
      ? usersDb.users.find((u) => safeToLower(u.robloxUsername) === safeToLower(robloxUsername))
      : null;

    const pending = pendingVerifications.get(safeToLower(robloxUsername));
    if (!pending || pending.expires < Date.now()) {
      pendingVerifications.delete(safeToLower(robloxUsername));
      return res.status(400).json({ message: 'Code expired — go back and get a new one' });
    }

    // Read the live Roblox bio and look for the code
    const https = require('https');
    const bio = await new Promise((resolve) => {
      const r = https.get(`https://users.roblox.com/v1/users/${pending.robloxUserId}`, (rs) => {
        let d = '';
        rs.on('data', (c) => { d += c; });
        rs.on('end', () => {
          try { resolve(JSON.parse(d).description || ''); }
          catch (_) { resolve(null); }
        });
      });
      r.on('error', () => resolve(null));
      r.setTimeout(6000, () => { r.destroy(); resolve(null); });
    });
    if (bio === null) return res.status(500).json({ message: 'Could not reach Roblox, try again' });
    if (!bio.includes(pending.code)) {
      return res.status(400).json({ message: 'Code not found in your Roblox bio yet — paste it in and press Verify again' });
    }

    let hashedPassword;
    try {
      // No password collected — store a random unusable hash so the
      // legacy password-login path can never match.
      hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    } catch (err) {
      return res.status(500).json({ message: 'Unable to create account at this time' });
    }

    // Returning user? Bio verified — just log them in.
    if (existing) {
      existing.lastLogin = new Date().toISOString();
      existing.updatedAt = new Date().toISOString();
      if (pending.displayName && !existing.displayName) existing.displayName = pending.displayName;
      if (pending.robloxUserId && !existing.robloxUserId) existing.robloxUserId = pending.robloxUserId;
      safeSaveUsersDb();
      pendingVerifications.delete(safeToLower(robloxUsername));

      setImmediate(async () => { try { await resolveAndCacheAvatar(existing.id); } catch (_) {} });

      const loginToken = jwt.sign(
        { userId: existing.id, robloxUsername: existing.robloxUsername, isAdmin: !!existing.isAdmin },
        jwtSecret(),
        { expiresIn: '24h' }
      );

      const { password: _pw, ...existingWithoutPassword } = existing;
      return res.status(200).json({ token: loginToken, user: existingWithoutPassword });
    }

    let avatar = pending.avatar || '';
    const newUser = {
      id: uuidv4(),
      robloxUsername: pending.robloxUsername,
      displayName: pending.displayName,
      password: hashedPassword,
      avatar,
      robloxUserId: pending.robloxUserId,
      robloxDisplayName: pending.displayName,
      avatarCachedAt: 0,
      balance: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      isAdmin: false,
      isActive: true,
      isFrozen: false,
      isBanned: false,
      status: 'active',
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!Array.isArray(usersDb.users)) usersDb.users = [];
    usersDb.users.push(newUser);
    safeSaveUsersDb();
    safeGetUserInventory(newUser.id);
    pendingVerifications.delete(safeToLower(robloxUsername));

    setImmediate(async () => { try { await resolveAndCacheAvatar(newUser.id); } catch (_) {} });

    const token = jwt.sign(
      { userId: newUser.id, robloxUsername: newUser.robloxUsername, isAdmin: !!newUser.isAdmin },
      jwtSecret(),
      { expiresIn: '24h' }
    );

    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json({ token, user: userWithoutPassword });
  } catch (error) {
    console.error('Verify-register error:', error.message);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

router.post('/verify-token', async (req, res) => {  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ valid: false, message: 'No token provided' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret());
    } catch (err) {
      return res.status(401).json({ valid: false, message: 'Invalid token' });
    }

    if (!decoded || (!decoded.userId && !decoded.robloxUsername)) {
      return res.status(401).json({ valid: false, message: 'Invalid token' });
    }

    const usersDb = dbManager.getUsersDb();
    if (!usersDb || !Array.isArray(usersDb.users)) {
      return res.status(500).json({ valid: false, message: 'Server initializing' });
    }

    const user = usersDb.users.find(u =>
      (decoded.userId && u.id === decoded.userId) ||
      (decoded.robloxUsername && safeToLower(u.robloxUsername) === safeToLower(decoded.robloxUsername))
    );

    if (!user || !user.isActive || user.isFrozen || user.isBanned || (user.status && user.status === 'banned')) {
      return res.status(401).json({ valid: false, message: 'Invalid or inactive user' });
    }

    if (!user.avatar) {
      try { await resolveAndCacheAvatar(user.id); } catch (_) {}
    }

    const freshUser = (usersDb.users.find(u => u.id === user.id)) || user;

    res.json({
      valid: true,
      user: {
        id: freshUser.id,
        robloxUsername: freshUser.robloxUsername || '',
        robloxDisplayName: freshUser.robloxDisplayName || null,
        customDisplayName: freshUser.customDisplayName || null,
        displayName: (freshUser.customDisplayName || freshUser.robloxDisplayName || freshUser.displayName || freshUser.robloxUsername || 'Anonymous'),
        balance: typeof freshUser.balance === 'number' ? freshUser.balance : 0,
        isAdmin: !!freshUser.isAdmin,
        avatar: freshUser.avatar || '',
        robloxUserId: freshUser.robloxUserId || null,
        discordId: freshUser.discordId || null,
        discordUsername: freshUser.discordUsername || null,
        discordAvatar: freshUser.discordAvatar || null
      }
    });
  } catch (error) {
    console.error('Token verification error:', error.message);
    console.error(error.stack);
    res.status(401).json({ valid: false, message: 'Invalid token' });
  }
});

// ---- Discord account linking (OAuth2) ----
// Setup: create an app at https://discord.com/developers/applications,
// add redirect URI <backend>/api/auth/discord/callback, set env:
// DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, CLIENT_URL.
const discordLinkStates = new Map(); // state -> { userId, expires }

function discordConfigured() {
  return !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && process.env.DISCORD_REDIRECT_URI);
}

// Public status check (no secrets leaked): open this URL to verify setup
router.get('/discord/status', (req, res) => {
  res.json({ configured: discordConfigured() });
});

// Step 1: logged-in user hits this (JWT in query since redirects can't send headers)
router.get('/discord', async (req, res) => {
  try {
    if (!discordConfigured()) {
      return res.status(500).send('Discord linking is not configured on this server.');
    }
    const token = req.query.token;
    if (!token) return res.status(401).send('Missing login token.');
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret());
    } catch (_) {
      return res.status(401).send('Invalid login token.');
    }
    const state = crypto.randomBytes(24).toString('hex');
    discordLinkStates.set(state, { userId: decoded.userId, expires: Date.now() + 10 * 60 * 1000 });
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify',
      state
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  } catch (error) {
    console.error('Discord link start error:', error.message);
    res.status(500).send('Could not start Discord linking.');
  }
});

// Step 2: Discord redirects back here
router.get('/discord/callback', async (req, res) => {
  const front = (process.env.CLIENT_URL || '').replace(/\/$/, '');
  const back = (to) => res.redirect(`${front}/profile${to}`);
  try {
    const { code, state } = req.query;
    const pending = discordLinkStates.get(state);
    discordLinkStates.delete(state);
    if (!code || !pending || pending.expires < Date.now()) {
      return back('?discord=error_expired');
    }

    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      })
    });
    if (!tokenRes.ok) return back('?discord=error_token');
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return back('?discord=error_token');

    // Fetch Discord profile
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!meRes.ok) return back('?discord=error_profile');
    const me = await meRes.json();
    if (!me.id) return back('?discord=error_profile');

    const usersDb = dbManager.getUsersDb();
    // Discord account can only be linked to one site account
    const taken = (usersDb.users || []).find(
      (u) => u.discordId && String(u.discordId) === String(me.id) && u.id !== pending.userId
    );
    if (taken) return back('?discord=error_taken');

    const user = (usersDb.users || []).find((u) => u.id === pending.userId);
    if (!user) return back('?discord=error_nouser');

    user.discordId = String(me.id);
    user.discordUsername = me.username + (me.discriminator && me.discriminator !== '0' ? `#${me.discriminator}` : '');
    user.discordAvatar = me.avatar
      ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`
      : '';
    user.discordLinkedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    dbManager.saveUsersDb();

    return back('?discord=linked');
  } catch (error) {
    console.error('Discord callback error:', error.message);
    return back('?discord=error_server');
  }
});

module.exports = router;