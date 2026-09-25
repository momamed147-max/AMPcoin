const crypto = require('crypto');

/**
 * Shared-secret auth for the trade bot endpoints.
 *
 * The key is read from the TRADE_BOT_API_KEY environment variable and is
 * never sent by, or readable from, any game client. If the variable is not
 * configured these routes fail closed (503) rather than open.
 */

// Constant-time compare so a timing side-channel cannot leak the key.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length differences are not obviously fast.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function reject(res, status, code, message) {
  return res.status(status).json({
    success: false,
    error: { code, message }
  });
}

function authenticateBot(req, res, next) {
  const configured = process.env.TRADE_BOT_API_KEY;

  if (!configured || String(configured).length < 24) {
    console.error('[trade-bot] TRADE_BOT_API_KEY is not set or is too short - refusing request');
    return reject(res, 503, 'BOT_AUTH_NOT_CONFIGURED', 'Trade bot API is not configured on this server.');
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !safeEqual(token, configured)) {
    console.warn(`[trade-bot] rejected ${req.method} ${req.originalUrl} - bad key from ${req.ip || 'unknown'}`);
    return reject(res, 401, 'INVALID_API_KEY', 'Invalid or missing API key.');
  }

  return next();
}

module.exports = { authenticateBot };
