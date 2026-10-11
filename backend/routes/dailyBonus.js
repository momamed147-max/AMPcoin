const express = require('express');
const dbManager = require('../db/dbHelper');
const { authenticateToken } = require('../middleware/auth');
const { emitToUser } = require('../realtime');
const { addNotification } = require('../notificationService');

const router = express.Router();

/**
 * Daily bonus with a login streak.
 *
 * The site already tracked `currentStreak` / `highestStreak` on the user
 * record, but those were win streaks - nothing ever incremented them from a
 * login, and nothing could read them for a reward.
 *
 * The rules are deliberately simple so they can be explained in one line:
 *   - one claim per calendar day (UTC), so the day boundary is the same for
 *     everyone and cannot be gamed by changing a client clock
 *   - the reward grows each consecutive day, up to a cap, then holds
 *   - missing a day resets the streak to 1, it does not pause it
 */

const BASE = 25000;
const PER_DAY = 15000;
const MAX_DAILY = 175000;
const MAX_STREAK = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC calendar day, as YYYY-MM-DD. */
function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function dayKeyOf(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return todayKey(d);
}

/** Whole days between two YYYY-MM-DD keys. */
function daysBetween(fromKey, toKey) {
  if (!fromKey || !toKey) return null;
  const a = Date.parse(`${fromKey}T00:00:00.000Z`);
  const b = Date.parse(`${toKey}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

function rewardFor(streak) {
  const capped = Math.max(1, Math.min(MAX_STREAK, streak));
  return Math.min(MAX_DAILY, BASE + (capped - 1) * PER_DAY);
}

function findUser(userId) {
  const usersDb = dbManager.getUsersDb();
  return { usersDb, user: (usersDb.users || []).find((u) => u.id === userId) };
}

/** Bonus fields are read defensively so an old record cannot throw here. */
function bonusState(user) {
  return {
    streak: typeof user.dailyBonusStreak === 'number' ? user.dailyBonusStreak : 0,
    best: typeof user.dailyBonusBest === 'number' ? user.dailyBonusBest : 0,
    totalClaimed: typeof user.dailyBonusTotal === 'number' ? user.dailyBonusTotal : 0,
    lastClaim: user.dailyBonusLastClaim || null,
    totalDays: typeof user.dailyBonusDays === 'number' ? user.dailyBonusDays : 0
  };
}

/**
 * What the viewer can see right now: whether they can claim, what it is worth,
 * and when the next one unlocks. Pure function of the stored state so the UI
 * and the server can never disagree about what is owed.
 */
function describe(user, now = new Date()) {
  const s = bonusState(user);
  const today = todayKey(now);
  const lastKey = dayKeyOf(s.lastClaim);
  const gap = daysBetween(lastKey, today);
  const claimedToday = lastKey === today;
  const consecutive = claimedToday ? gap === 0 : gap === 1;

  // The streak on display is the one they are ABOUT to be on, so a returning
  // player sees "day 4" for what they are about to claim rather than "day 3"
  // for what they already have.
  const nextStreak = consecutive ? s.streak + 1 : 1;
  const reward = rewardFor(nextStreak);

  let msUntilNext = 0;
  if (claimedToday) {
    const nextMidnight = Date.parse(`${today}T00:00:00.000Z`) + DAY_MS;
    msUntilNext = Math.max(0, nextMidnight - now.getTime());
  }

  return {
    canClaim: !claimedToday,
    claimedToday,
    // 0 while unclaimed: the UI shows this as a row of dots rather than a bar.
    streak: s.streak,
    nextStreak,
    best: Math.max(s.best, nextStreak),
    totalClaimed: s.totalClaimed,
    totalDays: s.totalDays,
    reward,
    nextReward: rewardFor(nextStreak + 1),
    maxStreak: MAX_STREAK,
    maxDaily: MAX_DAILY,
    msUntilNext,
    // True when they came back after missing at least a day.
    streakBroken: !claimedToday && gap !== null && gap > 1
  };
}

/** GET /api/daily-bonus - the current state. */
router.get('/', authenticateToken, (req, res) => {
  try {
    const { user } = findUser(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(describe(user));
  } catch (error) {
    console.error('Error reading daily bonus state:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /api/daily-bonus/claim - pay out the day's reward.
 *
 * The whole check-and-apply is synchronous, so two claims racing on separate
 * requests cannot both succeed: the second one re-reads the record and sees
 * today's key already set.
 */
router.post('/claim', authenticateToken, (req, res) => {
  try {
    const { usersDb, user } = findUser(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isBanned === true || user.isFrozen === true) {
      return res.status(403).json({ message: 'Your account cannot claim bonuses.' });
    }

    const state = describe(user);
    if (!state.canClaim) {
      const hours = Math.ceil(state.msUntilNext / (60 * 60 * 1000));
      return res.status(409).json({
        message: `Already claimed today. Come back in ${hours}h.`,
        ...state
      });
    }

    const amount = state.reward;
    user.balance = (Number(user.balance) || 0) + amount;
    user.dailyBonusStreak = state.nextStreak;
    user.dailyBonusBest = Math.max(state.best, state.nextStreak);
    user.dailyBonusTotal = state.totalClaimed + amount;
    user.dailyBonusDays = state.totalDays + 1;
    user.dailyBonusLastClaim = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    dbManager.saveUsersDb();

    const db = dbManager.getMainDb();
    db.transactions = db.transactions || [];
    db.transactions.push({
      id: `daily-${user.id}-${user.dailyBonusLastClaim}`,
      userId: user.id,
      robloxUsername: user.robloxUsername,
      amount,
      type: 'daily_bonus',
      status: 'completed',
      metadata: { streak: state.nextStreak, capped: state.nextStreak >= MAX_STREAK },
      timestamp: user.dailyBonusLastClaim
    });
    dbManager.saveMainDb();

    emitToUser(user.id, 'balanceUpdate', { userId: user.id, newBalance: user.balance });
    emitToUser(user.id, 'inventoryUpdate', { userId: user.id });
    try {
      addNotification({
        userId: user.id,
        title: `Daily bonus: day ${state.nextStreak}`,
        message: `+${amount.toLocaleString()} AMP added to your balance.`,
        type: 'success'
      });
    } catch (_) { /* a missing notification must not fail the payout */ }

    res.json({ message: `Day ${state.nextStreak}: +${amount.toLocaleString()} AMP`, amount, ...describe(user) });
  } catch (error) {
    console.error('Error claiming daily bonus:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
module.exports.describe = describe;
module.exports.rewardFor = rewardFor;
module.exports.todayKey = todayKey;