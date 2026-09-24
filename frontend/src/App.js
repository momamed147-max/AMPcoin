import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';

import './App.css';
import './giveaways-notifications.css';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Logo from './components/Logo';
import CoinflipPage from './pages/CoinflipPage';
import BlackjackPage from './pages/BlackjackPage';
import JackpotPage from './pages/JackpotPage';
import TradingPage from './pages/TradingPage';
import WalletPage from './pages/WalletPage';
import StatsPage from './pages/StatsPage';
import ProvablyFairPage from './pages/ProvablyFairPage';
import LoginPage from './pages/LoginPage';
import ProfilePage from './pages/ProfilePage';
import AdminPanel from './pages/AdminPanel';
import ChatPanel from './components/ChatPanel';
import ValueChecker from './components/ValueChecker';
import AnimatedPopup from './components/AnimatedPopup';
import AuthProvider, { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Icon from './components/Icon';

const BACKEND_URL = process.env.REACT_APP_API_URL || 'https://ampcoin-50q9kxt9.b4a.run';
const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  withCredentials: true,
  reconnection: true,
  reconnectionAttempts: 20,
  reconnectionDelay: 1000,
  timeout: 10000
});

function AppContent() {
  const { user, loading, refreshUser } = useAuth();
  const location = useLocation();
  const [balance, setBalance] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [valuesOpen, setValuesOpen] = useState(false);
  const [discordPopup, setDiscordPopup] = useState(null);
  const [apiDown, setApiDown] = useState(false);

  // Backend reachability canary — shows a banner instead of silent failures
  const checkApi = async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      await fetch(`${BACKEND_URL}/api/auth/discord/status`, { signal: ctrl.signal });
      clearTimeout(t);
      setApiDown(false);
    } catch (_) {
      setApiDown(true);
    }
  };

  useEffect(() => {
    checkApi();
    const t = setInterval(checkApi, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global "Values" modal — opened from sidebar, top nav, or coinflip page
  useEffect(() => {
    const open = () => setValuesOpen(true);
    window.addEventListener('ampcoin:open-values', open);
    return () => window.removeEventListener('ampcoin:open-values', open);
  }, []);

  // Discord OAuth return flags (?discord=linked etc.)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const flag = q.get('discord');
    if (!flag) return;
    const map = {
      linked: ['Discord account linked!', 'success'],
      error_taken: ['That Discord is already linked to another account.', 'error'],
      error_expired: ['Link expired — try again.', 'error'],
      error_token: ['Discord rejected the request — try again.', 'error'],
      error_profile: ['Could not read your Discord profile.', 'error'],
      error_nouser: ['Account not found — log in again.', 'error'],
      error_server: ['Server error — try again later.', 'error']
    };
    const [msg, type] = map[flag] || ['Discord linking finished.', 'info'];
    setDiscordPopup({ message: msg, type });
    window.history.replaceState({}, '', window.location.pathname);
    if (flag === 'linked' && refreshUser) {
      setTimeout(() => { try { refreshUser(); } catch (_) {} }, 500);
    }
  }, [refreshUser]);

  useEffect(() => {
    if (user) {
      setBalance(user.balance);
    }
  }, [user]);

  useEffect(() => {
    socket.on('balanceUpdate', (data) => {
      if (data.userId === user?.id) {
        setBalance(data.newBalance);
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        storedUser.balance = data.newBalance;
        localStorage.setItem('user', JSON.stringify(storedUser));
      }
    });
    socket.on('onlineCountUpdate', () => {});
    return () => {
      socket.off('balanceUpdate');
      socket.off('onlineCountUpdate');
    };
  }, [user]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="app-loading-logo"><Logo size={64} showText={false} /></div>
        <div className="loading-spinner"></div>
        <p>Loading AMPbet...</p>
      </div>
    );
  }

  return (
    <div className="app">
      {apiDown && (
        <div className="api-down-banner">
          <span>Cannot reach the game server — it may be offline or redeploying.</span>
          <button onClick={checkApi}>Retry</button>
        </div>
      )}
      {user && <Sidebar />}
      <div className="layout-columns">
        {user && (
          <>
            <div
              className={`chat-backdrop ${mobileChatOpen ? 'show' : ''}`}
              onClick={() => setMobileChatOpen(false)}
            />
            <div className={`chat-column ${mobileChatOpen ? 'mobile-open' : ''}`}>
              <ChatPanel socket={socket} chatOpen={true} />
            </div>
          </>
        )}
        <div className="main-content">
          {user && <Header balance={balance} setBalance={setBalance} notifications={notifications} socket={socket} />}
          <div className="page-content" key={location.pathname}>
            <Routes>
              <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/coinflip" />} />
              <Route path="/register" element={<Navigate to="/login" replace />} />
              <Route path="/" element={user ? <Navigate to="/coinflip" replace /> : <Navigate to="/login" replace />} />
              <Route path="/coinflip" element={<ProtectedRoute><CoinflipPage socket={socket} setBalance={setBalance} /></ProtectedRoute>} />
              <Route path="/jackpot" element={<ProtectedRoute><JackpotPage socket={socket} setBalance={setBalance} /></ProtectedRoute>} />
              <Route path="/trading" element={<ProtectedRoute><TradingPage socket={socket} /></ProtectedRoute>} />
              <Route path="/blackjack" element={<ProtectedRoute><JackpotPage socket={socket} setBalance={setBalance} /></ProtectedRoute>} />
              <Route path="/wallet" element={<ProtectedRoute><Navigate to="/coinflip" replace /></ProtectedRoute>} />
              <Route path="/stats" element={<ProtectedRoute><StatsPage /></ProtectedRoute>} />
              <Route path="/provably-fair" element={<ProtectedRoute><ProvablyFairPage /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
              <Route path="/admin" element={<ProtectedRoute adminOnly={true}><AdminPanel /></ProtectedRoute>} />
            </Routes>
          </div>
        </div>
      </div>
      {user && (
        <button
          className="mobile-chat-fab"
          onClick={() => setMobileChatOpen((v) => !v)}
          aria-label="Toggle chat"
        >
          {mobileChatOpen ? '✕' : <Icon name="chat" size={18} />}
        </button>
      )}
      <ValueChecker isOpen={valuesOpen} onClose={() => setValuesOpen(false)} />
      {discordPopup && (
        <AnimatedPopup
          message={discordPopup.message}
          type={discordPopup.type}
          onClose={() => setDiscordPopup(null)}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

export default App;
