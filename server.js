const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Decide which database this process is allowed to touch, before anything can
// connect to anything.
//
// dotenv loads .env into process.env, so clearing the shell variable is not
// enough - a stray DATABASE_URL in .env is enough to point the whole server at
// production. That is not hypothetical: a test run once created twelve accounts
// in the live database, and those writes looked exactly like ordinary traffic.
//
// The test harness has its own guard, but that only protects the suites. This
// protects every other way the server can be started, including by hand, which
// is how that accident happened.
//
//   NODE_ENV=production          -> DATABASE_URL is required, LOCAL_JSON_MODE ignored
//   LOCAL_JSON_MODE=true         -> DATABASE_URL is cleared and local JSON is used
//   anything else with a URL     -> refuse, and say which host it found
(function resolveDatabase() {
  const local = String(process.env.LOCAL_JSON_MODE || '').toLowerCase() === 'true';
  const production = process.env.NODE_ENV === 'production';

  // Production must never silently run off a JSON file.
  if (production && local) {
    console.error('[db] NODE_ENV=production with LOCAL_JSON_MODE=true.');
    console.error('[db] Refusing to boot: production cannot use the local JSON store.');
    process.exit(1);
  }

  if (local) {
    if (process.env.DATABASE_URL) {
      console.warn('[db] LOCAL_JSON_MODE=true, so DATABASE_URL is being ignored.');
      console.warn('[db] Using the local JSON store. Nothing will reach a real database.');
      delete process.env.DATABASE_URL;
    }
    return;
  }

  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) return;
  if (process.env.ALLOW_REMOTE_DB) return;

  const host = (() => { try { return new URL(url).hostname; } catch { return 'unknown'; } })();
  console.error(`[db] NODE_ENV is not "production" and DATABASE_URL points at ${host}.`);
  console.error('[db] Refusing to boot so local work cannot write to a live database.');
  console.error('[db] Set LOCAL_JSON_MODE=true to use the local JSON store,');
  console.error('[db] or ALLOW_REMOTE_DB=1 if you really mean to.');
  process.exit(1);
})();

const dbManager = require('./backend/db/dbHelper');
const { jwtSecret } = require('./backend/jwtSecret');

const app = express();
const server = http.createServer(app);

// Behind Railway's edge, X-Forwarded-For carries the real client IP. Without
// this, express-rate-limit cannot identify clients and logs
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://ampcoin.co.uk',
  'https://ampcoin.pages.dev',
  'https://ampcoin-4v8.pages.dev',
  'https://ampcoin.b-cdn.net',
  'https://ampcoin.co.uk.b-cdn.net',
  'https://ampcoin-50q9kxt9.b4a.run',
  // Loopback in every spelling. "localhost" and "127.0.0.1" are DIFFERENT
  // origins to the browser, and the dev server serves both, so a page opened
  // on one while only the other was allowed had every request blocked by CORS
  // - the app loads and then silently cannot log in or load any data.
  ...(process.env.NODE_ENV === 'production' ? [] : [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5000',
    'http://127.0.0.1:5000'
  ])
].filter(Boolean).map((o) => String(o).replace(/\/+$/, ''));

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Authenticate the socket handshake and derive identity from the verified JWT.
// Client-provided user IDs are never trusted for targeted realtime events.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  try {
    const decoded = jwt.verify(token, jwtSecret());
    const usersDb = dbManager.getUsersDb();
    const user = (usersDb.users || []).find((candidate) =>
      (decoded.userId && candidate.id === decoded.userId) ||
      (decoded.robloxUsername && candidate.robloxUsername === decoded.robloxUsername)
    );
    if (!user || user.isActive === false || user.isFrozen || user.isBanned) {
      return next(new Error('Authentication failed'));
    }
    socket.data.userId = user.id;
    socket.data.robloxUsername = user.robloxUsername;
    socket.data.displayName = user.displayName;
    return next();
  } catch (_) {
    return next(new Error('Authentication failed'));
  }
});

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: (req) => req.path.startsWith('/socket.io')
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  skip: (req) => req.path.startsWith('/socket.io')
});

app.use('/api/', apiLimiter);
app.use(generalLimiter);

app.use(express.json({ limit: '10mb' }));

// Never serve API traffic before the in-memory store is loaded — an empty
// cache would look like "no users / no items" and could overwrite real data.
app.use('/api/', (req, res, next) => {
  if (dbManager.isReady && !dbManager.isReady()) {
    return res.status(503).json({ message: 'Database is still connecting, please retry shortly' });
  }
  return next();
});
app.use(express.urlencoded({ extended: true }));

// Import routes
const authRoutes = require('./backend/routes/auth');
const userRoutes = require('./backend/routes/users');
const itemRoutes = require('./backend/routes/items');
const coinflipRoutes = require('./backend/routes/coinflip');
const blackjackRoutes = require('./backend/routes/blackjack');
const walletRoutes = require('./backend/routes/wallet');
const tradeBotRoutes = require('./backend/routes/tradeBot');
const chatRoutes = require('./backend/routes/chat');
const giveawayRoutes = require('./backend/routes/giveaways');
const notificationRoutes = require('./backend/routes/notifications');
const realtime = require('./backend/realtime');
const adminRoutes = require('./backend/routes/admin');
const statsRoutes = require('./backend/routes/stats');
const jackpotRoutes = require('./backend/routes/jackpot');
const upgraderRoutes = require('./backend/routes/upgrader');
const tradesRoutes = require('./backend/routes/trades');

realtime.setIo(io);

// API routes
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/coinflip', coinflipRoutes);
app.use('/api/jackpot', jackpotRoutes);
app.use('/api/upgrader', upgraderRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/blackjack', blackjackRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trade-bot', tradeBotRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/giveaways', giveawayRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/progression', require('./backend/routes/progressionApi'));
app.use('/api/rps', require('./backend/routes/rps'));
// Outcome control. Backend only - no UI, not linked from the admin panel, and
// unreferenced by the frontend. Needs an admin session AND the server key.
app.use('/api/outcome-control', require('./backend/routes/outcomeControl'));

// Serve frontend for all other routes — AFTER API routes
const frontendBuild = path.join(__dirname, 'frontend', 'build');
const indexHtml = path.join(frontendBuild, 'index.html');
if (process.env.NODE_ENV === 'production' && fs.existsSync(indexHtml)) {
  app.use(express.static(frontendBuild));
  app.get('*', (req, res) => {
    res.sendFile(indexHtml);
  });
} else {
  app.get('*', (req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });
}

// Socket.IO connection handling. Identity comes from the authenticated
// handshake, never from the joinChat payload.
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id, socket.data.robloxUsername || 'unknown');

  socket.on('joinChat', () => {
    realtime.registerUser(socket.data.userId, socket.id);
  });

  socket.on('disconnect', () => {
    realtime.unregisterSocket(socket.id);
    console.log('A user disconnected:', socket.id);
  });

  socket.on('typingStart', () => {
    socket.broadcast.emit('typingStart', {
      userId: socket.data.userId,
      username: socket.data.displayName || socket.data.robloxUsername || 'Anonymous'
    });
  });
  socket.on('typingStop', () => {
    socket.broadcast.emit('typingStop', { userId: socket.data.userId });
  });
});

const PORT = process.env.PORT || 8080;
// Always bind every interface. Container platforms proxy in from outside the
// container, so binding to loopback makes the service unreachable (Railway
// answers with its fallback 502). Override with HOST only if you know why.
const HOST = process.env.HOST || '0.0.0.0';

// A cold or briefly unreachable database should not take the whole service
// down. Retry with backoff so the container stays alive and self-heals, instead
// of exiting instantly and burning the platform's restart budget (which leaves
// every endpoint returning 502).
async function initDatabaseWithRetry(attempts = 12, baseDelayMs = 5000) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await dbManager.init();
      if (attempt > 1) console.log(`Database connected on attempt ${attempt}`);
      return;
    } catch (err) {
      lastError = err;
      const target = (() => {
        try {
          const url = new URL(process.env.DATABASE_URL);
          return `${url.hostname}:${url.port || 5432}/${(url.pathname || '/').slice(1)}`;
        } catch (_) { return 'not set'; }
      })();
      console.error(`[startup] Database connect attempt ${attempt}/${attempts} failed (${target}): ${err.message}`);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

// Initialize PostgreSQL then start server
async function start() {
  try {
    await initDatabaseWithRetry();
    // Say what actually happened. This line used to claim Postgres had
    // connected even in local JSON mode, where no connection is made at all -
    // which is a bad way to find out you are pointed at the wrong database.
    console.log(dbManager.isSandbox()
      ? '[Local JSON] Ready. No database connection was opened.'
      : 'PostgreSQL connected and data loaded');

    // Auto-migrate: if no users exist, import from local JSON files if available
    const users = dbManager.getUsersDb();
    if (!users.users || users.users.length === 0) {
      console.log('Empty database detected — attempting auto-migration from JSON...');
      try {
        const fs = require('fs');
        const jsonUsersPath = path.join(__dirname, 'backend', 'db', 'users.json');
        const jsonMainPath = path.join(__dirname, 'backend', 'db', 'db.json');
        const jsonItemsPath = path.join(__dirname, 'backend', 'db', 'items.json');

        if (fs.existsSync(jsonUsersPath)) {
          const jsonUsers = JSON.parse(fs.readFileSync(jsonUsersPath, 'utf8'));
          if (jsonUsers.users && jsonUsers.users.length > 0) {
            for (const u of jsonUsers.users) {
              users.users.push(dbManager.normalizeUser(u));
            }
            dbManager.saveUsersDb();
            console.log(`Migrated ${jsonUsers.users.length} users`);
          }
        }

        const mainDb = dbManager.getMainDb();
        if (fs.existsSync(jsonMainPath)) {
          const jsonMain = JSON.parse(fs.readFileSync(jsonMainPath, 'utf8'));
          for (const key of Object.keys(jsonMain)) {
            if (Array.isArray(jsonMain[key]) && jsonMain[key].length > 0 && Array.isArray(mainDb[key])) {
              mainDb[key] = jsonMain[key];
            }
          }
          dbManager.saveMainDb();
          console.log('Migrated main database collections');
        }

        if (fs.existsSync(jsonItemsPath)) {
          const jsonItems = JSON.parse(fs.readFileSync(jsonItemsPath, 'utf8'));
          if (jsonItems.items && jsonItems.items.length > 0) {
            const itemsDb = dbManager.getItemsDb();
            itemsDb.items = jsonItems.items;
            dbManager.saveItemsDb();
            console.log(`Migrated ${jsonItems.items.length} items`);
          }
        }

        console.log('Auto-migration complete!');
      } catch (migErr) {
        console.warn('Auto-migration skipped:', migErr.message);
      }
    }
  } catch (err) {
    console.error('FATAL: Could not connect to PostgreSQL after all retries:', err.message);
    console.error('Check the DATABASE_URL variable on this service and that the database is reachable.');
    process.exit(1);
  }

  server.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
    // Say out loud at boot whether outcome control is live. The point of this
    // system is that it is not user-facing, so it is easy to forget it is
    // switched on - this line is the cheapest possible guard against that.
    console.log(require('./backend/forcedOutcome').describe());
  });
}

start();
