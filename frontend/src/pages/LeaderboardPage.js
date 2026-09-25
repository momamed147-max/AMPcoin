import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiConfig';

const DEFAULT_AVATAR = '/default-avatar.png';

const profileCache = new Map();
const profilePending = new Map();

function getFallbackAvatar(player) {
  if (player?.avatar) return player.avatar;
  if (player?.robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${player.robloxUserId}&width=150&height=150&format=png`;
  }
  return DEFAULT_AVATAR;
}

function getDisplayName(player) {
  return (
    player?.robloxDisplayName ||
    player?.displayName ||
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

const LeaderboardPage = () => {
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolvedProfiles, setResolvedProfiles] = useState({});
  const [avatarErrs, setAvatarErrs] = useState({});
  const [activeTab, setActiveTab] = useState('topPlayers');

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const sortBy = activeTab === 'mostWins' ? 'gamesWon' : activeTab === 'highestStreak' ? 'highestStreak' : 'balance';
        const response = await fetch(`${API_BASE}/api/stats/leaderboard?limit=50&sortBy=${sortBy}`);
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
              const prof = await resolvePlayerProfile(identifier, p.robloxUserId);
              if (prof) {
                patches[p.id || identifier] = prof;
              }
            })
          );
          if (Object.keys(patches).length > 0) {
            setResolvedProfiles(prev => ({ ...prev, ...patches }));
          }
        }

        setLoading(false);
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
        setLeaderboardData([]);
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, [activeTab]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading leaderboard...</p>
      </div>
    );
  }

  const getAvatar = (player) => {
    const key = player.id || player.robloxUsername;
    if (avatarErrs[key]) return DEFAULT_AVATAR;
    const resolved = resolvedProfiles[key];
    const fromResolved = resolved?.avatar;
    const direct = player.avatar;
    const fromRblxId = player.robloxUserId
      ? `https://www.roblox.com/headshot-thumbnail/image?userId=${player.robloxUserId}&width=150&height=150&format=png`
      : '';
    return fromResolved || direct || fromRblxId || DEFAULT_AVATAR;
  };

  const getName = (player) => {
    const key = player.id || player.robloxUsername;
    const resolved = resolvedProfiles[key];
    return (
      resolved?.displayName ||
      player?.robloxDisplayName ||
      player?.displayName ||
      player?.robloxUsername ||
      'Anonymous'
    );
  };

  return (
    <div className="leaderboard-page">
      <div className="card">
        <h2 className="card-title">Leaderboard</h2>

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
                      <td>{secondaryValue}</td>
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
                  <td colSpan={activeTab !== 'highestStreak' ? 5 : 3} style={{ textAlign: 'center' }}>
                    No data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LeaderboardPage;
