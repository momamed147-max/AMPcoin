import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProfileModal from './ProfileModal';
import InventoryPickerModal from './InventoryPickerModal';
import Icon from './Icon';
import ModBadges from './ModBadges';
import './ModBadges.css';
import './WalletModal.css';

const DEFAULT_AVATAR = '/default-avatar.png';
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function getFallbackAvatar(user) {
  if (user?.robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxUserId}&width=420&height=420&format=png`;
  }
  return DEFAULT_AVATAR;
}

const Header = ({ balance, socket }) => {
  const location = useLocation();
  const { user } = useAuth();
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [invLoading, setInvLoading] = useState(false);
  const [selectedUnits, setSelectedUnits] = useState([]);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [wmSearch, setWmSearch] = useState('');
  const [wmSort, setWmSort] = useState('high-low');
  const [wmFilter, setWmFilter] = useState('all');
  const [modalMsg, setModalMsg] = useState('');
  const [invError, setInvError] = useState('');
  const [botInfo, setBotInfo] = useState(null); // { botUser, redirectLink, botEnabled, avatar }
  const [tradeModal, setTradeModal] = useState(null); // { kind: 'withdraw'|'deposit', items, amount }

  // Notifications
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifList, setNotifList] = useState([]);

  // Giveaway creation (GW button next to the bell)
  const [gwModalOpen, setGwModalOpen] = useState(false);
  const [gwInventory, setGwInventory] = useState([]);
  const [gwLoading, setGwLoading] = useState(false);
  const [gwBusyId, setGwBusyId] = useState(null);
  const [gwNote, setGwNote] = useState('');

  const num = (v) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };

  const unreadCount = notifList.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE}/api/notifications`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNotifList(data.notifications || []);
      }
    } catch (e) {
      console.warn('Notification fetch failed:', e.message);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!socket) return;
    const onNotification = (n) => {
      if (!n) return;
      setNotifList((prev) => (n.id && prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
    };
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [socket]);

  const toggleNotifications = async () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next && unreadCount > 0) {
      setNotifList((prev) => prev.map((n) => ({ ...n, read: true })));
      try {
        await fetch(`${API_BASE}/api/notifications/read`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
      } catch (e) {
        console.warn('Mark-read failed:', e.message);
      }
    }
  };

  const notifIcon = (type) => {
    switch (type) {
      case 'tip': return 'gift';
      case 'withdrawal': return 'cash';
      case 'items': return 'box';
      case 'giveaway': return 'party';
      default: return 'bell';
    }
  };

  const openGwModal = async () => {
    if (!user) return;
    setGwNote('');
    setGwModalOpen(true);
    setGwLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/inventory/${user.id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGwInventory(data.items || []);
      }
    } catch (e) {
      console.error('GW inventory fetch failed:', e.message);
    } finally {
      setGwLoading(false);
    }
  };

  const createGiveaway = async (item) => {
    const itemId = item.itemId || item.id;
    if (!itemId || gwBusyId) return;
    setGwBusyId(itemId);
    setGwNote('');
    try {
      const res = await fetch(`${API_BASE}/api/giveaways`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ itemId, quantity: 1 })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.chatMessage) {
        // Backend already broadcasts giveawayUpdate + inventoryUpdate via socket
        setGwModalOpen(false);
      } else {
        setGwNote(data.message || 'Failed to create giveaway');
      }
    } catch (e) {
      setGwNote('Failed to create giveaway — server error');
    } finally {
      setGwBusyId(null);
    }
  };

  // Compact display: 83623 -> 83.6k
  const formatCompact = (n) => {
    const v = num(n);
    if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return `${Math.floor(v)}`;
  };

  const getPageTitle = () => {
    switch(location.pathname) {
      case '/jackpot':
        return 'Jackpot';
      case '/coinflip':
        return 'Coinflip';
      case '/trading':
        return 'Trading';
      case '/blackjack':
        return 'Jackpot';
      case '/leaderboard':
        return 'Leaderboard';
      case '/stats':
        return 'Statistics';
      case '/provably-fair':
        return 'Provably Fair';
      case '/profile':
        return 'Profile';
      case '/admin':
        return 'Admin Panel';
      default:
        return 'Dashboard';
    }
  };

  const fetchInventory = useCallback(async () => {
    if (!user) return;
    setInvLoading(true);
    try {
      const identifier = user.id || user.robloxUsername;
      const res = await fetch(`${API_BASE}/api/users/inventory/${identifier}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setInventory(data.items || data.inventory?.items || []);
        setInvError('');
      } else if (res.status === 429) {
        setInvError('Rate limited — wait a few seconds and reopen the wallet.');
      } else if (res.status === 401 || res.status === 403) {
        setInvError('Session expired — log out and log back in.');
      } else if (res.status === 404) {
        setInvError('Account not found on server.');
      } else {
        setInvError(`Inventory failed to load (error ${res.status}).`);
      }
    } catch (e) {
      console.error('Header wallet inventory fetch failed:', e.message);
      setInvError('Could not reach the server.');
    } finally {
      setInvLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchInventory();
  }, [user, fetchInventory]);

  // Real-time: refresh inventory + totals on game/socket events (no refresh needed)
  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchInventory();
    socket.on('balanceUpdate', refresh);
    socket.on('newCoinflip', refresh);
    socket.on('coinflipJoined', refresh);
    socket.on('coinflipResult', refresh);
    socket.on('coinflipCancelled', refresh);
    socket.on('inventoryUpdate', refresh);
    socket.on('giveawayUpdate', refresh);
    return () => {
      socket.off('balanceUpdate', refresh);
      socket.off('newCoinflip', refresh);
      socket.off('coinflipJoined', refresh);
      socket.off('coinflipResult', refresh);
      socket.off('coinflipCancelled', refresh);
      socket.off('inventoryUpdate', refresh);
      socket.off('giveawayUpdate', refresh);
    };
  }, [socket, fetchInventory]);

  const handleWalletClick = () => {
    setModalMsg('');
    setInvError('');
    setBotInfo(null);
    setShowWalletModal(true);
    fetchInventory();
    fetchBotInfo();
  };

  // Pull the trade bot (name + join link + avatar) from admin settings
  const fetchBotInfo = async () => {
    try {
      const botRes = await fetch(`${API_BASE}/api/wallet/bot-info`);
      if (!botRes.ok) return;
      const bot = await botRes.json();
      let avatar = DEFAULT_AVATAR;
      if (bot.botUser) {
        try {
          const avRes = await fetch(`${API_BASE}/api/users/avatar/${encodeURIComponent(bot.botUser)}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
          });
          if (avRes.ok) {
            const av = await avRes.json();
            if (av.avatar) avatar = av.avatar;
          }
        } catch (_) { /* keep default avatar */ }
      }
      setBotInfo({ ...bot, avatar });
    } catch (e) {
      console.error('Bot info fetch failed:', e.message);
    }
  };

  const handleProfileClick = () => {
    setShowProfileModal(true);
  };

  const totalInventoryValue = inventory.reduce(
    (sum, item) => sum + (num(item.value || item.details?.value) * (num(item.quantity) || 1)),
    0
  );

  // Expand stacks into single-unit tiles shown next to each other
  const unitTiles = [];
  inventory.forEach((item) => {
    const stackKey = item.itemId || item.id;
    const qty = Math.max(1, parseInt(num(item.quantity) || 1, 10));
    for (let i = 0; i < qty; i++) {
      unitTiles.push({ ...item, stackKey, unitKey: `${stackKey}:${i}` });
    }
  });

  const toggleUnit = (unitKey) => {
    setSelectedUnits((prev) =>
      prev.includes(unitKey) ? prev.filter((k) => k !== unitKey) : [...prev, unitKey]
    );
  };

  const toggleSelectAll = () => {
    setSelectedUnits((prev) =>
      prev.length === unitTiles.length ? [] : unitTiles.map((u) => u.unitKey)
    );
  };

  const selectedValue = unitTiles
    .filter((u) => selectedUnits.includes(u.unitKey))
    .reduce((s, u) => s + num(u.value || u.details?.value), 0);

  const handleWithdraw = async () => {
    if (selectedUnits.length === 0 || withdrawBusy) return;
    setWithdrawBusy(true);
    setModalMsg('');
    try {
      const items = unitTiles
        .filter((u) => selectedUnits.includes(u.unitKey))
        .map((u) => ({
          itemId: u.itemId || u.id,
          itemName: u.details?.name || u.name,
          value: u.value || u.details?.value || 0,
          rarity: u.rarity || u.details?.rarity || 'common',
          image: u.image || u.imageUrl || u.details?.imageUrl || ''
        }));
      const res = await fetch(`${API_BASE}/api/wallet/withdraw-items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ items, address: 'Discord Server' })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSelectedUnits([]);
        fetchInventory();
        // Backend broadcasts inventoryUpdate via socket
        setTradeModal({ kind: 'withdraw', items });
      } else {
        setModalMsg(data.message || 'Withdrawal failed');
      }
    } catch (e) {
      setModalMsg('Withdrawal failed — server error');
    } finally {
      setWithdrawBusy(false);
    }
  };

  const displayName = user?.robloxDisplayName || user?.displayName || user?.robloxUsername || 'Anonymous';
  const avatarSrc = user?.avatar || getFallbackAvatar(user);

  return (
    <header className="header header-new">
      <div className="header-left">
        <span className="header-gem">◆</span>
        <h2>{getPageTitle()}</h2>
      </div>

      <div className="header-center">
        <div
          className="balance-pill"
          title={`Inventory value: ${totalInventoryValue.toLocaleString()} AMP`}
        >
          <span className="balance-gem"><Icon name="diamond" size={14} /></span>
          <span className="balance-total">{formatCompact(totalInventoryValue)}</span>
        </div>
        <button className="header-wallet-btn" onClick={handleWalletClick} title="Open wallet">
          <Icon name="wallet" size={14} /> Wallet
        </button>
      </div>

      <div className="header-right">
        <span className="username" onClick={handleProfileClick} style={{ cursor: 'pointer' }} title={user?.robloxUsername || ''}>
          {displayName}
        </span>

        <img
          src={avatarSrc || DEFAULT_AVATAR}
          alt={`${displayName} avatar`}
          className="user-avatar"
          onClick={handleProfileClick}
          style={{ cursor: 'pointer' }}
          onError={(e) => {
            const fb = getFallbackAvatar(user);
            if (e.target.src !== fb) e.target.src = fb;
            else if (e.target.src !== DEFAULT_AVATAR) e.target.src = DEFAULT_AVATAR;
          }}
        />

        <div className="notifications" onClick={toggleNotifications}>
          <span className="notification-icon"><Icon name="bell" size={16} /></span>
          {unreadCount > 0 && (
            <span className="notification-badge">{unreadCount}</span>
          )}
          {notifOpen && (
            <div className="notification-dropdown" onClick={(e) => e.stopPropagation()}>
              <div className="notification-dd-header">Notifications</div>
              {notifList.length === 0 ? (
                <div className="notification-empty">No notifications yet</div>
              ) : (
                <div className="notification-list">
                  {notifList.map((n) => (
                    <div key={n.id} className={`notification-item ${n.read ? '' : 'unread'}`}>
                      <span className="notification-item-icon">
                        {n.imageUrl ? (
                          <img
                            src={n.imageUrl}
                            alt=""
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <Icon name={notifIcon(n.type)} size={16} />
                        )}
                      </span>
                      <div className="notification-item-body">
                        {n.title && <div className="notification-item-title">{n.title}</div>}
                        <div className="notification-item-msg">{n.message}</div>
                        <div className="notification-item-time">
                          {new Date(n.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          className="header-gw-btn"
          onClick={openGwModal}
          disabled={!user}
          title="Create a giveaway — only members with a bet in the last 24h can join"
        >
          <Icon name="gift" size={16} />
        </button>
      </div>

      <InventoryPickerModal
        isOpen={gwModalOpen}
        title="Create a Giveaway"
        subtitle="Pick the item you want to give away — only members with a bet in the last 24h can join"
        items={gwInventory}
        loading={gwLoading}
        busyId={gwBusyId}
        note={gwNote}
        noteType={gwNote ? 'error' : undefined}
        actionLabel="GIVE"
        onClose={() => setGwModalOpen(false)}
        onSelect={createGiveaway}
      />

      {showProfileModal && (
        <ProfileModal
          viewer={user}
          profileUser={user}
          isOwn
          socket={socket}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {showWalletModal && (() => {
        const getVal = (u) => num(u.value || u.details?.value);
        const getName = (u) => u.name || u.details?.name || u.itemName || 'Unknown';
        const getRarity = (u) => u.rarity || u.details?.rarity || 'common';
        const anyWithdrawOnly = unitTiles.some((u) => u.withdrawOnly === true || u.details?.withdrawOnly === true);
        const rarities = [...new Set(unitTiles.map(getRarity))];
        const q = wmSearch.trim().toLowerCase();
        let visible = unitTiles.filter((u) => {
          if (q && !getName(u).toLowerCase().includes(q)) return false;
          if (wmFilter !== 'all' && getRarity(u) !== wmFilter) return false;
          return true;
        });
        visible = [...visible].sort((a, b) => wmSort === 'low-high' ? getVal(a) - getVal(b) : getVal(b) - getVal(a));
        return (
        <div className="wm-overlay" onClick={() => setShowWalletModal(false)}>
          <div className="wm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wm-header">
              <h2 className="wm-title">
                <span className="wm-coins-icon">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </span>
                Your Items
              </h2>
              <button
                className="wm-add-btn"
                onClick={() => setTradeModal({ kind: 'deposit' })}
                title="Deposit items"
              >
                +
              </button>
              <button
                className="wm-close"
                onClick={() => setShowWalletModal(false)}
              >
                ×
              </button>
            </div>
            <div className="wm-controls">
              <input
                className="wm-search"
                type="text"
                placeholder="Search for items"
                value={wmSearch}
                onChange={(e) => setWmSearch(e.target.value)}
              />
              <select
                className="wm-select"
                value={wmSort}
                onChange={(e) => setWmSort(e.target.value)}
              >
                <option value="high-low">High to low</option>
                <option value="low-high">Low to high</option>
              </select>
              <select
                className="wm-select"
                value={wmFilter}
                onChange={(e) => setWmFilter(e.target.value)}
              >
                <option value="all">All items</option>
                {rarities.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="wm-stats">
              <span>Selected: <span className="wm-gem">◆</span> <strong>{selectedValue.toLocaleString()}</strong></span>
              <span>Inventory Value: <span className="wm-gem">◆</span> <strong>{totalInventoryValue.toLocaleString()}</strong></span>
            </div>
            {modalMsg && <div className="wm-msg">{modalMsg}</div>}
            {invError && <div className="wm-msg-error">{invError}</div>}
            <div className="wm-grid">
              {invLoading ? (
                <div className="wm-empty">Loading inventory...</div>
              ) : visible.length > 0 ? (
                visible.map((unit) => {
                  const isSelected = selectedUnits.includes(unit.unitKey);
                  const flagged = unit.withdrawOnly === true || unit.details?.withdrawOnly === true;
                  const showBadge = anyWithdrawOnly ? flagged : true;
                  return (
                    <div
                      key={unit.unitKey}
                      className={`wm-card ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => toggleUnit(unit.unitKey)}
                    >
                      {showBadge && (
                        <span className="wm-badge">ⓘ Withdraw only</span>
                      )}
                      <div className="wm-img-wrap">
                        {unit.image || unit.imageUrl || unit.details?.imageUrl ? (
                          <img
                            src={unit.image || unit.imageUrl || unit.details?.imageUrl}
                            alt={getName(unit)}
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <div className="wm-fallback-icon"><Icon name="diamond" size={16} /></div>
                        )}
                      </div>
                      <h4 className="wm-name">{getName(unit)}</h4>
                      <ModBadges mods={unit.mods || unit.details?.mods} size={16} />
                      <p className="wm-value"><span className="wm-gem">◆</span> {getVal(unit).toLocaleString()}</p>
                    </div>
                  );
                })
              ) : (
                <div className="wm-empty">No items in your inventory</div>
              )}
            </div>
            <div className="wm-footer">
              <button className="wm-btn" onClick={toggleSelectAll}>
                {selectedUnits.length === unitTiles.length && unitTiles.length > 0 ? 'Deselect All' : 'Select All'}
              </button>
              <button
                className="wm-btn wm-btn-deposit"
                onClick={() => setTradeModal({ kind: 'deposit' })}
                title="Deposit items via trade bot"
              >
                <Icon name="plus" size={12} /> Deposit
              </button>
              <button
                className="wm-btn wm-btn-withdraw"
                onClick={handleWithdraw}
                disabled={selectedUnits.length === 0 || withdrawBusy}
              >
                {withdrawBusy ? 'Sending...' : (<>Withdraw <span className="wm-gem">◆</span> {selectedValue.toLocaleString()}</>)}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {tradeModal && (
        <div className="trade-modal-overlay" onClick={() => setTradeModal(null)}>
          <div className="trade-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn trade-close" onClick={() => setTradeModal(null)}>×</button>
            <h2>{tradeModal.kind === 'withdraw' ? 'Withdraw Requested!' : 'Deposit Requested!'}</h2>
            <p className="trade-sub">
              {tradeModal.kind === 'withdraw'
                ? 'Trade the bot in-game to receive your items.'
                : 'Join the server and trade the bot to deposit — an admin will approve it.'}
            </p>
            {botInfo && botInfo.botEnabled && botInfo.botUser ? (
              <div className="bot-trade-row">
                <img
                  src={botInfo.avatar || DEFAULT_AVATAR}
                  alt="Trade bot"
                  className="bot-avatar"
                  onError={(e) => { e.target.src = DEFAULT_AVATAR; }}
                />
                <span className="bot-name">{botInfo.botUser}</span>
                <span className="bot-dot" title="Online" />
                <span className="bot-spacer" />
                {botInfo.redirectLink ? (
                  <button
                    className="bot-join-btn"
                    onClick={() => window.open(botInfo.redirectLink, '_blank', 'noopener,noreferrer')}
                  >
                    Join
                  </button>
                ) : (
                  <span className="bot-no-link">Join link not set — ask an admin</span>
                )}
              </div>
            ) : (
              <p className="trade-sub">The trade bot is currently disabled — an admin will handle your request.</p>
            )}
            {tradeModal.kind === 'withdraw' && Array.isArray(tradeModal.items) && tradeModal.items.length > 0 && (
              <div className="trade-items">
                {tradeModal.items.map((it, idx) => (
                  <div key={`${it.itemId}-${idx}`} className="trade-item-chip">
                    <span className="chip-name">{it.itemName || it.name}</span>
                    <span className="chip-val">{Number(it.value || 0).toLocaleString()} AMP</span>
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-primary trade-done-btn" onClick={() => setTradeModal(null)}>
              Done
            </button>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
