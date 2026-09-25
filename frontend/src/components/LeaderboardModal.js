import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiConfig';
import Icon from './Icon';
import ModalPortal from './ModalPortal';
import { playError } from '../sound';
import './LeaderboardModal.css';

const DEFAULT_AVATAR = '/default-avatar.png';

const profileCache = new Map();
const profilePending = new Map();

async function resolvePlayerProfile(identifier) {
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

const LeaderboardModal = ({ isOpen, onClose }) => {
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState('topPlayers');
  const [resolvedProfiles, setResolvedProfiles] = useState({});
  const [avatarErrs, setAvatarErrs] = useState({});

  useEffect(() => {
    if (isOpen) {
      const fetchLeaderboard = async () => {
        setLoading(true);
        setLoadError('');
        setLeaderboardData([]);
        try {
          const sortBy = activeTab === 'mostWins' ? 'gamesWon' : activeTab === 'highestStreak' ? 'highestStreak' : 'balance';
          const response = await fetch(`${API_BASE}/api/stats/leaderboard?limit=20&sortBy=${sortBy}`);
          if (!response.ok) throw new Error(`Leaderboard unavailable (${response.status})`);
          const data = await response.json();

          let arr = [];
          if (Array.isArray(data)) {
            arr = data;
          } else if (data && Array.isArray(data.leaderboard)) {
            arr = data.leaderboard;
          }

          setLeaderboardData(arr);

          if (arr.length > 0) {
            const patches = {};
            await Promise.all(
              arr.map(async (p) => {
                const needsResolve = !p.avatar || !p.robloxDisplayName;
                if (!needsResolve) return;
                const identifier = p.robloxUsername || p.id;
                const prof = await resolvePlayerProfile(identifier);
                if (prof) patches[p.id || identifier] = prof;
              })
            );
            if (Object.keys(patches).length > 0) {
              setResolvedProfiles(prev => ({ ...prev, ...patches }));
            }
          }

          setLoading(false);
        } catch (error) {
          console.error('Error fetching leaderboard:', error);
          setLoadError('The leaderboard could not be loaded. Please try again.');
          playError();
          setLoading(false);
        }
      };

      fetchLeaderboard();
    }
  }, [isOpen, activeTab, reloadKey]);

  if (!isOpen) return null;

  const getAvatar = (player) => {
    const key = player.id || player.robloxUsername;
    if (avatarErrs[key]) return DEFAULT_AVATAR;
    const resolved = resolvedProfiles[key];
    return (
      resolved?.avatar ||
      player.avatar ||
      (player.robloxUserId
        ? `https://www.roblox.com/headshot-thumbnail/image?userId=${player.robloxUserId}&width=150&height=150&format=png`
        : DEFAULT_AVATAR)
    );
  };

  const getName = (player) => {
    const key = player.id || player.robloxUsername;
    const resolved = resolvedProfiles[key];
    return (
      resolved?.displayName ||
      player.customDisplayName ||
      player.displayName ||
      player.robloxDisplayName ||
      player.robloxUsername ||
      'Anonymous'
    );
  };

  const getTabContent = () => {
    if (loading) {
      return (
        <div className="loading-container" style={{ minHeight: '300px' }}>
          <div className="loading-spinner"></div>
          <p>Loading leaderboard...</p>
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="request-state" role="alert">
          <Icon name="warn" size={26} />
          <strong>Leaderboard unavailable</strong>
          <span>{loadError}</span>
          <button type="button" className="btn btn-primary" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </button>
        </div>
      );
    }

    return (
      <div className="table-responsive">
        <table className="table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>{activeTab === 'topPlayers' ? 'Balance' : activeTab === 'mostWins' ? 'Wins' : 'Streak'}</th>
              {activeTab !== 'highestStreak' && (
                <>
                  <th>Losses</th>
                  <th>Win Rate</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {Array.isArray(leaderboardData) && leaderboardData.length > 0 ? (
              leaderboardData.map((player, index) => {
                const key = player.id || player.robloxUsername || index;
                const secondaryValue =
                  activeTab === 'topPlayers'
                    ? `${(player.balance || 0).toLocaleString()} AMP`
                    : activeTab === 'mostWins'
                      ? (player.gamesWon || 0)
                      : (player.highestStreak || 0);
                return (
                  <tr key={key}>
                    <td>
                      <span className={`rank-badge rank-${index + 1}`}>
                        #{index + 1}
                      </span>
                    </td>
                    <td>
                      <div className="player-info">
                        <img
                          src={getAvatar(player)}
                          alt="Avatar"
                          className="player-avatar"
                          onError={(e) => {
                            setAvatarErrs(prev => ({ ...prev, [key]: true }));
                            if (e.target.src !== DEFAULT_AVATAR) e.target.src = DEFAULT_AVATAR;
                          }}
                          title={player.robloxUsername || ''}
                        />
                        <span title={player.robloxUsername || ''}>{getName(player)}</span>
                      </div>
                    </td>
                    <td>
                      {secondaryValue}
                    </td>
                    {activeTab !== 'highestStreak' && (
                      <>
                        <td>{player.gamesLost || 0}</td>
                        <td>{player.winRate ? `${player.winRate}%` : '0%'}</td>
                      </>
                    )}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={activeTab !== 'highestStreak' ? 5 : 3}>
                  <div className="leaderboard-empty">
                    <Icon name="trophy" size={20} />
                    <strong>No players found</strong>
                    <span>Completed games will appear here.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <ModalPortal>
    <div className="modal-overlay leaderboard-overlay" onClick={onClose}>
      <div className="modal-content leaderboard-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
        <div className="modal-header">
          <h3 id="leaderboard-title"><Icon name="trophy" size={18} /> Leaderboard</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close leaderboard">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="leaderboard-tabs">
            <button
              className={`tab-btn ${activeTab === 'topPlayers' ? 'active' : ''}`}
              onClick={() => setActiveTab('topPlayers')}
            >
              Top Players
            </button>
            <button
              className={`tab-btn ${activeTab === 'mostWins' ? 'active' : ''}`}
              onClick={() => setActiveTab('mostWins')}
            >
              Most Wins
            </button>
            <button
              className={`tab-btn ${activeTab === 'highestStreak' ? 'active' : ''}`}
              onClick={() => setActiveTab('highestStreak')}
            >
              Highest Streak
            </button>
          </div>

          {getTabContent()}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};

export default LeaderboardModal;
