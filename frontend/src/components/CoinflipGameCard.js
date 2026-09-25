import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiConfig';

const DEFAULT_AVATAR = '/default-avatar.png';

const profileCache = new Map();
const profilePending = new Map();

function getFallbackAvatar(player) {
  if (player?.avatar) return player.avatar;
  if (player?.creatorAvatar && !player?.opponentId) return player.creatorAvatar;
  if (player?.opponentAvatar && player?.opponentId) return player.opponentAvatar;
  if (player?.robloxUserId || player?.creatorRobloxUserId || player?.opponentRobloxUserId) {
    const rid = player.robloxUserId || player.creatorRobloxUserId || player.opponentRobloxUserId;
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${rid}&width=150&height=150&format=png`;
  }
  return DEFAULT_AVATAR;
}

function getDisplayName(player) {
  return (
    player?.robloxDisplayName ||
    player?.creatorRobloxDisplayName ||
    player?.opponentRobloxDisplayName ||
    player?.displayName ||
    player?.creatorDisplayName ||
    player?.opponentDisplayName ||
    player?.creatorUsername ||
    player?.opponentUsername ||
    player?.robloxUsername ||
    player?.username ||
    'Anonymous'
  );
}

async function resolvePlayerProfile(identifier, robloxUserId) {
  if (!identifier) return null;
  const key = String(identifier).toLowerCase();
  if (profileCache.has(key)) return profileCache.get(key);
  if (profilePending.has(key)) return profilePending.get(key);
  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users/profile/${encodeURIComponent(identifier)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      profileCache.set(key, data);
      return data;
    } catch (err) {
      return null;
    } finally {
      profilePending.delete(key);
    }
  })();
  profilePending.set(key, promise);
  return promise;
}

const CoinflipGameCard = ({ coinflip, onJoin }) => {
  const [selectedOutcome, setSelectedOutcome] = useState(null);
  const [resolved, setResolved] = useState({ creator: null, opponent: null });
  const [avatarErrs, setAvatarErrs] = useState({ creator: false, opponent: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const needsCreator = !coinflip?.creatorAvatar && (coinflip?.creatorId || coinflip?.creatorRobloxUsername);
      const needsOpponent = coinflip?.opponentId && !coinflip?.opponentAvatar && (coinflip?.opponentId || coinflip?.opponentRobloxUsername);
      const creatorRes = needsCreator
        ? await resolvePlayerProfile(coinflip.creatorRobloxUsername || coinflip.creatorId, coinflip.creatorRobloxUserId)
        : null;
      const opponentRes = needsOpponent
        ? await resolvePlayerProfile(coinflip.opponentRobloxUsername || coinflip.opponentId, coinflip.opponentRobloxUserId)
        : null;
      if (!cancelled) setResolved({ creator: creatorRes, opponent: opponentRes });
    })();
    return () => { cancelled = true; };
  }, [coinflip?.id, coinflip?.creatorId, coinflip?.opponentId]);

  const creatorAvatarSrc =
    (!avatarErrs.creator && resolved.creator?.avatar) ||
    coinflip.creatorAvatar ||
    (coinflip.creatorRobloxUserId
      ? `https://www.roblox.com/headshot-thumbnail/image?userId=${coinflip.creatorRobloxUserId}&width=150&height=150&format=png`
      : '') ||
    DEFAULT_AVATAR;

  const opponentAvatarSrc = coinflip.opponentId
    ? ((!avatarErrs.opponent && resolved.opponent?.avatar) ||
        coinflip.opponentAvatar ||
        (coinflip.opponentRobloxUserId
          ? `https://www.roblox.com/headshot-thumbnail/image?userId=${coinflip.opponentRobloxUserId}&width=150&height=150&format=png`
          : '') ||
        DEFAULT_AVATAR)
    : DEFAULT_AVATAR;

  const creatorName = resolved.creator?.displayName || getDisplayName(coinflip);
  const opponentName = coinflip.opponentId
    ? (resolved.opponent?.displayName || (coinflip.opponentRobloxDisplayName || coinflip.opponentDisplayName || coinflip.opponentUsername))
    : 'Waiting for opponent';

  const handleJoin = async () => {
    if (coinflip.status !== 'waiting' || coinflip.opponentId) {
      alert('This coinflip is no longer available');
      return;
    }

    if (!selectedOutcome) {
      alert('Please select an outcome to bet on');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/coinflip/${coinflip.id}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ outcome: selectedOutcome })
      });

      const data = await response.json();

      if (response.ok) {
        alert('Successfully joined coinflip!');
        if (onJoin) {
          onJoin(coinflip.id, selectedOutcome);
        }
      } else {
        alert(data.message || 'Failed to join coinflip');
      }
    } catch (error) {
      console.error('Error joining coinflip:', error);
      alert('Error joining coinflip');
    }
  };

  const getRarityClass = (rarity) => {
    const rarityClasses = {
      'common': 'badge-common',
      'rare': 'badge-rare',
      'epic': 'badge-epic',
      'legendary': 'badge-legendary',
      'mythic': 'badge-mythic'
    };
    return rarityClasses[rarity] || 'badge-common';
  };

  const renderItems = (items, maxToShow = 3) => {
    if (!items || items.length === 0) return null;

    const itemsToShow = items.slice(0, maxToShow);
    const extraCount = items.length - maxToShow;

    return (
      <div className="item-grid">
        {itemsToShow.map((item, index) => (
          <div key={index} className="item-card">
            <img
              src={item.details?.imageUrl || item.imageUrl || item.image || '/default-item.png'}
              alt={item.details?.name || item.itemName || item.name}
              className="item-image"
              onError={(e) => {
                e.target.src = '/default-item.png';
              }}
            />
            <div className="item-info">
              <div className="item-name">{item.details?.name || item.itemName || item.name}</div>
              <div className="item-value">{(item.value || 0).toLocaleString()} AMP</div>
              <span className={`badge ${getRarityClass(item.details?.rarity || item.rarity)}`}>
                {item.details?.rarity || item.rarity}
              </span>
            </div>
          </div>
        ))}
        {extraCount > 0 && (
          <div className="item-extra">
            +{extraCount}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="coinflip-card">
      <div className="coinflip-players">
        <div className="player-info">
          <img
            src={creatorAvatarSrc}
            alt="Creator"
            className="player-avatar"
            onError={(e) => {
              setAvatarErrs(prev => ({ ...prev, creator: true }));
              if (e.target.src !== DEFAULT_AVATAR) e.target.src = DEFAULT_AVATAR;
            }}
          />
          <div className="player-name" title={coinflip.creatorRobloxUsername || coinflip.creatorUsername || ''}>
            {creatorName}
          </div>
        </div>

        <div className="vs">VS</div>

        <div className="player-info">
          {coinflip.opponentId && (
            <>
              <img
                src={opponentAvatarSrc}
                alt="Opponent"
                className="player-avatar"
                onError={(e) => {
                  setAvatarErrs(prev => ({ ...prev, opponent: true }));
                  if (e.target.src !== DEFAULT_AVATAR) e.target.src = DEFAULT_AVATAR;
                }}
              />
              <div className="player-name" title={coinflip.opponentRobloxUsername || coinflip.opponentUsername || ''}>
                {opponentName}
              </div>
            </>
          )}
          {!coinflip.opponentId && (
            <div className="player-name">Waiting for opponent</div>
          )}
        </div>
      </div>

      <div className="coinflip-items">
        {renderItems(coinflip.creatorItems)}
      </div>

      <div className="coinflip-details">
        <div className="total-value">{(coinflip.totalValue || 0).toLocaleString()} AMP</div>
        <div className="opponent-range">Open to any value</div>

        <div className="coinflip-actions">
          {coinflip.status === 'waiting' && !coinflip.opponentId && (
            <div className="outcome-selection">
              <button
                className={`btn ${selectedOutcome === 'heads' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSelectedOutcome('heads')}
              >
                Heads
              </button>
              <button
                className={`btn ${selectedOutcome === 'tails' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSelectedOutcome('tails')}
              >
                Tails
              </button>
            </div>
          )}

          {coinflip.status === 'waiting' && !coinflip.opponentId && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleJoin}
            >
              JOIN
            </button>
          )}

          {coinflip.status === 'completed' && (
            <div className="result">
              <span className={`result-text ${coinflip.winnerId === coinflip.creatorId ? 'winner' : 'loser'}`}>
                {coinflip.winnerId === coinflip.creatorId ? 'Creator' : 'Opponent'} wins!
              </span>
            </div>
          )}

          {coinflip.opponentId && coinflip.status === 'waiting' && (
            <div className="status">Waiting for opponent to flip...</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CoinflipGameCard;
