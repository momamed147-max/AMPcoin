import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ModalPortal from './ModalPortal';
import Icon from './Icon';
import { playButtonClick } from '../sound';
import './CommandPalette.css';

/**
 * Ctrl+K command palette.
 *
 * Every page is one click away at best, and the games all need "pick pets,
 * pick a game, place the bet" before anything happens. A single fuzzy list
 * that jumps straight there removes the navigation step entirely.
 *
 * Built on the shared primitives, and deliberately keyboard-first: it opens on
 * Ctrl+K / Cmd+K, arrow keys move, Enter runs, Escape closes.
 */

const ACTIONS = [
  { id: 'coinflip', label: 'Coinflip', hint: 'Heads or tails for the pot', group: 'Games', icon: 'coin', path: '/coinflip' },
  { id: 'jackpot', label: 'Jackpot', hint: 'One winner takes the whole pot', group: 'Games', icon: 'jackpot', path: '/jackpot' },
  { id: 'rps', label: 'Rock Paper Scissors', hint: 'Best of 1 or 5', group: 'Games', icon: 'rpsScissors', path: '/rps' },
  { id: 'blackjack', label: 'Blackjack', hint: 'Dealer stands on flat 17', group: 'Games', icon: 'card', path: '/blackjack' },
  { id: 'upgrader', label: 'Upgrader', hint: 'Trade up, or lose it all', group: 'Games', icon: 'battery', path: '/upgrader' },
  { id: 'trading', label: 'Trading', hint: 'Post and accept item trades', group: 'Games', icon: 'swap', path: '/trading' },
  { id: 'stats', label: 'Statistics', hint: 'Wins, losses and achievements', group: 'You', icon: 'chart', path: '/stats' },
  { id: 'profile', label: 'Profile', hint: 'Your account and appearance', group: 'You', icon: 'chat', path: '/profile' },
  { id: 'fair', label: 'Provably Fair', hint: 'Verify any past result', group: 'You', icon: 'shield', path: '/provably-fair' },
  { id: 'leaderboard', label: 'Leaderboard', hint: 'Top players', group: 'You', icon: 'flag', path: '/stats' }
];

/** Subsequence match, so "cflp" finds Coinflip and "upgr" finds Upgrader. */
function fuzzy(needle, haystack) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (h.includes(n)) return true;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

function score(item, needle) {
  if (!needle) return 0;
  const l = item.label.toLowerCase();
  const n = needle.toLowerCase();
  if (l === n) return 100;
  if (l.startsWith(n)) return 80;
  if (l.includes(n)) return 60;
  if (fuzzy(n, l)) return 30;
  if (fuzzy(n, item.hint || '')) return 15;
  return -1;
}

export default function CommandPalette({ open, onClose, extra = [] }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const all = useMemo(() => [...extra, ...ACTIONS], [extra]);

  const results = useMemo(() => {
    const scored = all
      .map((a) => ({ ...a, _s: score(a, query.trim()) }))
      .filter((a) => a._s >= 0);
    // Exact-ish matches first, then alphabetical so the order is stable.
    scored.sort((a, b) => (b._s - a._s) || a.label.localeCompare(b.label));
    return scored.slice(0, 12);
  }, [all, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Focus after paint, or the dialog mounts and the caret stays nowhere.
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => { setCursor(0); }, [query]);

  const go = (item) => {
    if (!item) return;
    playButtonClick();
    onClose();
    // Do not "navigate" to where we already are: it would remount the page for
    // no reason and lose the user's place.
    if (item.path && item.path !== location.pathname) navigate(item.path);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[cursor]);
    } else if (e.key === 'Home') {
      setCursor(0);
    } else if (e.key === 'End') {
      setCursor(Math.max(0, results.length - 1));
    }
  };

  if (!open) return null;

  // Group headers, with the flat list index preserved so arrow keys still work.
  const rows = [];
  let lastGroup = null;
  results.forEach((r, i) => {
    if (r.group !== lastGroup) {
      rows.push({ header: r.group, key: `h-${r.group}-${i}` });
      lastGroup = r.group;
    }
    rows.push({ item: r, index: i, key: r.id });
  });

  return (
    <ModalPortal>
      <div className="cp-overlay" onClick={onClose}>
        <div
          className="cp"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onKeyDown={onKeyDown}
        >
          <div className="cp-search">
            <Icon name="search" size={16} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Jump to a game or a page..."
              aria-label="Search commands"
              // Escape must work even if focus escaped the input.
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
            />
            <kbd className="cp-kbd">Esc</kbd>
          </div>

          {results.length === 0 ? (
            <div className="cp-empty">
              <Icon name="search" size={22} />
              <span>Nothing matches &ldquo;{query}&rdquo;</span>
            </div>
          ) : (
            <ul className="cp-list" role="listbox">
              {rows.map((row) => {
                if (row.header) {
                  return <li key={row.key} className="cp-group" role="presentation">{row.header}</li>;
                }
                const r = row.item;
                const active = row.index === cursor;
                return (
                  <li key={row.key} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={`cp-item ${active ? 'is-active' : ''}`}
                      // Pointer movement sets the cursor, so hovering and
                      // arrowing can never disagree about what Enter will run.
                      onMouseMove={() => setCursor(row.index)}
                      onClick={() => go(r)}
                    >
                      <span className="cp-item-icon"><Icon name={r.icon || 'target'} size={15} /></span>
                      <span className="cp-item-body">
                        <span className="cp-item-label">{r.label}</span>
                        {r.hint && <span className="cp-item-hint">{r.hint}</span>}
                      </span>
                      {active && <span className="cp-item-go">↵</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="cp-foot">
            <span><kbd className="cp-kbd">↑</kbd><kbd className="cp-kbd">↓</kbd> move</span>
            <span><kbd className="cp-kbd">↵</kbd> open</span>
            <span><kbd className="cp-kbd">Esc</kbd> close</span>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}