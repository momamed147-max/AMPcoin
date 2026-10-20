import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import Logo from '../components/Logo';
import { playError } from '../sound';
import { API_BASE } from '../apiConfig';
import {
  getRememberedDevice,
  getRememberedDevices,
  saveRememberedDevice
} from '../rememberedDevice';
import './AuthPage.css';

const LOCAL_DEV_TOOLS = process.env.NODE_ENV !== 'production';

function rememberedAvatar(entry) {
  if (entry?.avatar) return entry.avatar;
  if (entry?.robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${entry.robloxUserId}&width=420&height=420&format=png`;
  }
  return '/default-avatar.svg';
}

function rememberedDisplayName(entry) {
  return entry?.displayName || entry?.robloxDisplayName || entry?.username || 'Roblox account';
}

const LoginPage = () => {
  const initialRemembered = React.useMemo(() => getRememberedDevice(), []);
  const [step, setStep] = useState(1); // 1 = username, 2 = bio code
  const [robloxUsername, setRobloxUsername] = useState(initialRemembered?.username || '');
  const [rememberedDevice, setRememberedDevice] = useState(initialRemembered);
  const [rememberedAccounts, setRememberedAccounts] = useState(() => getRememberedDevices());
  const [rememberMe, setRememberMe] = useState(!!initialRemembered);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [devName, setDevName] = useState('local-player-1');
  const [devLoading, setDevLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionBusy, setSessionBusy] = useState('');
  const navigate = useNavigate();
  const {
    requestVerifyCode,
    verifyAndRegister,
    rememberedLogin,
    forgetRememberedDevice,
    devLogin,
    loading: authLoading
  } = useAuth();

  // Old remembered entries were saved before the profile snapshot existed.
  // Resolve those lazily so the picker can still show a face and a name.
  React.useEffect(() => {
    const missing = rememberedAccounts.filter(
      (entry) => entry.username && (!entry.avatar || !entry.displayName)
    );
    if (!missing.length) return undefined;
    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(missing.map(async (entry) => {
        try {
          const res = await fetch(
            `${API_BASE}/api/users/profile/${encodeURIComponent(entry.username)}`
          );
          if (!res.ok) return null;
          const profile = await res.json();
          const avatar = profile.avatar
            || (profile.robloxUserId
              ? `https://www.roblox.com/headshot-thumbnail/image?userId=${profile.robloxUserId}&width=420&height=420&format=png`
              : '');
          const displayName = profile.displayName || profile.robloxDisplayName || entry.username;
          const robloxUserId = profile.robloxUserId || entry.robloxUserId || null;
          saveRememberedDevice({
            ...entry,
            displayName,
            avatar,
            robloxUserId
          });
          return { username: entry.username, displayName, avatar, robloxUserId };
        } catch (_) {
          return null;
        }
      }));
      if (cancelled) return;
      const updates = new Map(
        resolved.filter(Boolean).map((item) => [item.username.toLowerCase(), item])
      );
      if (updates.size) {
        setRememberedAccounts((list) => list.map((entry) => {
          const update = updates.get(entry.username.toLowerCase());
          return update ? { ...entry, ...update } : entry;
        }));
      }
    })();
    return () => { cancelled = true; };
    // This runs once for the entries present when the login screen mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showLoginError = (message) => {
    setError(message);
    playError();
  };

  const handleGetCode = async (e) => {
    e.preventDefault();
    setError('');
    const username = robloxUsername.trim();
    if (!username) {
      showLoginError('Please enter your Roblox username');
      return;
    }
    setLoading(true);
    try {
      // A remembered browser skips the bio step entirely. If the token has
      // expired, fall through to the normal code flow instead of making the
      // player start over.
      if (rememberMe && rememberedDevice) {
        const remembered = await rememberedLogin(username);
        if (remembered.success) {
          navigate('/coinflip');
          return;
        }
        setRememberedDevice(getRememberedDevice(username));
      }

      const result = await requestVerifyCode(username);
      if (result.success) {
        setCode(result.code);
        setStep(2);
      } else {
        showLoginError(result.message || 'Could not create code');
      }
    } catch (err) {
      showLoginError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await verifyAndRegister({
        robloxUsername: robloxUsername.trim(),
        remember: rememberMe
      });
      if (result.success) {
        navigate('/coinflip');
      } else {
        showLoginError(result.message || 'Verification failed');
      }
    } catch (err) {
      showLoginError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleUsernameChange = (value) => {
    setRobloxUsername(value);
    setError('');
    const saved = value.trim() ? getRememberedDevice(value) : null;
    setRememberedDevice(saved);
    // Switching to a different remembered account opts back in. Editing the
    // same one after unticking the box does not silently re-tick it.
    if (saved && saved.token !== rememberedDevice?.token) setRememberMe(true);
  };

  // One click on a remembered account exchanges its device token for a normal
  // session. This is the path that deliberately skips the Roblox bio code.
  const startRememberedAccount = async (entry) => {
    if (!entry || sessionBusy) return;
    setError('');
    setSessionBusy(entry.username);
    try {
      const result = await rememberedLogin(entry.username);
      if (result.success) {
        navigate('/coinflip');
        return;
      }
      showLoginError(result.message || 'Could not sign in from this device.');
      setRememberedAccounts(getRememberedDevices());
      if (String(entry.username).toLowerCase() === String(robloxUsername).toLowerCase()) {
        setRememberedDevice(null);
        setRememberMe(false);
      }
    } catch (err) {
      showLoginError(err.message || 'Network error. Please try again.');
    } finally {
      setSessionBusy('');
    }
  };

  const forgetAccount = async (entry, event) => {
    event.stopPropagation();
    if (!entry || sessionBusy) return;
    await forgetRememberedDevice(entry.username);
    setRememberedAccounts(getRememberedDevices());
    if (String(entry.username).toLowerCase() === String(robloxUsername).toLowerCase()) {
      setRememberedDevice(null);
      setRememberMe(false);
    }
  };

  const handleDevLogin = async (event) => {
    event.preventDefault();
    if (!devName.trim()) return;
    setDevLoading(true);
    setError('');
    const result = await devLogin(devName.trim());
    setDevLoading(false);
    if (result.success) navigate('/rps');
    else showLoginError(result.message || 'Local test login failed');
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus('Copied');
      setTimeout(() => setCopyStatus(''), 1800);
    } catch (_) {
      setCopyStatus('Copy failed');
    }
  };

  if (authLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Logo size={44} textSize="1.7rem" />
        </div>

        {/* Two steps, named. Without this the second screen reads as a
            different product rather than as the next page of this one. */}
        <ol className="auth-progress">
          <li className={`auth-progress-step ${step === 1 ? 'is-current' : 'is-done'}`}>
            <span className="auth-progress-dot" aria-hidden="true" />
            Username
          </li>
          <li className="auth-progress-sep" aria-hidden="true" />
          <li className={`auth-progress-step ${step === 2 ? 'is-current' : ''}`}>
            <span className="auth-progress-dot" aria-hidden="true" />
            Verify
          </li>
        </ol>

        {step === 1 ? (
          <form onSubmit={handleGetCode}>
            <h2 className="auth-title">Sign In</h2>
            <p className="auth-sub">
              {rememberedAccounts.length
                ? 'Pick an account that is already signed in on this device, or use a code.'
                : rememberedDevice
                  ? 'This device is remembered. Continue below without changing your Roblox bio.'
                  : 'Enter your Roblox username to get a verification code.'}
            </p>

            {rememberedAccounts.length > 0 && (
              <section className="auth-saved" aria-label="Remembered accounts">
                <div className="auth-saved-head">
                  <span>Already signed in</span>
                  <small>Remembered on this device</small>
                </div>
                <div className="auth-saved-list">
                  {rememberedAccounts.map((entry) => {
                    const busy = sessionBusy === entry.username;
                    return (
                      <div className="auth-saved-row" key={entry.username}>
                        <button
                          type="button"
                          className="auth-saved-account"
                          onClick={() => startRememberedAccount(entry)}
                          disabled={!!sessionBusy || loading}
                        >
                          <img
                            className="auth-saved-avatar"
                            src={rememberedAvatar(entry)}
                            alt=""
                            onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                          />
                          <span className="auth-saved-copy">
                            <span className="auth-saved-name">{rememberedDisplayName(entry)}</span>
                            <span className="auth-saved-user">@{entry.username}</span>
                          </span>
                          <span className="auth-saved-cta">{busy ? 'Signing in...' : 'Continue'}</span>
                        </button>
                        <button
                          type="button"
                          className="auth-saved-forget"
                          onClick={(event) => forgetAccount(entry, event)}
                          disabled={!!sessionBusy}
                          aria-label={`Forget ${entry.username}`}
                          title="Forget this account on this device"
                        >
                          <Icon name="close" size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="auth-saved-divider"><span>or use a code</span></div>
              </section>
            )}

            {error && <div className="auth-error" role="alert">{error}</div>}

            <label className="auth-label" htmlFor="robloxUsername">Roblox Username</label>
            <input
              type="text"
              id="robloxUsername"
              value={robloxUsername}
              onChange={(e) => handleUsernameChange(e.target.value)}
              className="auth-input"
              placeholder="Enter your Roblox username"
              autoComplete="off"
            />

            {rememberedDevice && (
              <p className="auth-device-note">
                <Icon name="shield" size={14} />
                <span>
                  <strong>{rememberedDevice.username}</strong> is remembered on this device. No code needed.
                </span>
              </p>
            )}

            <label className="auth-remember">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span className="auth-remember-copy">
                <strong>Remember this device</strong>
                <small>Skip the Roblox profile code for 90 days. Only use this on a device you trust.</small>
              </span>
            </label>

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading
                ? 'Please wait...'
                : rememberedDevice && rememberMe
                  ? 'Continue Without Code'
                  : 'Get Verification Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify}>
            <h2 className="auth-title">Verify It's You</h2>
            <p className="auth-sub">
              Put this code in your <strong>Roblox profile bio</strong>, then press Verify.
            </p>

            {error && <div className="auth-error" role="alert">{error}</div>}

            <button type="button" className="auth-code-box" onClick={copyCode} title="Copy verification code">
              <span className="auth-code">{code}</span>
              <span className={`auth-copy ${copyStatus ? 'visible' : ''}`}>
                <Icon name={copyStatus === 'Copied' ? 'check' : 'board'} size={14} />
                {copyStatus && <small>{copyStatus}</small>}
              </span>
            </button>

            <ol className="auth-steps">
              <li>Go to <strong>roblox.com</strong> and open your profile</li>
              <li>Click the <strong>pencil / edit</strong> icon on your bio</li>
              <li>Paste the code above into your bio and <strong>save</strong></li>
              <li>Come back here and press <strong>Verify</strong></li>
            </ol>

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? 'Checking your bio...' : 'Verify & Sign In'}
            </button>
            {rememberMe && (
              <p className="auth-remember-note">
                <Icon name="shield" size={13} />
                This device will be remembered for 90 days after verification.
              </p>
            )}
            <button
              type="button"
              className="auth-btn-secondary"
              onClick={() => { setStep(1); setError(''); }}
            >
              ← Use a different username
            </button>
          </form>
        )}

        {LOCAL_DEV_TOOLS && (
          <div className="auth-dev-panel">
            <div className="auth-dev-heading"><span><Icon name="target" size={13} /> Local test mode</span><small>local only</small></div>
            <p>Use a throwaway local account to test the games without Roblox verification. Sign in as <code>local-admin</code> to reach the admin panel.</p>
            <form onSubmit={handleDevLogin} className="auth-dev-form">
              <input value={devName} onChange={(event) => setDevName(event.target.value)} placeholder="local-player-1" aria-label="Local test username" maxLength={32} />
              <button type="submit" className="auth-btn-secondary" disabled={devLoading}>{devLoading ? 'Starting...' : 'Use local account'}</button>
            </form>
            <small className="auth-dev-note">Open a second browser profile with another name to test 1v1 RPS and coinflip.</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
