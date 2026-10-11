const express = require('express');
const { authenticateAdmin } = require('../middleware/auth');
const forcedOutcome = require('../forcedOutcome');

const router = express.Router();

/**
 * Outcome control - backend only, deliberately with no UI.
 *
 * This router is mounted at /api/outcome-control and is the ONLY way to reach
 * forcedOutcome.js. It has no GET route that reports its own existence, is not
 * linked from the admin panel, and is not referenced anywhere in frontend/src.
 *
 * It requires BOTH an admin session AND the server-side key, so a compromised
 * admin cookie alone is not enough.
 *
 * Every call is appended to db.forceOutcomeLog and echoed to the server log.
 * That audit trail is the part that is not optional: it is what makes "the
 * outcome was forced" a claim anyone can check rather than a matter of trust,
 * and it is the only trace of this system that does not depend on somebody
 * remembering it exists.
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
