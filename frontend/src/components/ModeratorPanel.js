import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AnimatedPopup from './AnimatedPopup';
import Icon from './Icon';
import { API_BASE } from '../apiConfig';

const DEFAULT_AVATAR = '/default-avatar.png';

function fallbackAvatar(user) {
  if (user?.robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxUserId}&width=150&height=150&format=png`;
  }
  return DEFAULT_AVATAR;
}

function displayNameFor(user) {
  return user?.customDisplayName || user?.displayName || user?.robloxDisplayName || user?.robloxUsername || 'Anonymous';
}

function statusFor(user) {
  if (user?.isBanned) return 'Banned';
  if (user?.isFrozen) return 'Frozen';
  if (user?.isActive === false) return 'Inactive';
  if (user?.isMuted) return 'Muted';
  return 'Active';
}

const ModeratorPanel = ({ user }) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    mutedUsers: 0,
    totalChatMessages: 0,
    dailyActiveUsers: 0
  });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [popup, setPopup] = useState({ show: false, message: '', type: 'info' });

  const showPopup = useCallback((message, type = 'info') => {
    setPopup({ show: true, message, type });
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    try {
      const [usersResponse, statsResponse] = await Promise.all([
        fetch(`${API_BASE}/api/admin/users?limit=1000`, { headers }),
        fetch(`${API_BASE}/api/admin/dashboard`, { headers })
      ]);

      if (usersResponse.status === 401 || usersResponse.status === 403) {
        throw new Error('Your moderator session is no longer authorized.');
      }
      if (!usersResponse.ok) throw new Error(`Could not load users (${usersResponse.status}).`);
      if (!statsResponse.ok) throw new Error(`Could not load dashboard (${statsResponse.status}).`);

      const usersData = await usersResponse.json();
      const statsData = await statsResponse.json();
      setUsers(Array.isArray(usersData.users) ? usersData.users : []);
      setStats({
        totalUsers: Number(statsData.totalUsers || 0),
        activeUsers: Number(statsData.activeUsers || 0),
        mutedUsers: Number(statsData.mutedUsers || 0),
        totalChatMessages: Number(statsData.totalChatMessages || 0),
        dailyActiveUsers: Number(statsData.dailyActiveUsers || 0)
      });
    } catch (loadError) {
      setError(loadError.message || 'Could not load the moderation console.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((target) =>
      [target.displayName, target.customDisplayName, target.robloxUsername, target.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [search, users]);

  const toggleMute = async (target) => {
    if (busyId || !target) return;
    const nextMuted = !target.isMuted;
    const protectedTarget = target.isAdmin || target.isModerator || String(target.id) === String(user?.id);
    if (protectedTarget) {
      showPopup('Moderators can only mute regular player accounts.', 'warning');
      return;
    }

    setBusyId(target.id);
    try {
      const response = await fetch(
        `${API_BASE}/api/chat/${nextMuted ? 'mute' : 'unmute'}/${encodeURIComponent(target.id)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ reason: 'Moderator console action' })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `Could not ${nextMuted ? 'mute' : 'unmute'} user.`);

      const wasMuted = target.isMuted === true;
      const effectiveMuted = typeof data.user?.isMuted === 'boolean' ? data.user.isMuted : nextMuted;
      const countDelta = (effectiveMuted ? 1 : 0) - (wasMuted ? 1 : 0);
      setUsers((current) => current.map((item) => (
        item.id === target.id
          ? { ...item, ...(data.user || {}), isMuted: effectiveMuted }
          : item
      )));
      setStats((current) => ({
        ...current,
        mutedUsers: Math.max(0, current.mutedUsers + countDelta)
      }));
      showPopup(data.message || `${displayNameFor(target)} ${effectiveMuted ? 'muted' : 'unmuted'}.`, data.unchanged ? 'info' : 'success');
    } catch (muteError) {
      showPopup(muteError.message || 'The moderation action failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading moderation console...</p>
      </div>
    );
  }

  return (
    <div className="admin-panel moderator-console">
      <div className="moderator-hero">
        <div>
          <span className="moderator-eyebrow"><Icon name="shield" size={13} /> Moderator access</span>
          <h1>Moderation Console</h1>
          <p>Keep chat healthy with focused, permission-safe controls.</p>
        </div>
        <div className="moderator-scope"><Icon name="lock" size={14} /> Mute-only access</div>
      </div>

      {error && (
        <div className="admin-inline-error moderator-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={loadData}>Retry</button>
        </div>
      )}

      <div className="admin-content moderator-content">
        <div className="admin-tabs moderator-tabs" role="tablist" aria-label="Moderator sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'dashboard'}
            className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Icon name="chart" size={14} /> Dashboard
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'users'}
            className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <Icon name="users" size={14} /> Manage Users
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="moderator-dashboard">
            <div className="moderator-stat-grid">
              <div className="moderator-stat-card">
                <span className="moderator-stat-icon"><Icon name="users" size={17} /></span>
                <span className="moderator-stat-label">Total users</span>
                <strong>{stats.totalUsers.toLocaleString()}</strong>
                <small>Registered accounts</small>
              </div>
              <div className="moderator-stat-card">
                <span className="moderator-stat-icon green"><Icon name="check" size={17} /></span>
                <span className="moderator-stat-label">Active users</span>
                <strong>{stats.activeUsers.toLocaleString()}</strong>
                <small>Can access the site</small>
              </div>
              <div className="moderator-stat-card">
                <span className="moderator-stat-icon amber"><Icon name="volumeOff" size={17} /></span>
                <span className="moderator-stat-label">Muted users</span>
                <strong>{stats.mutedUsers.toLocaleString()}</strong>
                <small>Chat access restricted</small>
              </div>
              <div className="moderator-stat-card">
                <span className="moderator-stat-icon purple"><Icon name="chat" size={17} /></span>
                <span className="moderator-stat-label">Chat messages</span>
                <strong>{stats.totalChatMessages.toLocaleString()}</strong>
                <small>Stored community messages</small>
              </div>
            </div>

            <div className="moderator-info-card">
              <div className="moderator-info-icon"><Icon name="shield" size={18} /></div>
              <div>
                <strong>Focused moderation permissions</strong>
                <p>Your console intentionally exposes only Dashboard and Manage Users. The single action available in Manage Users is Mute or Unmute.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="moderator-users-view">
            <div className="moderator-section-heading">
              <div>
                <h2>Manage Users</h2>
                <p>Search players and manage chat access.</p>
              </div>
              <span className="moderator-count">{filteredUsers.length} shown</span>
            </div>

            <div className="moderator-search">
              <Icon name="search" size={15} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search username, display name, or ID"
                aria-label="Search users"
              />
              {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear user search"><Icon name="close" size={14} /></button>}
            </div>

            <div className="moderator-user-list">
              {filteredUsers.length > 0 ? filteredUsers.map((target) => {
                const status = statusFor(target);
                const isBusy = busyId === target.id;
                const isProtected = target.isAdmin || target.isModerator || String(target.id) === String(user?.id);
                return (
                  <div className={`moderator-user-row ${target.isMuted ? 'is-muted' : ''}`} key={target.id}>
                    <img
                      className="moderator-user-avatar"
                      src={target.avatar || fallbackAvatar(target)}
                      alt=""
                      onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }}
                    />
                    <div className="moderator-user-copy">
                      <strong>{displayNameFor(target)}</strong>
                      <span>@{target.robloxUsername || 'unknown'}</span>
                    </div>
                    <div className="moderator-user-state">
                      <span className={`moderator-status ${status.toLowerCase()}`}>{status}</span>
                      {target.muteReason && target.isMuted && <small title={target.muteReason}>{target.muteReason}</small>}
                    </div>
                    <button
                      type="button"
                      className={`btn btn-sm moderator-mute-btn ${target.isMuted ? 'btn-success' : 'btn-warning'}`}
                      onClick={() => toggleMute(target)}
                      disabled={isBusy || isProtected}
                      title={isProtected ? 'Staff accounts cannot be muted here' : target.isMuted ? 'Restore chat access' : 'Restrict chat access'}
                    >
                      <Icon name={target.isMuted ? 'volume' : 'volumeOff'} size={14} />
                      {isBusy ? 'Saving...' : target.isMuted ? 'Unmute' : 'Mute'}
                    </button>
                  </div>
                );
              }) : (
                <div className="moderator-empty"><Icon name="search" size={22} /><strong>No users found</strong><span>Try a different username, display name, or ID.</span></div>
              )}
            </div>
          </div>
        )}
      </div>

      <AnimatedPopup
        show={popup.show}
        message={popup.message}
        type={popup.type}
        onClose={() => setPopup((current) => ({ ...current, show: false }))}
      />
    </div>
  );
};

export default ModeratorPanel;
