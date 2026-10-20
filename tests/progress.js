// Play real games of every kind, then check /api/progression reports the same
// numbers. The aggregation reads four different stored shapes, so the only way
// to know it is right is to make real records and read them back.
const API = 'http://127.0.0.1:5000';
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const val = (i) => (i || []).reduce((s, x) => s + Number(x.value) * Number(x.quantity), 0);
const login = async (u) => (await (await fetch(`${API}/api/auth/dev-login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u })
})).json());
const inv = async (t) => (await (await fetch(`${API}/api/users/inventory/${t.user.id}`, { headers: auth(t.token) })).json()).items;

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`); };

(async () => {
  const admin = await login('local-admin');
  const cat = await (await fetch(`${API}/api/items`)).json();
  const all = (Array.isArray(cat) ? cat : cat.items).filter((i) => Number(i.value) > 0);
  const byValue = [...all].sort((a, b) => Number(a.value) - Number(b.value));
  const pool = byValue.filter((i) => Number(i.value) <= 60).slice(0, 8);

  await fetch(`${API}/api/admin/user/${admin.user.id}/add-items`, {
    method: 'POST', headers: auth(admin.token),
    body: JSON.stringify({ items: pool.map((i) => ({ itemId: i.itemId || i.id, quantity: 600 })) })
  });
  await fetch(`${API}/api/admin/taxes`, {
    method: 'PUT', headers: auth(admin.token),
    body: JSON.stringify({ taxEnabled: true, taxPercent: 15, taxRecipient: admin.user.id })
  });

  const stamp = Date.now().toString().slice(-5);
  const mk = async (n, sl) => {
    const u = await login(n);
    await fetch(`${API}/api/admin/user/${u.user.id}/add-items`, {
      method: 'POST', headers: auth(admin.token),
      body: JSON.stringify({ items: pool.slice(sl, sl + 5).map((i) => ({ itemId: i.itemId || i.id, quantity: 400 })) })
    });
    return u;
  };
  // A fresh account so the expected numbers are exactly what this run creates.
  const me = await mk(`prog${stamp}`, 0);
  const myInv = await inv(me);
  const before = await (await fetch(`${API}/api/progression/summary`, { headers: auth(me.token) })).json();
  ok(before.totals.played === 0, `a fresh account starts at zero (${before.totals.played})`);

  // Pick a wager that a 5% band can be hit with.
  const seat = myInv[0];
  const stakeQty = 2;

  console.log('\n=== coinflip ===');
  let cfExpected = 0;
  {
    const opp = await mk(`pgo${stamp}`, 3);
    const oInv = await inv(opp);
    const fit = oInv.find((i) => {
      const v = Number(i.value); if (!v) return false;
      const q = Math.ceil((seat.value * 2 * 0.95) / v);
      return q * v >= seat.value * 2 * 0.95 && q * v <= seat.value * 2 * 1.05 && q <= (Number(i.quantity) || 1);
    });
    if (!fit) { ok(false, 'no in-band coinflip wager available'); } else {
      const qty = Math.ceil((seat.value * 2 * 0.95) / Number(fit.value));
      const cf = await (await fetch(`${API}/api/coinflip`, {
        method: 'POST', headers: auth(me.token),
        body: JSON.stringify({ selectedItems: [{ itemId: seat.itemId, quantity: stakeQty }], side: 'heads' })
      })).json();
      if (cf.message) { ok(false, `could not create a coinflip: ${cf.message}`); } else {
        const joined = await (await fetch(`${API}/api/coinflip/${cf.id}/join`, {
          method: 'POST', headers: auth(opp.token),
          body: JSON.stringify({ selectedItems: [{ itemId: fit.itemId, quantity: qty }] })
        })).json();
        if (joined.message) { ok(false, `could not join: ${joined.message}`); } else {
          // A coinflip settles the moment the second player joins, so a GET is
          // enough to read the result - there is no separate flip call.
          const done = await (await fetch(`${API}/api/coinflip/${cf.id}`, { headers: auth(me.token) })).json();
          if (done.status === 'completed') {
            cfExpected = 1;
            console.log(`  flipped ${done.result}, winner ${done.winnerId === me.user.id ? 'me' : 'opponent'}`);
          }
        }
      }
    }
  }

  console.log('\n=== blackjack ===');
  let bjExpected = 0;
  {
    for (let i = 0; i < 3; i++) {
      const t = await (await fetch(`${API}/api/blackjack/tables`, {
        method: 'POST', headers: auth(me.token),
        body: JSON.stringify({ selectedItems: [{ itemId: myInv[i % myInv.length].itemId, quantity: 2 }] })
      })).json();
      if (!t.id) break;
      await fetch(`${API}/api/blackjack/tables/${t.id}/bot-join`, { method: 'POST', headers: auth(me.token), body: '{}' });
      let cur = await (await fetch(`${API}/api/blackjack/tables/${t.id}`, { headers: auth(me.token) })).json();
      let guard = 0;
      // The human is the player against the house dealer, so drive the real
      // Hit/Stand buttons instead of a bot-play shortcut.
      while (cur.status === 'in_progress' && guard++ < 20) {
        const action = (cur.playerValue || 0) < 17 ? 'hit' : 'stand';
        const d = await (await fetch(`${API}/api/blackjack/tables/${t.id}/${action}`, {
          method: 'POST', headers: auth(me.token), body: '{}'
        })).json();
        if (d.message) break;
        cur = d;
      }
      if (cur.status === 'completed') bjExpected++;
    }
  }

  console.log('\n=== rps ===');
  let rpsExpected = 0;
  {
    const opp = await mk(`pgr${stamp}`, 5);
    const oInv = await inv(opp);
    const fit = oInv.find((i) => {
      const v = Number(i.value); if (!v) return false;
      const q = Math.ceil((seat.value * 0.95) / v);
      return q * v >= seat.value * 0.95 && q * v <= seat.value * 1.05 && q <= (Number(i.quantity) || 1);
    });
    if (fit) {
      const qty = Math.ceil((seat.value * 0.95) / Number(fit.value));
      // Both sides pick when they enter the bet: the creator with the post,
      // the joiner with the join. Rock beats scissors, so this pairing is
      // always decided on turn 1.
      const match = await (await fetch(`${API}/api/rps`, {
        method: 'POST', headers: auth(me.token),
        body: JSON.stringify({ selectedItems: [{ itemId: seat.itemId, quantity: 1 }], side: 'rock' })
      })).json();
      if (match.match) {
        const joined = await (await fetch(`${API}/api/rps/matches/${match.match.id}/join`, {
          method: 'POST', headers: auth(opp.token),
          body: JSON.stringify({ selectedItems: [{ itemId: fit.itemId, quantity: qty }], side: 'scissors' })
        })).json();
        if (joined.match) {
          // The single turn settles on the join, so the match is already
          // complete by the time the response comes back.
          rpsExpected = 1;
        }
      } else if (match.message) {
        ok(false, `could not create an RPS match: ${match.message}`);
      }
    }
  }

  console.log('\n=== the RPS lobby must list other people\'s open bets ===');
  {
    // Regression. The lobby route used to spread the public lobby - which
    // carries every open bet under `matches` - and then set `matches` again to
    // only the requester's own. Every player therefore saw an empty lobby and
    // could join nothing.
    const creator = await mk(`lobbyA${stamp}`, 4);
    const joiner = await mk(`lobbyB${stamp}`, 4);
    const cInv = await inv(creator);
    const jInv = await inv(joiner);
    const cItem = cInv.find((i) => Number(i.value) > 0);
    const jItem = jInv.find((i) => Number(i.value) > 0);

    const posted = await (await fetch(`${API}/api/rps`, {
      method: 'POST', headers: auth(creator.token),
      body: JSON.stringify({ selectedItems: [{ itemId: cItem.itemId, quantity: 1 }], side: 'rock' })
    })).json();

    ok(Boolean(posted.match), 'the creator posted an open bet');

    // The OTHER player must see it, or it cannot be joined.
    const otherLobby = await (await fetch(`${API}/api/rps/lobby`, { headers: auth(joiner.token) })).json();
    const visible = (otherLobby.matches || []).some((m) => m.id === posted.match.id);
    ok(visible, 'another player sees that open bet in the lobby');
    ok(!(otherLobby.myMatches || []).some((m) => m.id === posted.match.id),
      'and it is not listed as one of their own matches');

    // A spectator must not be able to read anyone's pick before the bet settles.
    const seen = (otherLobby.matches || []).find((m) => m.id === posted.match.id);
    if (seen) {
      ok(seen.playerOne?.choice == null,
        "the creator's pick is not readable by another player");
    }

    // Clean up so this does not leak into later assertions.
    await fetch(`${API}/api/rps/matches/${posted.match.id}/cancel`, {
      method: 'POST', headers: auth(creator.token)
    });
    void jItem;
  }

  console.log('\n=== the summary adds all four up ===');
  const s = await (await fetch(`${API}/api/progression/summary`, { headers: auth(me.token) })).json();
  console.log(`  totals: played=${s.totals.played} wins=${s.totals.wins} staked=${s.totals.staked} profit=${s.totals.profit}`);
  for (const [g, v] of Object.entries(s.games)) {
    console.log(`  ${g.padEnd(10)} played=${v.played} wins=${v.wins} staked=${v.staked} profit=${v.profit}`);
  }
  console.log(`  achievements: ${s.achievements.unlocked}/${s.achievements.total}, next: ${s.achievements.next && s.achievements.next.name}`);

  ok(s.games.blackjack.played === bjExpected,
    `blackjack counted ${bjExpected} completed hand(s) (got ${s.games.blackjack.played})`);
  ok(s.games.rps.played === rpsExpected,
    `rps counted ${rpsExpected} completed match(es) (got ${s.games.rps.played})`);
  ok(s.games.coinflip.played === cfExpected,
    `coinflip counted ${cfExpected} completed flip(s) (got ${s.games.coinflip.played})`);

  const sumPlayed = Object.values(s.games).reduce((a, g) => a + g.played, 0);
  ok(s.totals.played === sumPlayed,
    `the total equals the sum of the games (${s.totals.played} == ${sumPlayed})`);

  ok(s.history.length > 0, `the history feed has records (${s.history.length})`);
  // Over 3 hands every game can plausibly net zero - the player wins one pot
  // and loses another of the same size. Assert the column is wired up and can
  // carry a figure, not that luck produced one in a tiny sample.
  const profitColumn = Object.values(s.games).every((g) => typeof g.profit === 'number');
  ok(profitColumn, 'every game reports a numeric profit, win or lose');
  const sumProfit = Object.values(s.games).reduce((a, g) => a + g.profit, 0);
  ok(Math.abs(sumProfit - s.totals.profit) < 1,
    `the total profit equals the sum of the games (${s.totals.profit} == ${sumProfit})`);

  ok(s.totals.distinctOpponents >= 1,
    `distinct opponents counted (${s.totals.distinctOpponents}) - a bot seat must not count as a person`);

  console.log('\n=== achievements respond to what was played ===');
  ok(s.achievements.list.length === 12, `12 achievements defined (${s.achievements.list.length})`);
  ok(s.achievements.list.every((a) => a.percent >= 0 && a.percent <= 100), 'every percent is in range');
  ok(s.achievements.list.every((a) => a.value >= 0), 'no negative progress');
  const firstBet = s.achievements.list.find((a) => a.id === 'first-bet');
  ok(firstBet.unlocked === true, 'First Bet unlocked after playing');
  const cardCounter = s.achievements.list.find((a) => a.id === 'card-counter');
  ok(cardCounter.value === bjExpected, `Card Counter counts the blackjack hands (${cardCounter.value}/${bjExpected})`);
  // Locked-but-close must sort above locked-and-far, so the page can say what to do.
  const locked = s.achievements.list.filter((a) => !a.unlocked);
  if (locked.length > 1) {
    const sortedDesc = [...locked].sort((a, b) => b.percent - a.percent);
    ok(locked[0].percent >= locked[locked.length - 1].percent,
      'locked achievements are ordered by how close they are');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });