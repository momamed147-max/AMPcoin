import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import AnimatedPopup from '../components/AnimatedPopup';
import { API_BASE } from '../apiConfig';

const BlackjackPage = ({ socket, setBalance }) => {
  const { user, refreshUser } = useAuth();
  const [gameState, setGameState] = useState('betting'); // betting, in_progress, completed
  const [inventory, setInventory] = useState([]);
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState('');
  const [playerHand, setPlayerHand] = useState([]);
  const [dealerHand, setDealerHand] = useState([]);
  const [gameId, setGameId] = useState(null);
  const [playerValue, setPlayerValue] = useState(0);
  const [dealerValue, setDealerValue] = useState(0);
  const [result, setResult] = useState('');
  const [lastPayout, setLastPayout] = useState(null); // { profit, tax, betValue }
  const [showFinalResult, setShowFinalResult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');

  const showCustomPopup = (message) => {
    setPopupMessage(message);
    setShowPopup(true);
    setTimeout(() => setShowPopup(false), 3000);
  };

  // Blackjack is parked for now
  useEffect(() => {
    showCustomPopup('Blackjack is not available yet');
  }, []);

  const ampBalance = user?.balance || 0;
  const inventoryValue = inventory.reduce(
    (s, it) => s + ((it.value || it.details?.value || 0) * (it.quantity || 1)),
    0
  );
  const wagerValue = selected.reduce(
    (s, it) => s + ((it.value || it.details?.value || 0) * (it.quantity || 1)),
    0
  );

  const fetchInventory = useCallback(async () => {
    if (!user) return;
    try {
      const identifier = user.id || user.robloxUsername;
      const res = await fetch(`${API_BASE}/api/users/inventory/${identifier}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setInventory(data.items || []);
      }
    } catch (e) {
      console.error('Blackjack inventory fetch failed:', e.message);
    }
  }, [user]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const toggleSelect = (item) => {
    if (gameState !== 'betting') return;
    const key = item.itemId || item.id;
    setSelected((prev) =>
      prev.some((i) => (i.itemId || i.id) === key)
        ? prev.filter((i) => (i.itemId || i.id) !== key)
        : [...prev, item]
    );
  };

  const applyResult = (data) => {
    if (data.playerHand) setPlayerHand(data.playerHand);
    if (data.dealerHand) setDealerHand(data.dealerHand);
    if (typeof data.playerValue === 'number') setPlayerValue(data.playerValue);
    else {
      // fall back to local calc below via effect-free compute
      setPlayerValue(calculateHandValue(data.playerHand || []));
    }
    if (typeof data.dealerValue === 'number') setDealerValue(data.dealerValue);
    else setDealerValue(calculateHandValue((data.dealerHand || []).filter((c) => c.rank !== 'hidden')));

    if (data.status === 'completed') {
      setGameState('completed');
      setResult(data.result || '');
      setLastPayout({ profit: data.profit || 0, tax: data.tax || 0, betValue: data.betValue || 0 });
      setTimeout(() => setShowFinalResult(true), 500);
      fetchInventory();
      if (refreshUser) refreshUser();
      if (socket) socket.emit('inventoryUpdate', { userId: user?.id });
    }
  };

  const calculateHandValue = (hand) => {
    if (!hand) return 0;
    let value = 0;
    let aces = 0;
    for (const card of hand) {
      if (!card || card.rank === 'hidden') continue;
      if (card.rank === 'A') {
        aces++;
        value += 11;
      } else if (['J', 'Q', 'K'].includes(card.rank)) {
        value += 10;
      } else {
        value += parseInt(card.rank);
      }
    }
    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }
    return value;
  };

  const startGame = async () => {
    showCustomPopup('Blackjack is not available yet');
  };

  const hit = async () => {
    if (!gameId || gameState !== 'in_progress') {
      setMessage('No active game');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/blackjack/${gameId}/hit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      const data = await response.json();

      if (response.ok) {
        applyResult(data);
      } else {
        setMessage(data.message || 'Error hitting');
      }
    } catch (error) {
      console.error('Error hitting:', error);
      setMessage('Error hitting');
    } finally {
      setBusy(false);
    }
  };

  const stand = async () => {
    if (!gameId || gameState !== 'in_progress') {
      setMessage('No active game');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/blackjack/${gameId}/stand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      const data = await response.json();

      if (response.ok) {
        applyResult(data);
      } else {
        setMessage(data.message || 'Error standing');
      }
    } catch (error) {
      console.error('Error standing:', error);
      setMessage('Error standing');
    } finally {
      setBusy(false);
    }
  };

  const resetGame = () => {
    setGameState('betting');
    setPlayerHand([]);
    setDealerHand([]);
    setPlayerValue(0);
    setDealerValue(0);
    setResult('');
    setMessage('');
    setGameId(null);
    setShowFinalResult(false);
    setLastPayout(null);
    setSelected([]);
    fetchInventory();
  };

  return (
    <div className="blackjack-page">
      <div className="card">
        <h2 className="card-title">Blackjack — wager ITEMS, win AMP</h2>

        <div className="game-controls">
          <div className="balance-display">
            AMP Balance: {Number(ampBalance).toLocaleString()} <span className="ampcoin-text">AMP</span>
          </div>
          <div className="balance-display">
            Inventory: {Number(inventoryValue).toLocaleString()} <span className="ampcoin-text">AMP</span>
          </div>
        </div>

        {message && (
          <div className="message">
            <p>{message}</p>
          </div>
        )}

        {gameState === 'betting' && (
          <div className="betting-area">
            <h3>Select items to wager {wagerValue > 0 && <span>({wagerValue.toLocaleString()} AMP)</span>}</h3>
            {inventory.length === 0 ? (
              <p className="no-items-text">You have no items in your inventory to wager.</p>
            ) : (
              <div className="inventory-grid">
                {inventory.map((item, index) => {
                  const key = item.itemId || item.id;
                  const isSelected = selected.some((i) => (i.itemId || i.id) === key);
                  return (
                    <div
                      key={`${key}-${index}`}
                      className={`inventory-item-selectable ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleSelect(item)}
                    >
                      <img
                        src={item.details?.imageUrl || item.image || item.imageUrl || '/default-item.png'}
                        alt={item.details?.name || item.name}
                        className="inventory-item-image"
                        onError={(e) => { e.target.src = '/default-item.png'; }}
                      />
                      <div className="inventory-item-info">
                        <div className="item-name">{item.details?.name || item.name}</div>
                        <div className="item-value">{(item.value || item.details?.value || 0)?.toLocaleString()} AMP</div>
                        <span className={`badge badge-${item.details?.rarity || item.rarity || 'common'}`}>
                          {item.details?.rarity || item.rarity || 'common'}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={`btn ${isSelected ? 'btn-danger' : 'btn-primary'} btn-sm select-toggle-btn`}
                      >
                        {isSelected ? 'Deselect' : 'Select'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="game-buttons" style={{ marginTop: '15px' }}>
              <button
                className="btn btn-primary"
                onClick={startGame}
                disabled={selected.length === 0 || busy}
              >
                {busy ? 'Dealing...' : `Deal Cards (${wagerValue.toLocaleString()} AMP wager)`}
              </button>
            </div>
            <p className="form-text">Win: items back + AMP profit • Blackjack pays 1.5x • Lose: items go to the house</p>
          </div>
        )}

        {(gameState === 'in_progress' || gameState === 'completed') && (
          <div className="game-area">
            <div className="dealer-section">
              <h3>Dealer: {gameState === 'completed' ? dealerValue : '?'}</h3>
              <div className="cards">
                {dealerHand.map((card, index) => (
                  <div key={index} className="card-item">
                    <div className="card-front">
                      {gameState === 'completed' || index === 0 ?
                        `${card.rank} of ${card.suit}` :
                        'Hidden'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="player-section">
              <h3>You: {playerValue}</h3>
              <div className="cards">
                {playerHand.map((card, index) => (
                  <div key={index} className="card-item">
                    <div className="card-front">
                      {`${card.rank} of ${card.suit}`}
                    </div>
                  </div>
                ))}
              </div>

              {gameState === 'in_progress' && (
                <div className="game-buttons">
                  <button className="btn btn-primary" onClick={hit} disabled={busy}>Hit</button>
                  <button className="btn btn-secondary" onClick={stand} disabled={busy}>Stand</button>
                </div>
              )}

              {(gameState === 'completed' && showFinalResult) && result && (
                <div className={`result-message ${result}`}>
                  <h3>
                    {(result === 'win' || result === 'dealer_bust') && 'You Win!'}
                    {result === 'loss' && 'Dealer Wins!'}
                    {result === 'bust' && 'Bust! Dealer Wins!'}
                    {result === 'push' && 'Push! (Tie)'}
                    {result === 'blackjack' && 'Blackjack!'}
                  </h3>
                  {lastPayout && (result === 'win' || result === 'dealer_bust' || result === 'blackjack') && (
                    <p>+{lastPayout.profit.toLocaleString()} AMP profit (items returned){lastPayout.tax > 0 && ` — ${lastPayout.tax.toLocaleString()} AMP house tax`}</p>
                  )}
                  {result === 'push' && <p>Wagered items returned</p>}
                  {(result === 'loss' || result === 'bust') && lastPayout && (
                    <p>Wagered items ({Math.abs(lastPayout.profit).toLocaleString()} AMP) went to the house</p>
                  )}
                  <button className="btn btn-primary" onClick={resetGame}>New Game</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showPopup && (
        <AnimatedPopup
          message={popupMessage}
          type="info"
          onClose={() => setShowPopup(false)}
        />
      )}
    </div>
  );
};

export default BlackjackPage;
