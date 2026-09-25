import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../apiConfig';
import Icon from './Icon';
import ModalPortal from './ModalPortal';
import { THEMES, THEME_CHANGE_EVENT, applyTheme, getTheme } from '../theme';
import { playError } from '../sound';
import './SettingsModal.css';

const SettingsModal = ({ isOpen, onClose, initialNotice = '' }) => {
  const { user, updateUser, refreshUser } = useAuth();
  const userId = user?.id;
  const customDisplayName = user?.customDisplayName;
  const [displayName, setDisplayName] = useState('');
  const [themeId, setThemeId] = useState(() => getTheme().id);
  const [savingName, setSavingName] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [discordConfigured, setDiscordConfigured] = useState(null);
  const [notice, setNotice] = useState(initialNotice);
  const [error, setError] = useState('');
  const initializedOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      initializedOpenRef.current = false;
      return undefined;
    }

    const opening = !initializedOpenRef.current;
    initializedOpenRef.current = true;
    if (opening) {
      setDisplayName(customDisplayName || '');
      setNotice(initialNotice || '');
      setError('');
      setThemeId(getTheme().id);
      setDiscordConfigured(null);
    }

    let active = true;
    fetch(`${API_BASE}/api/auth/discord/status`)
      .then((res) => res.json())
      .then((data) => {
        if (active) setDiscordConfigured(Boolean(data?.configured));
      })
      .catch(() => {
        if (active) setDiscordConfigured(false);
      });

    const syncTheme = (event) => setThemeId(event.detail?.theme || getTheme().id);
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    return () => {
      active = false;
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
    };
  }, [isOpen, initialNotice, userId, customDisplayName]);

  if (!isOpen || !user) return null;

  const showError = (message) => {
    setError(message);
    setNotice('');
    playError();
  };

  const saveDisplayName = async (event) => {
    event.preventDefault();
    const nextName = displayName.trim();
    if (nextName.length > 32) {
      showError('Display names must be 32 characters or fewer.');
      return;
    }

    setSavingName(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API_BASE}/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ displayName: nextName })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Could not save your display name.');

      const savedUser = data.user || data || {
        ...user,
        displayName: nextName || user.robloxDisplayName || user.robloxUsername,
        customDisplayName: nextName || null
      };
      updateUser(savedUser);
      setDisplayName(nextName);
      setNotice(nextName ? 'Display name saved.' : 'Your Roblox display name is being used.');
    } catch (err) {
      showError(err.message || 'Could not save your display name.');
    } finally {
      setSavingName(false);
    }
  };

  const selectTheme = (id) => {
    setThemeId(id);
    applyTheme(id);
  };

  const linkDiscord = () => {
    if (discordConfigured === false) {
      showError('Discord linking is not configured on this server yet.');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      showError('Your session expired. Please log in again.');
      return;
    }
    window.location.assign(`${API_BASE}/api/auth/discord?token=${encodeURIComponent(token)}`);
  };

  const unlinkDiscord = async () => {
    if (discordBusy) return;
    setDiscordBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API_BASE}/api/users/unlink-discord`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Could not unlink Discord.');
      updateUser(data.user || { ...user, discordId: null, discordUsername: null, discordAvatar: null });
      setNotice('Discord account unlinked.');
      if (refreshUser) await refreshUser(false);
    } catch (err) {
      showError(err.message || 'Could not unlink Discord.');
    } finally {
      setDiscordBusy(false);
    }
  };

  return (
    <ModalPortal>
      <div className="settings-overlay" onClick={onClose}>
        <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="settings-header">
            <div className="settings-heading">
              <span className="settings-heading-icon"><Icon name="settings" size={18} /></span>
              <div>
                <h2 id="settings-title">Settings</h2>
                <p>Personalize your AMPbet experience.</p>
              </div>
            </div>
            <button className="settings-close" onClick={onClose} aria-label="Close settings">
              <Icon name="close" size={17} />
            </button>
          </div>

          <div className="settings-content">
            {(error || notice) && (
              <div className={`settings-message ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>
                <Icon name={error ? 'warn' : 'check'} size={15} />
                <span>{error || notice}</span>
              </div>
            )}

            <section className="settings-section" aria-labelledby="settings-profile-title">
              <div className="settings-section-heading">
                <span className="settings-section-icon"><Icon name="target" size={16} /></span>
                <div>
                  <h3 id="settings-profile-title">Profile</h3>
                  <p>How your name appears around AMPbet.</p>
                </div>
              </div>
              <form className="settings-form" onSubmit={saveDisplayName}>
                <label htmlFor="settings-display-name">Display name</label>
                <div className="settings-input-row">
                  <input
                    id="settings-display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={user.robloxDisplayName || user.robloxUsername || 'Your display name'}
                    maxLength={32}
                    autoComplete="nickname"
                  />
                  <span>{displayName.length}/32</span>
                </div>
                <small>Leave blank to use your Roblox display name.</small>
                <button className="btn btn-primary settings-save-button" type="submit" disabled={savingName}>
                  {savingName ? 'Saving...' : 'Save display name'}
                </button>
              </form>
            </section>

            <section className="settings-section" aria-labelledby="settings-theme-title">
              <div className="settings-section-heading">
                <span className="settings-section-icon"><Icon name="party" size={16} /></span>
                <div>
                  <h3 id="settings-theme-title">Theme</h3>
                  <p>Choose the colors used across the entire site.</p>
                </div>
              </div>
              <div className="theme-grid" role="radiogroup" aria-label="Website theme">
                {Object.values(THEMES).map((theme) => (
                  <button
                    type="button"
                    key={theme.id}
                    className={`theme-option ${themeId === theme.id ? 'selected' : ''}`}
                    onClick={() => selectTheme(theme.id)}
                    role="radio"
                    aria-checked={themeId === theme.id}
                  >
                    <span className="theme-preview" style={{ '--swatch-a': theme.swatches[0], '--swatch-b': theme.swatches[1], '--swatch-c': theme.swatches[2] }}>
                      <i /><i /><i />
                    </span>
                    <span className="theme-option-copy">
                      <strong>{theme.name}</strong>
                      <small>{theme.description}</small>
                    </span>
                    <span className="theme-check"><Icon name="check" size={13} /></span>
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-section" aria-labelledby="settings-discord-title">
              <div className="settings-section-heading">
                <span className="settings-section-icon"><Icon name="chat" size={16} /></span>
                <div>
                  <h3 id="settings-discord-title">Discord account</h3>
                  <p>Connect Discord for account linking and future community features.</p>
                </div>
              </div>
              {user.discordId ? (
                <div className="settings-discord-connected">
                  {user.discordAvatar && <img src={user.discordAvatar} alt="" />}
                  <span className="settings-discord-avatar-fallback"><Icon name="chat" size={16} /></span>
                  <div>
                    <strong>{user.discordUsername || 'Discord linked'}</strong>
                    <small>Connected to your AMPbet account</small>
                  </div>
                  <button className="btn btn-secondary settings-unlink-button" type="button" onClick={unlinkDiscord} disabled={discordBusy}>
                    {discordBusy ? 'Unlinking...' : 'Unlink'}
                  </button>
                </div>
              ) : (
                <div className="settings-discord-connect">
                  <div>
                    <strong>No Discord account linked</strong>
                    <small>{discordConfigured === false ? 'Discord linking is not configured yet.' : 'Link your Discord account to keep it connected.'}</small>
                  </div>
                  <button className="settings-discord-button" type="button" onClick={linkDiscord} disabled={discordConfigured !== true || discordBusy}>
                    <Icon name="chat" size={15} /> {discordConfigured === null ? 'Checking Discord...' : 'Link Discord'}
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};

export default SettingsModal;
