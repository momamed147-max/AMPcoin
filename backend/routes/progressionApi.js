const express = require('express');
const dbManager = require('../db/dbHelper');
const { authenticateToken } = require('../middleware/auth');
const { buildSummary, buildGames, buildAchievements, userContext } = require('./progression');

const router = express.Router();

/**
 * /api/progression - the stats and achievements surface.
 *
 * Everything is derived on read from the records each game already keeps, so
 * there is no second source of truth to fall out of sync with the games.
 */

function viewer(req, res) {
  const usersDb = dbManager.getUsersDb();
  const user = (usersDb.users || []).find((u) => u.id === req.user.userId);
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return null;
  }
  return { usersDb, user };
}

/** Totals, per-game breakdown, achievements, and a recent history feed. */
router.get('/summary', authenticateToken, (req, res) => {
  try {
    const v = viewer(req, res);
    if (!v) return;
    const db = dbManager.getMainDb();
    res.json(buildSummary(db, v.usersDb, v.user));
  } catch (error) {
    console.error('Error building progression summary:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/** Just the achievements, for a widget elsewhere on the site. */
router.get('/achievements', authenticateToken, (req, res) => {
  try {
    const v = viewer(req, res);
    if (!v) return;
    const db = dbManager.getMainDb();
    const stats = buildGames(db, v.user.id);
    const ctx = userContext(db, v.usersDb, v.user);
    const list = buildAchievements(stats, ctx);
    res.json({
      unlocked: list.filter((a) => a.unlocked).length,
      total: list.length,
      next: list.find((a) => !a.unlocked) || null,
      list
    });
  } catch (error) {
    console.error('Error building achievements:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/** The definition catalog, with no user attached. */
router.get('/achievements/catalog', authenticateToken, (req, res) => {
  try {
    const { ACHIEVEMENTS } = require('./progression');
    res.json({
      total: ACHIEVEMENTS.length,
      list: ACHIEVEMENTS.map((a) => ({
        id: a.id, name: a.name, tier: a.tier, icon: a.icon, description: a.description
      }))
    });
  } catch (error) {
    console.error('Error listing achievement catalog:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/** Just the per-game numbers, for a compact header widget. */
router.get('/games', authenticateToken, (req, res) => {
  try {
    const v = viewer(req, res);
    if (!v) return;
    const db = dbManager.getMainDb();
    const stats = buildGames(db, v.user.id);
    res.json({ games: stats.games, totals: stats.totals });
  } catch (error) {
    console.error('Error building per-game stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;