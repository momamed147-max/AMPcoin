import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import './ProfilePage.css';

const DEFAULT_AVATAR = '/default-avatar.png';

function getFallbackAvatar(user) {
  if (user?.robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxUserId}&width=420&height=420&format=png`;
  }
  return DEFAULT_AVATAR;
}

const ProfilePage = () => {
  const { user, loading: authLoading, updateUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user) {
      setProfile(user);
      setEditData({
        displayName: user.displayName,
        robloxUsername: user.robloxUsername
      });
    }
    setLoading(false);
  }, [user]);

  const refreshRobloxProfile = useCallback(async () => {
    if (!user?.robloxUsername) return;
    setRefreshing(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/users/profile/${encodeURIComponent(user.robloxUsername)}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`
          }
        }
      );
      if (res.ok) {
        const data = await res.json();
        const patch = {};
        if (data.avatar) patch.avatar = data.avatar;
        if (data.displayName) {
          patch.robloxDisplayName = data.displayName;
          patch.displayName = data.displayName;
        }
        if (data.robloxUserId) patch.robloxUserId = data.robloxUserId;
        if (Object.keys(patch).length > 0) {
          const updated = { ...(profile || user), ...patch };
          setProfile(updated);
          updateUser(patch);
          setMessage('Roblox profile refreshed successfully!');
        } else {
          setMessage('No new profile data available.');
        }
      } else {
        setMessage('Failed to refresh Roblox profile.');
      }
    } catch (err) {
      console.error('Refresh profile error:', err);
      setMessage('Error refreshing profile.');
    } finally {
      setRefreshing(false);
      setTimeout(() => setMessage(''), 3000);
    }
  }, [user, profile, updateUser]);

  const handleEditToggle = () => {
    setEditing(!editing);
    if (!editing && profile) {
      setEditData({
        displayName: profile.displayName,
        robloxUsername: profile.robloxUsername
      });
    }
  };

  const handleSave = async () => {
    try {
      const updatedProfile = {
        ...profile,
        displayName: editData.displayName,
        robloxUsername: editData.robloxUsername
      };

      setProfile(updatedProfile);
      updateUser({
        displayName: editData.displayName,
        robloxUsername: editData.robloxUsername
      });
      setEditing(false);
      setMessage('Profile saved. Click "Refresh from Roblox" to update display name and avatar.');

      setTimeout(() => setMessage(''), 4000);
    } catch (error) {
      console.error('Error updating profile:', error);
      setMessage('Error updating profile');
    }
  };

  const handleChange = (e) => {
    setEditData({
      ...editData,
      [e.target.name]: e.target.value
    });
  };

  if (authLoading || loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="error-container">
        <p>Error loading profile</p>
      </div>
    );
  }

  const displayName = profile.robloxDisplayName || profile.displayName || profile.robloxUsername || 'Anonymous';
  const avatarSrc = profile.avatar || getFallbackAvatar(profile);
  const winRate =
    profile.gamesPlayed && profile.gamesPlayed > 0
      ? Math.round((profile.gamesWon / profile.gamesPlayed) * 100)
      : 0;

  return (
    <div className="profile-container">
      <div className="profile-header">
        <h1>User Profile</h1>
        <div className="profile-header-actions">
          <button
            className="btn btn-secondary"
            onClick={refreshRobloxProfile}
            disabled={refreshing || !profile.robloxUsername}
            style={{ marginRight: '10px' }}
          >
            {refreshing ? <><Icon name="refresh" size={14} /> Refreshing...</> : <><Icon name="refresh" size={14} /> Refresh from Roblox</>}
          </button>
          <button className="btn btn-primary" onClick={handleEditToggle}>
            {editing ? 'Cancel' : 'Edit Profile'}
          </button>
        </div>
      </div>

      {message && <div className="message">{message}</div>}

      <div className="profile-card">
        <div className="profile-image-section">
          <div className="profile-image-wrap">
            <img
              src={avatarSrc || DEFAULT_AVATAR}
              alt={`${displayName}'s avatar`}
              className="profile-image"
              onError={(e) => {
                const fb = getFallbackAvatar(profile);
                if (e.target.src !== fb) e.target.src = fb;
                else if (e.target.src !== DEFAULT_AVATAR) e.target.src = DEFAULT_AVATAR;
              }}
            />
          </div>
          <div className="profile-names">
            <h2 className="profile-display-name">{displayName}</h2>
            {profile.robloxDisplayName && (
              <p className="profile-roblox-badge">
                Roblox Display Name · @{profile.robloxUsername || '—'}
              </p>
            )}
          </div>
        </div>

        <div className="profile-details">
          {editing ? (
            <div className="edit-form">
              <div className="form-group">
                <label htmlFor="displayName">Custom Display Name (optional):</label>
                <input
                  type="text"
                  id="displayName"
                  name="displayName"
                  value={editData.displayName}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Leave blank to use Roblox display name"
                />
                <small className="form-hint">
                  Note: Roblox Display Name from Roblox API takes priority when available.
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="robloxUsername">Roblox Username:</label>
                <input
                  type="text"
                  id="robloxUsername"
                  name="robloxUsername"
                  value={editData.robloxUsername}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>

              <button className="btn btn-success" onClick={handleSave}>
                Save Changes
              </button>
            </div>
          ) : (
            <>
              <div className="profile-fields-grid">
                <div className="profile-field">
                  <label>Roblox Display Name</label>
                  <p className="profile-field-value roblox-display">
                    {profile.robloxDisplayName || displayName}{' '}
                    {profile.robloxDisplayName && (
                      <span className="verified-roblox"><Icon name="check" size={11} /> Roblox</span>
                    )}
                  </p>
                </div>

                <div className="profile-field">
                  <label>Roblox Username</label>
                  <p className="profile-field-value mono">
                    @{profile.robloxUsername || '—'}
                  </p>
                </div>

                <div className="profile-field">
                  <label>Internal User ID</label>
                  <p className="profile-field-value mono small">{profile.id}</p>
                </div>

                <div className="profile-field">
                  <label>Balance</label>
                  <p className="profile-field-value balance">
                    {Number(profile.balance || 0).toLocaleString()} AMP
                  </p>
                </div>

              </div>

              <div className="profile-stats">
                <div className="stat">
                  <span className="stat-value">{profile.gamesPlayed || 0}</span>
                  <span className="stat-label">Games Played</span>
                </div>

                <div className="stat">
                  <span className="stat-value win">{profile.gamesWon || 0}</span>
                  <span className="stat-label">Wins</span>
                </div>

                <div className="stat">
                  <span className="stat-value loss">{profile.gamesLost || 0}</span>
                  <span className="stat-label">Losses</span>
                </div>

                <div className="stat">
                  <span className="stat-value rate">{winRate}%</span>
                  <span className="stat-label">Win Rate</span>
                </div>

                <div className="stat">
                  <span className="stat-value">
                    {Number(profile.totalDeposited || 0).toLocaleString()}
                  </span>
                  <span className="stat-label">Total Deposited</span>
                </div>

                <div className="stat">
                  <span className="stat-value">
                    {Number(profile.totalWithdrawn || 0).toLocaleString()}
                  </span>
                  <span className="stat-label">Total Withdrawn</span>
                </div>
              </div>

              {profile.robloxUserId && (
                <div className="profile-meta">
                  <small>Roblox User ID: {profile.robloxUserId}</small>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
