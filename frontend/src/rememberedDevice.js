/* Remembered login devices.
 *
 * The API hands back a random device token after a successful Roblox bio
 * verification. Only the SHA-256 hash of that token is stored server-side; the
 * raw token lives here so a returning browser can exchange it for a normal
 * session without making the player edit their Roblox bio again.
 *
 * Entries are keyed by username so two accounts on one browser do not
 * overwrite each other. Expiry is checked in the browser as a convenience, but
 * the server is the authority.
 */

const STORAGE_KEY = 'ampcoin_remembered_devices_v1';

function keyFor(username) {
  return String(username || '').trim().toLowerCase();
}

function readStore() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_) {
    return {};
  }
}

function writeStore(store) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (_) {
    // Storage can be unavailable in private browsing. The player simply gets
    // the normal bio-code flow next time.
  }
}

function isUsable(entry, now = Date.now()) {
  if (!entry || typeof entry.token !== 'string') return false;
  const expires = Date.parse(entry.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

function pruneExpired(store) {
  const now = Date.now();
  let changed = false;
  const clean = {};
  for (const [key, entry] of Object.entries(store)) {
    if (isUsable(entry, now)) clean[key] = entry;
    else changed = true;
  }
  if (changed) writeStore(clean);
  return clean;
}

export function getRememberedDevice(username) {
  const store = pruneExpired(readStore());
  const key = keyFor(username);
  if (key) {
    const entry = store[key];
    return entry && isUsable(entry) ? entry : null;
  }

  return Object.values(store)
    .filter((entry) => isUsable(entry))
    .sort((a, b) => Date.parse(b.savedAt || 0) - Date.parse(a.savedAt || 0))[0] || null;
}

export function saveRememberedDevice({ username, token, expiresAt }) {
  const key = keyFor(username);
  if (!key || !token || !expiresAt) return null;
  const store = pruneExpired(readStore());
  const entry = {
    username: String(username).trim(),
    token,
    expiresAt,
    savedAt: new Date().toISOString()
  };
  store[key] = entry;
  writeStore(store);
  return entry;
}

export function removeRememberedDevice(username) {
  const store = pruneExpired(readStore());
  const key = keyFor(username);
  if (!key || !store[key]) return null;
  const removed = store[key];
  delete store[key];
  writeStore(store);
  return removed;
}
