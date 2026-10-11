import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from 'react';
import ModalPortal from './ModalPortal';
import Icon from './Icon';
import { playButtonClick, playCoinflipJoin, playError, playBetPlaced } from '../sound';
import './Toasts.css';

/**
 * Toast notifications, driven by the realtime socket.
 *
 * The socket already emits everything that matters - someone joined your bet,
 * your hand settled, an upgrader round moved - and the old pages either ignored
 * it or re-rendered the whole list. So a win could happen with no acknowledgement
 * at all: you had to stare at the board and notice the row had changed.
 *
 * This turns those same events into a quiet, ordered stream of toasts, deduped
 * so a burst of identical events does not stack up, and grouped by how much the
 * event should interrupt.
 */

const ToastContext = createContext(null);

const TONE = {
  info: 'info',
  success: 'success',
  error: 'error',
  warn: 'warn',
  reward: 'reward'
};

let nextId = 1;

export function ToastProvider({ children, socket, user }) {
  const [toasts, setToasts] = useState([]);
  // Keyed by a dedupe key so the same event twice in a row does not stack.
  const seen = useRef(new Map());
  const timers = useRef([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((toast) => {
    const key = toast.key || `${toast.title}|${toast.body || ''}`;
    const now = Date.now();
    const last = seen.current.get(key) || 0;
    // Within 4s of the same message, refresh the existing toast instead of
    // adding another one.
    if (now - last < 4000) {
      seen.current.set(key, now);
      setToasts((prev) => prev.map((t) => t.key === key ? { ...t, at: now, bump: (t.bump || 0) + 1 } : t));
      return;
    }
    seen.current.set(key, now);
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-5), { ...toast, id, key, at: now }]);
    const timer = setTimeout(() => dismiss(id), toast.duration || 6000);
    timers.current.push(timer);
  }, [dismiss]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const me = user?.id;

    // ── coinflip ──
    socket.on('coinflipJoined', (d) => {
      if (!d) return;
      const mine = d.creatorId === me || d.opponentId === me;
      if (mine) {
        push({
          tone: TONE.success,
          icon: 'coin',
          title: d.creatorId === me ? 'Your bet was joined' : 'You joined a bet',
          body: 'Cards are flipping.',
          key: `cfj:${d.id}`
        });
        playCoinflipJoin();
      }
    });
    socket.on('coinflipResult', (d) => {
      if (!d || !d.id) return;
      const mine = d.creatorId === me || d.opponentId === me;
      if (!mine) return;
      const iWon = d.winnerId === me;
      push({
        tone: iWon ? TONE.reward : TONE.error,
        icon: iWon ? 'jackpot' : 'warn',
        title: iWon ? 'You won the coinflip' : 'You lost the coinflip',
        body: iWon ? `Flipped ${d.result || ''}`.trim() : `Flipped ${d.result || ''}`.trim(),
        key: `cfr:${d.id}`
      });
      if (iWon) playBetPlaced(); else playError();
    });

    // ── rps ──
    socket.on('rpsMatchUpdate', (d) => {
      if (!d || !d.id) return;
      const mine = d.playerOne?.id === me || d.playerTwo?.id === me;
      if (!mine || d.status !== 'completed') return;
      const iWon = d.winnerId === me;
      push({
        tone: iWon ? TONE.reward : TONE.error,
        icon: 'rpsScissors',
        title: iWon ? 'You won the RPS match' : d.winnerId ? 'You lost the RPS match' : 'RPS drawn',
        body: d.winnerId ? 'Your pot is yours.' : 'Wagers returned.',
        key: `rps:${d.id}`
      });
      if (iWon) playBetPlaced();
    });

    // ── blackjack ──
    socket.on('blackjackTables', () => {
      // The board itself carries the state; a toast here would fire on every
      // poll from every table and be unusable.
    });

    // ── upgrader ──
    socket.on('upgraderUpdate', (d) => {
      if (!d || !d.round || d.round.userId !== me) return;
      if (d.round.status !== 'rolled' && d.round.status !== 'settled') return;
      if (d.round.won === true) {
        push({
          tone: TONE.reward,
          icon: 'battery',
          title: 'Upgrade successful',
          body: `+${Number(d.round.payoutValue || 0).toLocaleString()} AMP`,
          key: `ug:${d.round.id}`
        });
        playBetPlaced();
      } else if (d.round.won === false) {
        push({
          tone: TONE.error,
          icon: 'battery',
          title: 'Upgrade failed',
          body: 'The pets went to the upgrader.',
          key: `ug:${d.round.id}`
        });
        playError();
      }
    });

    // ── chat mentions ──
    socket.on('chatMessage', (d) => {
      if (!d || d.username === user?.username) return;
      if (typeof d.text !== 'string' || !d.text.includes('@')) return;
      const handle = user?.username ? `@${user.username}`.toLowerCase() : null;
      if (handle && d.text.toLowerCase().includes(handle)) {
        push({
          tone: TONE.info,
          icon: 'chat',
          title: `${d.username} mentioned you`,
          body: d.text.length > 90 ? `${d.text.slice(0, 87)}...` : d.text,
          key: `mention:${d.id || d.text}`
        });
      }
    });

    // ── connection ──
    socket.on('disconnect', () => {
      push({
        tone: TONE.warn,
        icon: 'warn',
        title: 'Connection lost',
        body: 'Reconnecting...',
        duration: 9000,
        key: 'conn:down'
      });
    });
    socket.on('connect', () => {
      // Clear the offline toast if it is still up.
      setToasts((prev) => prev.filter((t) => t.key !== 'conn:down'));
    });

    return () => {
      socket.off('coinflipJoined');
      socket.off('coinflipResult');
      socket.off('rpsMatchUpdate');
      socket.off('blackjackTables');
      socket.off('upgraderUpdate');
      socket.off('chatMessage');
      socket.off('disconnect');
      socket.off('connect');
    };
  }, [socket, user?.id, user?.username, push]);

  const api = useMemo(() => ({
    push,
    dismiss,
    clear: () => setToasts([]),
    // A success/error helper so callers do not invent their own wording.
    notify: (title, opts = {}) => push({ title, tone: TONE.info, ...opts })
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // Safe outside the provider: pages can use it without being wrapped.
  return ctx || { push: () => {}, dismiss: () => {}, clear: () => {}, notify: () => {} };
}

const ICONS = {
  success: 'check', reward: 'jackpot', error: 'warn', warn: 'warn', info: 'target'
};

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <ModalPortal>
      <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone || 'info'} ${t.bump ? 'bump' : ''}`}>
            <span className="toast-icon"><Icon name={t.icon || ICONS[t.tone] || 'target'} size={15} /></span>
            <div className="toast-body">
              <strong className="toast-title">{t.title}</strong>
              {t.body && <span className="toast-text">{t.body}</span>}
            </div>
            <button
              type="button"
              className="toast-x"
              onClick={() => { playButtonClick(); onDismiss(t.id); }}
              aria-label={`Dismiss: ${t.title}`}
            >
              <Icon name="close" size={12} />
            </button>
            {/* The bar is the timer, so it never lies about how long is left. */}
            <span
              className="toast-life"
              style={{ animationDuration: `${t.duration || 6000}ms` }}
              onAnimationEnd={() => onDismiss(t.id)}
              aria-hidden="true"
            />
          </div>
        ))}
      </div>
    </ModalPortal>
  );
}

export default ToastProvider;