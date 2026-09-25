import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import ProfileModal from './ProfileModal';
import Icon from './Icon';
import { API_BASE } from '../apiConfig';

const DEFAULT_AVATAR = '/default-avatar.png';

const profileCache = new Map();
const profilePending = new Map();

async function resolveUserProfile(identifier, force = false) {
  if (!identifier) return { avatar: '', displayName: '' };
  const key = String(identifier).toLowerCase();
  if (!force && profileCache.has(key)) return profileCache.get(key);
  if (profilePending.has(key)) return profilePending.get(key);

  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users/profile/${encodeURIComponent(identifier)}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const result = {
        avatar: data.avatar || '',
        displayName: data.displayName || ''
      };
      profileCache.set(key, result);
      return result;
    } catch (error) {
      console.warn('Failed to resolve profile for', identifier, error.message);
      return { avatar: '', displayName: '' };
    } finally {
      profilePending.delete(key);
    }
  })();

  profilePending.set(key, promise);
  return promise;
}

function getFallbackAvatar(robloxUserId) {
  if (robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxUserId}&width=150&height=150&format=png`;
  }
  return DEFAULT_AVATAR;
}

function ChatAvatar({ msg, resolved }) {
  const avatarSrc = resolved?.avatar || msg.avatar || getFallbackAvatar(msg.robloxUserId);
  return (
    <div className="chat-avatar-wrap">
      <img
        src={avatarSrc || DEFAULT_AVATAR}
        alt=""
        className="chat-avatar"
        onError={(e) => {
          const fb = getFallbackAvatar(msg.robloxUserId);
          if (e.target.src !== fb) e.target.src = fb;
          else if (e.target.src !== DEFAULT_AVATAR) e.target.src = DEFAULT_AVATAR;
        }}
      />
    </div>
  );
}

// Chat giveaway card — matches the design: title + timer, item row with
// entries count and creator chip, and a big blue Join button.
// The winner is drawn automatically when the timer hits zero — no manual draw.
const GiveawayCard = ({ msg, user, onJoin, joining }) => {
  const gw = msg.giveaway || {};
  const [, setTick] = useState(0);

  useEffect(() => {
    if (gw.status !== 'open') return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [gw.status]);

  const isCreator = user && String(gw.creatorId) === String(user.id);
  const joined = user && (gw.entries || []).some((e) => String(e.userId) === String(user.id));
  const eligible = user && (gw.eligibleUserIds || []).map(String).includes(String(user.id));
  const isOpen = gw.status === 'open';
  const itemName = gw.item?.name || gw.item?.itemName || 'Item';
  const itemImg = gw.item?.imageUrl || gw.item?.image || '/default-item.png';

  const msLeft = gw.endsAt ? new Date(gw.endsAt).getTime() - Date.now() : 0;
  const secsLeft = Math.max(0, Math.ceil(msLeft / 1000));
  const timerText = `${String(Math.floor(secsLeft / 60)).padStart(2, '0')}:${String(secsLeft % 60).padStart(2, '0')}`;

  let action = null;
  if (isOpen) {
    if (isCreator) {
      action = <div className="gw-join-big locked">Waiting for timer... {(gw.entries || []).length} joined</div>;
    } else if (joined) {
      action = <div className="gw-join-big joined"><Icon name="check" size={14} /> Joined</div>;
    } else if (!eligible) {
      action = <div className="gw-join-big locked"><Icon name="lock" size={14} /> Need 1 bet in the last 24h to join</div>;
    } else {
      action = (
        <button className="gw-join-big" onClick={() => onJoin(gw.id)} disabled={joining}>
          <Icon name="gift" size={16} /> Join
        </button>
      );
    }
  }

  return (
    <div className={`gw-card ${isOpen ? '' : 'ended'}`}>
      <div className="gw-header">
        <span className="gw-title"><Icon name="gift" size={16} /> Giveaway</span>
        {isOpen && <span className="gw-timer"><Icon name="history" size={14} /> {timerText}</span>}
      </div>
      <div className="gw-body">
        <img
          className="gw-item-img"
          src={itemImg}
          alt=""
          onError={(e) => { e.target.src = '/default-item.png'; }}
        />
        <div className="gw-item-meta">
          <div className="gw-item-name">{itemName}{(gw.item?.quantity || 1) > 1 ? ` ×${gw.item.quantity}` : ''}</div>
          <div className="gw-item-sub">
            <span className="gw-item-val">◈ {Number(gw.item?.value || 0).toLocaleString()}</span>
            <span className="gw-entries-count">{(gw.entries || []).length} entries</span>
          </div>
        </div>
        <div className="gw-creator-chip" title={`by ${gw.creatorName || 'Anonymous'}`}>
          <img
            src={gw.creatorAvatar || DEFAULT_AVATAR}
            alt=""
            onError={(e) => { e.target.src = DEFAULT_AVATAR; }}
          />
          <span>{gw.creatorName || 'Anonymous'}</span>
        </div>
      </div>
      {gw.status === 'ended' ? (
        gw.winnerId ? (
          <div className="gw-winner-banner"><Icon name="trophy" size={16} /> Winner: {gw.winnerName}</div>
        ) : (
          <div className="gw-refund-banner">No entries — item returned to {gw.creatorName}</div>
        )
      ) : (
        <div className="gw-actions">{action}</div>
      )
      }
    </div>
  );
};

// Compact giveaway banner — shown at the top of the chat as a persistent strip
const GiveawayBanner = ({ giveaway, user, onJoin, joining }) => {
  const gw = giveaway || {};
  const [, setTick] = useState(0);

  useEffect(() => {
    if (gw.status !== 'open') return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [gw.status]);

  const isOpen = gw.status === 'open';
  const joined = user && (gw.entries || []).some((e) => String(e.userId) === String(user.id));
  const eligible = user && (gw.eligibleUserIds || []).map(String).includes(String(user.id));
  const isCreator = user && String(gw.creatorId) === String(user.id);
  const itemName = gw.item?.name || gw.item?.itemName || 'Item';
  const itemImg = gw.item?.imageUrl || gw.item?.image || '';
  const msLeft = gw.endsAt ? new Date(gw.endsAt).getTime() - Date.now() : 0;
  const secsLeft = Math.max(0, Math.ceil(msLeft / 1000));
  const timerText = `${String(Math.floor(secsLeft / 60)).padStart(2, '0')}:${String(secsLeft % 60).padStart(2, '0')}`;

  return (
    <div className="gw-banner">
      <div className="gw-banner-left">
        {itemImg && <img src={itemImg} alt={itemName} className="gw-banner-thumb" />}
        <div className="gw-banner-info">
          <span className="gw-banner-title"><Icon name="gift" size={14} /> GIVEAWAY</span>
          <span className="gw-banner-item">{itemName}</span>
        </div>
      </div>
      <div className="gw-banner-center">
        <span className="gw-banner-timer">{isOpen ? <><Icon name="history" size={14} /> {timerText}</> : <><Icon name="lock" size={14} /> Ended</>}</span>
        <span className="gw-banner-entries">{(gw.entries || []).length} joined</span>
      </div>
      <div className="gw-banner-right">
        {isOpen && (
          isCreator ? (
            <span className="gw-banner-status">Yours</span>
          ) : joined ? (
            <span className="gw-banner-status joined"><Icon name="check" size={14} /> Joined</span>
          ) : !eligible ? (
            <span className="gw-banner-status locked"><Icon name="lock" size={14} /> Locked</span>
          ) : (
            <button
              className="gw-banner-join"
              onClick={() => onJoin(gw.id)}
              disabled={joining}
            >
              Join
            </button>
          )
        )}
      </div>
    </div>
  );
};

const ChatPanel = ({ socket, chatOpen }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [isTyping, setIsTyping] = useState({});
  const [resolvedProfiles, setResolvedProfiles] = useState({});
  const [sending, setSending] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0); // seconds left on 5s chat cooldown
  const [viewProfile, setViewProfile] = useState(null); // chat user profile modal
  const [activeGiveaway, setActiveGiveaway] = useState(null); // persistent top banner
  const [winnerBanner, setWinnerBanner] = useState(null); // winner announcement

  // Giveaway interaction state (creation lives in the header GW button;
  // the winner is drawn automatically by the server when the timer ends)
  const [joiningGw, setJoiningGw] = useState(false);
  const cooldownTimer = useRef(null);
  const winnerTimer = useRef(null);
  const { user } = useAuth();
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const formRef = useRef(null);

  const resolveAllProfiles = useCallback(async (msgs) => {
    const needed = msgs.filter((m) => {
      if (!m.userId && !m.robloxUsername) return false;
      const key = String(m.userId || m.robloxUsername).toLowerCase();
      const cached = profileCache.has(key);
      if (cached) return false;
      return !m.avatar || !m.displayName;
    });
    const unique = [];
    const seen = new Set();
    for (const m of needed) {
      const key = String(m.userId || m.robloxUsername).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(m);
    }
    if (unique.length === 0) return;
    const patches = {};
    await Promise.all(
      unique.map(async (m) => {
        const identifier = m.robloxUsername || m.userId;
        if (!identifier) return;
        const key = String(identifier).toLowerCase();
        const profile = await resolveUserProfile(identifier);
        if (profile.avatar || profile.displayName) {
          patches[key] = profile;
        }
      })
    );
    if (Object.keys(patches).length > 0) {
      setResolvedProfiles((prev) => ({ ...prev, ...patches }));
    }
  }, []);

  useEffect(() => {
    if (socket) {
      socket.emit('joinChat', { userId: user?.id, username: user?.displayName || 'Anonymous' });

      const onReceive = (message) => {
        // Skip giveaway messages — they live in the banner, not the message list
        if (message && (message.type === 'giveaway' || message.type === 'giveaway_win')) return;
        // Dedup: our own optimistic/saved messages may echo back via broadcast
        setMessages((prev) =>
          message && message.id && prev.some((m) => m.id === message.id)
            ? prev
            : [...prev, message]
        );
      };
      const onOnline = (data) => {
        setOnlineUsers(data.count);
      };
      const onTypingStart = (data) => {
        setIsTyping((prev) => ({ ...prev, [data.userId]: true }));
      };
      const onTypingStop = (data) => {
        setIsTyping((prev) => {
          const next = { ...prev };
          delete next[data.userId];
          return next;
        });
      };

      const onGiveawayUpdate = (data) => {
        if (!data || !data.id) return;
        if (data.status === 'ended' && data.winnerId) {
          // Show winner banner for 5 min then clear
          setWinnerBanner({
            id: data.id,
            winnerName: data.winnerName || 'Someone',
            itemName: data.item?.name || 'Item',
            creatorName: data.creatorName || 'Someone'
          });
          setActiveGiveaway(null);
          if (winnerTimer.current) clearTimeout(winnerTimer.current);
          winnerTimer.current = setTimeout(() => setWinnerBanner(null), 5 * 60 * 1000);
        } else if (data.status === 'open') {
          setActiveGiveaway(data);
        }
        // Also update any giveaway messages already in the chat
        setMessages((prev) =>
          prev.map((m) =>
            m.type === 'giveaway' && m.giveaway && m.giveaway.id === data.id
              ? { ...m, giveaway: data }
              : m
          )
        );
      };

      socket.on('chatMessage', onReceive);
      socket.on('receiveMessage', onReceive);
      socket.on('onlineCountUpdate', onOnline);
      socket.on('typingStart', onTypingStart);
      socket.on('typingStop', onTypingStop);
      socket.on('giveawayUpdate', onGiveawayUpdate);

      fetchRecentMessages();
      fetchOnlineCount();
      fetchActiveGiveaway();

      return () => {
        socket.off('chatMessage', onReceive);
        socket.off('receiveMessage', onReceive);
        socket.off('onlineCountUpdate', onOnline);
        socket.off('typingStart', onTypingStart);
        socket.off('typingStop', onTypingStop);
        socket.off('giveawayUpdate', onGiveawayUpdate);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, user]);

  useEffect(() => {
    resolveAllProfiles(messages);
  }, [messages, resolveAllProfiles]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchOnlineCount = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/online`);
      if (res.ok) {
        const data = await res.json();
        setOnlineUsers(data.count || 0);
      }
    } catch (e) {
      console.warn('Online count fetch error', e.message);
    }
  };

  const fetchRecentMessages = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/chat/messages`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        // Filter giveaway messages out of regular chat — they live in the banner now
        const regularMessages = (data.messages || []).filter(
          (m) => m.type !== 'giveaway' && m.type !== 'giveaway_win'
        );
        setMessages(regularMessages);
      }
    } catch (error) {
      console.error('Error fetching chat messages:', error);
    }
  };

  // Fetch active (open) giveaway from the server so the banner shows on load
  const fetchActiveGiveaway = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/giveaways`);
      if (res.ok) {
        const data = await res.json();
        const openGw = (data.giveaways || []).find((g) => g.status === 'open');
        if (openGw) {
          setActiveGiveaway(openGw);
        } else {
          // Check for recently ended giveaway to show winner banner
          const ended = (data.giveaways || []).find((g) => g.status === 'ended' && g.winnerId && g.endedAt);
          if (ended) {
            const endedMs = new Date(ended.endedAt).getTime();
            const fiveMinLater = endedMs + 5 * 60 * 1000;
            if (Date.now() < fiveMinLater) {
              setWinnerBanner({
                id: ended.id,
                winnerName: ended.winnerName || 'Someone',
                itemName: ended.item?.name || 'Item',
                creatorName: ended.creatorName || 'Someone'
              });
              const remaining = fiveMinLater - Date.now();
              if (winnerTimer.current) clearTimeout(winnerTimer.current);
              winnerTimer.current = setTimeout(() => setWinnerBanner(null), remaining);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Giveaway fetch error', e.message);
    }
  };

  const startCooldown = (seconds) => {
    const secs = Math.max(1, Math.ceil(seconds || 5));
    setCooldownLeft(secs);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldownLeft((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownTimer.current);
          cooldownTimer.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => () => {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    if (winnerTimer.current) clearTimeout(winnerTimer.current);
  }, []);

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const trimmed = inputMessage.trim();
    if (!trimmed || !user || sending || cooldownLeft > 0) return;

    setSending(true);
    const displayName =
      user.robloxDisplayName || user.displayName || user.robloxUsername || 'Anonymous';
    const optimisticMsg = {
      id: `opt-${Date.now()}`,
      userId: user.id,
      robloxUsername: user.robloxUsername || '',
      robloxUserId: user.robloxUserId || null,
      username: displayName,
      displayName: displayName,
      avatar: user.avatar || '',
      message: trimmed,
      timestamp: new Date().toISOString(),
      type: 'user_message',
      optimistic: true
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInputMessage('');

    try {
      const response = await fetch(`${API_BASE}/api/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ message: trimmed })
      });

      if (response.ok) {
        const saved = await response.json();
        // Backend broadcasts chatMessage to all users via socket — no client emit needed.
        // The broadcast can arrive BEFORE this resolves, so drop any copy
        // with the real id first (fixes the double-message visual bug).
        setMessages((prev) =>
          prev.filter((m) => m.id !== saved.id && m.id !== optimisticMsg.id).concat(saved)
        );
        startCooldown(5);
      } else {
        const data = await response.json().catch(() => ({}));
        // Rejected (cooldown/mute/rate-limit): drop the ghost message, keep the text
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
        setInputMessage(trimmed);
        if (response.status === 429) {
          startCooldown(data.retryAfter || 5);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInputMessage(value);

    if (socket && user) {
      if (value.length > 0) {
        socket.emit('typingStart', { userId: user.id, username: user.displayName });
        clearTimeout(window.typingTimeout);
        window.typingTimeout = setTimeout(() => {
          socket.emit('typingStop', { userId: user.id });
        }, 1500);
      } else {
        socket.emit('typingStop', { userId: user.id });
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (formRef.current) formRef.current.requestSubmit();
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const formatTime = (timestamp) => {
    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  const getTypingUsers = () => {
    return Object.entries(isTyping)
      .filter(([, typing]) => typing)
      .map(([userId]) => {
        const userMsg = messages.find((m) => String(m.userId) === String(userId));
        return (
          <span key={userId} className="typing-user">
            {userMsg?.displayName || userMsg?.username || `User ${userId}`}
          </span>
        );
      });
  };

  const getResolved = (msg) => {
    const key = String(msg.userId || msg.robloxUsername || '').toLowerCase();
    return resolvedProfiles[key] || null;
  };

  // ---- Giveaways (join / draw; creation is in the header) ----
  const joinGiveaway = async (gwId) => {
    if (!gwId || joiningGw) return;
    setJoiningGw(true);
    try {
      const res = await fetch(`${API_BASE}/api/giveaways/${gwId}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.giveaway) {
        // Backend already broadcasts giveawayUpdate via socket to all users
      } else {
        showGwError(data.message || 'Could not join the giveaway');
      }
    } catch (e) {
      showGwError('Could not join the giveaway');
    } finally {
      setJoiningGw(false);
    }
  };

  const showGwError = (text) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `gwerr-${Date.now()}`,
        type: 'giveaway_error',
        message: text,
        timestamp: new Date().toISOString()
      }
    ]);
  };

  const openUserProfile = (msg) => {
    const resolved = getResolved(msg);
    setViewProfile({
      id: msg.userId,
      robloxUsername: msg.robloxUsername || '',
      robloxDisplayName: resolved?.displayName || msg.displayName || msg.username || '',
      displayName: resolved?.displayName || msg.displayName || msg.username || msg.robloxUsername || 'Anonymous',
      avatar: resolved?.avatar || msg.avatar || '',
      robloxUserId: msg.robloxUserId || null
    });
  };

  return (
    <div className={`chat-panel ${chatOpen ? 'chat-open' : ''}`}>
      <div className="chat-header">
        <h3 className="chat-title"><Icon name="chat" size={16} /> Live Chat</h3>
        <div className="chat-stats">
          <span className="online-dot" />
          <span className="online-count">{onlineUsers} online</span>
        </div>
      </div>

      <div className="chat-messages">
        {/* Persistent giveaway banner at top of chat */}
        {activeGiveaway && activeGiveaway.status === 'open' && (
          <GiveawayBanner
            giveaway={activeGiveaway}
            user={user}
            onJoin={joinGiveaway}
            joining={joiningGw}
          />
        )}
        {/* Winner announcement banner (stays 5 min after draw) */}
        {winnerBanner && (
          <div className="gw-winner-banner">
            <Icon name="party" size={16} /> <strong>{winnerBanner.winnerName}</strong> won{' '}
            <strong>{winnerBanner.itemName}</strong> from{' '}
            {winnerBanner.creatorName}'s giveaway!
          </div>
        )}

        {messages.length === 0 && !activeGiveaway ? (
          <div className="chat-empty">No messages yet. Say hello! <Icon name="wave" size={16} /></div>
        ) : (
          messages.map((msg, idx) => {
            if (msg.type === 'giveaway') {
              return (
                <div key={msg.id || idx} className="gw-card-row">
                  <GiveawayCard
                    msg={msg}
                    user={user}
                    onJoin={joinGiveaway}
                    joining={joiningGw}
                  />
                </div>
              );
            }
            if (msg.type === 'giveaway_win') {
              return (
                <div key={msg.id || idx} className="gw-win-line">{msg.message}</div>
              );
            }
            if (msg.type === 'giveaway_error') {
              return (
                <div key={msg.id || idx} className="gw-error-line"><Icon name="warn" size={14} /> {msg.message}</div>
              );
            }
            const resolved = getResolved(msg);
            const displayName =
              resolved?.displayName ||
              msg.displayName ||
              msg.username ||
              msg.robloxUsername ||
              'Anonymous';
            const msgIsAdmin = !!(msg.isAdmin || resolved?.isAdmin);
            return (
              <div key={msg.id || idx} className="chat-message-row">
                <span onClick={() => openUserProfile(msg)} style={{ cursor: 'pointer' }}>
                  <ChatAvatar msg={msg} resolved={resolved} />
                </span>
                <div className="chat-bubble">
                  <div className="bubble-header">
                    <span
                      className="bubble-username bubble-username-clickable"
                      title={msg.robloxUsername || ''}
                      onClick={() => openUserProfile(msg)}
                    >
                      {displayName}
                    </span>
                    {msgIsAdmin && <span className="chat-admin-badge">ADMIN</span>}
                    <span className="bubble-timestamp">{formatTime(msg.timestamp)}</span>
                  </div>
                  <div className="bubble-content">{msg.message}</div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {Object.keys(isTyping).length > 0 && (
        <div className="typing-indicator">
          <span className="typing-dots">
            <span />
            <span />
            <span />
          </span>
          <span className="typing-users-wrap">{getTypingUsers()} typing...</span>
        </div>
      )}

      <form
        ref={formRef}
        className="chat-input-form"
        onSubmit={handleSendMessage}
      >
        <div className="chat-input-wrap">
          <input
            ref={inputRef}
            type="text"
            value={inputMessage}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            className="chat-input"
            maxLength={500}
            disabled={sending || !user}
            autoComplete="off"
          />
          <span className="chat-char-count">{inputMessage.length}/500</span>
        </div>
        <button
          type="submit"
          className="send-button"
          disabled={!inputMessage.trim() || sending || !user || cooldownLeft > 0}
          title={cooldownLeft > 0 ? `Wait ${cooldownLeft}s before sending again` : 'Send'}
        >
          {sending ? (
            <span className="send-spinner" />
          ) : cooldownLeft > 0 ? (
            <>
              <span className="send-text">Wait {cooldownLeft}s</span>
            </>
          ) : (
            <>
              <span className="send-icon"><Icon name="send" size={16} /></span>
              <span className="send-text">Send</span>
            </>
          )}
        </button>
      </form>

      {viewProfile && (
        <ProfileModal
          viewer={user}
          profileUser={viewProfile}
          isOwn={user && String(user.id) === String(viewProfile.id)}
          socket={socket}
          onClose={() => setViewProfile(null)}
        />
      )}
    </div>
  );
};

export default ChatPanel;
