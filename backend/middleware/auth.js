const jwt = require('jsonwebtoken');
const dbManager = require('../db/dbHelper');
const { jwtSecret } = require('../jwtSecret');

const getBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  return authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
};

const findTokenUser = (decoded) => {
  const usersDb = dbManager.getUsersDb();
  if (!usersDb || !Array.isArray(usersDb.users)) return null;
  // The token id is authoritative — a username match is only a fallback so a
  // duplicate name can never resolve to the wrong account.
  if (decoded.userId) {
    const byId = usersDb.users.find((user) => user.id === decoded.userId);
    if (byId) return byId;
  }
  if (decoded.robloxUsername) {
    return usersDb.users.find((user) => user.robloxUsername === decoded.robloxUsername) || null;
  }
  return null;
};

const attachUser = (user) => {
  const isAdmin = user.isAdmin === true;
  const isModerator = user.isModerator === true;
  return {
    userId: user.id,
    robloxUsername: user.robloxUsername,
    displayName: user.displayName,
    isAdmin,
    isModerator,
    role: isAdmin ? 'admin' : isModerator ? 'moderator' : 'user'
  };
};

const authenticateStaff = (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret());
    const user = findTokenUser(decoded);
    if (!user || user.isActive === false || user.isFrozen || user.isBanned || (user.isAdmin !== true && user.isModerator !== true)) {
      return res.status(403).json({ message: 'Access denied. Staff access required.' });
    }

    req.user = attachUser(user);
    return next();
  } catch (error) {
    console.error('Staff authentication error:', error);
    return res.status(403).json({ message: 'Access denied. Invalid token.' });
  }
};

const authenticateAdmin = (req, res, next) => {
  return authenticateStaff(req, res, () => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: 'Access denied. Admin access required.' });
    }
    return next();
  });
};

// Moderators and admins share the staff authentication boundary. Individual
// routes decide which staff operations they expose.
const authenticateModerator = authenticateStaff;

const authenticateToken = (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret());
    const user = findTokenUser(decoded);
    if (!user || user.isActive === false || user.isFrozen || user.isBanned) {
      return res.status(403).json({ message: 'Access denied. Invalid, inactive, or banned user.' });
    }

    req.user = attachUser(user);
    return next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(403).json({ message: 'Access denied. Invalid token.' });
  }
};

module.exports = {
  authenticateToken,
  authenticateAdmin,
  authenticateModerator,
  authenticateStaff
};
