import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import AnimatedPopup from '../components/AnimatedPopup';
import ModalPortal from '../components/ModalPortal';
import CreateCoinflipModal from '../components/CreateCoinflipModal';
import ModBadges from '../components/ModBadges';
import PetTooltip from '../components/PetTooltip';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import { useAuth } from '../context/AuthContext';
import { playBetPlaced, playCoinflipJoin } from '../sound';
// Same shell and row anatomy as Coinflip/RPS. Blackjack is an open bet, not a
// separate table screen: it has the shared game tabs, lobby rows, join modal and
// view modal. CoinflipPage.css supplies the row action/button styling that
// lobby.css deliberately leaves to the pages.
import '../ui/lobby.css';
import './CoinflipPage.css';
import './BlackjackPage.css';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const json = () => ({ 'Content-Type': 'application/json', ...authHeaders() });

const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return v.toLocaleString();
};

const SUIT_CHAR = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const isRed = (suit) => suit === 'hearts' || suit === 'diamonds';

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

const RESULT_COPY = {
  blackjack: { text: 'Blackjack! Paid 3:2', tone: 'win' },
  win: { text: 'You beat the dealer', tone: 'win' },
  dealer_bust: { text: 'Dealer busts - you win', tone: 'win' },
  push: { text: 'Push - wager returned', tone: 'push' },
  loss: { text: 'Dealer takes the pot', tone: 'loss' },
  bust: { text: 'Bust - the dealer takes the pot', tone: 'loss' },
  dealer_blackjack: { text: 'Dealer blackjack - you lose', tone: 'loss' }
};

const DEALER_WINS = ['loss', 'bust', 'dealer_blackjack'];
const PLAYER_WINS = ['win', 'blackjack', 'dealer_bust'];

const dealerResultMessage = (bet) => {
  if (!bet) return 'Hand over';
  if (bet.result === 'push') return 'Push - both wagers returned';
  if (bet.result === 'dealer_blackjack') return 'Dealer blackjack - you win';
  if (PLAYER_WINS.includes(bet.result)) return 'The player beat you - the pot is theirs';
  return 'You take the pot';
};

const timeAgo = (stamp) => {
  const ms = Date.now() - new Date(stamp || Date.now()).getTime();
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

/* ─── One card ─── */
function Card({ card, index = 0, hidden, highlight, dimmed }) {
  if (!card) return null;
  if (hidden || card.rank === 'hidden') {
    return <div className="bj-card back" style={{ '--i': index }}><span className="bj-back-mark" /></div>;
  }
  const red = isRed(card.suit);
  return (
    <div
      className={`bj-card face ${red ? 'red' : 'black'} ${highlight ? 'highlight' : ''} ${dimmed ? 'dimmed' : ''}`}
      style={{ '--i': index }}
    >
      <span className="bj-corner tl">{card.rank}<i>{SUIT_CHAR[card.suit]}</i></span>
      <span className="bj-pip">{SUIT_CHAR[card.suit]}</span>
      <span className="bj-corner br">{card.rank}<i>{SUIT_CHAR[card.suit]}</i></span>
    </div>
  );
}

/* ─── One hand. `seq` restarts the deal animation when new cards land. ─── */
function Hand({ cards, seq, total, label, sub, hiddenIndex, highlight = [], dimmed, empty }) {
  return (
    <div className="bj-hand-row">
      <div className="bj-hand-label">
        <span className="bj-name">{label}</span>
        {sub && <span className="bj-hand-sub">{sub}</span>}
        <span className={`bj-total ${cards.length ? '' : 'muted'}`}>
          {cards.length ? total : '-'}
        </span>
      </div>
      <div className="bj-cards" key={seq}>
        {cards.length === 0 && <span className="bj-empty-cards">{empty}</span>}
        {cards.map((c, i) => (
          <Card
            key={`${seq}-${i}`}
            card={c}
            index={i}
            hidden={hiddenIndex === i}
            highlight={highlight.includes(i)}
            dimmed={dimmed && !highlight.includes(i)}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Item thumbnails, same row component RPS uses ─── */
function ItemThumbs({ items = [], limit = 4 }) {
  const visible = items.slice(0, limit);
  return (
    <>
      {visible.map((item, index) => (
        <div
          className="cf-row-thumb-wrap cf-tip-host"
          key={`${item.itemId || item.id}-${index}`}
          data-tip={item.name || item.itemName || 'Item'}
        >
          <img
            className="cf-row-thumb"
            src={item.image || item.imageUrl || '/default-item.svg'}
            alt={item.name || item.itemName || 'item'}
            onError={(event) => { event.currentTarget.src = '/default-item.svg'; }}
          />
          <span className="cf-row-thumb-rarity" style={{ background: rarityColor(item.rarity) }} />
          <span className="cf-tip-pop"><PetTooltip item={item} /></span>
        </div>
      ))}
      {items.length > limit && <span className="cf-row-more">+{items.length - limit}</span>}
    </>
  );
}

function ViewerItems({ items = [], side, empty }) {
  if (!items.length) return <div className="cf-view-noitems">{empty}</div>;
  return items.map((item, index) => (
    <div
      key={`${side}-${item.itemId || item.id}-${index}`}
      className="cf-view-item-row cf-tip-host"
      data-tip={item.name || item.itemName || 'Item'}
    >
      <img
        src={item.image || item.imageUrl || '/default-item.svg'}
        alt={item.name || 'item'}
        className="cf-view-item-icon"
        onError={(event) => { event.currentTarget.src = '/default-item.svg'; }}
      />
      <span className="cf-view-item-name">
        {item.name || item.itemName || 'Item'}{(item.quantity || 1) > 1 ? ` ×${item.quantity}` : ''}
      </span>
      <ModBadges mods={item.mods} size={15} />
      <span className="cf-view-item-val">
        <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span>{' '}
        {((item.value || 0) * (item.quantity || 1)).toLocaleString()}
      </span>
      <span className="cf-tip-pop"><PetTooltip item={item} /></span>
    </div>
  ));
}

/* ─── Lobby row: the same skeleton as a Coinflip/RPS open bet ─── */
function BlackjackRow({ bet, onJoin, onView, onBot, isSelf, busy }) {
  const waiting = bet.status === 'waiting';
  const live = bet.status === 'in_progress';
  const dealer = bet.dealerSeat || {};
  const player = bet.playerSeat || {};
  const hasDealer = !!dealer.id;
  const hasPlayer = !!player.id;
  const pot = Number(bet.potValue) || (Number(bet.creatorValue || 0) + Number(bet.opponentValue || 0));

  return (
    <div className={`cf-row bj-lobby-row ${live ? 'bj-row-live' : ''}`}>
      <div className="cf-row-players">
        <div className="cf-row-player">
          <div className={`cf-row-avatar-ring ${hasDealer ? 'ring-heads' : ''}`}>
            {hasDealer ? (
              <img
                className="cf-row-avatar"
                src={dealer.avatar || '/default-avatar.svg'}
                alt={dealer.username || 'Dealer'}
                onError={(event) => { event.currentTarget.src = '/default-avatar.svg'; }}
              />
            ) : (
              <div className="cf-row-avatar cf-row-avatar-empty">?</div>
            )}
            <span className="cf-row-chip-badge"><Icon name="card" size={18} /></span>
          </div>
          <span className={`cf-row-player-name ${hasDealer ? '' : 'is-waiting'}`} title={dealer.username || 'Open seat'}>
            {hasDealer ? dealer.username : 'Open seat'}
          </span>
        </div>
        <span className="cf-row-vs">VS</span>
        <div className="cf-row-player">
          <div className={`cf-row-avatar-ring ${hasPlayer ? 'ring-tails' : ''}`}>
            {hasPlayer ? (
              <img
                className="cf-row-avatar"
                src={player.avatar || '/default-avatar.svg'}
                alt={player.username || 'Player'}
                onError={(event) => { event.currentTarget.src = '/default-avatar.svg'; }}
              />
            ) : (
              <div className="cf-row-avatar cf-row-avatar-empty">?</div>
            )}
            <span className="cf-row-chip-badge"><Icon name="card" size={18} /></span>
          </div>
          <span className={`cf-row-player-name ${hasPlayer ? '' : 'is-waiting'}`} title={player.username || 'Open seat'}>
            {hasPlayer ? player.username : 'Open seat'}
          </span>
        </div>
      </div>

      <div className="cf-row-items">
        <ItemThumbs items={bet.dealerItems || []} limit={4} />
        {(bet.dealerItems || []).length > 0 && (bet.playerItems || []).length > 0 && (
          <span className="bj-row-vs-divider">+</span>
        )}
        <ItemThumbs items={bet.playerItems || []} limit={4} />
      </div>

      <div className="cf-row-value">
        <div className="cf-row-total">
          <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {compact(pot)}
        </div>
        <div className="cf-row-range">
          {waiting
            ? (isSelf ? 'Waiting for a dealer' : `Join ${compact(bet.minJoinValue)}-${compact(bet.maxJoinValue)}`)
            : live
              ? (bet.viewerIsPlayer || bet.viewerIsDealer
                ? `Hand live · ${bet.playerValue || 0} vs ${bet.dealerValue || 0}`
                : 'Hand in progress')
              : 'Hand complete'}
        </div>
        <div className="cf-row-cap">Blackjack 3:2</div>
      </div>

      <div className="cf-row-action">
        {waiting && isSelf && (
          <div className="cf-row-own-btns">
            <button
              className="cf-bot-btn"
              onClick={() => onBot(bet)}
              disabled={busy === 'bot'}
              title="Let the house dealer take the other seat"
            >
              {busy === 'bot' ? '...' : 'Bot'}
            </button>
            <button className="cf-view-btn" onClick={() => onView(bet)}>View</button>
          </div>
        )}
        {waiting && !isSelf && <button className="cf-join-btn" onClick={() => onJoin(bet)}>Join</button>}
        {!waiting && (
          <button className="cf-view-btn" onClick={() => onView(bet)}>
            {live && (bet.viewerIsPlayer || bet.viewerIsDealer) ? 'Continue' : 'View'}
          </button>
        )}
      </div>
    </div>
  );
}

const BlackjackPage = ({ socket }) => {
  const { user } = useAuth();
  const [lobby, setLobby] = useState({ bets: [], activeCount: 0 });
  const [myBet, setMyBet] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [popup, setPopup] = useState({ show: false, message: '', type: 'info' });
  const [seq, setSeq] = useState(0);

  const showPopup = useCallback(
    (message, type = 'info') => setPopup({ show: true, message, type }),
    []
  );

  const fetchInventory = useCallback(async () => {
    if (!user?.id) return;
    setInventoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/inventory/${encodeURIComponent(user.id)}`, {
        headers: authHeaders()
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setInventory(Array.isArray(d.items) ? d.items : []);
    } finally {
      setInventoryLoading(false);
    }
  }, [user?.id]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Blackjack bets unavailable (${res.status})`);
      const d = await res.json();
      const list = Array.isArray(d) ? d : (d.bets || d.tables || []);
      setLobby({ bets: list, activeCount: list.filter((b) => b.status === 'waiting').length });
      setMyBet((cur) => {
        const mine = d.myBet || d.myTable;
        if (mine) return mine;
        // Keep a just-settled hand up briefly so the result stays readable
        // instead of vanishing on the next poll.
        if (cur?.status === 'completed'
          && Date.now() - new Date(cur.updatedAt || Date.now()).getTime() < 4 * 60 * 1000) return cur;
        return null;
      });
      setError('');
    } catch (e) {
      setError(e.message || 'Blackjack bets unavailable');
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([refresh(), fetchInventory()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onBets = () => refresh();
    const onInv = () => fetchInventory();
    socket.on('blackjackTables', onBets);
    socket.on('inventoryUpdate', onInv);
    return () => {
      socket.off('blackjackTables', onBets);
      socket.off('inventoryUpdate', onInv);
    };
  }, [socket, refresh, fetchInventory]);

  const openCreate = async () => {
    playBetPlaced();
    await fetchInventory();
    setModal({ mode: 'create' });
  };

  const openJoin = async (bet) => {
    playCoinflipJoin();
    await fetchInventory();
    setModal({ mode: 'join', bet });
  };

  const handleDone = (bet) => {
    setModal(null);
    if (!bet) return;
    setSeq((s) => s + 1);
    setMyBet(bet);
    setViewId(bet.id);
    if (bet.status === 'completed') {
      const dealerWon = DEALER_WINS.includes(bet.result);
      const message = bet.viewerIsDealer ? dealerResultMessage(bet) : (RESULT_COPY[bet.result]?.text || 'Hand over');
      const tone = bet.result === 'push' ? 'info' : (bet.viewerIsDealer ? dealerWon : !dealerWon) ? 'success' : 'error';
      showPopup(message, tone);
    } else {
      showPopup(
        bet.status === 'waiting'
          ? 'Bet posted. Waiting for a dealer to join.'
          : bet.viewerIsPlayer
            ? 'Cards dealt. Hit or stand to play your hand.'
            : 'Cards dealt. You are dealing — wait for the player.',
        'success'
      );
    }
    fetchInventory();
    refresh();
  };

  const request = useCallback(async (path, body, label) => {
    if (busy) return null;
    setBusy(label);
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables${path}`, {
        method: 'POST',
        headers: json(),
        body: JSON.stringify(body || {})
      });
      const d = await res.json();
      if (!res.ok) {
        showPopup(d.message || 'Blackjack action failed.', 'error');
        return null;
      }
      return d;
    } catch {
      showPopup('Something went wrong.', 'error');
      return null;
    } finally {
      setBusy('');
    }
  }, [busy, showPopup]);

  const hit = async () => {
    if (!myBet) return;
    setSeq((s) => s + 1);
    const d = await request(`/${myBet.id}/hit`, {}, 'hit');
    if (d) {
      setMyBet(d);
      setViewId(d.id);
      await fetchInventory();
      if (d.status === 'completed') {
        const copy = RESULT_COPY[d.result];
        if (copy) showPopup(copy.text, copy.tone === 'win' ? 'success' : copy.tone === 'loss' ? 'error' : 'info');
        refresh();
      }
    }
  };

  const stand = async () => {
    if (!myBet) return;
    setSeq((s) => s + 1);
    const d = await request(`/${myBet.id}/stand`, {}, 'stand');
    if (!d) return;
    setMyBet(d);
    setViewId(d.id);
    await fetchInventory();
    const copy = RESULT_COPY[d.result];
    if (copy) showPopup(copy.text, copy.tone === 'win' ? 'success' : copy.tone === 'loss' ? 'error' : 'info');
    refresh();
  };

  // The creator calls the house dealer onto their own waiting bet. The bot
  // joins server-side through the same seat function a human uses, takes the
  // DEALER seat, and leaves the creator as the player. The hand deliberately
  // stays in progress: the creator now has real Hit and Stand buttons.
  const callHouse = async (target = myBet) => {
    if (!target) return;
    setSeq((s) => s + 1);
    const d = await request(`/${target.id}/bot-join`, {}, 'bot');
    if (!d) return;
    setMyBet(d);
    setViewId(d.id);
    setSeq((s) => s + 1);
    await fetchInventory();
    refresh();
    if (d.status === 'completed') {
      const copy = RESULT_COPY[d.result];
      if (copy) showPopup(copy.text, copy.tone === 'win' ? 'success' : copy.tone === 'loss' ? 'error' : 'info');
    } else {
      showPopup('The house dealer joined. Hit or stand to play your hand.', 'success');
    }
  };

  const closeView = () => setViewId(null);

  if (loading) {
    return <div className="cf-loading"><div className="loading-spinner" /><p>Loading Blackjack...</p></div>;
  }

  const me = user?.id;
  // A completed hand stays visible so the result can be read, but it never
  // blocks posting or joining the next one. That matches Coinflip/RPS.
  const activeBet = myBet && myBet.status !== 'completed' ? myBet : null;
  // Like Coinflip, a finished hand stays in the list briefly so the result is
  // still reachable; it is never joinable.
  const openBets = lobby.bets.filter((b) => {
    if (b.status === 'waiting' || b.status === 'in_progress') return true;
    if (b.status !== 'completed') return false;
    if (!b.completedAt) return true;
    return Date.now() - new Date(b.completedAt).getTime() < 10 * 60 * 1000;
  });
  const viewBet = viewId
    ? (myBet && myBet.id === viewId
      ? myBet
      : lobby.bets.find((b) => b.id === viewId) || null)
    : null;

  return (
    <div className="cf-page bj-page">
      <AnimatedPopup
        show={popup.show} message={popup.message} type={popup.type}
        onClose={() => setPopup({ show: false, message: '', type: 'info' })}
      />

      <div className="cf-topbar">
        <div className="cf-topbar-tabs">
          <Link to="/coinflip" className="cf-tab"><span className="cf-tab-label"><Icon name="coin" size={12} /> Coinflip</span></Link>
          <Link to="/jackpot" className="cf-tab"><span className="cf-tab-label"><Icon name="jackpot" size={12} /> Jackpot</span></Link>
          <Link to="/rps" className="cf-tab"><span className="cf-tab-label"><Icon name="rpsScissors" size={12} /> RPS</span></Link>
          <button className="cf-tab cf-tab-active"><span className="cf-tab-label"><Icon name="card" size={12} /> Blackjack</span><span className="cf-tab-count">{lobby.activeCount}</span></button>
        </div>
        <div className="cf-topbar-right">
          <div className="cf-topbar-stat"><span className="cf-dice-icon"><Icon name="card" size={13} /></span><span>{lobby.activeCount} open</span></div>
          {activeBet && viewId !== activeBet.id && (
            <button className="cf-topbar-btn" onClick={() => setViewId(activeBet.id)}>
              <Icon name="target" size={13} /> Your bet
            </button>
          )}
          <button
            className="cf-topbar-btn cf-topbar-btn-gold"
            onClick={openCreate}
            disabled={inventoryLoading}
            title="Post a new blackjack bet as the player"
          >
            <Icon name="plus" size={13} /> Bet Items
          </button>
        </div>
      </div>

      {error && (
        <div className="bj-error" role="alert">
          <Icon name="warn" size={15} /><span>{error}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={refresh}>Retry</button>
        </div>
      )}

      {activeBet && (
        <div className="bj-active-note">
          <Icon name="target" size={14} />
          <span>
            {activeBet.status === 'waiting'
              ? (activeBet.viewerIsPlayer
                ? 'You are playing this hand — waiting for a dealer to join.'
                : 'This hand is waiting for a dealer.')
              : activeBet.viewerIsDealer
                ? 'You are dealing — the player is taking their turn.'
                : activeBet.viewerIsPlayer
                  ? 'You are playing — hit or stand to finish it.'
                  : 'This hand is in progress.'}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewId(activeBet.id)}>Open</button>
        </div>
      )}

      <div className="cf-lobby">
        {openBets.length > 0 ? openBets.map((bet) => (
          <BlackjackRow
            key={bet.id}
            bet={bet}
            isSelf={bet.creatorId === me}
            onJoin={openJoin}
            onView={(b) => setViewId(b.id)}
            onBot={callHouse}
            busy={busy}
          />
        )) : (
          <div className="cf-empty">
            <div className="cf-empty-icon"><Icon name="card" size={34} /></div>
            <p>No open blackjack bets</p>
            <p className="cf-empty-sub">Post an item wager and wait for a dealer — or let the house bot deal to you.</p>
            <button className="cf-topbar-btn cf-topbar-btn-gold" onClick={openCreate}>
              <Icon name="plus" size={13} /> Create Blackjack Bet
            </button>
          </div>
        )}
      </div>

      {viewBet && (() => {
        const dSeat = viewBet.dealerSeat || {};
        const pSeat = viewBet.playerSeat || {};
        const iDeal = dSeat.id === me;
        const iPlay = pSeat.id === me;
        const inHand = viewBet.status === 'in_progress';
        const waiting = viewBet.status === 'waiting';
        const finished = viewBet.status === 'completed';
        const pHand = viewBet.playerHand || [];
        const dHand = viewBet.dealerHand || [];
        const pBJ = pHand.length === 2 && viewBet.playerValue === 21;
        const dBJ = dHand.length === 2 && viewBet.dealerValue === 21;
        const result = finished ? RESULT_COPY[viewBet.result] : null;
        const dealerWon = finished && DEALER_WINS.includes(viewBet.result);
        const viewerTone = finished && iDeal && viewBet.result !== 'push'
          ? (dealerWon ? 'win' : 'loss')
          : result?.tone;
        const dealerHighlight = dBJ ? [0, 1] : (finished && dealerWon ? dHand.map((_, n) => n) : []);
        const playerHighlight = pBJ ? [0, 1] : (finished && !dealerWon && viewBet.result !== 'push' ? pHand.map((_, n) => n) : []);
        // Only the human in the player seat gets buttons. The house bot is
        // always the dealer now, so it never holds the player seat.
        const canAct = inHand && iPlay && !pSeat.isBot;

        return (
          <ModalPortal>
            <div className="cf-modal-overlay" onClick={closeView}>
              <div className="cf-modal cf-view-modal bj-view-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Blackjack bet">
                <button className="cf-modal-close" onClick={closeView} aria-label="Close bet"><Icon name="close" size={15} /></button>

                <div className="cf-view-top bj-view-top">
                  <div className="cf-view-player">
                    <div className={`cf-view-avatar-ring ${finished && dealerWon ? 'ring-winner' : ''} ring-heads`}>
                      {dSeat.avatar
                        ? <img className="cf-view-avatar" src={dSeat.avatar} alt="" onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
                        : <div className="cf-view-avatar cf-view-avatar-empty">{(dSeat.username || 'D').slice(0, 1).toUpperCase()}</div>}
                      <span className="cf-view-chip-badge"><Icon name="card" size={24} /></span>
                    </div>
                    <div className="cf-view-player-name">{dSeat.username || 'Dealer'}</div>
                    <div className="bj-seat-role">
                      dealer{dSeat.isBot ? ' · house' : ''}
                    </div>
                  </div>

                  <div className="cf-view-coin-area">
                    <div className="bj-view-seal">
                      <span className="bj-plaque-big">BLACKJACK</span>
                      <span className="bj-plaque-sub">pays {viewBet.blackjackPays || '3:2'}</span>
                    </div>
                  </div>

                  <div className="cf-view-player">
                    <div className={`cf-view-avatar-ring ${finished && dealerWon ? 'ring-lost' : finished && viewBet.result !== 'push' ? 'ring-winner' : ''} ring-tails`}>
                      {pSeat.avatar
                        ? <img className="cf-view-avatar" src={pSeat.avatar} alt="" onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
                        : <div className="cf-view-avatar cf-view-avatar-empty">?</div>}
                      <span className="cf-view-chip-badge"><Icon name="card" size={24} /></span>
                    </div>
                    <div className="cf-view-player-name">{pSeat.username || 'Open seat'}</div>
                    <div className="bj-seat-role">
                      player{pSeat.isBot ? ' · house' : ''}
                    </div>
                  </div>
                </div>

                <div className="bj-hand-board">
                  <Hand
                    seq={seq}
                    label="Dealer"
                    sub={dSeat.isBot ? 'house' : undefined}
                    total={viewBet.dealerValue + (inHand && !iDeal ? '+?' : '')}
                    cards={dHand}
                    // The dealer sees both cards. The player only sees the
                    // upcard, and a spectator sees the same as the player.
                    hiddenIndex={inHand && !iDeal ? 1 : -1}
                    highlight={dealerHighlight}
                    dimmed={finished && !dealerHighlight.length}
                    empty={waiting ? 'waiting for a dealer' : 'dealing'}
                  />

                  <Hand
                    seq={seq}
                    label="Player"
                    sub={pSeat.isBot ? 'house' : undefined}
                    total={viewBet.playerValue}
                    cards={pHand}
                    highlight={playerHighlight}
                    dimmed={finished && !playerHighlight.length}
                    empty={waiting ? 'waiting to deal' : 'dealing'}
                  />
                </div>

                <div className="cf-view-items-split bj-view-items">
                  <div className="cf-view-items-col">
                    <div className="bj-items-label">Dealer's wager</div>
                    <ViewerItems
                      items={viewBet.dealerItems || []}
                      side="dealer"
                      empty={waiting ? 'Waiting for a dealer to join...' : 'No items'}
                    />
                  </div>
                  <div className="cf-view-items-col">
                    <div className="bj-items-label">Player's wager</div>
                    <ViewerItems items={viewBet.playerItems || []} side="player" empty="No items" />
                  </div>
                </div>

                <div className="bj-house-note">
                  {viewBet.houseRule || 'Dealer stands on flat 17 and hits soft 17'}
                  {' · '}{Math.round((viewBet.houseEdge ?? 0.1) * 100)}% house edge
                </div>

                {result && (
                  <div className={`bj-result ${viewerTone || 'push'}`}>
                    <strong>{iDeal && result.tone !== 'push'
                      ? (dealerWon ? 'You take the pot' : 'The player beat you')
                      : result.text}</strong>
                    {iPlay && viewBet.profit > 0 && <span>+{viewBet.profit.toLocaleString()} AMP</span>}
                    {iPlay && viewBet.profit < 0 && <span>{viewBet.profit.toLocaleString()} AMP</span>}
                    {iPlay && viewBet.profit === 0 && <span>wager returned</span>}
                    {iPlay && viewBet.tax > 0 && <span className="bj-tax">includes {viewBet.tax.toLocaleString()} tax</span>}
                    {iPlay && viewBet.rake > 0 && <span className="bj-tax">+ {viewBet.rake.toLocaleString()} house edge</span>}
                    {iPlay && viewBet.bonusShortfall > 0 && (
                      <span className="bj-tax">
                        3:2 bonus rounded down {viewBet.bonusShortfall.toLocaleString()} by item value
                      </span>
                    )}
                    {iDeal && viewBet.dealerProfit > 0 && <span>+{viewBet.dealerProfit.toLocaleString()} AMP</span>}
                    {iDeal && viewBet.dealerProfit < 0 && <span>{viewBet.dealerProfit.toLocaleString()} AMP</span>}
                    {iDeal && viewBet.tax > 0 && <span className="bj-tax">includes {viewBet.tax.toLocaleString()} tax</span>}
                    {iDeal && viewBet.rake > 0 && <span className="bj-tax">+ {viewBet.rake.toLocaleString()} house edge</span>}
                  </div>
                )}

                <div className="cf-view-footer bj-view-footer">
                  <span className="cf-view-created">
                    {waiting ? `Waiting for a dealer${viewBet.timeoutSeconds > 0 ? ` · ${viewBet.timeoutSeconds}s` : ''}` : `Created ${timeAgo(viewBet.createdAt)}`}
                  </span>

                  {waiting && iPlay && (
                    <div className="cf-view-own-row">
                      <button className="cf-bot-btn" onClick={() => callHouse(viewBet)} disabled={busy === 'bot'}>
                        <Icon name="target" size={13} /> {busy === 'bot' ? 'Joining...' : 'Bot'}
                      </button>
                    </div>
                  )}
                  {waiting && !iPlay && !iDeal && (
                    <button className="cf-view-join-btn" onClick={() => { closeView(); openJoin(viewBet); }}>
                      Join Bet ({Number(viewBet.minJoinValue || 0).toLocaleString()}-{Number(viewBet.maxJoinValue || 0).toLocaleString()} AMP)
                    </button>
                  )}

                  {canAct && (
                    <div className="cf-view-own-row bj-action-row">
                      <button className="cf-join-action-btn" onClick={hit} disabled={busy === 'hit'}>
                        {busy === 'hit' ? 'Hitting...' : 'Hit'}
                      </button>
                      <button className="cf-view-join-btn" onClick={stand} disabled={busy === 'stand'}>
                        {busy === 'stand' ? 'Standing...' : 'Stand'}
                      </button>
                    </div>
                  )}

                  {inHand && iDeal && (
                    <span className="bj-footer-note">Waiting for the player to hit or stand...</span>
                  )}
                  {finished && <button className="cf-view-btn" onClick={closeView}>Close</button>}
                </div>
              </div>
            </div>
          </ModalPortal>
        );
      })()}

      {modal && (
        <CreateCoinflipModal
          gameType={modal.mode === 'join' ? 'blackjack-join' : 'blackjack'}
          match={modal.bet || null}
          userId={user?.id}
          socket={socket}
          userInventory={inventory}
          onClose={() => setModal(null)}
          onCreated={handleDone}
        />
      )}
    </div>
  );
};

export default BlackjackPage;
