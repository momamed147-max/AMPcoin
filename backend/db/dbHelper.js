const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// The JSON sandbox is strictly opt-in via LOCAL_JSON_MODE=true.
//
// Two failure modes this avoids:
//  - A stray DATABASE_URL in a local .env silently pointing dev at the live DB.
//  - A host with no NODE_ENV set silently serving the repo's JSON files instead
//    of PostgreSQL, which would hide every real user, balance and inventory.
// Anything that is not an explicit sandbox always uses PostgreSQL.
const SANDBOX = /^(1|true|yes)$/i.test(String(process.env.LOCAL_JSON_MODE || ''));
const LOCAL_JSON_MODE = SANDBOX && process.env.NODE_ENV !== 'production';

// ─── PostgreSQL connection ───────────────────────────────────────────
function createPool(connectionString) {
  const created = new Pool({
    connectionString,
    ssl: connectionString && !connectionString.includes('localhost')
      ? { rejectUnauthorized: false }
      : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  created.on('error', (err) => {
    console.error('[PostgreSQL] Unexpected pool error:', err.message);
  });
  return created;
}

let pool = createPool(process.env.DATABASE_URL);

// ─── Schema init ─────────────────────────────────────────────────────
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS store (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Seed default rows if they don't exist
    const defaults = {
      users: { users: [] },
      items: { items: [] },
      main: {
        coinflips: [],
        inventories: [],
        transactions: [],
        deposits: [],
        withdrawals: [],
        itemWithdrawals: [],
        pendingTransactions: [],
        blackjackGames: [],
        chatMessages: [],
        giveaways: [],
        notifications: [],
        adminLogs: [],
        rpsMatches: [],
        tradeBotHeld: [],
        tradeBotUpdatedAt: null,
        settings: []
      },
      settings: {}
    };

    for (const [key, data] of Object.entries(defaults)) {
      await client.query(
        `INSERT INTO store (key, data) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(data)]
      );
    }

    console.log('[PostgreSQL] Database initialized');
  } finally {
    client.release();
  }
}

// ─── In-memory cache (same as the old JSON approach) ─────────────────
let usersDb = { users: [] };
let itemsDb = { items: [] };
let db = {
  coinflips: [],
  inventories: [],
  transactions: [],
  deposits: [],
  withdrawals: [],
  itemWithdrawals: [],
  pendingTransactions: [],
  blackjackGames: [],
  chatMessages: [],
  giveaways: [],
  notifications: [],
  adminLogs: [],
  rpsMatches: [],
  tradeBotHeld: [],
  tradeBotUpdatedAt: null,
  settings: []
};
let settingsCache = {};

let _loaded = false;

function readLocalJson(fileName, fallback) {
  try {
    const filePath = path.join(__dirname, fileName);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`[Local JSON] Could not read ${fileName}:`, error.message);
    return fallback;
  }
}

function loadLocalJson() {
  const localUsers = readLocalJson('users.json', { users: [] });
  const localItems = readLocalJson('items.json', { items: [] });
  const localMain = readLocalJson('db.json', {});
  usersDb = {
    users: Array.isArray(localUsers.users) ? localUsers.users.map(normalizeUser).filter(Boolean) : []
  };
  itemsDb = Array.isArray(localItems.items) ? localItems : { items: [] };
  db = {
    coinflips: localMain.coinflips || [],
    inventories: localMain.inventories || [],
    transactions: localMain.transactions || [],
    deposits: localMain.deposits || [],
    withdrawals: localMain.withdrawals || [],
    itemWithdrawals: localMain.itemWithdrawals || [],
    pendingTransactions: localMain.pendingTransactions || [],
    blackjackGames: localMain.blackjackGames || [],
    jackpots: localMain.jackpots || [],
    chatMessages: localMain.chatMessages || [],
    giveaways: localMain.giveaways || [],
    notifications: localMain.notifications || [],
    adminLogs: localMain.adminLogs || [],
    rpsMatches: localMain.rpsMatches || [],
    tradeBotHeld: localMain.tradeBotHeld || [],
    tradeBotUpdatedAt: localMain.tradeBotUpdatedAt || null,
    settings: localMain.settings || {}
  };
  settingsCache = readLocalJson('settings.json', {});
  _loaded = true;
  console.log('[Local JSON] Loaded development data into memory (changes reset on restart)');
}

async function loadFromDatabase() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT key, data FROM store');
    for (const row of res.rows) {
      const data = row.data;
      switch (row.key) {
        case 'users':
          usersDb = data && Array.isArray(data.users) ? data : { users: [] };
          break;
        case 'items':
          itemsDb = data && Array.isArray(data.items) ? data : { items: [] };
          break;
        case 'main':
          db = {
            coinflips: data?.coinflips || [],
            inventories: data?.inventories || [],
            transactions: data?.transactions || [],
            deposits: data?.deposits || [],
            withdrawals: data?.withdrawals || [],
            itemWithdrawals: data?.itemWithdrawals || [],
            pendingTransactions: data?.pendingTransactions || [],
            blackjackGames: data?.blackjackGames || [],
            chatMessages: data?.chatMessages || [],
            giveaways: data?.giveaways || [],
            notifications: data?.notifications || [],
            adminLogs: data?.adminLogs || [],
            rpsMatches: data?.rpsMatches || [],
            tradeBotHeld: data?.tradeBotHeld || [],
            tradeBotUpdatedAt: data?.tradeBotUpdatedAt || null,
            settings: data?.settings || {}
          };
          break;
        case 'settings':
          settingsCache = data || {};
          break;
      }
    }
    _loaded = true;
    console.log('[PostgreSQL] Loaded data into memory');
  } finally {
    client.release();
  }
}

// ─── Save helpers ────────────────────────────────────────────────────
async function saveToStore(key, data) {
  if (LOCAL_JSON_MODE) return Promise.resolve();
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO store (key, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = NOW()`,
      [key, JSON.stringify(data)]
    );
  } finally {
    client.release();
  }
}

function normalizeUser(user) {
  if (!user) return null;
  const now = new Date().toISOString();
  const base = {
    id: user.id || uuidv4(),
    robloxUserId: user.robloxUserId || user.robloxId || null,
    robloxUsername: user.robloxUsername || user.username || '',
    robloxDisplayName: user.robloxDisplayName || user.robloxName || null,
    customDisplayName: user.customDisplayName !== undefined
      ? (user.customDisplayName || null)
      : (user.robloxDisplayName && user.displayName && user.displayName !== user.robloxDisplayName ? user.displayName : null),
    displayName: user.customDisplayName || user.displayName || user.robloxDisplayName || user.robloxUsername || user.username || 'Anonymous',
    discordId: user.discordId || null,
    discordUsername: user.discordUsername || null,
    discordAvatar: user.discordAvatar || null,
    discordLinkedAt: user.discordLinkedAt || null,
    email: user.email || '',
    password: user.password || '',
    avatar: user.avatar || user.profilePicture || '',
    avatarCachedAt: user.avatarCachedAt || 0,
    balance: typeof user.balance === 'number' ? user.balance : 0,
    lockedBalance: typeof user.lockedBalance === 'number' ? user.lockedBalance : 0,
    totalDeposited: typeof user.totalDeposited === 'number' ? user.totalDeposited : 0,
    totalWithdrawn: typeof user.totalWithdrawn === 'number' ? user.totalWithdrawn : 0,
    gamesPlayed: typeof user.gamesPlayed === 'number' ? user.gamesPlayed : 0,
    gamesWon: typeof user.gamesWon === 'number' ? user.gamesWon : 0,
    gamesLost: typeof user.gamesLost === 'number' ? user.gamesLost : 0,
    highestStreak: typeof user.highestStreak === 'number' ? user.highestStreak : 0,
    currentStreak: typeof user.currentStreak === 'number' ? user.currentStreak : 0,
    isAdmin: user.isAdmin === true,
    isModerator: user.isModerator === true,
    isActive: user.isActive !== false,
    isBanned: user.isBanned === true || user.status === 'banned',
    isFrozen: user.isFrozen === true,
    isMuted: user.isMuted === true,
    mutedAt: user.mutedAt || null,
    mutedBy: user.mutedBy || null,
    muteReason: user.muteReason || null,
    status: user.status || (user.isBanned ? 'banned' : 'active'),
    lastLogin: user.lastLogin || now,
    createdAt: user.createdAt || now,
    updatedAt: user.updatedAt || now,
    inventorySyncedAt: user.inventorySyncedAt || 0
  };
  if (base.isBanned && base.status !== 'banned') base.status = 'banned';
  if (base.status === 'banned') base.isBanned = true;
  if (!base.isBanned && base.status === 'banned') base.status = 'active';
  return base;
}

// ─── dbManager — same API as the old JSON version ────────────────────
const dbManager = {
  // True only for the opt-in JSON sandbox. Anything that talks to a real
  // database must report false, so dev-only routes can never open up.
  isSandbox() {
    return LOCAL_JSON_MODE;
  },
  // Init: connect + load everything into memory
  isReady() {
    return _loaded;
  },
  async init() {
    if (LOCAL_JSON_MODE) {
      loadLocalJson();
      return;
    }
    await initDatabase();
    await loadFromDatabase();
  },

  getUsersDb() {
    return usersDb;
  },

  getItemsDb() {
    return itemsDb;
  },

  getMainDb() {
    return db;
  },

  saveUsersDb() {
    if (Array.isArray(usersDb.users)) {
      usersDb.users = usersDb.users.map(u => {
        const norm = normalizeUser(u);
        norm.updatedAt = new Date().toISOString();
        return norm;
      });
    }
    return saveToStore('users', usersDb);
  },

  saveItemsDb() {
    return saveToStore('items', itemsDb);
  },

  saveMainDb() {
    return saveToStore('main', db);
  },

  getUserInventory(userId) {
    if (!userId) return { id: null, userId, items: [], totalValue: 0 };
    if (!db.inventories) db.inventories = [];

    let inv = db.inventories.find(i => i.userId === userId);
    if (!inv) {
      inv = {
        id: `inv-${userId}`,
        userId: userId,
        items: [],
        totalValue: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.inventories.push(inv);
      saveToStore('main', db);
    }
    if (!inv.items) inv.items = [];
    if (!inv.totalValue) inv.totalValue = 0;
    return inv;
  },

  addItemToUserInventory(userId, item, quantity) {
    if (!userId || !item) return null;
    const inv = this.getUserInventory(userId);
    const qty = typeof quantity === 'number' ? quantity : (item.quantity || 1);

    const existing = inv.items.find(i =>
      (i.itemId && i.itemId === (item.itemId || item.id)) ||
      (i.id && i.id === (item.itemId || item.id))
    );

    if (existing) {
      existing.quantity = (existing.quantity || 1) + qty;
    } else {
      const now = new Date().toISOString();
      inv.items.push({
        id: item.id || item.itemId || uuidv4(),
        itemId: item.itemId || item.id,
        name: item.name || item.itemName || 'Unknown Item',
        itemName: item.itemName || item.name || 'Unknown Item',
        value: typeof item.value === 'number' ? item.value : 0,
        rarity: item.rarity || 'common',
        mods: Array.isArray(item.mods) ? item.mods : [],
        baseValue: typeof item.baseValue === 'number' ? item.baseValue : undefined,
        quantity: qty,
        image: item.image || item.imageUrl || '',
        imageUrl: item.imageUrl || item.image || '',
        details: item.details || {
          name: item.name || item.itemName || 'Unknown Item',
          imageUrl: item.image || item.imageUrl || '',
          rarity: item.rarity || 'common'
        },
        createdAt: item.createdAt || now,
        updatedAt: now
      });
    }

    inv.totalValue = Array.isArray(inv.items)
      ? inv.items.reduce((s, i) => s + ((i.value || 0) * (i.quantity || 1)), 0)
      : 0;
    inv.updatedAt = new Date().toISOString();

    saveToStore('main', db);
    return inv;
  },

  removeItemFromUserInventory(userId, itemId, quantity) {
    if (!userId || !itemId) return false;
    const inv = this.getUserInventory(userId);
    if (!inv || !Array.isArray(inv.items)) return false;
    const qty = typeof quantity === 'number' ? quantity : 1;

    const idx = inv.items.findIndex(i =>
      i.itemId === itemId || i.id === itemId
    );
    if (idx === -1) return false;

    const currentQty = inv.items[idx].quantity || 1;
    if (currentQty <= qty) {
      inv.items.splice(idx, 1);
    } else {
      inv.items[idx].quantity = currentQty - qty;
    }

    inv.totalValue = inv.items.reduce((s, i) => s + ((i.value || 0) * (i.quantity || 1)), 0);
    inv.updatedAt = new Date().toISOString();

    saveToStore('main', db);
    return true;
  },

  findUserByRobloxUsername(username) {
    if (!username) return null;
    const key = String(username).toLowerCase();
    return usersDb.users.find(u =>
      (u.robloxUsername && String(u.robloxUsername).toLowerCase() === key) ||
      (u.username && String(u.username).toLowerCase() === key)
    );
  },

  findUserById(id) {
    if (!id) return null;
    return usersDb.users.find(u => u.id === id || String(u.id) === String(id));
  },

  normalizeUser,

  addUser(userData) {
    const normalized = normalizeUser(userData);
    usersDb.users.push(normalized);
    this.saveUsersDb();
    return normalized;
  },

  updateUser(userId, patch) {
    const user = this.findUserById(userId) || this.findUserByRobloxUsername(userId);
    if (!user) return null;
    Object.assign(user, patch || {});
    user.updatedAt = new Date().toISOString();
    const norm = normalizeUser(user);
    const idx = usersDb.users.findIndex(u => u.id === norm.id);
    if (idx !== -1) usersDb.users[idx] = norm;
    this.saveUsersDb();
    return norm;
  }
};

module.exports = dbManager;
