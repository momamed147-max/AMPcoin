import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AnimatedPopup from '../components/AnimatedPopup';
import CreateCoinflipModal from '../components/CreateCoinflipModal';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import { playButtonClick, playCoinflipJoin } from '../sound';
import './CoinflipPage.css';
import './RpsPage.css';

const MOVES = [
  { id: 'rock', label: 'Rock', icon: 'rpsRock', hint: 'Crushes scissors' },
  { id: 'paper', label: 'Paper', icon: 'rpsPaper', hint: 'Covers rock' },
  { id: 'scissors', label: 'Scissors', icon: 'rpsScissors', hint: 'Cuts paper' }
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

function ItemThumbs({ items = [], limit = 8 }) {
  const visible = items.slice(0, limit);
  return (
    <>
      {visible.map((item, index) => (
        <div className="cf-row-thumb-wrap" key={`${item.itemId || item.id}-${index}`} title={`${item.name || item.itemName || 'Item'}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`}>
          <img className="cf-row-thumb" src={item.image || item.imageUrl || '/default-item.png'} alt={item.name || item.itemName || 'item'} onError={(event) => { event.currentTarget.src = '/default-item.png'; }} />
          <span className="cf-row-thumb-rarity" style={{ background: rarityColor(item.rarity) }} />
        </div>
      ))}
      {items.length > limit && <span className="cf-row-more">+{items.length - limit}</span>}
    </>
  );
}

function RpsLobbyRow({ challenge, onJoin }) {
  const player = challenge.playerOne;
  return (
    <div className="cf-row rps-lobby-row">
      <div className="cf-row-players">
        <div className="cf-row-player">
          <div className="cf-row-avatar-ring ring-heads">
            <img className="cf-row-avatar" src={player.avatar || '/default-avatar.png'} alt={player.displayName || player.username} onError={(event) => { event.currentTarget.src = '/default-avatar.png'; }} />
            <span className="cf-row-chip-badge"><Icon name="rpsScissors" size={18} /></span>
          </div>
        </div>
        <span className="cf-row-vs">VS</span>
        <div className="cf-row-player"><div className="cf-row-avatar-ring ring-tails"><div className="cf-row-avatar cf-row-avatar-empty">?</div></div></div>
      </div>
      <div className="cf-row-items"><ItemThumbs items={player.items} /></div>
      <div className="cf-row-value">
        <div className="cf-row-total"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {compact(challenge.creatorValue)}</div>
        <div className="cf-row-range">Join {compact(challenge.minJoinValue)}–{compact(challenge.maxJoinValue)}</div>
      </div>
      <div className="cf-row-action"><button className="cf-join-btn" onClick={() => onJoin(challenge)}>Join</button></div>
    </div>
  );
}

function RpsPlayerBlock({ player, isViewer, winner, picked, choice, revealedChoice }) {
  const shownChoice = choice || revealedChoice;
  return (
    <div className={`rps-player-block ${isViewer ? 'is-viewer' : ''} ${winner ? 'is-winner' : ''}`}>
      <div className="rps-player-avatar-wrap">
        <div className={`cf-row-avatar-ring ${winner ? 'ring-winner' : ''} ${isViewer ? 'ring-rps-viewer' : ''}`}>
          {player ? <img className="cf-row-avatar" src={player.avatar || '/default-avatar.png'} alt="" onError={(event) => { event.currentTarget.src = '/default-avatar.png'; }} /> : <div className="cf-row-avatar cf-row-avatar-empty">?</div>}
          <span className="cf-row-chip-badge"><Icon name="rpsScissors" size={18} /></span>
        </div>
        <span className="rps-player-name">{player?.displayName || player?.username || 'Waiting...'}{isViewer ? ' (You)' : ''}</span>
      </div>
      <div className="rps-player-items"><ItemThumbs items={player?.items || []} limit={5} /></div>
      <div className={`rps-pick-status ${picked ? 'picked' : ''} ${shownChoice ? 'revealed' : ''}`}>
        {shownChoice ? <><Icon name={moveFor(shownChoice)?.icon || 'dot'} size={19} /><span>{revealedChoice && !choice ? 'Revealed' : 'Picked side'}</span></> : <span>{picked ? 'Picked side' : 'Waiting for pick'}</span>}
      </div>
      <div className="rps-player-value"><span className="cf-diamond-sm"><Icon name="diamond" size={10} /></span> {compact(itemTotal(player?.items))} AMP</div>
    </div>
  );
}

const RpsPage = ({ socket }) => {
  const { user } = useAuth();
  const [lobby, setLobby] = useState({ matches: [], activeCount: 0 });
  const [match, setMatch] = useState(null);
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

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/rps/lobby`, { headers: authHeaders() });
      if (!response.ok) throw new Error(`RPS lobby unavailable (${response.status})`);
      const data = await response.json();
      setLobby({ matches: Array.isArray(data.matches) ? data.matches : [], activeCount: Number(data.activeCount || 0) });
      if (data.match) setMatch(data.match);
      else setMatch((current) => current?.status === 'waiting' ? null : current);
      setError('');
    } catch (refreshError) {
      setError(refreshError.message || 'Could not reach the RPS lobby.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!socket) return undefined;
    const onLobby = (data) => {
      if (!data) return;
      setLobby({ matches: Array.isArray(data.matches) ? data.matches : [], activeCount: Number(data.activeCount || 0) });
    };
    const onMatch = (data) => {
      if (data) setMatch(data);
      if (data?.status === 'completed') fetchInventory();
    };
    socket.on('rpsLobbyUpdate', onLobby);
    socket.on('rpsMatchUpdate', onMatch);
    return () => {
      socket.off('rpsLobbyUpdate', onLobby);
      socket.off('rpsMatchUpdate', onMatch);
    };
  }, [socket, fetchInventory]);

  const request = useCallback(async (path, body, action) => {
    setBusy(action);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/rps${path}`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body || {}) });
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
    setMatch(data.match || null);
    setModal(null);
    showPopup(data.match?.status === 'waiting' ? 'RPS bet posted. Waiting for a challenger.' : 'RPS bet joined. Pick your side!', 'success');
    if (data.match?.status === 'playing') playCoinflipJoin();
    refresh();
  };

  const chooseMove = async (choice) => {
    if (!match || match.status !== 'playing') return;
    const data = await request(`/matches/${match.id}/choice`, { choice }, choice);
    if (data) {
      setMatch(data.match);
      if (data.waitingForOpponent) showPopup('Side picked — waiting for your opponent.', 'info');
      if (data.match?.status === 'completed') {
        await fetchInventory();
        showPopup(data.match.winnerId === user?.id ? 'You won the RPS pot!' : data.match.winnerId ? 'Your opponent won the pot.' : 'The pot was returned after a draw.', data.match.winnerId === user?.id ? 'success' : 'info');
      }
    }
  };

  const leaveMatch = async () => {
    const data = await request(`/matches/${match.id}/cancel`, {}, 'cancel');
    if (data) {
      setMatch(null);
      showPopup(data.cancelled ? 'You left the RPS bet.' : 'Bet updated.', 'info');
      refresh();
    }
  };

  const viewerSide = match?.viewerSide || (match?.playerOne?.id === user?.id ? 'one' : match?.playerTwo?.id === user?.id ? 'two' : null);
  const viewer = viewerSide === 'one' ? match?.playerOne : viewerSide === 'two' ? match?.playerTwo : null;
  const viewerChoice = viewer?.choice || null;
  const lastRound = match?.lastRound;
  const revealedOne = match?.status === 'completed' ? lastRound?.playerOneChoice : null;
  const revealedTwo = match?.status === 'completed' ? lastRound?.playerTwoChoice : null;
  const roundWinnerIsViewer = !!lastRound?.winnerId && lastRound.winnerId === viewer?.id;
  const roundIsDraw = lastRound?.result === 'draw';
  const matchWinnerIsViewer = match?.status === 'completed' && match.winnerId === user?.id;
  const openChallenges = useMemo(() => (lobby.matches || []).filter((challenge) => challenge.playerOne?.id !== user?.id), [lobby.matches, user?.id]);
  const openValue = openChallenges.reduce((sum, challenge) => sum + Number(challenge.creatorValue || 0), 0);

  if (loading) return <div className="cf-loading"><div className="loading-spinner" /><p>Loading RPS bets...</p></div>;

  return (
    <div className="cf-page rps-page">
      <div className="cf-topbar">
        <div className="cf-topbar-tabs">
          <Link to="/coinflip" className="cf-tab"><span className="cf-tab-label"><Icon name="coin" size={12} /> Coinflip</span></Link>
          <Link to="/jackpot" className="cf-tab"><span className="cf-tab-label"><Icon name="jackpot" size={12} /> Jackpot</span></Link>
          <button className="cf-tab cf-tab-active"><span className="cf-tab-label"><Icon name="rpsScissors" size={12} /> RPS</span><span className="cf-tab-count">{openChallenges.length}</span></button>
          <span className="cf-tab-divider" />
          <button className="cf-tab cf-tab-disabled" disabled title="Coming soon"><span className="cf-tab-label"><Icon name="shop" size={12} /> Market</span></button>
          <button className="cf-tab cf-tab-disabled" disabled title="Coming soon"><span className="cf-tab-label"><Icon name="flag" size={12} /> Race</span></button>
        </div>
        <div className="cf-topbar-right">
          <div className="cf-topbar-stat"><span className="cf-dice-icon"><Icon name="rpsScissors" size={13} /></span><span>{openChallenges.length} open</span></div>
          <div className="cf-topbar-stat"><span className="cf-diamond-icon"><Icon name="diamond" size={12} /></span><span>{compact(openValue)}</span></div>
          <button className="cf-topbar-btn cf-topbar-btn-gold" onClick={openCreateModal} disabled={inventoryLoading}><Icon name="plus" size={13} /> Bet Items</button>
        </div>
      </div>

      {error && <div className="rps-error" role="alert"><Icon name="warn" size={15} /><span>{error}</span><button type="button" onClick={refresh}>Retry</button></div>}

      <div className="cf-lobby">
        {match ? (
          <div className="rps-active-panel">
            <div className="rps-active-head">
              <div><span className="cf-join-vs-label">ACTIVE RPS BET</span><strong>Round {match.round}</strong></div>
              <div className="rps-active-value"><span className="cf-diamond-sm"><Icon name="diamond" size={12} /></span> {compact(match.potValue)} AMP <small>Join range {compact(match.minJoinValue)}–{compact(match.maxJoinValue)}</small></div>
            </div>
            <div className="rps-players-row">
              <RpsPlayerBlock player={match.playerOne} isViewer={viewerSide === 'one'} winner={match.winnerId === match.playerOne.id} picked={!!match.playerOne.picked} choice={match.playerOne.choice} revealedChoice={revealedOne} />
              <span className="cf-row-vs">VS</span>
              <RpsPlayerBlock player={match.playerTwo} isViewer={viewerSide === 'two'} winner={match.winnerId === match.playerTwo?.id} picked={!!match.playerTwo?.picked} choice={match.playerTwo?.choice} revealedChoice={revealedTwo} />
            </div>

            {match.status === 'waiting' && <div className="rps-waiting-bar"><div><strong>Waiting for a challenger</strong><span>Join with {compact(match.minJoinValue)}–{compact(match.maxJoinValue)} AMP. No side is picked yet.</span></div><button className="cf-cancel-btn" onClick={leaveMatch} disabled={busy === 'cancel'}>Cancel Bet</button></div>}

            {match.status === 'playing' && <div className="rps-choice-area"><div className="cf-join-bet-items-title">CHOOSE YOUR SIDE <span>{viewerChoice ? 'Side locked — waiting for opponent' : 'Your choice stays hidden'}</span></div><div className="rps-choice-row">{MOVES.map((move) => <button type="button" key={move.id} className={`rps-choice-tile ${viewerChoice === move.id ? 'selected' : ''}`} onClick={() => chooseMove(move.id)} disabled={!!viewerChoice || busy === move.id}><Icon name={move.icon} size={27} /><strong>{move.label}</strong><small>{move.hint}</small>{viewerChoice === move.id && <span className="rps-choice-check"><Icon name="check" size={11} /></span>}</button>)}</div>{lastRound && <div className={`cf-view-result-text rps-round-result ${roundIsDraw ? 'draw' : roundWinnerIsViewer ? 'win' : 'loss'}`}><Icon name={roundIsDraw ? 'info' : roundWinnerIsViewer ? 'trophy' : 'warn'} size={13} /><span>{roundIsDraw ? `Round ${lastRound.round} draw` : roundWinnerIsViewer ? `You won round ${lastRound.round}` : `Round ${lastRound.round} lost`}</span><strong>{lastRound.playerOneChoice?.toUpperCase()} · {lastRound.playerTwoChoice?.toUpperCase()}</strong></div>}</div>}

            {match.status === 'completed' && <div className="rps-result-bar"><Icon name={matchWinnerIsViewer ? 'trophy' : match.winnerId ? 'flag' : 'info'} size={18} /><div><strong>{matchWinnerIsViewer ? 'Victory' : match.winnerId ? 'Good game' : 'Draw'}</strong><span>{matchWinnerIsViewer ? `You won ${match.playerOne.wins}–${match.playerTwo.wins}.` : match.winnerId ? `Final score ${match.playerOne.wins}–${match.playerTwo.wins}.` : 'Both wagers returned.'}</span></div><small>Pot {compact(match.potValue)} · Tax {compact(match.taxAmount)} AMP</small></div>}
            {match.status !== 'completed' && <button className="rps-leave-link" onClick={leaveMatch} disabled={busy === 'cancel'}>Leave bet</button>}
          </div>
        ) : openChallenges.length > 0 ? openChallenges.map((challenge) => <RpsLobbyRow key={challenge.id} challenge={challenge} onJoin={openJoinModal} />) : (
          <div className="cf-empty"><div className="cf-empty-icon"><Icon name="rpsScissors" size={34} /></div><p>No active RPS bets</p><p className="cf-empty-sub">Post an item bet to get started!</p><button className="cf-topbar-btn cf-topbar-btn-gold" onClick={openCreateModal}><Icon name="plus" size={13} /> Create RPS Bet</button></div>
        )}
      </div>

      {modal && <CreateCoinflipModal gameType={modal.type} match={modal.match} userInventory={inventory} onClose={() => setModal(null)} onCreated={handleBetCreated} />}
      <AnimatedPopup show={popup.show} message={popup.message} type={popup.type} onClose={() => setPopup((current) => ({ ...current, show: false }))} />
    </div>
  );
};

export default RpsPage;
