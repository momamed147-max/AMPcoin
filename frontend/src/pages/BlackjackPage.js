import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AnimatedPopup from '../components/AnimatedPopup';
import { CoinLoader } from '../components/CoinChip';
import '../components/CoinChip.css';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import { playBetPlaced } from '../sound';
import './BlackjackPage.css';

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const json = () => ({ 'Content-Type': 'application/json', ...auth() });

const SUIT_CHAR = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const isRed = (suit) => suit === 'hearts' || suit === 'diamonds';
const stackValue = (it) => (Number(it.value) || 0) * (Number(it.quantity) || 1);

const RESULT_COPY = {
  blackjack: { text: 'Blackjack! Paid 3:2', tone: 'win' },
  win: { text: 'You win', tone: 'win' },
  dealer_bust: { text: 'Dealer busts - you win', tone: 'win' },
  push: { text: 'Push - wager returned', tone: 'push' },
  loss: { text: 'Dealer wins', tone: 'loss' },
  bust: { text: 'Bust - dealer takes the pot', tone: 'loss' }
};

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

const BlackjackPage = ({ socket }) => {
  const [inventory, setInventory] = useState([]);
  const [wager, setWager] = useState({});
  const [game, setGame] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('play');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [popup, setPopup] = useState({ show: false, message: '', type: 'info' });
  const [seq, setSeq] = useState(0); // bumps to replay the deal animation

  const say = (message, type = 'info') => setPopup({ show: true, message, type });

  const loadInventory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users/inventory`, { headers: auth() });
      if (res.ok) {
        const d = await res.json();
        setInventory(Array.isArray(d) ? d : d.items || []);
      }
    } catch { /* shown as an empty inventory */ }
  }, []);

  const loadHistory = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/user/${userId}/history`, { headers: auth() });
      if (res.ok) setHistory(await res.json());
    } catch { /* history is optional */ }
  }, []);

  useEffect(() => {
    (async () => {
      await loadInventory();
      try {
        const me = JSON.parse(localStorage.getItem('user') || '{}');
        await loadHistory(me.id || me.userId);
      } catch { /* ignore */ }
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => loadInventory();
    socket.on('inventoryUpdate', refresh);
    socket.on('balanceUpdate', refresh);
    return () => {
      socket.off('inventoryUpdate', refresh);
      socket.off('balanceUpdate', refresh);
    };
  }, [socket, loadInventory]);

  const wagerItems = useMemo(
    () => inventory.filter((i) => (wager[i.itemId || i.id] || 0) > 0)
      .map((i) => ({ itemId: i.itemId || i.id, name: i.name, quantity: wager[i.itemId || i.id] })),
    [inventory, wager]
  );
  const wagerValue = wagerItems.reduce((s, i) => {
    const item = inventory.find((x) => (x.itemId || x.id) === i.itemId);
    return s + stackValue({ ...item, quantity: i.quantity });
  }, 0);

  const inHand = !!game && game.status === 'in_progress';
  const finished = !!game && game.status !== 'in_progress';

  const startGame = async () => {
    if (!wagerItems.length || inHand || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/start`, {
        method: 'POST', headers: json(), body: JSON.stringify({ selectedItems: wagerItems })
      });
      const d = await res.json();
      if (!res.ok) return say(d.message || 'Could not start the game', 'error');

      setWager({});
      setDealing(true);
      setSeq((s) => s + 1);
      setGame(d);
      playBetPlaced();
      await new Promise((r) => setTimeout(r, 750));
      setDealing(false);
      await loadInventory();
    } catch {
      say('Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  };

  const hit = async () => {
    if (!inHand || busy) return;
    setBusy(true);
    setDealing(true);
    setSeq((s) => s + 1);
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/${game.gameId}/hit`, {
        method: 'POST', headers: json(), body: '{}'
      });
      const d = await res.json();
      if (!res.ok) return say(d.message || 'Could not draw', 'error');
      await new Promise((r) => setTimeout(r, 600));
      setGame(d);
      await loadInventory();
    } catch {
      say('Something went wrong', 'error');
    } finally {
      setDealing(false);
      setBusy(false);
    }
  };

  const stand = async () => {
    if (!inHand || busy) return;
    setBusy(true);
    setDealing(true);
    setSeq((s) => s + 1);
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/${game.gameId}/stand`, {
        method: 'POST', headers: json(), body: '{}'
      });
      const d = await res.json();
      if (!res.ok) return say(d.message || 'Could not stand', 'error');
      await new Promise((r) => setTimeout(r, 700));
      setGame(d);
      await Promise.all([loadInventory(), loadHistory(JSON.parse(localStorage.getItem('user') || '{}').id)]);
      const copy = RESULT_COPY[d.result];
      if (copy) say(copy.text, copy.tone === 'win' ? 'success' : copy.tone === 'loss' ? 'error' : 'info');
    } catch {
      say('Something went wrong', 'error');
    } finally {
      setDealing(false);
      setBusy(false);
    }
  };

  const setQty = (itemId, qty) => setWager((prev) => {
    const next = { ...prev };
    if (qty > 0) next[itemId] = qty; else delete next[itemId];
    return next;
  });

  if (loading) {
    return <div className="bj-page"><div className="bj-loading"><CoinLoader size={84} label="Loading blackjack..." /></div></div>;
  }

  const playerHand = game?.playerHand || [];
  const dealerHand = game?.dealerHand || [];
  const playerBJ = playerHand.length === 2 && game?.playerValue === 21;
  const dealerBJ = dealerHand.length === 2 && game?.dealerValue === 21;
  const result = finished ? RESULT_COPY[game.result] : null;

  return (
    <div className="bj-page">
      <AnimatedPopup
        show={popup.show} message={popup.message} type={popup.type}
        onClose={() => setPopup({ show: false, message: '', type: 'info' })}
      />

      <div className="bj-tabs">
        <button className={`bj-tab ${activeTab === 'play' ? 'active' : ''}`} onClick={() => setActiveTab('play')}>
          <Icon name="jackpot" size={15} /> Table
        </button>
        <button className={`bj-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <Icon name="board" size={15} /> History
        </button>
      </div>

      {activeTab === 'play' ? (
        <div className="bj-grid">
          <div className="bj-table">
            {/* dealer */}
            <div className="bj-hand-row">
              <div className="bj-hand-label">
                <span className="bj-name">Dealer</span>
                <span className={`bj-total ${game ? '' : 'muted'}`}>
                  {game ? (game.dealerValue + (inHand ? '+?' : '')) : '-'}
                </span>
              </div>
              <div className="bj-cards" key={`d${seq}`}>
                {dealerHand.length === 0 && <span className="bj-empty-cards">waiting for a wager</span>}
                {dealerHand.map((c, i) => (
                  <Card
                    key={i} card={c} index={i}
                    hidden={inHand && i === 1}
                    highlight={finished && dealerBJ}
                    dimmed={finished && !dealerBJ && game.result !== 'push'}
                  />
                ))}
              </div>
            </div>

            <div className="bj-divider" />

            {/* player */}
            <div className="bj-hand-row">
              <div className="bj-hand-label">
                <span className="bj-name">You</span>
                <span className={`bj-total ${game ? '' : 'muted'}`}>{game ? game.playerValue : '-'}</span>
              </div>
              <div className="bj-cards" key={`p${seq}`}>
                {playerHand.length === 0 && <span className="bj-empty-cards">wager some pets to deal</span>}
                {playerHand.map((c, i) => (
                  <Card
                    key={i} card={c} index={i}
                    highlight={playerBJ || (finished && (game.result === 'win' || game.result === 'dealer_bust'))}
                    dimmed={finished && game.result !== 'push' && !playerBJ && game.result !== 'win' && game.result !== 'dealer_bust'}
                  />
                ))}
              </div>
            </div>

            {result && (
              <div className={`bj-result ${result.tone}`}>
                <strong>{result.text}</strong>
                {game.profit > 0 && <span>+{game.profit.toLocaleString()} AMP</span>}
                {game.profit < 0 && <span>{game.profit.toLocaleString()} AMP</span>}
                {game.profit === 0 && <span>wager returned</span>}
                {game.tax > 0 && <span className="bj-tax">includes {game.tax.toLocaleString()} tax</span>}
              </div>
            )}

            <div className="bj-actions">
              {!game && (
                <button className="bj-btn" disabled={!wagerItems.length || busy} onClick={startGame}>
                  Deal
                </button>
              )}
              {inHand && (
                <>
                  <button className="bj-btn" disabled={busy || dealing} onClick={hit}>Hit</button>
                  <button className="bj-btn secondary" disabled={busy || dealing} onClick={stand}>Stand</button>
                </>
              )}
              {finished && (
                <button className="bj-btn" onClick={() => { setGame(null); setSeq((s) => s + 1); }}>
                  New hand
                </button>
              )}
            </div>

            <div className="bj-hint">
              Blackjack pays 3:2. Dealer stands on 17, including soft 17.
            </div>
          </div>

          <div className="bj-panel">
            <h3>Your wager <span className="bj-count">{wagerItems.length ? `${wagerItems.length} picked` : ''}</span></h3>
            <p className="bj-panel-sub">These pets are risked. Win and they come back plus a cash profit.</p>
            <div className="bj-list">
              {inventory.length === 0 && <div className="bj-empty">No pets in your inventory.</div>}
              {inventory.map((i) => {
                const id = i.itemId || i.id;
                const avail = Number(i.quantity) || 1;
                const qty = wager[id] || 0;
                return (
                  <div key={id} className={`bj-item ${qty > 0 ? 'picked' : ''}`}>
                    <img
                      className="bj-item-img" src={i.image || i.imageUrl || '/default-item.png'} alt=""
                      onError={(e) => { e.target.style.visibility = 'hidden'; }}
                    />
                    <div className="bj-item-body">
                      <span className="bj-item-name">{i.name || i.itemName}</span>
                      <span className="bj-item-val">
                        <Icon name="diamond" size={11} /> {(Number(i.value) || 0).toLocaleString()} each
                      </span>
                    </div>
                    <div className="bj-stepper">
                      <button type="button" onClick={() => setQty(id, qty - 1)} disabled={qty <= 0}>-</button>
                      <span className={qty > 0 ? 'on' : ''}>{qty}</span>
                      <button type="button" onClick={() => setQty(id, qty + 1)} disabled={qty >= avail}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="bj-total">
              <span>Total wager</span>
              <span><Icon name="diamond" size={13} /> {wagerValue.toLocaleString()}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="bj-history">
          {history.length === 0 && <div className="bj-empty">No hands played yet.</div>}
          {history.slice(0, 30).map((h) => {
            const copy = RESULT_COPY[h.result] || { text: h.result, tone: 'loss' };
            return (
              <div key={h.id} className={`bj-history-row ${copy.tone}`}>
                <div className="bj-history-cards">
                  {(h.playerHand || []).slice(0, 5).map((c, i) => (
                    <span key={i} className={`bj-mini ${isRed(c.suit) ? 'red' : 'black'}`}>
                      {c.rank}{SUIT_CHAR[c.suit]}
                    </span>
                  ))}
                </div>
                <div className="bj-history-body">
                  <span className="bj-history-outcome">{copy.text}</span>
                  <span className="bj-history-detail">
                    <Icon name="diamond" size={10} /> {Number(h.betValue || 0).toLocaleString()} wagered
                  </span>
                </div>
                <span className="bj-history-profit">
                  {h.profit > 0 ? '+' : ''}{Number(h.profit || 0).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BlackjackPage;
