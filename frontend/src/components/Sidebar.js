import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProfileModal from './ProfileModal';
import Logo from './Logo';
import Icon from './Icon';

const DEFAULT_AVATAR = '/default-avatar.png';

function getFallbackAvatar(user) {
  if (user?.robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxUserId}&width=420&height=420&format=png`;
  }
  return DEFAULT_AVATAR;
}

function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);

  if (!user) return null;

  const isStaff = !!(user.isAdmin || user.isModerator);
  const staffLabel = user.isAdmin ? 'Admin' : 'Moderator';

  const navItems = [
    { path: '/coinflip', label: 'Coinflip', icon: 'coin' },
    { path: '/jackpot', label: 'Jackpot', icon: 'jackpot' },
    { path: '/trading', label: 'Trading', icon: 'wave' },
    { path: '/stats', label: 'Stats', icon: 'chart' },
    { path: '/provably-fair', label: 'Fair', icon: 'shield' },
    { action: 'values', label: 'Values', icon: 'search' }
  ];

  return (
    <nav className="sidebar" aria-label="Main navigation">
      <Link to="/coinflip" className="sidebar-brand" aria-label="AMPcoin home">
        <Logo size={31} />
        <span className="brand-live" aria-label="Servers online">
          <span /> LIVE
        </span>
      </Link>

      <div className="sidebar-nav-scroll">
        <div className="nav-section">
          {navItems.map((item) =>
            item.action === 'values' ? (
              <button
                type="button"
                key="values"
                className="nav-link"
                onClick={() => window.dispatchEvent(new CustomEvent('ampcoin:open-values'))}
                aria-label="Open item values"
              >
                <Icon name={item.icon} size={15} />
                <span className="nav-label">{item.label}</span>
              </button>
            ) : (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
                aria-label={item.label}
                aria-current={location.pathname === item.path ? 'page' : undefined}
              >
                <Icon name={item.icon} size={15} />
                <span className="nav-label">{item.label}</span>
              </Link>
            )
          )}
        </div>

        {isStaff && (
          <div className="nav-section nav-section-admin">
            <span className="nav-section-rule" />
            <Link
              to="/admin"
              className={`nav-link ${location.pathname === '/admin' ? 'active' : ''}`}
              aria-label={`${staffLabel} panel`}
              aria-current={location.pathname === '/admin' ? 'page' : undefined}
            >
              <Icon name={user.isAdmin ? 'gear' : 'shield'} size={15} />
              <span className="nav-label">{staffLabel}</span>
            </Link>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="user-info" onClick={() => setProfileOpen(true)} aria-label="Open your profile">
          <span className="user-avatar-wrap">
            <img
              src={user.avatar || getFallbackAvatar(user)}
              alt={user.displayName || user.robloxUsername}
              className="user-avatar"
              onError={(e) => { e.currentTarget.src = getFallbackAvatar(user); }}
            />
            <span className="user-online-dot" />
          </span>
          <div className="user-details">
            <span className="user-name">{user.displayName || user.robloxUsername}</span>
            <span className="user-handle">@{user.robloxUsername || 'player'}</span>
          </div>
          {isStaff && <span className={`admin-badge ${user.isModerator ? 'moderator' : ''}`}>{staffLabel}</span>}
        </button>
        <button className="logout-btn" onClick={logout} title="Log out" aria-label="Log out">
          <Icon name="door" size={16} />
          <span className="logout-label">Log out</span>
        </button>
      </div>

      {profileOpen && (
        <ProfileModal
          viewer={user}
          profileUser={user}
          isOwn
          onClose={() => setProfileOpen(false)}
        />
      )}
    </nav>
  );
}

export default Sidebar;
