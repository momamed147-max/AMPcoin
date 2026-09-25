import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AnimatedPopup from '../components/AnimatedPopup';
import CreateCoinflipModal from '../components/CreateCoinflipModal';
import ModalPortal from '../components/ModalPortal';
import ModBadges from '../components/ModBadges';
import PetTooltip from '../components/PetTooltip';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import { playButtonClick, playCoinflipJoin } from '../sound';
import './CoinflipPage.css';
import '../components/ModBadges.css';
import './RpsPage.css';

const MOVES = [
  { id: 'rock', label: 'Rock', icon: 'rpsRock' },
  { id: 'paper', label: 'Paper', icon: 'rpsPaper' },
  { id: 'scissors', label: 'Scissors', icon: 'rpsScissors' }
];

const RARITY_COLORS = {
  legendary: '#f59e0b',
  ultra_rare: '#8b5cf6',
  mythic: '#c026d3',
  epic: '#a855f7',
  rare: '#3b82f6',
  uncommon: '#10b981',
  common: '#6b7280'
};
const rarityColor = (rarity) => RARITY_COLORS[String(rarity || '').toLowerCase()] || '#6b7280';

function authHeaders(json = false) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${localStorage.getItem('token')}`
  };
}

function compact(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace('.0', '')}K`;
  return number.toLocaleString();
}

function itemTotal(items) {
  return (items || []).reduce((sum, item) => sum + Number(item.value || 0) * Math.max(1, Number(item.quantity || 1)), 0);
}

function moveFor(id) {
  return MOVES.find((move) => move.id === id) || null;
}

function timeAgo(value) {
  if (!value) return 'just now';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function pct(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((Number(part || 0) / Number(whole)) * 100)}%`;
}

function ItemThumbs({ items = [], limit = 8 }) {
  const visible = items.slice(0, limit);
  return (
    <>
      {visible.map((item, index) => (
        <div className="cf-row-thumb-wrap cf-tip-host" key={`${item.itemId || item.id}-${index}`} data-tip={item.name || item.itemName || 'Item'}>
          <img
            className="cf-row-thumb"
            src={item.image || item.imageUrl || '/default-item.png'}
            alt={item.name || item.itemName || 'item'}
            onError={(event) => { event.currentTarget.src = '/default-item.png'; }}
          />
          <span className="cf-row-thumb-rarity" style={{ background: rarityColor(item.rarity) }} />
          <span className="cf-tip-pop"><PetTooltip item={item} /></span>
        </div>
      ))}
      {items.length > limit && <span className="cf-row-more">+{items.length - limit}</span>}
    </>
  );
}

/* ─── Lobby row: same skeleton as a Coinflip lobby row ─── */
function RpsLobbyRow({ match, onJoin, onView, isSelf }) {
  const completed = match.status === 'completed';
  const waiting = match.status === 'waiting';
  const one = match.playerOne;
  const two = match.playerTwo;
  return (
    <div className={`cf-row rps-lobby-row ${completed ? 'cf-row-done' : waiting ? '' : 'rps-row-live'}`}>
      <div className="cf-row-players">
        <div className="cf-row-player">
          <div className={`cf-row-avatar-ring ${completed ? (match.winnerId === one.id ? 'ring-winner' : 'ring-lost') : 'ring-heads'}`}>
            <img
              className="cf-row-avatar"
              src={one.avatar || '/default-avatar.png'}
              alt={one.displayName || one.username}
              onError={(event) => { event.currentTarget.src = '/default-avatar.png'; }}
            />
            <span className="cf-row-chip-badge"><Icon name="rpsScissors" size={18} /></span>
          </div>
        </div>
        <span className="cf-row-vs">VS</span>
        <div className="cf-row-player">
          <div className={`cf-row-avatar-ring ${completed ? (match.winnerId === two?.id ? 'ring-winner' : 'ring-lost') : 'ring-tails'}`}>
            {two ? (
              <img
                className="cf-row-avatar"
                src={two.avatar || '/default-avatar.png'}
                alt={two.displayName || two.username}
                onError={(event) => { event.currentTarget.src = '/default-avatar.png'; }}
              />
            ) : (
              <div className="cf-row-avatar cf-row-avatar-empty">?</div>
            )}
            <span className="cf-row-chip-badge"><Icon name="rpsScissors" size={18} /></span>
          </div>
        </div>
      </div>

      <div className="cf-row-items">
        <ItemThumbs items={one.items} limit={4} />
        {two && two.items?.length > 0 && <span className="rps-row-vs-divider">+</span>}
        {two && <ItemThumbs items={two.items} limit={4} />}
      </div>

      <div className="cf-row-value">
        <div className="cf-row-total">
          <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {compact(match.potValue)}
        </div>
        <div className="cf-row-range">
          {completed
            ? `${one.wins || 0} - ${two?.wins || 0}${match.winnerId ? '' : ' draw'}`
            : waiting
              ? `Join ${compact(match.minJoinValue)}-${compact(match.maxJoinValue)}`
              : `Turn ${match.round}/${match.rounds} · ${one.wins || 0}-${two?.wins || 0}`}
        </div>
        <div className="cf-row-cap">{match.rounds > 1 ? `${match.rounds} turns` : '1 turn'}</div>
      </div>

      <div className="cf-row-action">
        {waiting && !isSelf && <button className="cf-join-btn" onClick={() => onJoin(match)}>Join</button>}
        {waiting && isSelf && <span className="cf-row-cap">Yours</span>}
        <button className="cf-view-btn" onClick={() => onView(match)}>View</button>
      </div>
    </div>
  );
}

/* ─── Item list column used inside the view modal ─── */
function RpsItemColumn({ items, side }) {
  if (!items?.length) {
    return <div className="cf-view-noitems">No items</div>;
  }
  return items.map((item, index) => (
    <div key={`${side}-${item.itemId || item.id}-${index}`} className="cf-view-item-row cf-tip-host" data-tip={item.name || item.itemName || 'Item'}>
      <img
        src={item.image || item.imageUrl || '/default-item.png'}
        alt={item.name || 'item'}
        className="cf-view-item-icon"
        onError={(event) => { event.currentTarget.src = '/default-item.png'; }}
      />
      <span className="cf-view-item-name">
        {item.name || item.itemName || 'Item'}{(item.quantity || 1) > 1 ? ` ×${item.quantity}` : ''}
      </span>
      <ModBadges mods={item.mods} size={15} />
      <span className="cf-view-item-val">
        <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {((item.value || 0) * (item.quantity || 1)).toLocaleString()}
      </span>
      <span className="cf-tip-pop"><PetTooltip item={item} /></span>
    </div>
  ));
}

const RpsPage = ({ socket }) => {
  const { user } = useAuth();
  const [lobby, setLobby] = useState({ matches: [], activeCount: 0 });
  const [myMatch, setMyMatch] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [dismissedKey, setDismissedKey] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [popup, setPopup] = useState({ show: false, message: '', type: 'info' });

  const showPopup = useCallback((message, type = 'info') => setPopup({ show: true, message, type }), []);

  const fetchInventory = useCallback(async () => {
    if (!user?.id) return;
    setInventoryLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/users/inventory/${encodeURIComponent(user.id)}`, { headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setInventory(Array.isArray(data.items) ? data.items : []);
    } finally {
      setInventoryLoading(false);
    }
  }, [user?.id]);

  const applyLobby = useCallback((data) => {
    if (!data) return;
    setLobby({
      matches: Array.isArray(data.matches) ? data.matches : [],
      activeCount: Number(data.activeCount || 0)
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/rps/lobby`, { headers: authHeaders() });
      if (!response.ok) throw new Error(`RPS lobby unavailable (${response.status})`);
      const data = await response.json();
      applyLobby(data);
      setMyMatch((current) => {
        if (data.match) return data.match;
        // Keep a just-finished match on screen so the result and payout stay
        // readable instead of snapping shut on the next poll.
        if (current?.status === 'completed'
          && Date.now() - new Date(current.completedAt || Date.now()).getTime() < 5 * 60 * 1000) {
          return current;
        }
        return null;
      });
      setError('');
    } catch (refreshError) {
      setError(refreshError.message || 'Could not reach the RPS lobby.');
    } finally {
      setLoading(false);
    }
  }, [applyLobby]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Keep the open match fresh from the poll so nothing needs a manual refresh.
  useEffect(() => {
    if (!myMatch) return;
    const fresh = lobby.matches.find((candidate) => candidate.id === myMatch.id);
    if (fresh && (fresh.round !== myMatch.round || fresh.status !== myMatch.status
      || fresh.playerOne?.picked !== myMatch.playerOne?.picked
      || fresh.playerTwo?.picked !== myMatch.playerTwo?.picked
      || fresh.playerOne?.wins !== myMatch.playerOne?.wins
      || fresh.playerTwo?.wins !== myMatch.playerTwo?.wins)) {
      setMyMatch(fresh);
    }
  }, [lobby.matches, myMatch]);

  useEffect(() => {
    if (!socket) return undefined;
    const onLobby = (data) => applyLobby(data);
    const onMatch = (data) => {
      if (data) {
        setMyMatch(data);
        if (data.status === 'completed') fetchInventory();
      }
    };
    socket.on('rpsLobbyUpdate', onLobby);
    socket.on('rpsMatchUpdate', onMatch);
    return () => {
      socket.off('rpsLobbyUpdate', onLobby);
      socket.off('rpsMatchUpdate', onMatch);
    };
  }, [socket, applyLobby, fetchInventory]);

  // Auto-open the modal for the player's own match, once per new turn. The ref
  // keeps the 4s poll from snapping a manually opened View back to this match.
  const autoOpenRef = useRef(null);
  useEffect(() => {
    if (!myMatch) return;
    const key = `${myMatch.id}:${myMatch.round}:${myMatch.status}`;
    if (autoOpenRef.current === key) return;
    if (dismissedKey === key) return;
    autoOpenRef.current = key;
    setViewId(myMatch.id);
  }, [myMatch, dismissedKey]);

  const request = useCallback(async (path, body, action) => {
    setBusy(action);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/rps${path}`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body || {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'RPS action failed.');
      return data;
    } catch (requestError) {
      setError(requestError.message || 'RPS action failed.');
      showPopup(requestError.message || 'RPS action failed.', 'error');
      return null;
    } finally {
      setBusy('');
    }
  }, [showPopup]);

  const openCreateModal = async () => {
    playButtonClick();
    await fetchInventory();
    setModal({ type: 'rps' });
  };

  const openJoinModal = async (challenge) => {
    playButtonClick();
    await fetchInventory();
    setModal({ type: 'rps-join', match: challenge });
  };

  const handleBetCreated = (data) => {
    setMyMatch(data.match || null);
    setModal(null);
    setViewId(data.match?.id || null);
    setDismissedKey(null);
    showPopup(data.match?.status === 'waiting' ? 'RPS bet posted. Waiting for a challenger.' : 'RPS bet joined. Pick your side!', 'success');
    if (data.match?.status === 'playing') playCoinflipJoin();
    refresh();
  };

  const chooseMove = async (choice) => {
    if (!myMatch) return;
    const data = await request(`/matches/${myMatch.id}/choice`, { choice }, choice);
    if (data) {
      setMyMatch(data.match);
      refresh();
      if (data.waitingForOpponent) showPopup('Side locked in — waiting for your opponent.', 'info');
      if (data.match?.status === 'completed') {
        await fetchInventory();
        showPopup(
          data.match.winnerId === user?.id
            ? 'You won the RPS pot!'
            : data.match.winnerId
              ? 'Your opponent won the pot.'
              : 'Turns ended level — both wagers were returned.',
          data.match.winnerId === user?.id ? 'success' : 'info'
        );
      }
    }
  };

  const leaveMatch = async () => {
    if (!myMatch) return;
    const data = await request(`/matches/${myMatch.id}/cancel`, {}, 'cancel');
    if (data) {
      setMyMatch(null);
      setViewId(null);
      showPopup(data.cancelled ? 'You left the RPS bet.' : 'Bet updated.', 'info');
      refresh();
    }
  };

  // The modal always renders the freshest copy: own match (private view) or
  // the lobby copy when spectating someone else's game.
  const viewMatch = useMemo(() => {
    if (!viewId) return null;
    if (myMatch?.id === viewId) return myMatch;
    return lobby.matches.find((candidate) => candidate.id === viewId) || null;
  }, [viewId, myMatch, lobby.matches]);

  const openValue = useMemo(
    () => lobby.matches.filter((m) => m.status === 'waiting').reduce((sum, m) => sum + Number(m.creatorValue || 0), 0),
    [lobby.matches]
  );
  const waitingCount = useMemo(
    () => lobby.matches.filter((m) => m.status === 'waiting').length,
    [lobby.matches]
  );

  const closeView = () => {
    if (myMatch) setDismissedKey(`${myMatch.id}:${myMatch.round}:${myMatch.status}`);
    setViewId(null);
  };

  if (loading) return <div className="cf-loading"><div className="loading-spinner" /><p>Loading RPS bets...</p></div>;

  return (
    <div className="cf-page rps-page">
      <div className="cf-topbar">
        <div className="cf-topbar-tabs">
          <Link to="/coinflip" className="cf-tab"><span className="cf-tab-label"><Icon name="coin" size={12} /> Coinflip</span></Link>
          <Link to="/jackpot" className="cf-tab"><span className="cf-tab-label"><Icon name="jackpot" size={12} /> Jackpot</span></Link>
          <button className="cf-tab cf-tab-active"><span className="cf-tab-label"><Icon name="rpsScissors" size={12} /> RPS</span><span className="cf-tab-count">{lobby.matches.length}</span></button>
          <span className="cf-tab-divider" />
          <button className="cf-tab cf-tab-disabled" disabled title="Coming soon"><span className="cf-tab-label"><Icon name="shop" size={12} /> Market</span></button>
          <button className="cf-tab cf-tab-disabled" disabled title="Coming soon"><span className="cf-tab-label"><Icon name="flag" size={12} /> Race</span></button>
        </div>
        <div className="cf-topbar-right">
          <div className="cf-topbar-stat"><span className="cf-dice-icon"><Icon name="rpsScissors" size={13} /></span><span>{waitingCount} open</span></div>
          <div className="cf-topbar-stat"><span className="cf-diamond-icon"><Icon name="diamond" size={12} /></span><span>{compact(openValue)}</span></div>
          {myMatch && viewId !== myMatch.id && (
            <button className="cf-topbar-btn" onClick={() => setViewId(myMatch.id)}>
              <Icon name="target" size={13} /> Your match
            </button>
          )}
          <button className="cf-topbar-btn cf-topbar-btn-gold" onClick={openCreateModal} disabled={inventoryLoading}>
            <Icon name="plus" size={13} /> Bet Items
          </button>
        </div>
      </div>

      {error && <div className="rps-error" role="alert"><Icon name="warn" size={15} /><span>{error}</span><button type="button" onClick={refresh}>Retry</button></div>}

      <div className="cf-lobby">
        {lobby.matches.length > 0 ? lobby.matches.map((match) => (
          <RpsLobbyRow
            key={match.id}
            match={match}
            isSelf={match.playerOne?.id === user?.id || match.playerTwo?.id === user?.id}
            onJoin={openJoinModal}
            onView={(target) => setViewId(target.id)}
          />
        )) : (
          <div className="cf-empty">
            <div className="cf-empty-icon"><Icon name="rpsScissors" size={34} /></div>
            <p>No active RPS bets</p>
            <p className="cf-empty-sub">Post an item wager to get started!</p>
            <button className="cf-topbar-btn cf-topbar-btn-gold" onClick={openCreateModal}><Icon name="plus" size={13} /> Create RPS Bet</button>
          </div>
        )}
      </div>

      {/* ═══ View modal — playable for participants, read-only for spectators ═══ */}
      {viewMatch && (() => {
        const one = viewMatch.playerOne;
        const two = viewMatch.playerTwo;
        // Finished matches are no longer "active", so fall back to the player
        // ids to still show your own side and payout.
        const isSelfMatch = one?.id === user?.id || two?.id === user?.id;
        const viewerSide = myMatch?.id === viewMatch.id
          ? myMatch.viewerSide
          : isSelfMatch
            ? (one?.id === user?.id ? 'one' : 'two')
            : null;
        const isParticipant = !!viewerSide;
        const waiting = viewMatch.status === 'waiting';
        const completed = viewMatch.status === 'completed';
        const myChoice = viewerSide === 'one' ? one?.choice : viewerSide === 'two' ? two?.choice : null;
        const opponentPicked = viewerSide === 'one' ? two?.picked : one?.picked;
        const viewer = viewerSide === 'one' ? one : two;
        const lastRound = viewMatch.lastRound;
        const potValue = viewMatch.potValue || 0;
        const taxPercent = Number(viewMatch.taxPercent || 0);
        const winnerName = viewMatch.winnerId
          ? (viewMatch.winnerId === one.id ? (one.displayName || one.username) : (two?.displayName || two?.username))
          : null;

        return (
          <ModalPortal>
            <div className="cf-modal-overlay" onClick={closeView}>
              <div className="cf-modal cf-view-modal rps-view-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="RPS match details">
                <button className="cf-modal-close" onClick={closeView} aria-label="Close match"><Icon name="close" size={15} /></button>

                {/* Players + turn state */}
                <div className="cf-view-top">
                  <div className="cf-view-player">
                    <div className={`cf-view-avatar-ring ${completed && viewMatch.winnerId === one.id ? 'ring-winner' : 'ring-heads'}`}>
                      <img src={one.avatar || '/default-avatar.png'} alt={one.displayName || one.username} className="cf-view-avatar" onError={(e) => { e.target.src = '/default-avatar.png'; }} />
                      <span className="cf-view-chip-badge"><Icon name="rpsScissors" size={22} /></span>
                    </div>
                    <div className="cf-view-player-name">{one.displayName || one.username}</div>
                    <div className="cf-view-turn-score">{one.wins || 0}</div>
                  </div>

                  <div className="cf-view-coin-area rps-view-center">
                    {completed ? (
                      <div className={`rps-final-move rps-final-${lastRound?.result || 'draw'}`}>
                        <Icon name={moveFor(lastRound?.playerOneChoice)?.icon || 'rpsScissors'} size={30} />
                        <span className="rps-final-vs">vs</span>
                        <Icon name={moveFor(lastRound?.playerTwoChoice)?.icon || 'rpsScissors'} size={30} />
                      </div>
                    ) : (
                      <>
                        <div className="cf-view-vs-big">Vs</div>
                        <div className="rps-turn-counter">
                          {waiting ? 'Waiting to start' : `Turn ${viewMatch.round} of ${viewMatch.rounds}`}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="cf-view-player">
                    <div className={`cf-view-avatar-ring ${completed && viewMatch.winnerId === two?.id ? 'ring-winner' : 'ring-tails'}`}>
                      {two ? (
                        <img src={two.avatar || '/default-avatar.png'} alt={two.displayName || two.username} className="cf-view-avatar" onError={(e) => { e.target.src = '/default-avatar.png'; }} />
                      ) : (
                        <div className="cf-view-avatar cf-view-avatar-empty">?</div>
                      )}
                      <span className="cf-view-chip-badge"><Icon name="rpsScissors" size={22} /></span>
                    </div>
                    <div className="cf-view-player-name">{two ? (two.displayName || two.username) : 'Waiting...'}</div>
                    <div className="cf-view-turn-score">{two ? (two.wins || 0) : '—'}</div>
                  </div>
                </div>

                {/* Pot + wagers */}
                <div className="cf-view-panels">
                  <div className="cf-view-panel">
                    <span className="cf-panel-side">Pot</span>
                    <span className="cf-panel-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {potValue.toLocaleString()}</span>
                  </div>
                  <div className="cf-view-panel">
                    <span className="cf-panel-side">{one.displayName || one.username}</span>
                    <span className="cf-panel-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {itemTotal(one.items).toLocaleString()}</span>
                  </div>
                  <div className="cf-view-panel">
                    <span className="cf-panel-side">{two ? (two.displayName || two.username) : 'Opponent'}</span>
                    <span className="cf-panel-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {two ? itemTotal(two.items).toLocaleString() : '—'}</span>
                  </div>
                </div>

                {/* Live lock-in status */}
                {!completed && (
                  <div className="rps-lock-row">
                    <div className={`rps-lock ${viewerSide === 'one' ? 'is-you' : ''} ${one.picked ? 'is-picked' : ''}`}>
                      <Icon name={one.picked ? 'check' : 'rpsScissors'} size={14} />
                      <span>{viewerSide === 'one' ? 'You' : (one.displayName || one.username)}</span>
                      <strong>{one.picked ? 'Picked side' : 'Choosing'}</strong>
                    </div>
                    {two && (
                      <div className={`rps-lock ${viewerSide === 'two' ? 'is-you' : ''} ${two.picked ? 'is-picked' : ''}`}>
                        <Icon name={two.picked ? 'check' : 'rpsScissors'} size={14} />
                        <span>{viewerSide === 'two' ? 'You' : (two.displayName || two.username)}</span>
                        <strong>{two.picked ? 'Picked side' : 'Choosing'}</strong>
                      </div>
                    )}
                  </div>
                )}

                {/* Move picker (participants only) */}
                {!completed && !waiting && isParticipant && (
                  <div className="rps-move-area">
                    <div className="rps-move-title">
                      {myChoice
                        ? 'Side locked in — waiting for your opponent'
                        : opponentPicked
                          ? 'Your opponent has locked in — pick your side'
                          : 'Pick your side'}
                    </div>
                    <div className="rps-move-row">
                      {MOVES.map((move) => (
                        <button
                          type="button"
                          key={move.id}
                          className={`rps-move-btn ${myChoice === move.id ? 'selected' : ''}`}
                          onClick={() => chooseMove(move.id)}
                          disabled={!!myChoice || busy === move.id}
                          aria-pressed={myChoice === move.id}
                        >
                          <Icon name={move.icon} size={30} />
                          <span>{move.label}</span>
                          {myChoice === move.id && <em><Icon name="check" size={11} /></em>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!completed && !waiting && !isParticipant && (
                  <div className="cf-view-waiting">Spectating — both sides stay hidden until the turn is played.</div>
                )}

                {waiting && (
                  <div className="cf-view-waiting">
                    Waiting for a challenger to join with {compact(viewMatch.minJoinValue)}–{compact(viewMatch.maxJoinValue)} AMP.
                  </div>
                )}

                {/* Last turn result */}
                {lastRound && (
                  <div className={`rps-last-turn ${isParticipant ? (lastRound.result === 'draw' ? 'draw' : lastRound.winnerId === viewer?.id ? 'win' : 'loss') : ''}`}>
                    <Icon name={lastRound.result === 'draw' ? 'info' : 'trophy'} size={13} />
                    <span>
                      Turn {lastRound.round}: {lastRound.playerOneChoice?.toUpperCase()} vs {lastRound.playerTwoChoice?.toUpperCase()}
                      {lastRound.result === 'draw'
                        ? ' — draw'
                        : ` — ${(lastRound.winnerId === one.id ? (one.displayName || one.username) : (two?.displayName || two?.username))} takes it`}
                    </span>
                  </div>
                )}

                {/* Wagers side by side */}
                <div className="cf-view-items-split">
                  <div className="cf-view-items-col">
                    <div className="cf-view-items-header"><span>{one.displayName || one.username}</span><span>{pct(itemTotal(one.items), potValue)}</span></div>
                    <RpsItemColumn items={one.items} side="one" />
                  </div>
                  <div className="cf-view-items-col">
                    <div className="cf-view-items-header"><span>{two ? (two.displayName || two.username) : 'Opponent'}</span><span>{two ? pct(itemTotal(two.items), potValue) : '—'}</span></div>
                    {two ? <RpsItemColumn items={two.items} side="two" /> : <div className="cf-view-noitems">Waiting for a challenger...</div>}
                  </div>
                </div>

                {/* Payout breakdown — replaces the old bare tax line */}
                {completed && (
                  <div className="rps-payout">
                    <div className="rps-payout-head">
                      <Icon name={viewMatch.winnerId ? 'trophy' : 'info'} size={14} />
                      <strong>{viewMatch.winnerId ? `${winnerName} wins` : 'Draw — wagers returned'}</strong>
                    </div>
                    <div className="rps-payout-rows">
                      <div className="rps-payout-row"><span>Total pot</span><span>{potValue.toLocaleString()} AMP</span></div>
                      {Number(viewMatch.taxAmount || 0) > 0 ? (
                        <div className="rps-payout-row is-tax">
                          <span>Item tax ({taxPercent}%)</span>
                          <span>-{Math.round(viewMatch.taxAmount || 0).toLocaleString()} AMP</span>
                        </div>
                      ) : (
                        <div className="rps-payout-row"><span>Item tax</span><span>None on this pot</span></div>
                      )}
                      <div className="rps-payout-row is-total">
                        <span>{viewMatch.winnerId ? `${viewMatch.winnerId === user?.id ? 'You' : 'Winner'} receive` : 'Returned to both players'}</span>
                        <span>{(viewMatch.winnerId ? potValue - Math.round(viewMatch.taxAmount || 0) : potValue).toLocaleString()} AMP</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="cf-view-footer">
                  <span className="cf-view-created">Created {timeAgo(viewMatch.createdAt)}</span>
                  <div className="rps-view-footer-actions">
                    {isParticipant && !completed && (
                      <button className="cf-cancel-btn" onClick={leaveMatch} disabled={busy === 'cancel'}>
                        {busy === 'cancel' ? 'Leaving...' : waiting ? 'Cancel Bet' : 'Forfeit'}
                      </button>
                    )}
                    {waiting && !isParticipant && (
                      <button className="cf-view-join-btn" onClick={() => { setViewId(null); openJoinModal(viewMatch); }}>
                        Join Bet ({compact(viewMatch.creatorValue)} AMP)
                      </button>
                    )}
                    {completed && <button className="cf-view-btn" onClick={closeView}>Close</button>}
                  </div>
                </div>
              </div>
            </div>
          </ModalPortal>
        );
      })()}

      {modal && <CreateCoinflipModal gameType={modal.type} match={modal.match} userInventory={inventory} onClose={() => setModal(null)} onCreated={handleBetCreated} />}
      <AnimatedPopup show={popup.show} message={popup.message} type={popup.type} onClose={() => setPopup((current) => ({ ...current, show: false }))} />
    </div>
  );
};

export default RpsPage;
