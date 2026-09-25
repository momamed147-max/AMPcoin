import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import InventoryPickerModal from './InventoryPickerModal';
import Icon from './Icon';
import { API_BASE } from '../apiConfig';
import './ProfileModal.css';

const DEFAULT_AVATAR = '/default-avatar.png';

function formatCompact(n) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const a = Math.abs(v);
  let out;
  if (a >= 1e9) out = `${(a / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  else if (a >= 1e6) out = `${(a / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  else if (a >= 1e3) out = `${(a / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  else out = `${Math.floor(a)}`;
  return neg ? `-${out}` : out;
}

// Wager-based ranks: total AMP staked in completed coinflips
const RANKS = [
  { level: 0, name: 'Rookie', at: 0 },
  { level: 1, name: 'Bronze', at: 10000 },
  { level: 2, name: 'Silver', at: 50000 },
  { level: 3, name: 'Gold', at: 150000 },
  { level: 4, name: 'Platinum', at: 500000 },
  { level: 5, name: 'Diamond', at: 1500000 },
  { level: 6, name: 'Master', at: 5000000 },
  { level: 7, name: 'Grandmaster', at: 15000000 },
  { level: 8, name: 'Legend', at: 50000000 }
];

function getRank(wager) {
  const w = Number(wager) || 0;
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (w >= RANKS[i].at) idx = i;
  }
  const current = RANKS[idx];
  const next = RANKS[idx + 1] || null;
  const progress = next ? Math.min(1, (w - current.at) / (next.at - current.at)) : 1;
  return { ...current, next, progress, wager: w };
}

const ProfileModal = ({ viewer, profileUser, isOwn, onClose }) => {
  const [stats, setStats] = useState({ wager: 0, profit: 0, won: 0, lost: 0 });
  const [tipModalOpen, setTipModalOpen] = useState(false);
  const [tipInventory, setTipInventory] = useState([]);
  const [tippingId, setTippingId] = useState(null);
  const [tipNote, setTipNote] = useState('');

  const person = profileUser || viewer;
  const showTip = !isOwn && viewer && person && String(viewer.id) !== String(person.id);

  useEffect(() => {
    if (!person) return;
    (async () => {
      try {
        const identifier = person.id || person.robloxUsername;
        if (!identifier) return;
        const res = await fetch(`${API_BASE}/api/coinflip/user/${identifier}/history`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (!res.ok) return;
        const history = await res.json();
        let wager = 0;
        let won = 0;
        let lost = 0;
        (Array.isArray(history) ? history : []).forEach((g) => {
          const isCreator = g.creatorId === person.id;
          const stake = isCreator ? (g.creatorValue || 0) : (g.opponentValue || 0);
          wager += stake;
          if (g.winnerId === person.id) won += g.totalValue || 0;
          else lost += stake;
        });
        setStats({ wager, won, lost, profit: won - lost });
      } catch (e) {
        console.error('Profile stats fetch failed:', e.message);
      }
    })();
  }, [person]);

  const openTipPicker = async () => {
    setTipNote('');
    if (tipModalOpen) {
      setTipModalOpen(false);
      return;
    }
    setTipModalOpen(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/inventory/${viewer.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTipInventory(data.items || []);
      }
    } catch (e) {
      console.error('Tip inventory fetch failed:', e.message);
    }
  };

  const sendTip = async (item) => {
    const itemId = item.itemId || item.id;
    if (!itemId || tippingId) return;
    setTippingId(itemId);
    setTipNote('');
    try {
      const res = await fetch(`${API_BASE}/api/users/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ recipientId: person.id, itemId, quantity: 1 })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTipNote(data.message || 'Tip sent!');
        setTipInventory((prev) =>
          prev
            .map((it) =>
              (it.itemId || it.id) === itemId
                ? { ...it, quantity: (it.quantity || 1) - 1 }
                : it
            )
            .filter((it) => (it.quantity || 1) > 0)
        );
        // Backend already broadcasts inventoryUpdate to all users via socket
      } else {
        setTipNote(data.message || 'Tip failed');
      }
    } catch (e) {
      setTipNote('Tip failed — server error');
    } finally {
      setTippingId(null);
    }
  };

  if (!person) return null;

  const displayName = person.robloxDisplayName || person.displayName || person.robloxUsername || 'Anonymous';
  const avatarSrc = person.avatar || '/default-avatar.png';
  const idTag = person.robloxUserId ? `#${person.robloxUserId}` : `#${String(person.id || '').slice(0, 10)}`;
  const rank = getRank(stats.wager);

  const cells = [
    { label: 'WAGER', value: formatCompact(stats.wager), cls: '' },
    { label: 'PROFIT', value: `${stats.profit >= 0 ? '+' : ''}${formatCompact(stats.profit)}`, cls: stats.profit >= 0 ? 'pos' : 'neg' },
    { label: 'WON', value: formatCompact(stats.won), cls: '' },
    { label: 'LOST', value: formatCompact(stats.lost), cls: '' }
  ];

  return createPortal(
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="profile-modal-name">
        <div className="profile-banner">
          <button className="profile-close" onClick={onClose} aria-label="Close profile">
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="profile-avatar-wrap">
          <img
            src={avatarSrc}
            alt={displayName}
            onError={(e) => { e.target.src = DEFAULT_AVATAR; }}
          />
          <span className="profile-lvl">LVL {rank.level}</span>
        </div>
        <div className="profile-name" id="profile-modal-name">
          {displayName}
          {person.isAdmin && <span className="profile-admin-badge">ADMIN</span>}
        </div>
        <div className="profile-idtag">{idTag}</div>
        <div className="profile-rank-row">
          <span className="profile-rank-name">{rank.name}</span>
          <div className="profile-rank-bar">
            <div className="profile-rank-fill" style={{ width: `${Math.round(rank.progress * 100)}%` }} />
          </div>
          <span className="profile-rank-next">
            {rank.next
              ? `${formatCompact(rank.wager)} / ${formatCompact(rank.next.at)} to ${rank.next.name}`
              : 'MAX RANK'}
          </span>
        </div>

        <div className="profile-stats-label">Player Statistics</div>
        <div className="profile-stats-grid">
          {cells.map((c) => (
            <div key={c.label} className="profile-stat-box">
              <span className="profile-stat-label">{c.label}</span>
              <span className={`profile-stat-val ${c.cls}`}>
                <span className="stat-gem"><Icon name="diamond" size={14} /></span> {c.value}
              </span>
            </div>
          ))}
        </div>

        {showTip && (
          <button className="profile-tip-btn" onClick={openTipPicker}>
            {tipModalOpen ? 'Close' : 'Send Tip'}
          </button>
        )}
        {showTip && (
          <InventoryPickerModal
            isOpen={tipModalOpen}
            title={`Tip ${displayName}`}
            subtitle="Pick one of your items to send"
            items={tipInventory}
            busyId={tippingId}
            note={tipNote}
            noteType={tipNote && tipNote.toLowerCase().includes('fail') ? 'error' : 'ok'}
            actionLabel="TIP"
            onClose={() => setTipModalOpen(false)}
            onSelect={sendTip}
          />
        )}
      </div>
    </div>,
    document.body
  );
};

export default ProfileModal;
