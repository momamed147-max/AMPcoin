/**
 * The only place in the backend that talks to Roblox.
 *
 * These two lookups used to be copy-pasted into auth.js, chat.js and users.js,
 * each with its own `timeout: 5000`. That mattered because both sit on paths
 * the browser blocks on at boot:
 *
 *   POST /api/auth/verify-token      awaits an avatar lookup
 *   GET  /api/users/profile/:name    awaits a profile lookup
 *
 * If Roblox is slow, rate-limited, or simply unreachable - a machine behind a
 * firewall, a laptop on a train, an ISP with DNS trouble - every single page
 * load stalls for the full timeout before the app renders. Measured at 5.2s
 * while Roblox was unreachable, versus 9ms for every other endpoint.
 *
 * Two things fix that, and both belong here rather than at each call site:
 *
 *   1. A circuit breaker. Once a lookup fails, stop trying for a few minutes
 *      and answer from cache. Without it the retry is endless, because a failed
 *      lookup stores an empty avatar and the "already cached?" check tests a
 *      non-empty string - so it never counts as cached and re-fires on every
 *      single request.
 *   2. A short timeout. An avatar is decoration. It must never be worth a
 *      multi-second stall.
 */

const https = require('https');

// Roblox is decoration on every screen that asks for it. A slow answer is
// worth less than no answer at all.
const TIMEOUT_MS = Number(process.env.ROBLOX_TIMEOUT_MS || 2500);

// How long to stop trying after a failure. Long enough that a brief blip does
// not get re-probed on every request, short enough to recover on its own.
const BREAKER_MS = Number(process.env.ROBLOX_BACKOFF_MS || 5 * 60 * 1000);

/** Set while the breaker is open. A timestamp, not a boolean, so it self-closes. */
let breakerOpenUntil = 0;
let lastFailureReason = null;
const stats = { attempted: 0, skipped: 0, failed: 0, succeeded: 0 };

function breakerIsOpen() {
  return Date.now() < breakerOpenUntil;
}

function tripBreaker(reason) {
  // Log only on an actual transition. React StrictMode doubles every request,
  // and a page load fires several lookups at once, so logging per failure
  // turned one outage into a dozen identical lines.
  const wasOpen = breakerIsOpen();
  breakerOpenUntil = Date.now() + BREAKER_MS;
  lastFailureReason = reason;
  if (!wasOpen) {
    console.warn(`[roblox] ${reason} - skipping lookups for ${Math.round(BREAKER_MS / 1000)}s`);
  }
}

function getRobloxStats() {
  return {
    ...stats,
    breakerOpen: breakerIsOpen(),
    breakerOpenUntil,
    lastFailureReason,
    timeoutMs: TIMEOUT_MS,
    backoffMs: BREAKER_MS
  };
}

/** Lets the tests and a manual retry force a fresh attempt. */
function resetBreaker() {
  breakerOpenUntil = 0;
  lastFailureReason = null;
}

/** One HTTPS request with a hard deadline. Returns parsed JSON, or throws. */
function requestJson(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, timeout: TIMEOUT_MS }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('bad json')); }
      });
    });
    const fail = (err) => { try { req.destroy(); } catch (_) { /* already gone */ } reject(err); };
    req.on('error', fail);
    req.on('timeout', () => fail(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Run a lookup unless the breaker is open.
 * `fallback` is returned on every failure path, so callers never see a throw.
 */
async function guarded(fn, fallback) {
  if (breakerIsOpen()) {
    stats.skipped += 1;
    return fallback;
  }
  stats.attempted += 1;
  try {
    const out = await fn();
    stats.succeeded += 1;
    breakerOpenUntil = 0; // recovered
    return out;
  } catch (err) {
    stats.failed += 1;
    tripBreaker(err.message || 'request failed');
    return fallback;
  }
}

/**
 * Roblox user id for a username, or null.
 * Returns null immediately while the breaker is open.
 */
async function getRobloxUserIdFromUsername(robloxUsername) {
  if (!robloxUsername) return null;
  return guarded(async () => {
    const body = JSON.stringify({ usernames: [robloxUsername], excludeBannedUsers: false });
    const json = await requestJson({
      hostname: 'users.roblox.com',
      path: '/v1/usernames/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json'
      }
    }, body);
    return json && json.data && json.data.length > 0 ? json.data[0].id : null;
  }, null);
}

/** Full profile record for a username: { id, displayName }, or null. */
async function getRobloxProfileByUsername(robloxUsername) {
  if (!robloxUsername) return null;
  return guarded(async () => {
    const body = JSON.stringify({ usernames: [robloxUsername], excludeBannedUsers: false });
    const json = await requestJson({
      hostname: 'users.roblox.com',
      path: '/v1/usernames/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json'
      }
    }, body);
    return json && json.data && json.data.length > 0 ? json.data[0] : null;
  }, null);
}

/** Headshot image URL for a user id, or null. */
async function getRobloxHeadshotUrl(robloxUserId, size = '420x420') {
  if (!robloxUserId) return null;
  return guarded(async () => {
    const json = await requestJson({
      hostname: 'thumbnails.roblox.com',
      path: `/v1/users/avatar-headshot?userIds=${robloxUserId}&size=${size}&format=Png&isCircular=false`,
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    return json && json.data && json.data.length > 0 && json.data[0].imageUrl
      ? json.data[0].imageUrl
      : null;
  }, null);
}

/**
 * The URL the browser will use anyway, without asking us. Lets callers offer a
 * real image even when the lookup failed.
 */
function headshotFallbackUrl(robloxUserId, size = 420) {
  if (!robloxUserId) return '';
  return `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxUserId}&width=${size}&height=${size}&format=png`;
}

module.exports = {
  getRobloxUserIdFromUsername,
  getRobloxProfileByUsername,
  getRobloxHeadshotUrl,
  headshotFallbackUrl,
  getRobloxStats,
  resetBreaker,
  TIMEOUT_MS,
  BREAKER_MS
};
