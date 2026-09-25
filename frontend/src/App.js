import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';

import './App.css';
import './giveaways-notifications.css';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Logo from './components/Logo';
import CoinflipPage from './pages/CoinflipPage';
import JackpotPage from './pages/JackpotPage';
import TradingPage from './pages/TradingPage';
import StatsPage from './pages/StatsPage';
import ProvablyFairPage from './pages/ProvablyFairPage';
import LoginPage from './pages/LoginPage';
import ProfilePage from './pages/ProfilePage';
import AdminPanel from './pages/AdminPanel';
import ChatPanel from './components/ChatPanel';
import ValueChecker from './components/ValueChecker';
import AuthProvider, { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Icon from './components/Icon';
import { API_BASE } from './apiConfig';
import { installGlobalSoundEffects, playError } from './sound';
import { initializeTheme } from './theme';

const BACKEND_URL = API_BASE;
const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  withCredentials: true,
  reconnection: true,
  reconnectionAttempts: 20,
  reconnectionDelay: 1000,
  timeout: 10000
});

function AppContent() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [balance, setBalance] = useState(0);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [valuesOpen, setValuesOpen] = useState(false);
  const [apiDown, setApiDown] = useState(false);
  const apiDownRef = useRef(false);

  // Backend reachability canary — shows a banner instead of silent failures
  const checkApi = async () => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    try {
      const response = await fetch(`${BACKEND_URL}/api/health`, { signal: ctrl.signal });
      if (!response.ok) throw new Error(`API check failed (${response.status})`);
      apiDownRef.current = false;
      setApiDown(false);
    } catch (_) {
      if (!apiDownRef.current) playError();
      apiDownRef.current = true;
      setApiDown(true);
    } finally {
      clearTimeout(timeout);
    }
  };

  useEffect(() => {
    checkApi();
    const t = setInterval(checkApi, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => installGlobalSoundEffects(), []);
  useEffect(() => { initializeTheme(); }, []);

  // Global "Values" modal — opened from sidebar, top nav, or coinflip page
  useEffect(() => {
    const open = () => setValuesOpen(true);
    window.addEventListener('ampcoin:open-values', open);
    return () => window.removeEventListener('ampcoin:open-values', open);
  }, []);

  useEffect(() => {
    if (!mobileChatOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileChatOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileChatOpen]);

  useEffect(() => {
    const closeTopDialogOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      const topDialog = dialogs[dialogs.length - 1];
      if (!topDialog) return;
      const closeButton = topDialog.querySelector(
        'button[aria-label^="Close"], .close-modal, .ipm-close, .wm-close, .vc-close, .cf-modal-close, .profile-close, .modal-close-btn'
      );
      if (closeButton) closeButton.click();
    };
    document.addEventListener('keydown', closeTopDialogOnEscape);
    return () => document.removeEventListener('keydown', closeTopDialogOnEscape);
  }, []);

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
        <div className="api-down-banner" role="status">
          <Icon name="warn" size={15} />
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
          {user && <Header balance={balance} setBalance={setBalance} socket={socket} />}
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
              <Route path="*" element={(
                <div className="request-state">
                  <Icon name="search" size={26} />
                  <strong>Page not found</strong>
                  <span>The page you requested does not exist or has moved.</span>
                  <button type="button" className="btn btn-primary" onClick={() => window.location.assign('/coinflip')}>
                    Return to Coinflip
                  </button>
                </div>
              )} />
            </Routes>
          </div>
        </div>
      </div>
      {user && (
        <button
          className="mobile-chat-fab"
          onClick={() => setMobileChatOpen((v) => !v)}
          aria-label={mobileChatOpen ? 'Close chat' : 'Open live chat'}
          aria-expanded={mobileChatOpen}
        >
          <Icon name={mobileChatOpen ? 'close' : 'chat'} size={18} />
        </button>
      )}
      <ValueChecker isOpen={valuesOpen} onClose={() => setValuesOpen(false)} />
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
