import React, { useEffect, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';
import Icon from './Icon';
import { useToast } from './Toasts';
import { playBetPlaced, playError } from '../sound';
import { useApi } from '../ui/useApi';
import { API_BASE } from '../apiConfig';
import { Button } from '../ui/primitives';
import './DailyBonus.css';

/**
 * Daily bonus with a login streak.
 *
 * The claim button is the point, so the dialog is built around it: one big
 * button that either pays out or explains when you can next. The countdown is
 * computed locally and only the claim itself talks to the server, so the timer
 * cannot drift by re-fetching.
 */

const fmtClock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec).padStart(2, '0')}s`;
};

export default function DailyBonus({ open, onClose }) {
  const { data, loading, error, reload } = useApi('/api/daily-bonus', {
    immediate: open,
    enabled: open
  });
  const toast = useToast();
  const [claiming, setClaiming] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const timer = useRef(null);

  // Tick locally. Re-fetching every second to update a clock would hammer the
  // API for no reason.
  useEffect(() => {
    clearInterval(timer.current);
    if (!data || data.canClaim) return undefined;
    const start = Date.now();
    const tick = () => setRemaining(Math.max(0, data.msUntilNext - (Date.now() - start)));
    tick();
    timer.current = setInterval(tick, 1000);
    return () => clearInterval(timer.current);
  }, [data]);

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      const res = await fetch(`${API_BASE}/api/daily-bonus/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });
      const body = await res.json();
      if (!res.ok) {
        toast.push({ tone: 'error', icon: 'warn', title: 'Could not claim', body: body.message || 'Try again.', key: 'db:fail' });
        playError();
        // The server is the authority on whether it is still claimable.
        reload();
        return;
      }
      playBetPlaced();
      toast.push({
        tone: 'reward',
        icon: 'jackpot',
        title: `Day ${body.nextStreak - 1} claimed`,
        body: `+${Number(body.amount || 0).toLocaleString()} AMP`,
        key: `db:ok:${body.amount}`
      });
      reload();
    } catch (err) {
      toast.push({ tone: 'error', icon: 'warn', title: 'Could not reach the server', key: 'db:net' });
      playError();
    } finally {
      setClaiming(false);
    }
  };

  if (!open) return null;

  const s = data;

  return (
    <ModalPortal>
      <div className="db-overlay" onClick={onClose}>
        <div
          className="db"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Daily bonus"
        >
          <button className="cf-modal-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>

          <div className="db-head">
            <div className="db-gift"><Icon name="jackpot" size={22} /></div>
            <h2>Daily Bonus</h2>
            <p>Claim every day. The longer your streak, the bigger it gets.</p>
          </div>

          {loading && !s && (
            <div className="db-body"><div className="db-skel" /></div>
          )}

          {error && (
            <div className="db-body">
              <div className="db-error">
                <Icon name="warn" size={20} />
                <span>{error.message || 'Could not load your bonus'}</span>
                <Button variant="primary" size="sm" onClick={reload}>Try again</Button>
              </div>
            </div>
          )}

          {s && (
            <>
              <div className="db-body">
                {/* The streak as a row of dots: day N filled, today highlighted,
                    the rest dimmed. Reads faster than a number. */}
                <div className="db-streak" aria-label={`Streak: ${s.streak} of ${s.maxStreak} days`}>
                  {Array.from({ length: s.maxStreak }, (_, i) => {
                    const day = i + 1;
                    const done = day <= s.streak;
                    const isToday = day === (s.canClaim ? s.nextStreak : s.nextStreak);
                    return (
                      <span
                        key={day}
                        className={`db-day ${done ? 'is-done' : ''} ${isToday ? 'is-today' : ''}`}
                        title={`Day ${day}`}
                      >
                        {done ? <Icon name="check" size={11} /> : day}
                      </span>
                    );
                  })}
                </div>

                <div className="db-figure">
                  <span className="db-figure-label">
                    {s.claimedToday ? `Day ${s.nextStreak} tomorrow` : `Day ${s.nextStreak} today`}
                  </span>
                  <span className="db-figure-value">
                    <Icon name="diamond" size={17} />
                    {Number(s.canClaim ? s.reward : s.nextReward).toLocaleString()}
                  </span>
                  <span className="db-figure-sub">
                    {s.canClaim
                      ? `Best run so far: ${s.best} day${s.best === 1 ? '' : 's'}`
                      : `Comes back in ${fmtClock(remaining)}`}
                  </span>
                </div>

                {/* Only warn when a streak was actually lost. On the very first claim of a
                    brand-new account the server reports streakBroken with a zero
                    streak, which is not a broken streak at all. */}
                {s.streakBroken && s.streak > 0 && (
                  <div className="db-note warn">
                    <Icon name="warn" size={13} />
                    Your streak reset - you missed a day. Claim now to start again at day 1.
                  </div>
                )}

                <dl className="db-stats">
                  <div><dt>Total claimed</dt><dd>{Number(s.totalClaimed).toLocaleString()}</dd></div>
                  <div><dt>Days claimed</dt><dd>{s.totalDays}</dd></div>
                  <div><dt>Best streak</dt><dd>{s.best}</dd></div>
                </dl>
              </div>

              <div className="db-actions">
                {s.canClaim ? (
                  <Button variant="primary" size="lg" full loading={claiming} onClick={claim} icon="jackpot">
                    Claim {Number(s.reward).toLocaleString()} AMP
                  </Button>
                ) : (
                  <div className="db-waiting">
                    <span className="db-timer">{fmtClock(remaining)}</span>
                    <span className="db-timer-label">until your next bonus</span>
                  </div>
                )}
                <Button variant="ghost" onClick={onClose}>Close</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}