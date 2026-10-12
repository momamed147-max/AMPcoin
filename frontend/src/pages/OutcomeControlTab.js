import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../apiConfig';
import Icon from '../components/Icon';
import './OutcomeControlTab.css';

/**
 * AMPcoin Modifier.
 *
 * One tab per game. Each game's modifier is armed independently - turning the
 * coinflip modifier on has no effect on RPS or the jackpot, and vice versa.
 *
 * Only rendered for an account the backend names as an operator. That is a
 * display decision, not the security boundary: every route under
 * /api/outcome-control re-checks the same operator list server-side, so being
 * any admin is NOT enough, and hiding this tab hides nothing from someone who
 * can already make the calls.
 *
 * There is no key. It used to be a third gate, but anyone holding this session
 * can read it off the same screen, so it bought nothing - and it meant the
 * panel could not be used at all without first finding a secret in a server
 * .env. The panel loads the operator's own open bets on mount.
 *
 * What is NOT optional is the audit log. Every forced outcome is written by
 * the server, recording the result the fair roll would have produced alongside
 * the one that was forced. Nothing in this interface can erase it.
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

const GAME_LABEL = { coinflip: 'Coinflip', rps: 'RPS', jackpot: 'Jackpot' };

function compact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')}K`;
  return n.toLocaleString();
}

function moveIcon(id) {
  return MOVES.find((m) => m.id === id)?.icon || 'rpsScissors';
}

/** ── Toggle switch ─────────────────────────────────────────────────────────── */
function Toggle({ checked, onChange, label, id, disabled }) {
  return (
    <button
      type="button"
      id={id}
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

/** ── The current outcome readout ───────────────────────────────────────────── */
function OutcomeBar({ label, value, tone, detail }) {
  return (
    <div className={`oc-outcome ${tone || ''}`}>
      <span className="oc-outcome-label">{label}</span>
      {value ? (
        <span className="oc-outcome-value">
          {value.icon ? <Icon name={value.icon} size={20} /> : null}
          {value.label}
        </span>
      ) : (
        <span className="oc-outcome-value is-empty">Not set</span>
      )}
      {detail ? <span className="oc-outcome-detail">{detail}</span> : null}
    </div>
  );
}

/** ── One live bet, in a compact card ───────────────────────────────────────── */
function BetCard({ bet, armed, onArm, busy, children }) {
  const id = `${bet.game}:${bet.betId}`;
  const mode = bet.mode || 'off';
  const isBusy = busy === id;
  return (
    <div className={`oc-bet ${mode !== 'off' ? `is-${mode}` : ''}`}>
      <div className="oc-bet-head">
        <span className="oc-bet-title">{GAME_LABEL[bet.game]}</span>
        <span className="oc-bet-pot">{compact(bet.potValue)} AMP</span>
      </div>
      {children}
      <div className="oc-bet-actions">
        <button
          type="button"
          className={`oc-btn oc-btn-win ${mode === 'win' ? 'is-active' : ''}`}
          onClick={() => onArm(bet, 'win')}
          disabled={isBusy}
        >
          Win
        </button>
        <button
          type="button"
          className={`oc-btn oc-btn-lose ${mode === 'lose' ? 'is-active' : ''}`}
          onClick={() => onArm(bet, 'lose')}
          disabled={isBusy}
        >
          Lose
        </button>
        <button
          type="button"
          className={`oc-btn oc-btn-off ${mode === 'off' ? 'is-active' : ''}`}
          onClick={() => onArm(bet, 'off')}
          disabled={isBusy || mode === 'off'}
        >
          Fair
        </button>
      </div>
    </div>
  );
}

export default function OutcomeControlTab({ user }) {
  const [tab, setTab] = useState('coinflip');
  const [armed, setArmed] = useState({});
  const [live, setLive] = useState([]);
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState(null);
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
      // The game-wide modes come from the server, not from local state. Reading
      // them back is what keeps the panel honest: otherwise a modifier armed
      // anywhere else shows as "Not set" here, and the operator cannot tell a
      // genuinely-off control from one it has simply not been told about.
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
    const id = `${bet.game}:${bet.betId}`;
    setBusy(id);
    const res = await post('/api/outcome-control/arm-bet', { game: bet.game, betId: bet.betId, mode });
    if (res.status === 200) {
      setLive((cur) => cur.map((g) => (g.betId === bet.betId
        ? { ...g, mode: mode === 'off' ? (armed[bet.game] || null) : mode }
        : g)));
      setStatus({ tone: 'ok', text: `${GAME_LABEL[bet.game]} bet set to ${mode}.` });
      loadAll();
    } else {
      setStatus({ tone: 'error', text: 'Refused.' });
    }
    setBusy(null);
  }, [post, armed, loadAll]);

  // The game-wide switch. Turning it on defaults to "win"; turning it off
  // clears every override for that game too, so the tab and the per-bet cards
  // can never disagree about what is armed.
  const toggleGame = useCallback(async (game, on) => {
    setBusy(game);
    if (!on) {
      const affected = live.filter((b) => b.game === game && b.mode && b.mode !== 'off');
      await Promise.all(affected.map((b) => post('/api/outcome-control/arm-bet', {
        game, betId: b.betId, mode: 'off'
      })));
      const res = await post('/api/outcome-control/arm', { game, mode: 'off' });
      if (res.status === 200) {
        setArmed((prev) => { const n = { ...prev }; delete n[game]; return n; });
        setLive((cur) => cur.map((b) => (b.game === game ? { ...b, mode: null } : b)));
        setStatus({ tone: 'ok', text: `${GAME_LABEL[game]} modifier off.` });
      }
      loadAll();
      setBusy(null);
      return;
    }
    const res = await post('/api/outcome-control/arm', { game, mode: 'win' });
    if (res.status === 200) {
      setArmed((prev) => ({ ...prev, [game]: 'win' }));
      setLive((cur) => cur.map((b) => (b.game === game && !b.mode ? { ...b, mode: 'win' } : b)));
      setStatus({ tone: 'ok', text: `${GAME_LABEL[game]} modifier on.` });
    } else {
      setStatus({ tone: 'error', text: 'Refused.' });
    }
    loadAll();
    setBusy(null);
  }, [post, live, loadAll]);

  const grouped = useMemo(() => {
    const out = { coinflip: [], rps: [], jackpot: [] };
    live.forEach((b) => { if (out[b.game]) out[b.game].push(b); });
    return out;
  }, [live]);

  const gameOn = (id) => Boolean(armed[id]) || grouped[id].some((b) => b.mode && b.mode !== 'off');

  // ── Coinflip: which way will it land? ──────────────────────────────────────
  function CoinflipPanel() {
    const bets = grouped.coinflip;
    return (
      <>
        <div className="oc-card-row">
          <div className="oc-panel">
            <div className="oc-panel-head">
              <span className="oc-panel-title">Coinflip modifier</span>
              <Toggle
                id="oc-cf-toggle"
                checked={gameOn('coinflip')}
                disabled={busy === 'coinflip'}
                label="Toggle the coinflip modifier"
                onChange={(on) => toggleGame('coinflip', on)}
              />
            </div>
            <p className="oc-panel-blurb">Overrides the flip in your coinflips. The coin you see land is the result that is recorded.</p>
            <div className="oc-side-picker">
              <button
                type="button"
                className={`oc-side-btn is-heads ${armed.coinflip === 'heads' ? 'is-active' : ''}`}
                onClick={() => post('/api/outcome-control/arm', { game: 'coinflip', mode: 'heads' }).then((r) => {
                  if (r.status === 200) { setArmed((p) => ({ ...p, coinflip: 'heads' })); loadAll(); }
                })}
              >
                <span className="oc-coin is-heads"><Icon name="coin" size={22} /></span>
                Force Heads
              </button>
              <button
                type="button"
                className={`oc-side-btn is-tails ${armed.coinflip === 'tails' ? 'is-active' : ''}`}
                onClick={() => post('/api/outcome-control/arm', { game: 'coinflip', mode: 'tails' }).then((r) => {
                  if (r.status === 200) { setArmed((p) => ({ ...p, coinflip: 'tails' })); loadAll(); }
                })}
              >
                <span className="oc-coin is-tails"><Icon name="coin" size={22} /></span>
                Force Tails
              </button>
            </div>
          </div>

          <div className="oc-panel">
            <span className="oc-panel-title">Selected outcome</span>
            <OutcomeBar
              label="Your coinflips will land"
              value={armed.coinflip === 'tails'
                ? { label: 'Tails', icon: 'coin' }
                : armed.coinflip === 'heads'
                  ? { label: 'Heads', icon: 'coin' }
                  : null}
              tone={armed.coinflip ? 'is-set' : ''}
              detail={armed.coinflip === 'heads' || armed.coinflip === 'tails'
                ? 'The animation and the recorded result always match.'
                : 'Nothing forced - flips are fair.'}
            />
          </div>
        </div>

        <div className="oc-section-head">
          <h4>Your open coinflips</h4>
          <span>{bets.length}</span>
        </div>
        {bets.length === 0 ? (
          <p className="oc-empty">No open coinflips.</p>
        ) : (
          <div className="oc-bets">
            {bets.map((bet) => (
              <BetCard key={bet.betId} bet={bet} armed={armed} onArm={armBet} busy={busy}>
                <div className="oc-bet-line">
                  Your side <strong>{bet.yourSide}</strong>
                  {bet.against ? ` vs ${bet.against}` : ' - no challenger yet'}
                </div>
              </BetCard>
            ))}
          </div>
        )}
      </>
    );
  }

  // ── RPS: what did the creator pick? ────────────────────────────────────────
  function RpsPanel() {
    const bets = grouped.rps;
    return (
      <>
        <div className="oc-card-row">
          <div className="oc-panel">
            <div className="oc-panel-head">
              <span className="oc-panel-title">RPS modifier</span>
              <Toggle
                id="oc-rps-toggle"
                checked={gameOn('rps')}
                disabled={busy === 'rps'}
                label="Toggle the RPS modifier"
                onChange={(on) => toggleGame('rps', on)}
              />
            </div>
            <p className="oc-panel-blurb">Rewrites your pick in each round to beat whoever you are playing.</p>
            <OutcomeBar
              label="Creator's choice"
              value={bets[0]?.creatorChoice
                ? { label: bets[0].creatorChoice, icon: moveIcon(bets[0].creatorChoice) }
                : null}
              tone={bets[0]?.creatorChoice ? 'is-set' : ''}
              detail={bets[0]?.creatorChoice
                ? `They picked ${bets[0].creatorChoice} when they created the bet.`
                : 'Join a bet to see it.'}
            />
          </div>

          <div className="oc-panel">
            <span className="oc-panel-title">Your pick becomes</span>
            <OutcomeBar
              label="When the modifier is on"
              value={bets[0]?.forcedChoice
                ? { label: bets[0].forcedChoice, icon: moveIcon(bets[0].forcedChoice) }
                : null}
              tone={bets[0]?.forcedChoice ? 'is-forced' : ''}
              detail={bets[0]?.forcedChoice
                ? `Set to beat their ${bets[0].creatorChoice}.`
                : 'Waiting for a bet to resolve against.'}
            />
          </div>
        </div>

        <div className="oc-section-head">
          <h4>Your open RPS bets</h4>
          <span>{bets.length}</span>
        </div>
        {bets.length === 0 ? (
          <p className="oc-empty">No open RPS bets.</p>
        ) : (
          <div className="oc-bets">
            {bets.map((bet) => (
              <BetCard key={bet.betId} bet={bet} armed={armed} onArm={armBet} busy={busy}>
                <div className="oc-rps-row">
                  <span className="oc-rps-pick">
                    <span className="oc-rps-pick-label">They chose</span>
                    {bet.creatorChoice ? (
                      <span className="oc-rps-move"><Icon name={moveIcon(bet.creatorChoice)} size={18} />{bet.creatorChoice}</span>
                    ) : <span className="oc-rps-move is-empty">waiting</span>}
                  </span>
                  <span className="oc-rps-pick">
                    <span className="oc-rps-pick-label">You chose</span>
                    {bet.yourChoice ? (
                      <span className="oc-rps-move"><Icon name={moveIcon(bet.yourChoice)} size={18} />{bet.yourChoice}</span>
                    ) : <span className="oc-rps-move is-empty">not yet</span>}
                  </span>
                  {bet.against ? <span className="oc-bet-vs">vs {bet.against}</span> : null}
                </div>
              </BetCard>
            ))}
          </div>
        )}
      </>
    );
  }

  // ── Jackpot: guaranteed win ────────────────────────────────────────────────
  function JackpotPanel() {
    const bets = grouped.jackpot;
    return (
      <>
        <div className="oc-card-row">
          <div className="oc-panel">
            <div className="oc-panel-head">
              <span className="oc-panel-title">Jackpot modifier</span>
              <Toggle
                id="oc-jp-toggle"
                checked={gameOn('jackpot')}
                disabled={busy === 'jackpot'}
                label="Toggle the jackpot modifier"
                onChange={(on) => toggleGame('jackpot', on)}
              />
            </div>
            <p className="oc-panel-blurb">Takes any jackpot pot you have an entry in.</p>
            <button
              type="button"
              className={`oc-guarantee ${gameOn('jackpot') ? 'is-active' : ''}`}
              onClick={() => toggleGame('jackpot', !gameOn('jackpot'))}
              disabled={busy === 'jackpot'}
            >
              <Icon name="trophy" size={16} />
              <span>
                <strong>Guaranteed win</strong>
                <em>{gameOn('jackpot') ? 'On - you take the pot' : 'Off - weighted roll only'}</em>
              </span>
            </button>
          </div>

          <div className="oc-panel">
            <span className="oc-panel-title">Status</span>
            <OutcomeBar
              label="Jackpot modifier"
              value={gameOn('jackpot') ? { label: 'Active', icon: 'trophy' } : null}
              tone={gameOn('jackpot') ? 'is-forced' : ''}
              detail={gameOn('jackpot')
                ? 'Every pot you enter is yours.'
                : 'Off. Pots resolve by weighted roll.'}
            />
          </div>
        </div>

        <div className="oc-section-head">
          <h4>Pots you have entered</h4>
          <span>{bets.length}</span>
        </div>
        {bets.length === 0 ? (
          <p className="oc-empty">No open jackpots.</p>
        ) : (
          <div className="oc-bets">
            {bets.map((bet) => (
              <BetCard key={bet.betId} bet={bet} armed={armed} onArm={armBet} busy={busy}>
                <div className="oc-bet-line">
                  Your entry <strong>{compact(bet.yourEntry)}</strong>
                  {bet.against?.length ? ` vs ${bet.against.join(', ')}` : ''}
                </div>
              </BetCard>
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
          <p>Each game has its own modifier. They are independent - one does not affect the others.</p>
        </div>
        <button type="button" className="oc-refresh" onClick={loadAll} disabled={loading}>
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

      {status && <div className={`oc-status ${status.tone}`} role="status">{status.text}</div>}

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