import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import CreateCoinflipModal from '../components/CreateCoinflipModal';
import LeaderboardModal from '../components/LeaderboardModal';
import AnimatedPopup from '../components/AnimatedPopup';
import ModalPortal from '../components/ModalPortal';
import { CoinChip, CoinFlipAnimation, CoinLoader } from '../components/CoinChip';
import ModBadges from '../components/ModBadges';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import '../components/CoinChip.css';
import '../components/ModBadges.css';
import './CoinflipPage.css';

/* ── Rarity badge color helper ── */
const RARITY_COLORS = {
  legendary: '#f59e0b',
  ultra_rare: '#8b5cf6',
  rare: '#3b82f6',
  uncommon: '#10b981',
  common: '#6b7280',
};
const getRarityColor = (r) => RARITY_COLORS[(r || '').toLowerCase()] || '#6b7280';

/* ── Coinflip animation: poker-chip flip, winner hidden until landing ── */
function CoinSpinner({ result, size = 80, onDone }) {
  return <CoinFlipAnimation result={result} size={size} onDone={onDone} />;
}

/* ── Relative time helper ("Created 7 minutes ago") ── */
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/* ── Pet hover tooltip: dark card with image, badges, name, value ── */
function PetTooltip({ item }) {
  const name = item.name || item.itemName || 'Item';
  const rarity = (item.rarity || 'common').toLowerCase();
  const unitVal = Number(item.value || 0);
  const qty = parseInt(item.quantity || 1, 10) || 1;
  const itemMods = Array.isArray(item.mods) ? item.mods : [];
  const showF = itemMods.includes('F') || itemMods.includes('M') || itemMods.includes('N');
  const showR = itemMods.includes('R') || itemMods.includes('M') || itemMods.includes('N');
  return (
    <div className="pet-tip">
      <div className="pet-tip-img-wrap">
        <img
          src={item.image || item.imageUrl || '/default-item.png'}
          alt={name}
          className="pet-tip-img"
          onError={(e) => { e.target.src = '/default-item.png'; }}
        />
        {showF && <span className="pet-tip-badge badge-f">F</span>}
        {showR && <span className="pet-tip-badge badge-r">R</span>}
      </div>
      <div className="pet-tip-name">{name}{qty > 1 ? ` ×${qty}` : ''}</div>
      <ModBadges mods={item.mods} size={16} />
      <div className="pet-tip-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {(unitVal * qty).toLocaleString()}</div>
      <div className={`pet-tip-rarity rarity-${rarity}`}>{rarity.replace('_', ' ')}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
const CoinflipPage = ({ socket, setBalance }) => {
  const { user } = useAuth();
  const [coinflips, setCoinflips] = useState([]);
  const [activeCount, setActiveCount] = useState(0);
  const [totalInGames, setTotalInGames] = useState(0);
  const [jackpotCount, setJackpotCount] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sortBy, setSortBy] = useState('newest');
  const [loading, setLoading] = useState(true);
  const [userInventory, setUserInventory] = useState([]);

  // Join modal
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [selectedBet, setSelectedBet] = useState(null);
  const [joinSelectedQty, setJoinSelectedQty] = useState({});
  const [joining, setJoining] = useState(false);

  const joinStackKeyOf = (item) => item.itemId || item.id;
  const joinStackQtyOf = (item) => Math.max(1, parseInt(item.quantity || 1, 10) || 1);

  const toggleJoinUnit = (stackKey, tileIdx) => {
    setJoinSelectedQty((prev) => {
      const cur = prev[stackKey] || 0;
      const next = tileIdx < cur ? tileIdx : cur + 1;
      const stack = userInventory.find((i) => joinStackKeyOf(i) === stackKey);
      const max = stack ? joinStackQtyOf(stack) : next;
      const clamped = Math.min(next, max);
      const n = { ...prev };
      if (clamped <= 0) delete n[stackKey];
      else n[stackKey] = clamped;
      const totalPets = Object.values(n).reduce((s, q) => s + q, 0);
      const petCap = selectedBet && typeof selectedBet.maxJoinPets === 'number' ? selectedBet.maxJoinPets : null;
      if (petCap && totalPets > petCap) return prev;
      return n;
    });
  };

  const joinEntries = userInventory
    .filter((item) => (joinSelectedQty[joinStackKeyOf(item)] || 0) > 0)
    .map((item) => ({ item, qty: joinSelectedQty[joinStackKeyOf(item)] }));
  const joinSelectedCount = joinEntries.reduce((s, e) => s + e.qty, 0);

  // Chip animation
  const [chipAnim, setChipAnim] = useState(null);
  const animTimers = useRef([]);

  // Popup
  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');
  const [popupType, setPopupType] = useState('info');

  const showCustomPopup = (message, type = 'info') => {
    setPopupMessage(message);
    setPopupType(type);
    setShowPopup(true);
    setTimeout(() => setShowPopup(false), 3000);
  };

  const closePopup = () => setShowPopup(false);

  // Sort filter state
  const [sortDropdown, setSortDropdown] = useState(false);

  // Values open in the global modal (App level)
  const openValueChecker = () => window.dispatchEvent(new CustomEvent('ampcoin:open-values'));

  // Fetch coinflips
  const fetchCoinflips = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/coinflip?sort=${sortBy}`);
      if (response.ok) {
        const data = await response.json();
        setCoinflips(data.coinflips || []);
        setActiveCount(data.activeCount || 0);
        setTotalInGames(data.totalInGames || 0);
      } else if (response.status === 429) {
        showCustomPopup('Server is rate-limiting requests — wait a few seconds and refresh.', 'error');
      }
    } catch (error) {
      console.error('Error fetching coinflips:', error);
    } finally {
      setLoading(false);
    }
  }, [sortBy]);

  // Fetch active jackpot player count for the tab badge
  const fetchJackpotCount = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/jackpot/active`);
      if (res.ok) {
        const data = await res.json();
        setJackpotCount(data && Array.isArray(data.entries) ? data.entries.length : 0);
      }
    } catch (_) { /* ignore */ }
  }, []);

  // Fetch user inventory
  const fetchInventory = useCallback(async () => {
    if (!user) return;
    try {
      const identifier = user.id || user.robloxUsername;
      const response = await fetch(`${API_BASE}/api/users/inventory/${identifier}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUserInventory(data.items || []);
      }
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  }, [user]);

  // Initial load + socket
  useEffect(() => {
    fetchCoinflips();
    fetchInventory();
    fetchJackpotCount();
    if (socket) {
      socket.on('newCoinflip', (data) => {
        if (data && data.id) {
          setCoinflips(prev => [data, ...prev.filter(cf => cf.id !== data.id)]);
          setActiveCount(prev => prev + 1);
          setTotalInGames(prev => prev + (data.totalValue || 0));
          flashFreshRow(data.id);
        }
      });
      socket.on('coinflipJoined', (data) => {
        setCoinflips(prev => prev.map(cf => cf.id === data.id ? data : cf));
      });
      socket.on('coinflipUpdated', (data) => {
        if (data && data.id) {
          setCoinflips(prev => prev.map(cf => cf.id === data.id ? data : cf));
        }
      });
      socket.on('coinflipResult', (data) => {
        if (data && data.id && (data.status === 'completed' || data.result)) {
          playChipFlip(data);
          if (user && (data.creatorId === user.id || data.opponentId === user.id)) fetchInventory();
        }
        setCoinflips(prev => prev.map(cf => cf.id === data.id ? data : cf));
      });
      socket.on('coinflipCancelled', (data) => {
        if (data && data.id) {
          // Animate out, then remove
          setLeavingBetId(data.id);
          setTimeout(() => {
            setCoinflips(prev => prev.filter(cf => cf.id !== data.id));
            setLeavingBetId((cur) => (cur === data.id ? null : cur));
          }, 380);
          setActiveCount(prev => Math.max(0, prev - 1));
        }
      });
      socket.on('inventoryUpdate', () => fetchInventory());
    }
    return () => {
      if (socket) {
        socket.off('newCoinflip');
        socket.off('coinflipJoined');
        socket.off('coinflipUpdated');
        socket.off('coinflipResult');
        socket.off('coinflipCancelled');
        socket.off('inventoryUpdate');
      }
    };
  }, [socket, user, fetchCoinflips, fetchInventory, fetchJackpotCount]);

  const playChipFlip = (gameData) => {
    if (!gameData || !gameData.id) return;
    animTimers.current.forEach(clearTimeout);
    animTimers.current = [];
    const side = (gameData.result || gameData.sideChosen || gameData.creatorSide || 'heads')
      .toLowerCase() === 'tails' ? 'tails' : 'heads';
    setChipAnim({ id: gameData.id, phase: 'flipping', side });
    animTimers.current.push(setTimeout(() => {
      setChipAnim((prev) => (prev && prev.id === gameData.id ? { id: gameData.id, phase: 'landed', side } : prev));
    }, 3000));
    animTimers.current.push(setTimeout(() => {
      setChipAnim((prev) => (prev && prev.id === gameData.id ? null : prev));
    }, 7000));
  };

  useEffect(() => () => { animTimers.current.forEach(clearTimeout); }, []);

  // Fresh-row highlight (create animation): flashes the glow, clears after 3.5s
  const [freshBetId, setFreshBetId] = useState(null);
  const freshTimer = useRef(null);
  const flashFreshRow = (id) => {
    if (!id) return;
    setFreshBetId(id);
    if (freshTimer.current) clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => setFreshBetId(null), 3500);
  };
  useEffect(() => () => { if (freshTimer.current) clearTimeout(freshTimer.current); }, []);

  // Leaving-row animation (cancel): collapse + fade before removal
  const [leavingBetId, setLeavingBetId] = useState(null);

  const isVisibleGame = (cf) => {
    if (!cf) return false;
    if (cf.status === 'waiting' || cf.status === 'active') return true;
    if (cf.status !== 'completed') return false;
    if (!cf.completedAt) return true;
    return Date.now() - new Date(cf.completedAt).getTime() < 10 * 60 * 1000;
  };

  const openHistory = async () => {
    setShowHistory(true);
    setHistoryPage(1);
    setHistoryLoading(true);
    try {
      const identifier = user?.id || user?.robloxUsername;
      if (!identifier) { setHistoryItems([]); return; }
      const response = await fetch(`${API_BASE}/api/coinflip/user/${encodeURIComponent(identifier)}/history`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json().catch(() => []);
      const list = Array.isArray(data) ? data : [];
      list.sort((a, b) => new Date(b.completedAt || b.updatedAt || 0) - new Date(a.completedAt || a.updatedAt || 0));
      setHistoryItems(list);
    } catch (error) {
      console.error('Error fetching coinflip history:', error);
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Bot join
  const [botBusyId, setBotBusyId] = useState(null);

  // Bot join — settled entirely on the server, no client secrets
  const handleBotJoin = async (cf) => {
    if (!user || botBusyId) return;
    setBotBusyId(cf.id);
    try {
      const res = await fetch(`${API_BASE}/api/coinflip/${cf.id}/bot-join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && data.id) {
        // Backend broadcasts coinflipResult + inventoryUpdate via socket;
        // update immediately too so the row flips without waiting.
        setCoinflips((prev) => prev.map((x) => (x.id === data.id ? data : x)));
        playChipFlip(data);
        fetchInventory();
      } else {
        showCustomPopup(data.message || "Bot doesn't have valid balance", 'error');
      }
    } catch (error) {
      console.error('Bot join failed:', error);
      showCustomPopup("Bot doesn't have valid balance", 'error');
    } finally {
      setBotBusyId(null);
    }
  };

  const handleCreateBet = () => {
    if (!userInventory || userInventory.length === 0) {
      showCustomPopup('You currently have no items in your inventory to bet.', 'warning');
      return;
    }
    setShowCreateModal(true);
  };

  const handleBetCreated = (newBet) => {
    if (newBet && newBet.id) {
      setCoinflips((prev) => [newBet, ...prev.filter((cf) => cf.id !== newBet.id)]);
      setActiveCount((prev) => prev + 1);
      setTotalInGames((prev) => prev + (newBet.totalValue || 0));
      flashFreshRow(newBet.id);
      showCustomPopup('Coinflip created — your bet is live!', 'success');
    }
    fetchCoinflips();
    fetchInventory();
  };

  const handleOpenJoinModal = (bet) => {
    if (!userInventory || userInventory.length === 0) {
      showCustomPopup('You currently have no items in your inventory to bet with.', 'warning');
      return;
    }
    setSelectedBet(bet);
    setJoinSelectedQty({});
    setShowJoinModal(true);
  };

  const getJoinTotalValue = () => {
    return joinEntries.reduce((sum, e) => sum + ((e.item.value || e.item.details?.value || 0) * e.qty), 0);
  };

  const handleAutoSelect = () => {
    if (!selectedBet) return;
    const { lo, hi } = getJoinRange(selectedBet);
    const maxByKey = {};
    const units = [];
    userInventory.forEach((item) => {
      const v = item.value || item.details?.value || 0;
      if (v <= 0) return;
      const key = joinStackKeyOf(item);
      const q = joinStackQtyOf(item);
      maxByKey[key] = q;
      for (let i = 0; i < q; i++) units.push({ key, value: v });
    });
    const petCap = selectedBet && typeof selectedBet.maxJoinPets === 'number' ? selectedBet.maxJoinPets : null;
    units.sort((a, b) => b.value - a.value);
    const pickedQty = {};
    let total = 0;
    let pickedCount = 0;
    for (const u of units) {
      if (total >= lo) break;
      if (petCap && pickedCount >= petCap) break;
      if ((pickedQty[u.key] || 0) >= (maxByKey[u.key] || 1)) continue;
      if (total + u.value <= hi) {
        pickedQty[u.key] = (pickedQty[u.key] || 0) + 1;
        total += u.value;
        pickedCount += 1;
      }
    }
    if (total < lo) {
      const seen = new Set();
      const rest = [];
      units.forEach((u) => {
        if (seen.has(u.key)) return;
        seen.add(u.key);
        if ((pickedQty[u.key] || 0) < (maxByKey[u.key] || 1)) rest.push(u);
      });
      rest.sort((a, b) => a.value - b.value);
      const fit = rest.find((u) => total + u.value >= lo && total + u.value <= hi)
        || rest.find((u) => total + u.value <= hi);
      if (fit && !(petCap && pickedCount >= petCap)) {
        pickedQty[fit.key] = (pickedQty[fit.key] || 0) + 1;
        total += fit.value;
        pickedCount += 1;
      }
    }
    setJoinSelectedQty(pickedQty);
    if (pickedCount === 0) showCustomPopup('No combination of your items fits that range.', 'warning');
  };

  const handleSelectAll = () => {
    if (!selectedBet || userInventory.length === 0) return;
    const petCap = typeof selectedBet.maxJoinPets === 'number' ? selectedBet.maxJoinPets : null;
    const newQty = {};
    let count = 0;
    for (const item of userInventory) {
      const key = joinStackKeyOf(item);
      const q = joinStackQtyOf(item);
      for (let i = 0; i < q; i++) {
        if (petCap && count >= petCap) break;
        newQty[key] = (newQty[key] || 0) + 1;
        count++;
      }
      if (petCap && count >= petCap) break;
    }
    setJoinSelectedQty(newQty);
  };

  const joinRangeOk = () => {
    if (!selectedBet || joinSelectedCount === 0) return false;
    const { lo, hi } = getJoinRange(selectedBet);
    const total = getJoinTotalValue();
    return total >= lo && total <= hi;
  };

  const formatCompact = (n) => {
    const v = Number(n) || 0;
    if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return `${v}`;
  };

  const sidePct = (v, t) => (t > 0 ? `${((v / t) * 100).toFixed(2)}%` : '0.00%');

  const getBetMeta = (cf) => {
    const creatorName = cf.creator?.displayName || cf.creatorUsername || 'Unknown';
    const creatorAvatar = cf.creator?.avatar || cf.creatorAvatar || '/default-avatar.png';
    const creatorSide = (cf.sideChosen || cf.creatorSide || 'heads').toLowerCase() === 'tails' ? 'tails' : 'heads';
    const opponentSide = creatorSide === 'heads' ? 'tails' : 'heads';
    const oppName = cf.opponent?.displayName || cf.opponentUsername || null;
    const oppAvatar = cf.opponent?.avatar || cf.opponentAvatar || '/default-avatar.png';
    const hasOpponent = !!(cf.opponentId || oppName);
    const creatorVal = cf.creatorValue || 0;
    const oppVal = cf.opponentValue || 0;
    const total = cf.totalValue || (creatorVal + oppVal);
    const isUserCreator = !!(user && cf.creatorId === user.id);
    const isCompleted = cf.status === 'completed' || !!cf.isCompleted;
    const winnerId = cf.winnerId || null;
    const resultSide = (cf.result || cf.sideChosen || cf.creatorSide || 'heads').toLowerCase() === 'tails' ? 'tails' : 'heads';
    const thumbs = [...(cf.creatorItems || []), ...(cf.opponentItems || [])];
    const creatorItems = cf.creatorItems || [];
    const opponentItems = cf.opponentItems || [];
    const allItems = [...creatorItems, ...opponentItems];
    const maxJoinPets = (typeof cf.maxJoinPets === 'number' && cf.maxJoinPets > 0) ? cf.maxJoinPets : null;
    return { creatorName, creatorAvatar, creatorSide, opponentSide, oppName, oppAvatar, hasOpponent, creatorVal, oppVal, total, isUserCreator, isCompleted, winnerId, resultSide, thumbs, allItems, creatorItems, opponentItems, maxJoinPets };
  };

  const [viewBet, setViewBet] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  // Bet id whose view-modal flip animation has finished (winner ring shows after)
  const [flipDoneId, setFlipDoneId] = useState(null);

  const handleCancelBet = async (bet) => {
    if (!bet || cancelling) return;
    setCancelling(true);
    // Play the exit animation first, then hit the API
    setLeavingBetId(bet.id);
    setViewBet(null);
    await new Promise((r) => setTimeout(r, 380));
    try {
      const response = await fetch(`${API_BASE}/api/coinflip/${bet.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setCoinflips((prev) => prev.filter((cf) => cf.id !== bet.id));
        setActiveCount((prev) => Math.max(0, prev - 1));
        setTotalInGames((prev) => Math.max(0, prev - (bet.totalValue || 0)));
        showCustomPopup('Bet cancelled — items refunded!', 'success');
        fetchInventory();
      } else {
        setLeavingBetId(null);
        showCustomPopup(data.message || 'Failed to cancel bet', 'error');
      }
    } catch (err) {
      console.error('Error cancelling bet:', err);
      setLeavingBetId(null);
      showCustomPopup('Failed to cancel bet due to server error', 'error');
    } finally {
      setCancelling(false);
    }
  };

  const getJoinMin = (bet) => {
    if (!bet) return 0;
    if (typeof bet.minOpponentValue === 'number' && bet.minOpponentValue > 0) return bet.minOpponentValue;
    return Math.floor((bet.creatorValue || bet.totalValue || 0) * 0.95);
  };

  const getJoinRange = (bet) => {
    const lo = getJoinMin(bet);
    const storedHi = bet?.maxOpponentValue;
    const hi = (typeof storedHi === 'number' && isFinite(storedHi) && storedHi > 0 && storedHi < 1000000000)
      ? storedHi
      : Math.ceil((bet?.creatorValue || bet?.totalValue || 0) * 1.05);
    return { lo, hi };
  };

  const handleConfirmJoinBet = async () => {
    if (!selectedBet || joinSelectedCount === 0) {
      showCustomPopup('Please select at least one item to match the bet.', 'warning');
      return;
    }
    const currentVal = getJoinTotalValue();
    const { lo, hi } = getJoinRange(selectedBet);
    if (currentVal < lo) {
      showCustomPopup(`Your items (${currentVal.toLocaleString()} AMP) are below the required minimum (${lo.toLocaleString()} AMP).`, 'warning');
      return;
    }
    if (currentVal > hi) {
      showCustomPopup(`Your items (${currentVal.toLocaleString()} AMP) exceed the maximum (${hi.toLocaleString()} AMP).`, 'warning');
      return;
    }
    const petCap = typeof selectedBet.maxJoinPets === 'number' ? selectedBet.maxJoinPets : null;
    if (petCap && joinSelectedCount > petCap) {
      showCustomPopup(`This bet allows at most ${petCap} pet${petCap === 1 ? '' : 's'}.`, 'warning');
      return;
    }

    setJoining(true);
    try {
      const response = await fetch(`${API_BASE}/api/coinflip/${selectedBet.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({
          selectedItems: joinEntries.map(({ item, qty }) => ({
            itemId: item.itemId || item.id,
            name: item.details?.name || item.name,
            quantity: qty,
            value: item.value || item.details?.value || 0
          }))
        })
      });
      const data = await response.json();
      if (response.ok) {
        setShowJoinModal(false);
        playChipFlip(data);
        fetchInventory();
        fetchCoinflips();
      } else {
        showCustomPopup(data.message || 'Failed to join coinflip', 'error');
      }
    } catch (err) {
      console.error('Error joining coinflip:', err);
      showCustomPopup('Failed to join coinflip due to server error', 'error');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="cf-loading">
        <CoinLoader size={84} label="Flipping up the lobby..." />
      </div>
    );
  }

  const visibleGames = coinflips.filter(isVisibleGame);

  return (
    <div className="cf-page">
      {/* ─── TOP BAR ─── */}
      <div className="cf-topbar">
        <div className="cf-topbar-tabs">
          <button className="cf-tab cf-tab-active">
            <span className="cf-tab-label"><Icon name="coin" size={12} /> Coinflip</span>
            <span className="cf-tab-count">{activeCount}</span>
          </button>
          <Link to="/jackpot" className="cf-tab">
            <span className="cf-tab-label"><Icon name="jackpot" size={12} /> Jackpot</span>
            <span className="cf-tab-count">{jackpotCount}</span>
          </Link>
          <span className="cf-tab-divider" />
          <button className="cf-tab cf-tab-disabled" disabled title="Coming soon">
            <span className="cf-tab-label"><Icon name="shop" size={12} /> Market</span>
          </button>
          <button className="cf-tab cf-tab-disabled" disabled title="Coming soon">
            <span className="cf-tab-label"><Icon name="flag" size={12} /> Race</span>
          </button>
        </div>
        <div className="cf-topbar-right">
          <div className="cf-sort-wrap" onClick={() => setSortDropdown(!sortDropdown)}>
            <span className="cf-sort-label">⇅ Value sort {sortBy === 'value_low' ? 'low to high' : sortBy === 'newest' ? 'newest' : sortBy === 'oldest' ? 'oldest' : 'high to low'}</span>
            <span className="cf-sort-arrow">▾</span>
            {sortDropdown && (
              <div className="cf-sort-dropdown" onClick={(e) => e.stopPropagation()}>
                {['newest', 'oldest', 'value_high', 'value_low'].map((s) => (
                  <button key={s} className={`cf-sort-option ${sortBy === s ? 'active' : ''}`} onClick={() => { setSortBy(s); setSortDropdown(false); }}>
                    {s.replace('_', ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="cf-topbar-stat">
            <span className="cf-dice-icon"><Icon name="dice" size={12} /></span>
            <span>{visibleGames.length}</span>
          </div>
          <div className="cf-topbar-stat">
            <span className="cf-diamond-icon"><Icon name="diamond" size={12} /></span>
            <span>{formatCompact(totalInGames)}</span>
          </div>
          <button className="cf-topbar-btn cf-topbar-btn-gold" onClick={handleCreateBet}>
            + Bet Items
          </button>
          <button className="cf-topbar-btn" onClick={openValueChecker}>
            Values
          </button>
          <button className="cf-topbar-btn" onClick={() => setShowLeaderboard(true)}>
            Leaderboard
          </button>
          <button className="cf-topbar-btn" onClick={openHistory}>
            History
          </button>
        </div>
      </div>

      {/* ─── LOBBY LIST ─── */}
      <div className="cf-lobby">
        {visibleGames.length === 0 ? (
          <div className="cf-empty">
            <div className="cf-empty-icon"><Icon name="coin" size={12} /></div>
            <p>No active coinflips</p>
            <p className="cf-empty-sub">Create a bet to get started!</p>
          </div>
        ) : (
          visibleGames.map((coinflip) => {
            const meta = getBetMeta(coinflip);
            const anim = chipAnim && chipAnim.id === coinflip.id ? chipAnim : null;
            const creatorWon = meta.isCompleted && meta.winnerId && meta.winnerId === coinflip.creatorId;
            const oppWon = meta.isCompleted && meta.winnerId && meta.winnerId === coinflip.opponentId;
            const creatorLost = meta.isCompleted && meta.winnerId && meta.winnerId !== coinflip.creatorId;
            const oppLost = meta.isCompleted && meta.winnerId && meta.winnerId !== coinflip.opponentId;
            // Lobby rows stay unhighlighted while the flip animation plays;
            // the winner ring appears once the result lands
            const flipping = !!(anim && anim.phase === 'flipping');
            const showCreatorRing = creatorWon && !flipping;
            const showOppRing = oppWon && !flipping;

            return (
              <div key={coinflip.id} className={`cf-row ${meta.isCompleted ? 'cf-row-done' : ''} ${freshBetId === coinflip.id ? 'cf-row-fresh' : ''} ${leavingBetId === coinflip.id ? 'cf-row-exit' : ''}`}>
                {/* Players */}
                <div className="cf-row-players">
                  <div className="cf-row-player">
                    <div className={`cf-row-avatar-ring ${showCreatorRing ? 'ring-winner' : ''} ${creatorLost ? 'ring-lost' : ''} ring-${meta.creatorSide}`}>
                      <img
                        src={meta.creatorAvatar}
                        alt={meta.creatorName}
                        className="cf-row-avatar"
                        onError={(e) => { e.target.src = '/default-avatar.png'; }}
                      />
                      <span className="cf-row-chip-badge">
                        <CoinChip side={meta.creatorSide} size={20} />
                      </span>
                    </div>
                  </div>
                  <span className="cf-row-vs">VS</span>
                  <div className="cf-row-player">
                    <div className={`cf-row-avatar-ring ${showOppRing ? 'ring-winner' : ''} ${oppLost ? 'ring-lost' : ''} ring-${meta.opponentSide}`}>
                      {meta.hasOpponent ? (
                        <img
                          src={meta.oppAvatar}
                          alt={meta.oppName}
                          className="cf-row-avatar"
                          onError={(e) => { e.target.src = '/default-avatar.png'; }}
                        />
                      ) : (
                        <div className="cf-row-avatar cf-row-avatar-empty">?</div>
                      )}
                      <span className="cf-row-chip-badge">
                        <CoinChip side={meta.opponentSide} size={20} />
                      </span>
                    </div>
                  </div>
                </div>

                {/* Item thumbnails */}
                <div className="cf-row-items">
                  {meta.thumbs.slice(0, 8).map((item, idx) => (
                    <div key={idx} className="cf-row-thumb-wrap cf-tip-host">
                      <img
                        src={item.image || item.imageUrl || '/default-item.png'}
                        alt={item.name || item.itemName || 'item'}
                        className="cf-row-thumb"
                        onError={(e) => { e.target.src = '/default-item.png'; }}
                      />
                      <span className="cf-row-thumb-rarity" style={{ background: getRarityColor(item.rarity) }}></span>
                      <span className="cf-tip-pop"><PetTooltip item={item} /></span>
                    </div>
                  ))}
                  {meta.thumbs.length > 8 && (
                    <span className="cf-row-more">+{meta.thumbs.length - 8}</span>
                  )}
                  {meta.isCompleted && (
                    <span className="cf-row-chip" title={`Landed ${meta.resultSide}`}>
                      {anim && anim.phase === 'flipping' ? (
                        <CoinFlipAnimation result={anim.side} size={46} />
                      ) : (
                        <CoinChip side={meta.resultSide} size={46} />
                      )}
                    </span>
                  )}
                </div>

                {/* Value */}
                <div className="cf-row-value">
                  <div className="cf-row-total">
                    <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {formatCompact(meta.total)}
                  </div>
                  <div className="cf-row-range">
                    {formatCompact(meta.creatorVal)} - {formatCompact(meta.oppVal || meta.creatorVal)}
                  </div>
                  {meta.maxJoinPets && (
                    <div className="cf-row-cap">Max {meta.maxJoinPets} items</div>
                  )}
                </div>

                {/* Action */}
                <div className="cf-row-action">
                  {!meta.isCompleted && !meta.isUserCreator && (
                    <>
                      <button className="cf-join-btn" onClick={() => handleOpenJoinModal(coinflip)}>
                        Join
                      </button>
                      <button className="cf-view-btn" onClick={() => setViewBet(coinflip)}>View</button>
                    </>
                  )}
                  {!meta.isCompleted && meta.isUserCreator && (
                    <div className="cf-row-own-btns">
                      <button
                        className="cf-bot-btn"
                        onClick={() => handleBotJoin(coinflip)}
                        disabled={botBusyId === coinflip.id}
                        title="Add the house bot to this bet"
                      >
                        {botBusyId === coinflip.id ? '...' : 'Bot'}
                      </button>
                      <button className="cf-view-btn" onClick={() => setViewBet(coinflip)}>View</button>
                    </div>
                  )}
                  {meta.isCompleted && (
                    <button className="cf-view-btn" onClick={() => setViewBet(coinflip)}>View</button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          VIEW MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      {viewBet && (() => {
        const meta = getBetMeta(viewBet);
        const isCompleted = viewBet.status === 'completed' || viewBet.isCompleted;
        const creatorWon = isCompleted && meta.winnerId && meta.winnerId === viewBet.creatorId;
        // Winner ring appears only after the flip animation lands
        const showWinnerRing = isCompleted && flipDoneId === viewBet.id;
        return (
          <ModalPortal>
          <div className="cf-modal-overlay" onClick={() => setViewBet(null)}>
            <div className="cf-modal cf-view-modal" onClick={(e) => e.stopPropagation()}>
              <button className="cf-modal-close" onClick={() => setViewBet(null)}>×</button>

              {/* Top: Players + Vs / Coin */}
              <div className="cf-view-top">
                <div className="cf-view-player">
                  <div className={`cf-view-avatar-ring ${showWinnerRing && creatorWon ? 'ring-winner' : ''} ring-${meta.creatorSide}`}>
                    <img src={meta.creatorAvatar} alt={meta.creatorName} className="cf-view-avatar" onError={(e) => { e.target.src = '/default-avatar.png'; }} />
                    <span className="cf-view-chip-badge"><CoinChip side={meta.creatorSide} size={24} /></span>
                  </div>
                  <div className="cf-view-player-name">{meta.creatorName}</div>
                </div>

                <div className="cf-view-coin-area">
                  {isCompleted ? (
                    <CoinSpinner result={meta.resultSide} size={84} onDone={() => setFlipDoneId(viewBet.id)} />
                  ) : (
                    <div className="cf-view-vs-big">Vs</div>
                  )}
                </div>

                <div className="cf-view-player">
                  <div className={`cf-view-avatar-ring ${showWinnerRing && !creatorWon ? 'ring-winner' : ''} ring-${meta.opponentSide}`}>
                    {meta.hasOpponent ? (
                      <img src={meta.oppAvatar} alt={meta.oppName} className="cf-view-avatar" onError={(e) => { e.target.src = '/default-avatar.png'; }} />
                    ) : (
                      <div className="cf-view-avatar cf-view-avatar-empty">?</div>
                    )}
                    <span className="cf-view-chip-badge"><CoinChip side={meta.opponentSide} size={24} /></span>
                  </div>
                  <div className="cf-view-player-name">{meta.oppName || 'Waiting..'}</div>
                </div>
              </div>

              {/* Hash */}
              {viewBet.hash && (
                <div className="cf-view-hash">
                  <span className="cf-hash-icon">#</span>
                  <span>{String(viewBet.hash).length > 30 ? `${String(viewBet.hash).slice(0, 30)}...` : viewBet.hash}</span>
                </div>
              )}

              {/* Win-chance bars */}
              <div className="cf-view-panels">
                <div className="cf-view-panel">
                  <span className="cf-panel-pct">{sidePct(meta.creatorVal, meta.total)}</span>
                  <span className="cf-panel-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {meta.creatorVal.toLocaleString()}</span>
                </div>
                <div className="cf-view-panel">
                  <span className="cf-panel-pct">{sidePct(meta.oppVal, meta.total)}</span>
                  <span className="cf-panel-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {meta.oppVal.toLocaleString()}</span>
                </div>
              </div>

              {/* Items split */}
              <div className="cf-view-items-split">
                <div className="cf-view-items-col">
                  {meta.creatorItems.length > 0 ? meta.creatorItems.map((item, i) => (
                    <div key={i} className="cf-view-item-row cf-tip-host" data-tip={item.name || item.itemName || 'Item'}>
                      <img src={item.image || item.imageUrl || '/default-item.png'} alt={item.name || 'item'} className="cf-view-item-icon" onError={(e) => { e.target.src = '/default-item.png'; }} />
                      <span className="cf-view-item-name">{item.name || item.itemName || 'Item'}{(item.quantity || 1) > 1 ? ` ×${item.quantity}` : ''}</span>
                      <ModBadges mods={item.mods} size={15} />
                      <span className="cf-view-item-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {((item.value || 0) * (item.quantity || 1)).toLocaleString()}</span>
                      <span className="cf-tip-pop"><PetTooltip item={item} /></span>
                    </div>
                  )) : <div className="cf-view-noitems">No items</div>}
                </div>
                <div className="cf-view-items-col">
                  {meta.opponentItems.length > 0 ? meta.opponentItems.map((item, i) => (
                    <div key={i} className="cf-view-item-row cf-tip-host" data-tip={item.name || item.itemName || 'Item'}>
                      <img src={item.image || item.imageUrl || '/default-item.png'} alt={item.name || 'item'} className="cf-view-item-icon" onError={(e) => { e.target.src = '/default-item.png'; }} />
                      <span className="cf-view-item-name">{item.name || item.itemName || 'Item'}{(item.quantity || 1) > 1 ? ` ×${item.quantity}` : ''}</span>
                      <ModBadges mods={item.mods} size={15} />
                      <span className="cf-view-item-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {((item.value || 0) * (item.quantity || 1)).toLocaleString()}</span>
                      <span className="cf-tip-pop"><PetTooltip item={item} /></span>
                    </div>
                  )) : <div className="cf-view-waiting">Waiting for the opponent to join...</div>}
                </div>
              </div>

              {/* Completed result line */}
              {isCompleted && (
                <div className="cf-view-result-text">
                  <Icon name="trophy" size={12} /> <strong>{viewBet.winnerUsername || 'Someone'}</strong> won <span className="cf-highlight">{meta.total.toLocaleString()} AMP</span>
                </div>
              )}

              {/* Footer */}
              <div className="cf-view-footer">
                <span className="cf-view-created">Created {timeAgo(viewBet.createdAt)}</span>
                {!isCompleted && !meta.isUserCreator && (
                  <button className="cf-view-join-btn" onClick={() => { const b = viewBet; setViewBet(null); handleOpenJoinModal(b); }}>
                    Join Bet ({meta.total.toLocaleString()} AMP)
                  </button>
                )}
                {!isCompleted && meta.isUserCreator && (
                  <div className="cf-view-own-row">
                    <button className="cf-cancel-btn" onClick={() => handleCancelBet(viewBet)} disabled={cancelling}>
                      {cancelling ? 'Cancelling...' : 'Cancel Bet'}
                    </button>
                  </div>
                )}
              </div>
              <div className="cf-view-provably">
                <span className="cf-provably-btn">PROVABLY FAIR</span>
              </div>
            </div>
          </div>
          </ModalPortal>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════
          JOIN MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      {showJoinModal && selectedBet && (() => {
        const meta = getBetMeta(selectedBet);
        const { lo, hi } = getJoinRange(selectedBet);
        const totalVal = getJoinTotalValue();
        const rangeOk = joinRangeOk();
        return (
          <ModalPortal>
          <div className="cf-modal-overlay" onClick={() => setShowJoinModal(false)}>
            <div className="cf-modal cf-join-modal" onClick={(e) => e.stopPropagation()}>
              <button className="cf-modal-close" onClick={() => setShowJoinModal(false)}>×</button>

              <div className="cf-join-content">
                {/* Left: who you're joining + what's in the bet */}
                <div className="cf-join-left">
                  <div className="cf-join-vs-head">
                    <span className="cf-join-vs-label">JOINING</span>
                    <div className="cf-join-vs-user">
                      <img src={meta.creatorAvatar} alt={meta.creatorName} className="cf-join-vs-avatar" onError={(e) => { e.target.src = '/default-avatar.png'; }} />
                      <div className="cf-join-vs-meta">
                        <span className="cf-join-vs-name">{meta.creatorName}</span>
                        <span className={`cf-join-vs-side side-${meta.creatorSide}`}>
                          {meta.creatorSide === 'heads' ? 'H · Heads' : 'T · Tails'}
                        </span>
                      </div>
                    </div>
                    <div className="cf-join-vs-total">
                      <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {formatCompact(meta.total)}
                      <span className="cf-join-vs-sub">{meta.thumbs.length} items in pot</span>
                    </div>
                  </div>

                  {/* Items in this bet */}
                  <div className="cf-join-bet-items">
                    <div className="cf-join-bet-items-title">ITEMS IN THIS BET</div>
                    <div className="cf-join-bet-items-list">
                      {(selectedBet.creatorItems || []).map((item, idx) => (
                        <div key={idx} className="cf-join-bet-item" title={`${item.name || item.itemName || 'Item'}`}>
                          <img
                            src={item.image || item.imageUrl || '/default-item.png'}
                            alt={item.name || item.itemName || 'item'}
                            className="cf-join-bet-item-img"
                            onError={(e) => { e.target.src = '/default-item.png'; }}
                          />
                          <span className="cf-join-bet-item-name">{item.name || item.itemName || 'Item'}{(item.quantity || 1) > 1 ? ` ×${item.quantity}` : ''}</span>
                          <span className="cf-join-bet-item-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {Number(item.value || 0).toLocaleString()}</span>
                        </div>
                      ))}
                      {(!selectedBet.creatorItems || selectedBet.creatorItems.length === 0) && (
                        <div className="cf-join-no-items">No items</div>
                      )}
                    </div>
                  </div>

                  {/* Player cards: them vs you */}
                  <div className="cf-join-player-cards">
                    <div className="cf-join-pcard">
                      <img src={meta.creatorAvatar} alt="" className="cf-join-pcard-avatar" onError={(e) => { e.target.src = '/default-avatar.png'; }} />
                      <div className="cf-join-pcard-info">
                        <span className="cf-join-pcard-name">{meta.creatorName}</span>
                        <span className="cf-join-pcard-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {meta.creatorVal.toLocaleString()}</span>
                      </div>
                      <span className="cf-join-pcard-pct">{sidePct(meta.creatorVal, meta.total)}</span>
                    </div>
                    <div className="cf-join-pcard">
                      <img src={user?.avatar || '/default-avatar.png'} alt="" className="cf-join-pcard-avatar" onError={(e) => { e.target.src = '/default-avatar.png'; }} />
                      <div className="cf-join-pcard-info">
                        <span className="cf-join-pcard-name">{user?.robloxDisplayName || user?.displayName || 'You'}</span>
                        <span className="cf-join-pcard-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {totalVal.toLocaleString()}</span>
                      </div>
                      <span className="cf-join-pcard-pct">{totalVal > 0 ? sidePct(totalVal, meta.total) : '0.00%'}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Inventory grid */}
                <div className="cf-join-right">
                  <div className="cf-join-inv-header">
                    <span>Select Items</span>
                    <span className="cf-join-range-text">Range: {lo.toLocaleString()} - {hi.toLocaleString()} AMP</span>
                  </div>
                  <div className="cf-join-inv-grid">
                    {userInventory.length === 0 ? (
                      <div className="cf-join-no-items">Your inventory is empty</div>
                    ) : (
                      userInventory.flatMap((item) => {
                        const key = joinStackKeyOf(item);
                        const max = joinStackQtyOf(item);
                        const sel = joinSelectedQty[key] || 0;
                        const tiles = max > 8 ? 7 : max;
                        const extra = max > 8 ? max - 7 : 0;
                        const arr = [];
                        for (let i = 0; i < tiles; i++) {
                          const isSelected = i < sel;
                          const tileItem = {
                            name: item.details?.name || item.name,
                            itemName: item.details?.name || item.name,
                            value: item.value || item.details?.value || 0,
                            quantity: 1,
                            rarity: item.rarity || item.details?.rarity || 'common',
                            mods: item.mods || item.details?.mods || [],
                            image: item.details?.imageUrl || item.image || item.imageUrl
                          };
                          arr.push(
                            <div
                              key={`${key}:${i}`}
                              className={`cf-inv-tile cf-tip-host ${isSelected ? 'selected' : ''}`}
                              onClick={() => toggleJoinUnit(key, i)}
                            >
                              <img src={item.details?.imageUrl || item.image || item.imageUrl || '/default-item.png'} alt="" className="cf-inv-img" onError={(e) => { e.target.src = '/default-item.png'; }} />
                              <div className="cf-inv-name">{item.details?.name || item.name}</div>
                              <ModBadges mods={item.mods || item.details?.mods} size={15} />
                              <div className="cf-inv-val"><span className="cf-diamond-xs"><Icon name="diamond" size={10} /></span>{(item.value || item.details?.value || 0).toLocaleString()}</div>
                              <span className="cf-tip-pop"><PetTooltip item={tileItem} /></span>
                            </div>
                          );
                        }
                        if (extra > 0) {
                          arr.push(
                            <div
                              key={`${key}:extra`}
                              className="cf-inv-tile cf-inv-extra"
                              onClick={() => toggleJoinUnit(key, tiles)}
                              title={`${extra} more ${item.details?.name || item.name}`}
                            >
                              <div className="cf-inv-extra-num">+{extra}</div>
                              <div className="cf-inv-name">{item.details?.name || item.name}</div>
                              <div className="cf-inv-val"><span className="cf-diamond-xs"><Icon name="diamond" size={10} /></span>{(item.value || item.details?.value || 0).toLocaleString()}</div>
                            </div>
                          );
                        }
                        return arr;
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom bar (always visible) */}
              <div className="cf-join-bottom">
                <div className="cf-join-bottom-left">
                  <button className="cf-join-action-btn" onClick={handleSelectAll} disabled={joining}>Select All</button>
                  <button className="cf-join-action-btn" onClick={handleAutoSelect} disabled={joining}>Auto Select</button>
                </div>
                <div className="cf-join-bottom-right">
                  <div className="cf-join-selected-info">
                    <span className={rangeOk ? 'cf-range-ok' : 'cf-range-bad'}>
                      {rangeOk ? `✓ ${totalVal.toLocaleString()} AMP` : `${totalVal.toLocaleString()} AMP — need ${Math.max(0, lo - totalVal).toLocaleString()} more`}
                    </span>
                  </div>
                  <button className="cf-confirm-btn" disabled={joining || !rangeOk} onClick={handleConfirmJoinBet}>
                    {joining ? 'Joining...' : `Confirm Bet (${totalVal.toLocaleString()} AMP)`}
                  </button>
                </div>
              </div>
            </div>
          </div>
          </ModalPortal>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════
          CREATE MODAL (delegates to CreateCoinflipModal component)
      ═══════════════════════════════════════════════════════════════════ */}
      {showCreateModal && (
        <CreateCoinflipModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleBetCreated}
          userId={user?.id}
          socket={socket}
          setBalance={setBalance}
          userInventory={userInventory}
        />
      )}

      {/* Values open in the global modal (App level) — see openValueChecker */}

      {/* ═══════════════════════════════════════════════════════════════════
          HISTORY MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      {showHistory && (
        <ModalPortal>
        <div className="cf-modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="cf-modal cf-history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cf-modal-close" onClick={() => setShowHistory(false)}>×</button>
            <h2 className="cf-history-title">Coinflip History</h2>
            <div className="cf-history-body">
              {historyLoading ? (
                <div className="cf-value-loading"><div className="cf-loading-spinner"></div></div>
              ) : historyItems.length === 0 ? (
                <div className="cf-history-empty">
                  <p>No bet history yet</p>
                  <p className="cf-history-empty-sub">Place or join a bet to start tracking</p>
                </div>
              ) : (() => {
                const perPage = 8;
                const totalPages = Math.max(1, Math.ceil(historyItems.length / perPage));
                const safePage = Math.min(Math.max(1, historyPage), totalPages);
                const pageBets = historyItems.slice((safePage - 1) * perPage, safePage * perPage);
                return (
                  <>
                    <div className="cf-history-list">
                      {pageBets.map((bet, index) => {
                        const hmeta = getBetMeta(bet);
                        const winnerIsCreator = bet.winnerId && bet.winnerId === bet.creatorId;
                        const winnerAvatar = winnerIsCreator ? hmeta.creatorAvatar : hmeta.oppAvatar;
                        const winnerName = winnerIsCreator ? hmeta.creatorName : (hmeta.oppName || 'Unknown');
                        const winnerSide = winnerIsCreator ? hmeta.creatorSide : hmeta.opponentSide;
                        const loserAvatar = winnerIsCreator ? hmeta.oppAvatar : hmeta.creatorAvatar;
                        const loserSide = winnerIsCreator ? hmeta.opponentSide : hmeta.creatorSide;
                        const potItems = [...(bet.creatorItems || []), ...(bet.opponentItems || [])];
                        const shown = potItems.slice(0, 5);
                        const extra = potItems.length - shown.length;
                        return (
                          <div key={bet.id || index} className="cf-history-row">
                            <div className="cf-history-avatars">
                              <div className="cf-history-avatar-wrap winner">
                                <img src={winnerAvatar} alt={winnerName} className="cf-history-avatar" onError={(e) => { e.target.src = '/default-avatar.png'; }} />
                                <span className="cf-history-chip"><CoinChip side={winnerSide} size={18} /></span>
                              </div>
                              <div className="cf-history-avatar-wrap loser">
                                <img src={loserAvatar} alt="" className="cf-history-avatar" onError={(e) => { e.target.src = '/default-avatar.png'; }} />
                                <span className="cf-history-chip"><CoinChip side={loserSide} size={18} /></span>
                              </div>
                            </div>
                            <div className="cf-history-items">
                              {shown.map((item, i) => (
                                <div key={i} className="cf-history-thumb-col">
                                  <img
                                    src={item.image || item.imageUrl || '/default-item.png'}
                                    alt={item.name || item.itemName || 'item'}
                                    className="cf-history-thumb"
                                    onError={(e) => { e.target.src = '/default-item.png'; }}
                                  />
                                  <ModBadges mods={item.mods} size={13} />
                                </div>
                              ))}
                              {extra > 0 && <span className="cf-history-more">+{extra}</span>}
                            </div>
                            <span className="cf-history-chip-big" title={`Landed ${hmeta.resultSide}`}>
                              <CoinChip side={hmeta.resultSide} size={42} />
                            </span>
                            <button
                              className="cf-history-view"
                              title="View game"
                              onClick={() => { setShowHistory(false); setViewBet(bet); }}
                            >
                              <Icon name="eye" size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="cf-history-pager">
                      <button
                        className="cf-history-page-btn"
                        disabled={safePage <= 1}
                        onClick={() => setHistoryPage(safePage - 1)}
                      >
                        ‹
                      </button>
                      <span className="cf-history-page-info">Page {safePage} of {totalPages} · {historyItems.length} flips</span>
                      <button
                        className="cf-history-page-btn"
                        disabled={safePage >= totalPages}
                        onClick={() => setHistoryPage(safePage + 1)}
                      >
                        ›
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Leaderboard */}

      {/* Leaderboard */}
      {showLeaderboard && (
        <LeaderboardModal isOpen={showLeaderboard} onClose={() => setShowLeaderboard(false)} />
      )}

      {/* Popup */}
      {showPopup && (
        <AnimatedPopup message={popupMessage} type={popupType} onClose={closePopup} />
      )}
    </div>
  );
};

export default CoinflipPage;
