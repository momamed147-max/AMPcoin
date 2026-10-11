const dbManager = require('../db/dbHelper');

/**
 * Progression: per-game statistics and achievements, computed from the records
 * each game actually keeps.
 *
 * The games store their history in different shapes and nobody had aggregated
 * them, so "your stats" was a single gamesPlayed counter that could not be
 * broken down, and it read db.blackjackGames - a collection the solo Blackjack
 * used to write and nothing writes any more.
 *
 * Every getter below is defensive on purpose: a missing or renamed field must
 * degrade to zero, never throw. Stats are not worth a 500.
 */

const list = (v) => (Array.isArray(v) ? v : []);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Total value of a set of item stacks. */
function itemsValue(items) {
  return list(items).reduce((s, it) => s + num(it && it.value) * num(it && (it.quantity || 1)), 0);
}

function isRealUserId(id) {
  // A bot seat is synthetic ("bot-<realUserId>") so it is not a distinct player.
  return typeof id === 'string' && id.length > 0 && !id.startsWith('bot-');
}

// ── per-game history ─────────────────────────────────────────────────────────

/** Completed coinflips this user was in. */
function coinflipRecords(db, userId) {
  return list(db.coinflips).filter((cf) => (
    cf.status === 'completed'
    && (cf.creatorId === userId || cf.opponentId === userId)
  ));
}

/**
 * Completed blackjack tables the user sat in, from EITHER seat.
 *
 * The creator of a table is the DEALER. So a user is in one of two places:
 *   - opponentId: they were the player against another human (they hit/stand).
 *   - creatorId:  they were the dealer. That is every bot table, because the
 *     house bot is the player seat - and it was missed entirely when only
 *     opponentId was checked, so bot hands never appeared in anyone's stats.
 *
 * The win and the profit are read from the seat the user actually held.
 */
function blackjackRecords(db, userId) {
  return list(db.blackjackTables)
    .filter((t) => t.status === 'completed' && (t.creatorId === userId || t.opponentId === userId))
    .map((t) => {
      const asPlayer = t.opponentId === userId;
      // profit is recorded net of the rake and tax, so it is the real figure.
      const playerProfit = num(t.profit);
      return {
        id: t.id,
        won: asPlayer
          ? ['win', 'blackjack', 'dealer_bust'].includes(t.result)
          // As the dealer the user wins when the player busted or lost.
          : ['loss', 'bust'].includes(t.result),
        staked: asPlayer ? num(t.opponentValue) : num(t.creatorValue),
        profited: asPlayer ? playerProfit : -playerProfit,
        seat: asPlayer ? 'player' : 'dealer',
        result: t.result,
        at: t.updatedAt || t.createdAt
      };
    });
}

/** The user as the RPS playerOne. */
function rpsRecordsAsCreator(db, userId) {
  return list(db.rpsMatches).filter((m) => m.playerOne && m.playerOne.id === userId);
}

/** The user as the RPS playerTwo (the joiner). */
function rpsRecordsAsOpponent(db, userId) {
  return list(db.rpsMatches).filter((m) => m.playerTwo && m.playerTwo.id === userId);
}

/** Upgrader rounds this user settled. */
function upgraderRecords(db, userId) {
  const rounds = db.upgrader && Array.isArray(db.upgrader.rounds) ? db.upgrader.rounds : [];
  return rounds.filter((r) => r && r.userId === userId);
}

// ── aggregation ──────────────────────────────────────────────────────────────

function summarise(records, { won, staked, profited }) {
  let wins = 0; let losses = 0; let pushes = 0; let stakedTotal = 0; let profitTotal = 0;
  let biggestWin = 0; let biggestLoss = 0;
  for (const r of records) {
    const s = num(staked(r));
    const p = num(profited(r));
    stakedTotal += s;
    profitTotal += p;
    const wonThis = won(r);
    if (wonThis) {
      wins++;
      if (p > biggestWin) biggestWin = p;
    } else if (p === 0) {
      pushes++;
    } else {
      losses++;
      if (p < biggestLoss) biggestLoss = p;
    }
  }
  const played = wins + losses + pushes;
  return {
    played,
    wins,
    losses,
    pushes,
    // Pushes count as played but not as decided, so the rate is over decided
    // games only - otherwise a player who draws a lot looks unlucky.
    winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
    staked: stakedTotal,
    profit: profitTotal,
    biggestWin,
    biggestLoss: Math.abs(biggestLoss)
  };
}

function buildGames(db, userId) {
  const coinflip = coinflipRecords(db, userId).map((cf) => ({
    id: cf.id,
    won: cf.winnerId === userId,
    staked: cf.creatorId === userId ? num(cf.creatorValue) : num(cf.opponentValue),
    profited: cf.winnerId === userId ? num(cf.opponentValue) : -num(cf.creatorValue),
    at: cf.completedAt || cf.createdAt
  }));

  const blackjack = blackjackRecords(db, userId);

  const rps = [...rpsRecordsAsCreator(db, userId), ...rpsRecordsAsOpponent(db, userId)]
    .map((m) => {
      const asOne = m.playerOne && m.playerOne.id === userId;
      const stake = asOne ? num(m.creatorValue) : num(m.potValue) - num(m.creatorValue);
      return {
        id: m.id,
        won: m.winnerId === userId,
        // A draw is recorded with no winner rather than as a result string.
        push: !m.winnerId,
        staked: stake,
        profited: m.winnerId === userId ? num(m.potValue) - num(m.creatorValue) - stake : m.winnerId ? -stake : 0,
        at: m.updatedAt || m.createdAt
      };
    });

  const upgrader = upgraderRecords(db, userId).map((r) => ({
    id: r.id,
    won: r.won === true,
    staked: num(r.potValue),
    profited: r.won ? num(r.payoutValue) - num(r.potValue) : -num(r.potValue),
    at: r.settledAt || r.createdAt
  }));

  const games = {
    coinflip: summarise(coinflip, {
      won: (r) => r.won,
      staked: (r) => r.staked,
      profited: (r) => r.profited
    }),
    blackjack: summarise(blackjack, {
      won: (r) => r.won,
      staked: (r) => r.staked,
      profited: (r) => r.profited
    }),
    rps: summarise(rps, {
      won: (r) => r.won,
      staked: (r) => r.staked,
      profited: (r) => r.profited
    }),
    upgrader: summarise(upgrader, {
      won: (r) => r.won,
      staked: (r) => r.staked,
      profited: (r) => r.profited
    })
  };

  const all = [...coinflip, ...blackjack, ...rps, ...upgrader];
  const played = all.length;
  const wins = all.filter((r) => r.won).length;
  const net = all.reduce((s, r) => s + r.profited, 0);

  return {
    games,
    totals: {
      played,
      wins,
      losses: all.filter((r) => !r.won && r.profited !== 0).length,
      winRate: played > 0 ? Math.round((wins / played) * 1000) / 10 : 0,
      staked: all.reduce((s, r) => s + r.staked, 0),
      profit: net,
      biggestWin: all.reduce((m, r) => Math.max(m, r.profited), 0),
      biggestLoss: Math.abs(all.reduce((m, r) => Math.min(m, r.profited), 0)),
      biggestStake: all.reduce((m, r) => Math.max(m, r.staked), 0),
      distinctOpponents: countOpponents(db, userId)
    },
    history: all
      .filter((r) => r.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 50)
  };
}

/** How many different people this user has actually played against. */
function countOpponents(db, userId) {
  const ids = new Set();
  for (const cf of list(db.coinflips)) {
    if (cf.creatorId === userId && isRealUserId(cf.opponentId)) ids.add(cf.opponentId);
    if (cf.opponentId === userId && isRealUserId(cf.creatorId)) ids.add(cf.creatorId);
  }
  for (const t of list(db.blackjackTables)) {
    if (t.creatorId === userId && isRealUserId(t.opponentId)) ids.add(t.opponentId);
    if (t.opponentId === userId && isRealUserId(t.creatorId)) ids.add(t.creatorId);
  }
  for (const m of list(db.rpsMatches)) {
    const one = m.playerOne && m.playerOne.id;
    const two = m.playerTwo && m.playerTwo.id;
    if (one === userId && isRealUserId(two)) ids.add(two);
    if (two === userId && isRealUserId(one)) ids.add(one);
  }
  return ids.size;
}

// ── achievements ─────────────────────────────────────────────────────────────

/**
 * Definitions. `progress(stats, ctx)` returns { value, goal } where value is
 * clamped by the caller, so a tiered achievement counts up rather than popping.
 *
 * ctx carries the things that cannot be derived from the aggregate alone: the
 * user's lifetime counters kept on their record.
 */
const ACHIEVEMENTS = [
  {
    id: 'first-bet', name: 'First Bet', tier: 'bronze', icon: 'coin',
    description: 'Place your first bet.',
    progress: (s, ctx) => ({ value: Math.max(ctx.gamesPlayed || 0, s.totals.played), goal: 1 })
  },
  {
    id: 'getting-serious', name: 'Getting Serious', tier: 'bronze', icon: 'target',
    description: 'Play 100 bets.',
    progress: (s) => ({ value: s.totals.played, goal: 100 })
  },
  {
    id: 'veteran', name: 'Veteran', tier: 'silver', icon: 'flag',
    description: 'Play 500 bets.',
    progress: (s) => ({ value: s.totals.played, goal: 500 })
  },
  {
    id: 'high-roller', name: 'High Roller', tier: 'silver', icon: 'diamond',
    description: 'Stake 100,000 in a single bet.',
    progress: (s) => ({ value: s.totals.biggestStake, goal: 100000 })
  },
  {
    id: 'whale', name: 'Whale', tier: 'gold', icon: 'jackpot',
    description: 'Win 1,000,000 net across every game.',
    progress: (s) => ({ value: Math.max(0, s.totals.profit), goal: 1000000 })
  },
  {
    id: 'sharpshooter', name: 'Sharpshooter', tier: 'silver', icon: 'rpsRock',
    description: 'Hold a 60% win rate over 50 decided bets.',
    progress: (s) => ({
      value: s.totals.played >= 50 && s.totals.winRate >= 60 ? 1 : 0,
      goal: 1
    })
  },
  {
    id: 'natural', name: 'Natural', tier: 'gold', icon: 'card',
    description: 'Be dealt a blackjack.',
    progress: (s, ctx) => ({ value: Math.min(ctx.blackjackNaturals || 0, 1), goal: 1 })
  },
  {
    id: 'card-counter', name: 'Card Counter', tier: 'silver', icon: 'card',
    description: 'Play 10 blackjack hands.',
    progress: (s) => ({ value: s.games.blackjack.played, goal: 10 })
  },
  {
    id: 'upgrader-pro', name: 'Upgrader Pro', tier: 'gold', icon: 'battery',
    description: 'Win 5 upgrader rounds.',
    progress: (s) => ({ value: s.games.upgrader.wins, goal: 5 })
  },
  {
    id: 'rock-paper-scissors', name: 'Grandmaster', tier: 'silver', icon: 'rpsScissors',
    description: 'Win 25 RPS matches.',
    progress: (s) => ({ value: s.games.rps.wins, goal: 25 })
  },
  {
    id: 'socialite', name: 'Socialite', tier: 'silver', icon: 'chat',
    description: 'Play against 10 different people.',
    progress: (s) => ({ value: s.totals.distinctOpponents, goal: 10 })
  },
  {
    id: 'taxpayer', name: 'Taxpayer', tier: 'bronze', icon: 'wallet',
    description: 'Pay 10,000 in tax across the site.',
    progress: (s, ctx) => ({ value: Math.min(ctx.taxPaid || 0, 10000), goal: 10000 })
  }
];

const TIER_ORDER = { bronze: 0, silver: 1, gold: 2, diamond: 3 };

function buildAchievements(stats, ctx) {
  return ACHIEVEMENTS.map((a) => {
    let value = 0;
    let goal = 1;
    try {
      const p = a.progress(stats, ctx);
      value = Math.max(0, num(p && p.value));
      goal = Math.max(1, num(p && p.goal) || 1);
    } catch (_) {
      // A broken definition must not take the whole page down with it.
      value = 0; goal = 1;
    }
    const unlocked = value >= goal;
    return {
      id: a.id,
      name: a.name,
      tier: a.tier,
      icon: a.icon,
      description: a.description,
      unlocked,
      value,
      goal,
      percent: Math.min(100, Math.round((value / goal) * 100))
    };
  }).sort((a, b) => {
    // Locked-but-close first, so the page tells you what to go and do next.
    if (a.unlocked !== b.unlocked) return a.unlocked ? 1 : -1;
    const byTier = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (byTier !== 0) return byTier;
    return b.percent - a.percent;
  });
}

/** Counters the user record keeps that the aggregate cannot work out. */
function userContext(db, usersDb, user) {
  const taxPaid = list(db.transactions)
    .filter((t) => t.userId === user.id && num(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(num(t.amount)), 0);
  // A natural counts whoever was holding the hand, which on a bot table is the
  // BOT (the player seat), not the human dealer.
  const blackjackNaturals = list(db.blackjackTables)
    .filter((t) => t.result === 'blackjack' && t.opponentId === user.id).length;
  return {
    gamesPlayed: num(user.gamesPlayed),
    taxPaid,
    blackjackNaturals
  };
}

function buildSummary(db, usersDb, user) {
  const stats = buildGames(db, user.id);
  const ctx = userContext(db, usersDb, user);
  const achievements = buildAchievements(stats, ctx);
  return {
    totals: stats.totals,
    games: stats.games,
    achievements: {
      unlocked: achievements.filter((a) => a.unlocked).length,
      total: achievements.length,
      // The next thing to go and do, and how close it is.
      next: achievements.find((a) => !a.unlocked) || null,
      list: achievements
    },
    history: stats.history.map((r) => ({
      id: r.id,
      won: r.won,
      staked: r.staked,
      profit: r.profited,
      at: r.at,
      result: r.result || null
    }))
  };
}

module.exports = {
  ACHIEVEMENTS,
  buildGames,
  buildAchievements,
  buildSummary,
  userContext,
  countOpponents,
  itemsValue,
  num
};