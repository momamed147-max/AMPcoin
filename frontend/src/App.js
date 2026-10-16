import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';

import './App.css';
import './giveaways-notifications.css';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Logo from './components/Logo';
import AuthProvider, { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import ToastProvider, { useToast } from './components/Toasts';
import CommandPalette from './components/CommandPalette';
import Icon from './components/Icon';
import { API_BASE } from './apiConfig';
import { installGlobalSoundEffects, playError } from './sound';
import { initializeTheme } from './theme';

// Route-level code splitting: each page (and its CSS) is fetched on demand, so
// opening Coinflip no longer downloads the Admin Panel, Trading, Profile, etc.
const CoinflipPage = lazy(() => import('./pages/CoinflipPage'));
const JackpotPage = lazy(() => import('./pages/JackpotPage'));
const RpsPage = lazy(() => import('./pages/RpsPage'));
const UpgraderPage = lazy(() => import('./pages/UpgraderPage'));
const BlackjackPage = lazy(() => import('./pages/BlackjackPage'));
const TradingPage = lazy(() => import('./pages/TradingPage'));
const StatsPage = lazy(() => import('./pages/StatsPageV2'));
const ProvablyFairPage = lazy(() => import('./pages/ProvablyFairPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));

// The chat column and the value checker are 31kb and 12kb of source, and
// neither is above the fold: both only mount once the player opens them. They
// used to be eager imports, so every visitor - including someone on the login
// screen who will never see either - paid to parse them before first paint.
const ChatPanel = lazy(() => import('./components/ChatPanel'));
const ValueChecker = lazy(() => import('./components/ValueChecker'));

function RouteFallback() {
  return (
    <div className="route-loading">
      <div className="cf-loading" aria-label="Loading page">
        <span className="cf-loading-dots"><i /><i /><i /></span>
      </div>
    </div>
  );
}

const BACKEND_URL = API_BASE;
const socket = io(BACKEND_URL, {
  autoConnect: false,
  auth: (cb) => cb({ token: localStorage.getItem('token') || '' }),
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
  // Toasts are declared here but rendered at the end, so they sit above every
  // modal and survive navigation.
  const toast = useToast();
  // Cash balance was removed as a feature. It never meant anything: no game
  // settled against it and nothing paid it out, so it could only ever go down.
  // Items are the currency on this site.
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [valuesOpen, setValuesOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const apiDownRef = useRef(false);
  const toastRef = useRef(null);
  toastRef.current = toast;

  // Backend reachability canary — shows a banner instead of silent failures
  const [apiDown, setApiDown] = useState(false);
  const [apiNote, setApiNote] = useState('');
  const checkApi = async () => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    try {
      const response = await fetch(`${BACKEND_URL}/api/health`, { signal: ctrl.signal });
      if (!response.ok) throw new Error(`API check failed (${response.status})`);
      apiDownRef.current = false;
      setApiDown(false);
      setApiNote('');
    } catch (err) {
      // A rate-limited server is up and healthy; it is only refusing to answer
      // right now. Telling the player the game is offline when it is merely
      // throttled is wrong, and it is also alarming when nothing is actually
      // broken - the inventory shows 0, chat says it is reconnecting, and every
      // panel reports failure, all because of one 429.
      const throttled = /429/.test(err.message || '');
      const note = throttled
        ? 'Too many requests — the server is rate limiting you. It will clear in a minute.'
        : 'Cannot reach the game server — it may be offline or redeploying.';
      setApiNote(note);
      if (!apiDownRef.current) {
        if (!throttled) playError();
        toastRef.current?.push({
          tone: throttled ? 'warn' : 'error',
          icon: 'warn',
          title: throttled ? 'Rate limited' : 'Game server unreachable',
          body: throttled
            ? 'Slow down for a moment; requests will start working again shortly.'
            : 'You will not be able to bet until it comes back.',
          duration: 9000,
          key: throttled ? 'api:throttled' : 'api:down'
        });
      }
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

  // Ctrl+K / Cmd+K opens the command palette from anywhere. Registered once,
  // at the app level, so it works on every page and in the login form too.
  useEffect(() => {
    const onKey = (event) => {
      const k = event.key;
      if (k !== 'k' && k !== 'K') return;
      if (!(event.ctrlKey || event.metaKey)) return;
      // Inside a text field, Ctrl+K should stay the browser's own shortcut
      // rather than stealing it.
      const el = event.target;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable)) return;
      event.preventDefault();
      setPaletteOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => installGlobalSoundEffects(), []);
  useEffect(() => { initializeTheme(); }, []);
  useEffect(() => {
    if (user?.id) socket.connect();
    else socket.disconnect();
  }, [user?.id]);

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
    socket.on('onlineCountUpdate', () => {});
    return () => {
      socket.off('onlineCountUpdate');
    };
  }, [user]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="app-loading-logo"><Logo size={64} showText={false} /></div>
        <div className="loading-spinner"></div>
        <p>Loading AMPcoin...</p>
      </div>
    );
  }

  return (
    <div className="app">
      {apiDown && (
        <div className="api-down-banner" role="status">
          <Icon name="warn" size={15} />
          <span>{apiNote}</span>
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
              <Suspense fallback={null}>
                <ChatPanel socket={socket} chatOpen={true} />
              </Suspense>
            </div>
          </>
        )}
        <div className="main-content">
          {user && <Header socket={socket} />}
          <div className="page-content" key={location.pathname}>
            {/* keying on the path remounts the boundary on navigation, so a
                page that crashed cannot leave its error showing after you
                navigate away. */}
            <ErrorBoundary key={location.pathname} label="This page">
            <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/coinflip" />} />
              <Route path="/register" element={<Navigate to="/login" replace />} />
              <Route path="/" element={user ? <Navigate to="/coinflip" replace /> : <Navigate to="/login" replace />} />
              <Route path="/coinflip" element={<ProtectedRoute><CoinflipPage socket={socket} /></ProtectedRoute>} />
              <Route path="/jackpot" element={<ProtectedRoute><JackpotPage socket={socket} /></ProtectedRoute>} />
              <Route path="/rps" element={<ProtectedRoute><RpsPage socket={socket} /></ProtectedRoute>} />
              <Route path="/trading" element={<ProtectedRoute><TradingPage socket={socket} /></ProtectedRoute>} />
              <Route path="/upgrader" element={<ProtectedRoute><UpgraderPage socket={socket} /></ProtectedRoute>} />
              <Route path="/blackjack" element={<ProtectedRoute><BlackjackPage socket={socket} /></ProtectedRoute>} />
              <Route path="/wallet" element={<ProtectedRoute><Navigate to="/coinflip" replace /></ProtectedRoute>} />
              <Route path="/stats" element={<ProtectedRoute><StatsPage /></ProtectedRoute>} />
              <Route path="/provably-fair" element={<ProtectedRoute><ProvablyFairPage /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
              <Route path="/admin" element={<ProtectedRoute staffOnly={true}><AdminPanel /></ProtectedRoute>} />
              <Route path="*" element={(
                <div className="request-state">
                  <Icon name="search" size={30} />
                  <p>Page not found</p>
                  <p className="request-state-sub">That page does not exist, or it has moved.</p>
                  <div className="request-state-actions">
                    <button type="button" className="ui-btn ui-btn-primary" onClick={() => window.location.assign('/coinflip')}>
                      Go to Coinflip
                    </button>
                    <button type="button" className="ui-btn" onClick={() => window.history.back()}>
                      Go back
                    </button>
                  </div>
                </div>
              )} />
            </Routes>
            </Suspense>
            </ErrorBoundary>
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
      <Suspense fallback={null}>
        <ValueChecker isOpen={valuesOpen} onClose={() => setValuesOpen(false)} />
      </Suspense>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        {/* Toasts live OUTSIDE the router so a notification raised on one page
            is not destroyed by navigating to another. */}
        <ToastProvider socket={socket}>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
