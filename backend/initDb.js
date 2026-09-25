const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Database file paths
const usersPath = path.join(__dirname, 'db', 'users.json');
const itemsPath = path.join(__dirname, 'db', 'items.json');
const coinflipPath = path.join(__dirname, 'db', 'coinflip.json');
const mainDbPath = path.join(__dirname, 'db', 'db.json');

// Ensure db directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize main db.json
if (!fs.existsSync(mainDbPath)) {
  const defaultDb = {
    transactions: [],
    coinflips: [],
    blackjackGames: [],
    withdrawals: [],
    deposits: [],
    inventories: [],
    chatMessages: [],
    adminLogs: [],
    itemWithdrawals: [],
    taxRecipients: [],
    settings: []
  };
  
  fs.writeFileSync(mainDbPath, JSON.stringify(defaultDb, null, 2));
  console.log('Created db.json with default structures');
}

// Initialize users database
if (!fs.existsSync(usersPath)) {
  const defaultUsers = {
    users: [
      {
        id: '1',
        robloxUsername: 'admin',
        displayName: 'Admin User',
        password: bcrypt.hashSync('admin123', 10),
        avatar: '',
        balance: 10000,
        totalDeposited: 0,
        totalWithdrawn: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        gamesLost: 0,
        isAdmin: true,
        isModerator: false,
        isActive: true,
        isFrozen: false,
        lastLogin: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: '2',
        robloxUsername: 'player1',
        displayName: 'Player One',
        password: bcrypt.hashSync('password123', 10),
        avatar: '',
        balance: 5000,
        totalDeposited: 0,
        totalWithdrawn: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        gamesLost: 0,
        isAdmin: false,
        isModerator: false,
        isActive: true,
        isFrozen: false,
        lastLogin: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  };
  
  fs.writeFileSync(usersPath, JSON.stringify(defaultUsers, null, 2));
  console.log('Created users.json with default users');
  
  // Create default inventories for these users in main db
  const mainDb = JSON.parse(fs.readFileSync(mainDbPath, 'utf8'));
  
  // Create inventory for admin user
  const adminInventory = {
    id: '1',
    userId: '1',
    items: [],
    totalValue: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  // Create inventory for player1
  const playerInventory = {
    id: '2',
    userId: '2',
    items: [],
    totalValue: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  mainDb.inventories = [adminInventory, playerInventory];
  
  fs.writeFileSync(mainDbPath, JSON.stringify(mainDb, null, 2));
  console.log('Created default inventories for default users');
}

// Initialize items database
if (!fs.existsSync(itemsPath)) {
  const defaultItems = {
    items: [
      {
        id: '1',
        name: 'Epic Sword',
        type: 'weapon',
        value: 100,
        rarity: 'common',
        image: 'sword.png',
        quantity: 10
      },
      {
        id: '2',
        name: 'Magic Shield',
        type: 'armor',
        value: 150,
        rarity: 'uncommon',
        image: 'shield.png',
        quantity: 5
      }
    ]
  };
  
  fs.writeFileSync(itemsPath, JSON.stringify(defaultItems, null, 2));
  console.log('Created items.json with default items');
}

// Initialize coinflip database
if (!fs.existsSync(coinflipPath)) {
  const defaultCoinflips = {
    coinflips: []
  };
  
  fs.writeFileSync(coinflipPath, JSON.stringify(defaultCoinflips, null, 2));
  console.log('Created coinflip.json');
}

console.log('Database initialization completed');