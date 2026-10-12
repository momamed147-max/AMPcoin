import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../apiConfig';
import Icon from '../components/Icon';
import './OutcomeControlTab.css';

/**
 * Outcome control.
 *
 * Only rendered for an account the backend names as an operator. Every route
 * under /api/outcome-control independently re-checks that same list, so hiding
 * the tab is convenience rather than protection: being any admin is NOT enough,
 * you must be one of the named accounts.
 *
 * There is no key to type. It used to be a third gate, but anyone who already
 * holds this session can read it off the same screen, so it bought nothing
 * against the threat that mattered - and it made the panel unusable, because
 * the operator had to go and find FORCE_OUTCOME_KEY in a server .env first.
 * In its place the panel loads the operator's own open bets directly.
 *
 * What is NOT optional is the audit log at the bottom. Every forced outcome is
 * written by the server, recording the result the fair roll would have
 * produced alongside the one that was forced. Nothing here can erase it.
 */

const GAMES = [
  { id: 'coinflip', label: 'Coinflip', icon: 'coin', blurb: 'Bias every coinflip you create.' },
  { id: 'rps', label: 'RPS', icon: 'rpsScissors', blurb: 'Rewrite your pick to beat the opponent.' },
  { id: 'jackpot', label: 'Jackpot', icon: 'jackpot', blurb: 'Take any pot you have an entry in.' }
];

const MODE_LABEL = { win: 'Win', lose: 'Lose', off: 'Fair' };

const GAME_LABEL = { coinflip: 'Coinflip', rps: 'RPS', jackpot: 'Jackpot' };

function compact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')}K`;
  return n.toLocaleString();
}

function timeAgo(value) {
  if (!value) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function OutcomeControlTab({ user }) {
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
      post('/api/outcome-control/log', { limit: 60 })
    ]);
    if (liveRes.status === 200) setLive(liveRes.body.games || []);
    else setLive([]);
    if (logRes.status === 200) setEntries(logRes.body.entries || []);
    setLoading(false);
  }, [post]);

  // Load on mount, then poll. A bet can appear or be settled by someone else
  // at any moment, so the list is refreshed rather than fetched once.
  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 5000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const setGame = useCallback(async (game, mode) => {
    setBusy(game);
    const res = await post('/api/outcome-control/arm', { game, mode });
    if (res.status === 200) {
      setArmed((prev) => {
        const next = { ...prev };
        if (mode === 'off') delete next[game];
        else next[game] = mode;
        return next;
      });
      setStatus({ tone: 'ok', text: `${GAME_LABEL[game]} ${mode === 'off' ? 'disarmed' : `armed to ${mode}`}.` });
      loadAll();
    } else {
      setStatus({ tone: 'error', text: 'Refused.' });
    }
    setBusy(null);
  }, [post, loadAll]);

  const setBet = useCallback(async (bet, mode) => {
    const id = `${bet.game}:${bet.betId}`;
    setBusy(id);
    const res = await post('/api/outcome-control/arm-bet', {
      game: bet.game, betId: bet.betId, mode
    });
    if (res.status === 200) {
      setLive((current) => current.map((g) => (
        g.betId === bet.betId ? { ...g, mode: mode === 'off' ? (armed[bet.game] || null) : mode } : g
      )));
      setStatus({ tone: 'ok', text: `${GAME_LABEL[bet.game]} bet ${mode === 'off' ? 'released' : `forced to ${mode}`}.` });
      loadAll();
    } else {
      setStatus({ tone: 'error', text: 'Refused.' });
    }
    setBusy(null);
  }, [post, armed, loadAll]);

  const counts = GAMES.reduce((acc, g) => {
    acc[g.id] = live.filter((b) => b.game === g.id).length;
    return acc;
  }, {});

  return (
    <div className="outcome-control">
      <div className="oc-head">
        <div>
          <h3>Outcome control</h3>
          <p>
            Biases your own bets. A player you have not joined is never affected:
            coinflip only applies to bets you created, RPS only rewrites your own
            pick, and jackpot only applies when you have an entry in the pot.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary oc-refresh"
          onClick={loadAll}
          disabled={loading}
        >
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      {status && (
        <div className={`oc-status ${status.tone}`} role="status">{status.text}</div>
      )}

      {/* ── Live bets ─────────────────────────────────────────────────── */}
      <div className="oc-live-head">
        <h4>Your open bets</h4>
        <span>{live.length} open</span>
      </div>

      {loading ? (
        <p className="oc-live-empty">Loading your bets...</p>
      ) : live.length === 0 ? (
        <p className="oc-live-empty">
          No open bets. Start a coinflip, an RPS match or a jackpot and it will show up here.
        </p>
      ) : (
        <div className="oc-live">
          {live.map((bet) => {
            const id = `${bet.game}:${bet.betId}`;
            const mode = bet.mode || 'off';
            return (
              <div key={id} className={`oc-live-row is-${mode}`}>
                <div className="oc-live-main">
                  <div className="oc-live-title">
                    <span className="oc-live-game">{GAME_LABEL[bet.game]}</span>
                    <span className={`oc-pill ${mode}`}>{MODE_LABEL[mode]}</span>
                    <span className="oc-live-pot">{compact(bet.potValue)} AMP</span>
                  </div>

                  {bet.game === 'rps' && (
                    <div className="oc-live-detail">
                      {bet.opponentChoice ? (
                        <>
                          <span>
                            {bet.against || 'They'} chose <strong>{bet.opponentChoice}</strong>
                          </span>
                          {bet.forcedChoice && (
                            <span className="oc-live-forced">
                              {' '}→ yours becomes <strong>{bet.forcedChoice}</strong>
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="oc-live-muted">
                          {bet.against
                            ? `Waiting for ${bet.against} to lock in`
                            : 'Waiting for a challenger to join'}
                        </span>
                      )}
                    </div>
                  )}

                  {bet.game === 'coinflip' && (
                    <div className="oc-live-detail">
                      Your side <strong>{bet.yourSide}</strong>
                      {bet.against ? ` vs ${bet.against}` : ' — no challenger yet'}
                    </div>
                  )}

                  {bet.game === 'jackpot' && (
                    <div className="oc-live-detail">
                      Your entry <strong>{compact(bet.yourEntry)}</strong>
                      {bet.against?.length ? ` vs ${bet.against.join(', ')}` : ''}
                    </div>
                  )}

                  <div className="oc-live-meta">
                    {bet.itemCount ? `${bet.itemCount} items` : ''}
                    {bet.openedAt ? ` · ${timeAgo(bet.openedAt)}` : ''}
                  </div>
                </div>

                <div className="oc-live-actions">
                  <button
                    type="button"
                    className={`btn btn-sm ${mode === 'win' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setBet(bet, 'win')}
                    disabled={busy === id}
                  >
                    Win
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${mode === 'lose' ? 'btn-danger' : 'btn-secondary'}`}
                    onClick={() => setBet(bet, 'lose')}
                    disabled={busy === id}
                  >
                    Lose
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setBet(bet, 'off')}
                    disabled={busy === id || mode === 'off'}
                  >
                    Fair
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Game-wide defaults ────────────────────────────────────────── */}
      <div className="oc-defaults-head">
        <h4>Apply to every bet</h4>
        <span>fallback when a bet has no override</span>
      </div>
      <div className="oc-grid">
        {GAMES.map((g) => {
          const mode = armed[g.id] || 'off';
          return (
            <div key={g.id} className={`oc-card ${mode !== 'off' ? 'is-armed' : ''}`}>
              <div className="oc-card-head">
                <span className="oc-card-name">
                  <Icon name={g.icon} size={13} /> {g.label}
                  {counts[g.id] > 0 && <span className="oc-card-count">{counts[g.id]}</span>}
                </span>
                <span className={`oc-pill ${mode}`}>{MODE_LABEL[mode]}</span>
              </div>
              <p className="oc-card-blurb">{g.blurb}</p>
              <div className="oc-card-actions">
                <button
                  type="button"
                  className={`btn btn-sm ${mode === 'win' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setGame(g.id, 'win')}
                  disabled={busy === g.id}
                >
                  Force win
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${mode === 'lose' ? 'btn-danger' : 'btn-secondary'}`}
                  onClick={() => setGame(g.id, 'lose')}
                  disabled={busy === g.id}
                >
                  Force loss
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setGame(g.id, 'off')}
                  disabled={busy === g.id || mode === 'off'}
                >
                  Disarm
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="oc-log-head">
        <h4>Audit log</h4>
        <span>{entries.length} recent</span>
      </div>
      {entries.length === 0 ? (
        <p className="oc-log-empty">
          Nothing recorded yet. Every forced outcome is written here with the
          result the fair roll would have produced alongside the forced one.
        </p>
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
        <span>
          This log is written by the server and cannot be cleared from here.
          Deleting it means editing the database by hand.
        </span>
      </div>
    </div>
  );
}