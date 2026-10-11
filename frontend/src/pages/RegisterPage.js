import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
// Shared with LoginPage - both render the auth-step list and the same form
// layout. Without this the whole page rendered unstyled.
import './AuthPage.css';

const RegisterPage = () => {
  const [step, setStep] = useState(1); // 1: credentials, 2: is this u?, 3: bio code
  const [formData, setFormData] = useState({
    robloxUsername: '',
    password: '',
    confirmPassword: ''
  });
  const [account, setAccount] = useState(null); // resolved roblox account
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { resolveRobloxAccount, requestVerifyCode, verifyAndRegister, loading: authLoading } = useAuth();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  // Step 1 -> resolve the Roblox account
  const handleLookup = async (e) => {
    e.preventDefault();
    setError('');
    if (!formData.robloxUsername.trim()) {
      setError('Please enter your Roblox username');
      return;
    }
    if (!formData.password) {
      setError('Please enter a password');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }
    setLoading(true);
    try {
      const result = await resolveRobloxAccount(formData.robloxUsername.trim());
      if (result.success) {
        setAccount(result.account);
        setStep(2);
      } else {
        setError(result.message || 'Roblox user not found');
      }
    } catch (err) {
      setError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2 confirm -> backend issues the bio code
  const handleConfirmAccount = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await requestVerifyCode(account.robloxUsername);
      if (result.success) {
        setCode(result.code);
        setStep(3);
      } else {
        setError(result.message || 'Could not create verification code');
      }
    } catch (err) {
      setError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3 verify -> backend checks the bio, creates the account
  const handleVerify = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await verifyAndRegister({
        robloxUsername: account.robloxUsername,
        password: formData.password
      });
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
        <h2 className="auth-title">Register</h2>
        <p className="auth-sub">Create an account to start betting.</p>
        <div className="auth-steps">
          <span className={step >= 1 ? 'active' : ''}>1. Account</span>
          <span className={step >= 2 ? 'active' : ''}>2. Is this u?</span>
          <span className={step >= 3 ? 'active' : ''}>3. Verify</span>
        </div>

        {error && <div className="auth-error" role="alert">{error}</div>}

        {step === 1 && (
          <form onSubmit={handleLookup}>
        <label htmlFor="robloxUsername" className="auth-label">Roblox Username</label>
              <input
                type="text"
                id="robloxUsername"
                name="robloxUsername"
                value={formData.robloxUsername}
                onChange={handleChange}
                className="auth-input"
                placeholder="Enter your Roblox username"
                required
              />
        <label htmlFor="password" className="auth-label">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="auth-input"
                placeholder="Enter your password"
                required
              />
        <label htmlFor="confirmPassword" className="auth-label">Confirm Password</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="auth-input"
                placeholder="Confirm your password"
                required
              />
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? 'Looking up...' : 'Continue'}
            </button>
          </form>
        )}

        {step === 2 && account && (
          <div>
            <h3 className="auth-title">Is this u?</h3>
            <img
              src={account.avatar || '/default-avatar.png'}
              alt="Roblox avatar"
              className="auth-logo"
              onError={(e) => { e.target.src = '/default-avatar.png'; }}
            />
            <div className="auth-title">{account.displayName}</div>
            <div className="auth-sub">@{account.robloxUsername}</div>
            <div className="auth-form">
              <button className="auth-btn-secondary" onClick={() => setStep(1)} disabled={loading}>
                Back
              </button>
              <button className="auth-btn" onClick={handleConfirmAccount} disabled={loading}>
                {loading ? 'Please wait...' : 'Confirm'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h3 className="auth-title">Prove it's you</h3>
            <p className="auth-sub">
              Put this code in your Roblox bio (profile description), then press Verify.
            </p>
            <div className="auth-code-box">{code}</div>
            <div className="auth-form">
              <button className="auth-btn-secondary" onClick={() => setStep(2)} disabled={loading}>
                Back
              </button>
              <button className="auth-btn" onClick={handleVerify} disabled={loading}>
                {loading ? 'Checking bio...' : 'Verify'}
              </button>
            </div>
          </div>
        )}

        <div className="auth-sub">
          <p>
            Already have an account? <Link to="/login">Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
