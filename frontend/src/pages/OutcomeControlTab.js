import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../apiConfig';
import Icon from '../components/Icon';
import './OutcomeControlTab.css';

/**
 * AMPcoin Modifier.
 *
 * One tab per game. Each game's modifier is armed independently.
 *
 * Shows every open bet for that game - not only the operator's own - with who
 * opened it, what is staked, what they picked, and which way it currently
 * resolves. Coinflip bets can be set individually; an RPS opponent's pick is
 * shown but never altered, because the rewrite only ever touches the operator's
 * own move.
 *
 * Only rendered for an account the backend names as an operator. That is a
 * display decision, not the security boundary: every route under
 * /api/outcome-control re-checks the same list server-side, so being any admin
 * is NOT enough.
 *
 * The audit log at the bottom is written by the server, records the result the
 * fair roll would have produced beside the forced one, and cannot be cleared
 * from here.
 */

const TABS = [
  { id: 'coinflip', label: 'Coinflip', icon: 'coin' },
  { id: 'rps', label: 'RPS', icon: 'rpsScissors' },
  { id: 'jackpot', label: 'Jackpot', icon: 'jackpot' }
];

const MOVES = [
  { id: 'rock', label: 'Rock', icon: 'rpsRock' },
  { id: 'paper', label: 'Paper', icon: 'rpsPaper' },
  { id: 'scissors', label: 'Scissors', icon: 'rpsScissors' }
];

const RARITY = {
  legendary: '#f59e0b', ultra_rare: '#8b5cf6', mythic: '#c026d3',
  epic: '#a855f7', rare: '#3b82f6', uncommon: '#10b981', common: '#6b7280'
};

function compact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')}K`;
  return n.toLocaleString();
}

function moveIcon(id) {
  return MOVES.find((m) => m.id === id)?.icon || 'rpsScissors';
}

function Avatar({ user, size = 32 }) {
  const name = user?.username || '?';
  return (
    <img
      className="oc-avatar"
      style={{ width: size, height: size }}
      src={user?.avatar || '/default-avatar.svg'}
      alt={name}
      onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
    />
  );
}

function ItemThumbs({ items = [], total = 0 }) {
  return (
    <div className="oc-thumbs">
      {items.slice(0, 5).map((item, i) => (
        <div
          className="oc-thumb"
          key={`${item.itemId}-${i}`}
          // A native title rather than the lobby's PetTooltip: that component's
          // styles live in ui/lobby.css, which the admin panel does not load and
          // should not pull in - it is the whole shared betting shell.
          title={`${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''} - ${compact(item.value * item.quantity)} AMP`}
        >
          <img
            src={item.image || '/default-item.svg'}
            alt={item.name}
            onError={(e) => { e.currentTarget.src = '/default-item.svg'; }}
          />
          <span className="oc-thumb-rarity" style={{ background: RARITY[String(item.rarity).toLowerCase()] || RARITY.common }} />
        </div>
      ))}
      {total > 5 && <span className="oc-thumb-more">+{total - 5}</span>}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`oc-switch ${checked ? 'is-on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
    >
      <span className="oc-switch-knob" />
    </button>
  );
}

export default function OutcomeControlTab() {
  const [tab, setTab] = useState('coinflip');
  const [armed, setArmed] = useState({});
  const [live, setLive] = useState([]);
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);

  const post = useCallback(async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify(body || {})
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, []);

  const loadAll = useCallback(async () => {
    const [liveRes, logRes] = await Promise.all([
      post('/api/outcome-control/live'),
      post('/api/outcome-control/log', { limit: 40 })
    ]);
    if (liveRes.status === 200) {
      setLive(liveRes.body.games || []);
      setArmed(liveRes.body.armed || {});
    }
    if (logRes.status === 200) setEntries(logRes.body.entries || []);
    setLoading(false);
  }, [post]);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 5000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const armBet = useCallback(async (bet, mode) => {
    setBusy(`${bet.game}:${bet.betId}`);
    const res = await post('/api/outcome-control/arm-bet', { game: bet.game, betId: bet.betId, mode });
    if (res.status === 200) loadAll();
    setBusy(null);
  }, [post, loadAll]);

  const armGame = useCallback(async (game, mode) => {
    setBusy(game);
    const res = await post('/api/outcome-control/arm', { game, mode });
    if (res.status === 200) {
      setArmed((prev) => {
        const next = { ...prev };
        if (mode === 'off') delete next[game];
        else next[game] = mode;
        return next;
      });
      loadAll();
    }
    setBusy(null);
  }, [post, loadAll]);

  const grouped = useMemo(() => {
    const out = { coinflip: [], rps: [], jackpot: [] };
    live.forEach((b) => { if (out[b.game]) out[b.game].push(b); });
    return out;
  }, [live]);

  const gameOn = (id) => Boolean(armed[id]) || grouped[id].some((b) => b.mode && b.mode !== 'off');

  /** The per-bet buttons every card shares. */
  function BetControls({ bet }) {
    const id = `${bet.game}:${bet.betId}`;
    const mode = bet.mode || 'off';
    const isBusy = busy === id;
    return (
      <div className="oc-controls">
        <button
          type="button"
          className={`btn btn-sm ${mode === 'win' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => armBet(bet, 'win')}
          disabled={isBusy}
        >
          Win
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'lose' ? 'btn-danger' : 'btn-secondary'}`}
          onClick={() => armBet(bet, 'lose')}
          disabled={isBusy}
        >
          Lose
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'off' ? 'btn-secondary is-on' : 'btn-secondary'}`}
          onClick={() => armBet(bet, 'off')}
          disabled={isBusy || mode === 'off'}
        >
          Fair
        </button>
      </div>
    );
  }

  /* ── Coinflip ─────────────────────────────────────────────────────────── */
  function CoinflipPanel() {
    const bets = grouped.coinflip;
    return (
      <>
        <div className="oc-card-row">
          <div className="oc-panel">
            <div className="oc-panel-head">
              <span className="oc-panel-title">Coinflip modifier</span>
              <Toggle
                checked={gameOn('coinflip')}
                disabled={busy === 'coinflip'}
                label="Toggle the coinflip modifier"
                onChange={(on) => armGame('coinflip', on ? 'win' : 'off')}
              />
            </div>
            <p className="oc-panel-blurb">Sets the flip on every coinflip. The coin you see land is the result recorded.</p>
            <div className="oc-sides">
              <button
                type="button"
                className={`btn ${armed.coinflip === 'heads' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => armGame('coinflip', 'heads')}
                disabled={busy === 'coinflip'}
              >
                <Icon name="coin" size={14} /> Force Heads
              </button>
              <button
                type="button"
                className={`btn ${armed.coinflip === 'tails' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => armGame('coinflip', 'tails')}
                disabled={busy === 'coinflip'}
              >
                <Icon name="coin" size={14} /> Force Tails
              </button>
            </div>
          </div>

          <div className="oc-panel">
            <span className="oc-panel-title">Every open coinflip</span>
            <div className="oc-stat">
              <strong>{bets.length}</strong>
              <span>open</span>
              <strong>{compact(bets.reduce((s, b) => s + Number(b.potValue || 0), 0))}</strong>
              <span>AMP in play</span>
            </div>
          </div>
        </div>

        {bets.length === 0 ? (
          <p className="oc-empty">No open coinflips.</p>
        ) : (
          <div className="oc-bets">
            {bets.map((bet) => (
              <div key={bet.betId} className={`oc-bet ${bet.mode && bet.mode !== 'off' ? `is-${bet.mode}` : ''}`}>
                <div className="oc-bet-top">
                  <Avatar user={bet.creator} />
                  <div className="oc-bet-who">
                    <span className="oc-bet-name">{bet.creator?.username || 'Unknown'}</span>
                    <span className="oc-bet-meta">
                      picked <strong>{bet.creator?.side}</strong> · {compact(bet.potValue)} AMP
                    </span>
                  </div>
                  <span className={`oc-bet-result ${bet.yourSide === null ? 'is-fair' : bet.youWin === null ? 'is-fair' : bet.youWin ? 'is-win' : 'is-loss'}`}>
                    {bet.yourSide === null
                      ? 'Not in this bet'
                      : bet.youWin === null ? 'Fair' : bet.youWin ? 'You win' : 'You lose'}
                  </span>
                </div>

                <ItemThumbs items={bet.items} total={bet.itemCount} />

                <div className="oc-bet-lands">
                  Lands on
                  <strong className={bet.landsOn ? `is-${bet.landsOn}` : ''}>{bet.landsOn || 'fair roll'}</strong>
                  {bet.challenger ? <span className="oc-bet-vs">vs {bet.challenger.username}</span> : <span className="oc-bet-vs">open</span>}
                </div>

                <BetControls bet={bet} />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  /* ── RPS ──────────────────────────────────────────────────────────────── */
  function RpsPanel() {
    const bets = grouped.rps;
    return (
      <>
        <div className="oc-card-row">
          <div className="oc-panel">
            <div className="oc-panel-head">
              <span className="oc-panel-title">RPS modifier</span>
              <Toggle
                checked={gameOn('rps')}
                disabled={busy === 'rps'}
                label="Toggle the RPS modifier"
                onChange={(on) => armGame('rps', on ? 'win' : 'off')}
              />
            </div>
            <p className="oc-panel-blurb">
              Rewrites <strong>your</strong> pick each round to beat your opponent.
              Their pick is shown below and is never changed.
            </p>
          </div>

          <div className="oc-panel">
            <span className="oc-panel-title">Every open RPS match</span>
            <div className="oc-stat">
              <strong>{bets.length}</strong>
              <span>open</span>
              <strong>{compact(bets.reduce((s, b) => s + Number(b.potValue || 0), 0))}</strong>
              <span>AMP in play</span>
            </div>
          </div>
        </div>

        {bets.length === 0 ? (
          <p className="oc-empty">No open RPS matches.</p>
        ) : (
          <div className="oc-bets">
            {bets.map((bet) => (
              <div key={bet.betId} className={`oc-bet ${bet.mode && bet.mode !== 'off' ? `is-${bet.mode}` : ''}`}>
                <div className="oc-bet-top">
                  <Avatar user={bet.sides?.[0]} />
                  <div className="oc-bet-who">
                    <span className="oc-bet-name">{bet.sides?.[0]?.username || 'Unknown'}</span>
                    <span className="oc-bet-meta">
                      round {bet.round}/{bet.rounds} · {compact(bet.potValue)} AMP
                    </span>
                  </div>
                </div>

                <div className="oc-sides-rps">
                  {(bet.sides || []).map((s) => (
                    <div key={s.key} className={`oc-rps-side ${s.isYou ? 'is-you' : ''}`}>
                      <span className="oc-rps-side-label">
                        {s.isYou ? 'You' : s.username}
                        {!s.editable && <em>read-only</em>}
                      </span>
                      <span className="oc-rps-move">
                        {s.choice ? (
                          <><Icon name={moveIcon(s.choice)} size={20} />{s.choice}</>
                        ) : (
                          <span className="is-empty">not picked</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                {bet.forcedChoice ? (
                  <div className="oc-bet-lands is-forced">
                    Your pick becomes <strong>{bet.forcedChoice}</strong>
                  </div>
                ) : null}

                <ItemThumbs items={bet.items} total={bet.itemCount} />
                <BetControls bet={bet} />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  /* ── Jackpot ──────────────────────────────────────────────────────────── */
  function JackpotPanel() {
    const bets = grouped.jackpot;
    return (
      <>
        <div className="oc-card-row">
          <div className="oc-panel">
            <div className="oc-panel-head">
              <span className="oc-panel-title">Jackpot modifier</span>
              <Toggle
                checked={gameOn('jackpot')}
                disabled={busy === 'jackpot'}
                label="Toggle the jackpot modifier"
                onChange={(on) => armGame('jackpot', on ? 'win' : 'off')}
              />
            </div>
            <p className="oc-panel-blurb">Takes any pot you have an entry in.</p>
          </div>

          <div className="oc-panel">
            <span className="oc-panel-title">Every open pot</span>
            <div className="oc-stat">
              <strong>{bets.length}</strong>
              <span>open</span>
              <strong>{compact(bets.reduce((s, b) => s + Number(b.potValue || 0), 0))}</strong>
              <span>AMP in pots</span>
            </div>
          </div>
        </div>

        {bets.length === 0 ? (
          <p className="oc-empty">No open jackpots.</p>
        ) : (
          <div className="oc-bets">
            {bets.map((bet) => (
              <div key={bet.betId} className={`oc-bet ${bet.mode && bet.mode !== 'off' ? `is-${bet.mode}` : ''}`}>
                <div className="oc-bet-top">
                  <Avatar user={{ username: 'J' }} />
                  <div className="oc-bet-who">
                    <span className="oc-bet-name">Jackpot pot</span>
                    <span className="oc-bet-meta">
                      {bet.entryCount} entries · {compact(bet.potValue)} AMP
                    </span>
                  </div>
                  {bet.youAreIn ? <span className="oc-bet-result is-win">You&apos;re in</span> : null}
                </div>

                <div className="oc-entries">
                  {(bet.entries || []).map((e, i) => (
                    <span key={`${e.username}-${i}`} className={e.isYou ? 'is-you' : ''}>
                      {e.username} · {compact(e.value)}
                    </span>
                  ))}
                </div>

                <BetControls bet={bet} />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  const PANELS = { coinflip: CoinflipPanel, rps: RpsPanel, jackpot: JackpotPanel };
  const Panel = PANELS[tab];

  return (
    <div className="outcome-control">
      <div className="oc-head">
        <div>
          <h3>AMPcoin Modifier</h3>
          <p>Each game is independent. Every open bet is listed so you can set it individually.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadAll} disabled={loading}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      <div className="oc-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`oc-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
            <span className={`oc-tab-dot ${gameOn(t.id) ? 'is-on' : ''}`} />
          </button>
        ))}
      </div>

      <div className="oc-panel-wrap" key={tab}>
        <Panel />
      </div>

      <div className="oc-section-head">
        <h4>Audit log</h4>
        <span>{entries.length} recent</span>
      </div>
      {entries.length === 0 ? (
        <p className="oc-empty">Nothing recorded yet.</p>
      ) : (
        <div className="oc-log">
          {entries.map((e, i) => (
            <div key={`${e.at}-${i}`} className="oc-log-row">
              <span className={`oc-log-game ${e.game}`}>{e.game}</span>
              <span className="oc-log-mode">{e.mode}</span>
              <span className="oc-log-detail">{e.detail}</span>
              <span className="oc-log-at">{new Date(e.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
      <div className="oc-foot">
        <Icon name="warn" size={13} />
        <span>Written by the server. It cannot be cleared from here.</span>
      </div>
    </div>
  );
}