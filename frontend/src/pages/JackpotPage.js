import React, { useState, useEffect, useCallback, useRef } from 'react';
import AnimatedPopup from '../components/AnimatedPopup';
import { CoinLoader } from '../components/CoinChip';
import '../components/CoinChip.css';
import Icon from '../components/Icon';
import ModBadges from '../components/ModBadges';
import { API_BASE } from '../apiConfig';
import { playBetPlaced } from '../sound';
import '../components/ModBadges.css';
import './JackpotPage.css';

const JackpotPage = ({ socket, setBalance }) => {
  const [jackpot, setJackpot] = useState(null);
  const [history, setHistory] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [popup, setPopup] = useState({ show: false, message: '', type: 'info' });
  const [timer, setTimer] = useState(null);
  const [activeTab, setActiveTab] = useState('active'); // active, history
  const [spinId, setSpinId] = useState(null); // userId currently highlighted by the sweep
  const [spinning, setSpinning] = useState(false);
  const spinTimers = useRef([]);
  const prevStatus = useRef(null);

  const clearSpin = () => {
    spinTimers.current.forEach(clearTimeout);
    spinTimers.current = [];
  };

  useEffect(() => clearSpin, []);

  // Sweep animation: cycles through players, decelerates, lands on the winner
  const runSpin = useCallback((jp) => {
    const entries = jp.entries || [];
    if (entries.length < 2 || !jp.winnerId) return;
    clearSpin();
    setSpinning(true);
    const order = entries.map((e) => e.userId);
    // Keep the reveal readable even in a very large pot: sweep a representative
    // slice for at most a few seconds, then settle on the server-selected winner.
    const sweepOrder = order.slice(0, Math.min(order.length, 12));
    if (!sweepOrder.includes(jp.winnerId)) sweepOrder[sweepOrder.length - 1] = jp.winnerId;
    const cycles = sweepOrder.length <= 6 ? 2 : 1;
    const totalSteps = sweepOrder.length * cycles + 1;
    let t = 0;
    for (let s = 0; s < totalSteps; s++) {
      const uid = sweepOrder[s % sweepOrder.length];
      const progress = s / totalSteps;
      // ease-out: 70ms -> 420ms
      t += 70 + Math.pow(progress, 2.2) * 350;
      spinTimers.current.push(setTimeout(() => setSpinId(uid), t));
    }
    spinTimers.current.push(setTimeout(() => {
      setSpinId(jp.winnerId);
      setSpinning(false);
    }, t + 650));
  }, []);

  const showCustomPopup = (message, type = 'info') => {
    setPopup({ show: true, message, type });
  };

  // Fetch active jackpot
  const fetchJackpot = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/jackpot/active`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setJackpot(data);
        if (data && data.timerStartedAt && data.status === 'active') {
          const elapsed = Math.floor((Date.now() - new Date(data.timerStartedAt).getTime()) / 1000);
          const remaining = Math.max(0, (data.timerDuration || 90) - elapsed);
          setTimer(remaining);
        } else {
          setTimer(null);
        }
      }
    } catch (err) {
      console.error('Error fetching jackpot:', err);
    }
  }, []);

  // Fetch inventory
  const fetchInventory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users/inventory`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setInventory(Array.isArray(data) ? data : data.items || []);
      }
    } catch (err) {
      console.error('Error fetching inventory:', err);
    }
  }, []);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/jackpot/history`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Error fetching jackpot history:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchJackpot(), fetchInventory(), fetchHistory()])
      .finally(() => setLoading(false));
  }, [fetchJackpot, fetchInventory, fetchHistory]);

  // Timer countdown — when it hits zero, trigger the draw then refresh
  useEffect(() => {
    if (timer === null || timer <= 0) return;
    const interval = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) {
          clearInterval(interval);
          (async () => {
            try {
              if (jackpot && jackpot.id && jackpot.status === 'active') {
                await fetch(`${API_BASE}/api/jackpot/${jackpot.id}/resolve`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                });
              }
            } catch (_) { /* server auto-resolves anyway */ }
            fetchJackpot();
          })();
          return null;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timer, fetchJackpot, jackpot]);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;
    socket.on('jackpotUpdate', (data) => {
      const was = prevStatus.current;
      prevStatus.current = data ? data.status : null;
      setJackpot(data);
      if (data && data.status === 'completed' && data.winnerId && was !== 'completed') {
        runSpin(data);
      }
      if (data && (data.status === 'waiting' || data.status === 'active')) {
        clearSpin();
        setSpinning(false);
        setSpinId(null);
      }
      if (data && data.timerStartedAt && data.status === 'active') {
        const elapsed = Math.floor((Date.now() - new Date(data.timerStartedAt).getTime()) / 1000);
        const remaining = Math.max(0, (data.timerDuration || 90) - elapsed);
        setTimer(remaining);
      } else {
        setTimer(null);
      }
      fetchHistory();
    });
    socket.on('inventoryUpdate', () => {
      fetchInventory();
    });
    return () => {
      socket.off('jackpotUpdate');
      socket.off('inventoryUpdate');
    };
  }, [socket, fetchInventory, fetchHistory, runSpin]);

  // Toggle item selection
  const toggleItem = (item) => {
    setSelectedItems((prev) => {
      const exists = prev.find((p) => p.itemId === item.itemId);
      if (exists) return prev.filter((p) => p.itemId !== item.itemId);
      return [...prev, { itemId: item.itemId, name: item.name, quantity: 1 }];
    });
  };

  // Select all items
  const selectAll = () => {
    setSelectedItems(inventory.map((item) => ({
      itemId: item.itemId,
      name: item.name,
      quantity: 1
    })));
  };

  // Join jackpot
  const handleJoin = async () => {
    if (selectedItems.length === 0) return showCustomPopup('Select at least one item', 'error');
    setJoining(true);
    try {
      const res = await fetch(`${API_BASE}/api/jackpot/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ selectedItems })
      });
      const data = await res.json();
      if (res.ok) {
        playBetPlaced();
        showCustomPopup('Entered jackpot!', 'success');
        setSelectedItems([]);
        fetchJackpot();
        fetchInventory();
      } else {
        showCustomPopup(data.message || 'Failed to join', 'error');
      }
    } catch (err) {
      showCustomPopup('Server error joining jackpot', 'error');
    } finally {
      setJoining(false);
    }
  };

  const selectedValue = selectedItems.reduce((sum, sel) => {
    const item = inventory.find((i) => i.itemId === sel.itemId);
    return sum + (item ? item.value : 0);
  }, 0);

  const totalPotValue = jackpot ? jackpot.entries.reduce((s, e) => s + e.value, 0) : 0;

  if (loading) {
    return (
      <div className="jackpot-page">
        <div className="jp-loading">
          <CoinLoader size={84} label="Loading jackpot..." />
        </div>
      </div>
    );
  }

  return (
    <div className="jackpot-page">
      <AnimatedPopup show={popup.show} message={popup.message} type={popup.type} onClose={() => setPopup({ show: false, message: '', type: 'info' })} />

      {/* Top Tabs */}
      <div className="jp-tabs">
        <button className={`jp-tab ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          <Icon name="jackpot" size={15} /> Jackpot {jackpot?.entries?.length ? `(${jackpot.entries.length})` : ''}
        </button>
        <button className={`jp-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <Icon name="board" size={15} /> History
        </button>
      </div>

      {activeTab === 'active' ? (
        <div className="jp-active">
          {/* Winner banner (after the sweep lands) */}
          {jackpot && jackpot.status === 'completed' && jackpot.winnerUsername && !spinning && (
            <div className="jp-winner-banner">
              <Icon name="trophy" size={18} />
              <span><strong>{jackpot.winnerUsername}</strong> won the jackpot — <Icon name="diamond" size={13} /> {totalPotValue.toLocaleString()}</span>
            </div>
          )}
          {spinning && (
            <div className="jp-spinning-banner">
              <span className="jp-spin-dots"><span /><span /><span /></span> Drawing winner...
            </div>
          )}
          {/* Jackpot Wheel / Pot Display */}
          <div className="jp-pot-section">
            <div className="jp-wheel">
              <div className="jp-wheel-inner">
                <div className="jp-pot-value">
                  <span className="jp-diamond"><Icon name="diamond" size={16} /></span> {totalPotValue.toLocaleString()}
                </div>
                <div className="jp-pot-info">
                  {jackpot?.entries?.length || 0} players · {timer !== null ? `${timer}s` : 'Waiting...'}
                </div>
              </div>
              {/* Player avatars on wheel edge */}
              {jackpot?.entries?.map((entry, idx) => {
                const angle = (360 / Math.max(jackpot.entries.length, 1)) * idx - 90;
                const radius = 45;
                const x = 50 + radius * Math.cos((angle * Math.PI) / 180);
                const y = 50 + radius * Math.sin((angle * Math.PI) / 180);
                return (
                  <div
                    key={entry.userId}
                    className="jp-wheel-avatar"
                    style={{ left: `${x}%`, top: `${y}%` }}
                    title={`${entry.username} — ${entry.value.toLocaleString()}`}
                  >
                    <img
                      src={entry.avatar || `https://www.roblox.com/headshot-thumbnail/image?userId=${entry.userId}&width=100&height=100&format=png`}
                      alt={entry.username}
                      onError={(e) => { e.target.src = '/default-avatar.png'; }}
                    />
                  </div>
                );
              })}
            </div>
            {timer !== null && (
              <div className="jp-timer-bar">
                <div className="jp-timer-fill" style={{ width: `${(timer / 90) * 100}%` }}></div>
              </div>
            )}
          </div>

          {/* Player Cards */}
          <div className={`jp-players ${spinning ? 'spinning' : ''}`}>
            <h3>Players in Pot</h3>
            {jackpot?.entries?.length > 0 ? (
              jackpot.entries.map((entry) => {
                const isLeader = totalPotValue > 0 && entry.value === Math.max(...jackpot.entries.map((e) => e.value));
                return (
                <div
                  key={entry.userId}
                  className={`jp-player-card ${spinId === entry.userId ? 'spin-active' : ''} ${jackpot.status === 'completed' && jackpot.winnerId === entry.userId && !spinning ? 'is-winner' : ''} ${isLeader && jackpot.status !== 'completed' ? 'is-leader' : ''}`}
                >  <img
                    src={entry.avatar || `https://www.roblox.com/headshot-thumbnail/image?userId=${entry.userId}&width=100&height=100&format=png`}
                    alt={entry.username}
                    className="jp-player-avatar"
                    onError={(e) => { e.target.src = '/default-avatar.png'; }}
                  />
                  <div className="jp-player-info">
                    <span className="jp-player-name">{entry.username}</span>
                    <span className="jp-player-value">
                      <Icon name="diamond" size={12} /> {entry.value.toLocaleString()} · {entry.itemCount} items
                    </span>
                  </div>
                  <span className="jp-player-chance">
                    {totalPotValue > 0 ? ((entry.value / totalPotValue) * 100).toFixed(1) : 0}%
                  </span>
                </div>
                );
              })
            ) : (
              <div className="jp-empty">No one has entered yet. Be the first!</div>
            )}
          </div>

          {/* Item Selection */}
          <div className="jp-select">
            <h3>Select Items to Enter</h3>
            <div className="jp-select-actions">
              <button className="jp-btn-secondary" onClick={selectAll}>Select All</button>
              <button className="jp-btn-secondary" onClick={() => setSelectedItems([])}>Clear</button>
              <span className="jp-selected-value"><Icon name="diamond" size={13} /> {selectedValue.toLocaleString()}</span>
            </div>
            <div className="jp-inventory-grid">
              {inventory.length > 0 ? inventory.map((item) => {
                const isSelected = selectedItems.some((s) => s.itemId === item.itemId);
                return (
                  <div
                    key={item.itemId}
                    className={`jp-inv-tile ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleItem(item)}
                    title={`${item.name} — ${(item.value || 0).toLocaleString()} AMP`}
                  >
                    <img
                      src={item.imageUrl || item.image || '/default-item.png'}
                      alt={item.name}
                      onError={(e) => { e.target.src = '/default-item.png'; }}
                    />
                    <span className="jp-inv-name">{item.name}</span>
                    <ModBadges mods={item.mods} size={14} />
                    <span className="jp-inv-value"><Icon name="diamond" size={11} /> {(item.value || 0).toLocaleString()}</span>
                  </div>
                );
              }) : (
                <div className="jp-empty">No items in inventory</div>
              )}
            </div>
            <div className="jp-bottom-bar">
              <span className="jp-selected-count">{selectedItems.length} items selected</span>
              <button
                className="jp-btn-primary"
                onClick={handleJoin}
                disabled={joining || selectedItems.length === 0}
              >
                {joining ? 'Joining...' : 'Enter Jackpot'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* History Tab */
        <div className="jp-history">
          <h3>Jackpot History</h3>
          {history.length > 0 ? history.map((jp) => (
            <div key={jp.id} className="jp-history-item">
              <div className="jp-history-winner">
                <Icon name="trophy" size={14} /> {jp.winnerUsername || 'Unknown'} won <Icon name="diamond" size={12} /> {(jp.totalValue || 0).toLocaleString()}
              </div>
              <div className="jp-history-details">
                {jp.playerCount} players · {jp.entries?.reduce((s, e) => s + e.itemCount, 0) || 0} items
              </div>
              <div className="jp-history-time">
                {jp.completedAt ? new Date(jp.completedAt).toLocaleString() : ''}
              </div>
            </div>
          )) : (
            <div className="jp-empty">No jackpot history yet</div>
          )}
        </div>
      )}
    </div>
  );
};

export default JackpotPage;
