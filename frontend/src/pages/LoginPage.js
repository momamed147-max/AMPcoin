import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import Logo from '../components/Logo';
import './AuthPage.css';

const LoginPage = () => {
  const [step, setStep] = useState(1); // 1 = username, 2 = bio code
  const [robloxUsername, setRobloxUsername] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { requestVerifyCode, verifyAndRegister, loading: authLoading } = useAuth();

  const handleGetCode = async (e) => {
    e.preventDefault();
    setError('');
    if (!robloxUsername.trim()) {
      setError('Please enter your Roblox username');
      return;
    }
    setLoading(true);
    try {
      const result = await requestVerifyCode(robloxUsername.trim());
      if (result.success) {
        setCode(result.code);
        setStep(2);
      } else {
        setError(result.message || 'Could not create code');
      }
    } catch (err) {
      setError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await verifyAndRegister({ robloxUsername: robloxUsername.trim() });
      if (result.success) {
        navigate('/coinflip');
      } else {
        setError(result.message || 'Verification failed');
      }
    } catch (err) {
      setError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
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

        {step === 1 ? (
          <form onSubmit={handleGetCode}>
            <h2 className="auth-title">Sign In</h2>
            <p className="auth-sub">Enter your Roblox username to get a verification code.</p>

            {error && <div className="auth-error" role="alert">{error}</div>}

            <label className="auth-label" htmlFor="robloxUsername">Roblox Username</label>
            <input
              type="text"
              id="robloxUsername"
              value={robloxUsername}
              onChange={(e) => { setRobloxUsername(e.target.value); setError(''); }}
              className="auth-input"
              placeholder="Enter your Roblox username"
              autoComplete="off"
            />

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? 'Please wait...' : 'Get Verification Code'}
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
            <button
              type="button"
              className="auth-btn-secondary"
              onClick={() => { setStep(1); setError(''); }}
            >
              ← Use a different username
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
