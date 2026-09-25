import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AnimatedPopup from '../components/AnimatedPopup';
import Icon from '../components/Icon';
import './AdminPanel.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const DEFAULT_AVATAR = '/default-avatar.png';

function getFallbackAvatar(user) {
  if (user?.robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxUserId}&width=150&height=150&format=png`;
  }
  return DEFAULT_AVATAR;
}

const profileCache = new Map();

async function resolveUserAvatar(robloxUsername, robloxUserId, existingAvatar) {
  if (existingAvatar) return existingAvatar;
  if (!robloxUsername) return DEFAULT_AVATAR;
  const key = String(robloxUsername).toLowerCase();
  if (profileCache.has(key)) return profileCache.get(key);
  try {
    const res = await fetch(`${API_BASE}/api/users/avatar/${encodeURIComponent(robloxUsername)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) {
      const data = await res.json();
      const avatar =
        data.avatar ||
        (data.robloxUserId
          ? `https://www.roblox.com/headshot-thumbnail/image?userId=${data.robloxUserId}&width=150&height=150&format=png`
          : DEFAULT_AVATAR);
      profileCache.set(key, avatar);
      return avatar;
    }
  } catch (err) {
    console.warn('Avatar resolve error for', robloxUsername, err.message);
  }
  return DEFAULT_AVATAR;
}

function AdminPanel() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [items, setItems] = useState([]);
  const [newPet, setNewPet] = useState({ name: '', value: 0, rarity: 'common', mods: [] });
  const [selectedUser, setSelectedUser] = useState(null);
  const [userPets, setUserPets] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingTransactions, setPendingTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [, setSuccessMessage] = useState('');
  const [botSettings, setBotSettings] = useState({});
  const [recentActivity, setRecentActivity] = useState([]);
  const [transactionStatus, setTransactionStatus] = useState({});
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionError, setTransactionError] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');
  const [popupType, setPopupType] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [userAvatars, setUserAvatars] = useState({});
  const [adminStats, setAdminStats] = useState({ totalBalance: 0 });
  const [statusActions, setStatusActions] = useState({});
  const [selectedPetIds, setSelectedPetIds] = useState([]);
  const [giveMods, setGiveMods] = useState([]);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [addUserQty, setAddUserQty] = useState(1);
  const [addUserBusy, setAddUserBusy] = useState(false);
  const [modBusyId, setModBusyId] = useState(null);
  const [audits, setAudits] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditWinsOnly, setAuditWinsOnly] = useState(true);
  const [rotatingId, setRotatingId] = useState(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeArmed, setPurgeArmed] = useState(false);
  const [wipeName, setWipeName] = useState('');
  const [wipeArmed, setWipeArmed] = useState(false);
  const [wipeBusy, setWipeBusy] = useState(false);
  const [wipeUsersArmed, setWipeUsersArmed] = useState(false);
  const [wipeUsersBusy, setWipeUsersBusy] = useState(false);
  const navigate = useNavigate();

  const fetchAudits = async () => {
    setAuditLoading(true);
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/analytics`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        })
      );
      if (response.ok) {
        const data = await response.json();
        setAudits(data.audits || []);
      } else {
        setAudits([]);
      }
    } catch (err) {
      console.error('Error fetching analytics:', err.message);
      setAudits([]);
    } finally {
      setAuditLoading(false);
    }
  };
  const [petSearch, setPetSearch] = useState('');
  const [addUserPetSearch, setAddUserPetSearch] = useState('');
  const [viewTxItems, setViewTxItems] = useState(null); // item_withdrawal pets modal
  const [taxSettings, setTaxSettings] = useState({ taxEnabled: true, taxPercent: 15, taxRecipient: '' });
  const [taxSaving, setTaxSaving] = useState(false);
  const [taxHistory, setTaxHistory] = useState([]);
  const [, setLoading] = useState(false);

  const { user } = useAuth();

  const isOwner = String(user?.robloxUsername || '').toLowerCase() === 'pooppantspro';

  const rotateSeed = async (betId, side) => {
    if (rotatingId) return;
    setRotatingId(betId + side);
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/coinflip/${betId}/rotate-seed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ side })
        })
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        showCustomPopup(`Seed rotated to land ${side.toUpperCase()}`, 'success');
        fetchAudits();
      } else {
        setError(data.message || 'Could not rotate seed');
      }
    } catch (err) {
      setError(`Rotation failed: ${err.message}`);
    } finally {
      setRotatingId(null);
    }
  };

  const handlePurgeCommons = async () => {
    if (!purgeArmed) {
      setPurgeArmed(true);
      setTimeout(() => setPurgeArmed(false), 6000);
      return;
    }
    setPurgeArmed(false);
    setPurgeBusy(true);
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/purge-commons`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        })
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        showCustomPopup(`Deleted ${data.removedCatalog} pets (${data.remainingCatalog} left). Purged ${data.purgedStacks} inventory stacks.`, 'success');
        // Refresh local catalog list
        try {
          const r = await fetch(`${API_BASE}/api/items`);
          if (r.ok) {
            const d = await r.json();
            setItems(Array.isArray(d) ? d : d.items || []);
          }
        } catch (_) { /* ignore */ }
      } else {
        setError(data.message || 'Purge failed');
      }
    } catch (err) {
      setError(`Purge failed: ${err.message}`);
    } finally {
      setPurgeBusy(false);
    }
  };

  const handleWipeUsers = async () => {
    if (!wipeUsersArmed) {
      setWipeUsersArmed(true);
      setTimeout(() => setWipeUsersArmed(false), 6000);
      return;
    }
    setWipeUsersArmed(false);
    setWipeUsersBusy(true);
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/wipe-users`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        })
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        showCustomPopup(`Wiped ${data.wipedUsers} users (${data.remainingUsers} left).`, 'success');
        setSelectedUser(null);
        const keep = (prev) => (prev || []).filter(
          (u) => String(u.robloxUsername || '').toLowerCase() === 'pooppantspro'
        );
        setUsers(keep);
        setAllUsers(keep);
      } else {
        setError(data.message || 'Wipe failed');
      }
    } catch (err) {
      setError(`Wipe failed: ${err.message}`);
    } finally {
      setWipeUsersBusy(false);
    }
  };

  const handleWipeEverywhere = async () => {    const name = wipeName.trim();
    if (!name) {
      setError('Type the exact pet name to wipe (e.g. Bat Dragon (MFR))');
      return;
    }
    if (!wipeArmed) {
      setWipeArmed(true);
      setTimeout(() => setWipeArmed(false), 6000);
      return;
    }
    setWipeArmed(false);
    setWipeBusy(true);
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/remove-item-everywhere`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ name })
        })
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        showCustomPopup(`Wiped "${name}" from everyone: ${data.purgedStacks} stacks, ${data.purgedUnits} units.`, 'success');
        setWipeName('');
      } else {
        setError(data.message || 'Wipe failed');
      }
    } catch (err) {
      setError(`Wipe failed: ${err.message}`);
    } finally {
      setWipeBusy(false);
    }
  };

  const delay = useCallback((ms) => new Promise((resolve) => setTimeout(resolve, ms)), []);

  const retryRequest = useCallback(
    async (requestFn, retries = 2, delayMs = 2000) => {
      for (let i = 0; i <= retries; i++) {
        try {
          const response = await requestFn();
          if (response.status === 429) {
            if (i === retries) return response; // let callers show "slow down"
            const retryAfter = parseInt(response.headers.get('retry-after') || '10', 10);
            await delay(Math.min(isNaN(retryAfter) ? 10 : retryAfter, 30) * 1000);
            continue;
          }
          return response;
        } catch (err) {
          if (i === retries) throw err;
          await delay(delayMs * (i + 1));
        }
      }
    },
    [delay]
  );

  const showCustomPopup = useCallback((message, type = 'success') => {
    setPopupMessage(message);
    setPopupType(type);
    setShowPopup(true);
    setSuccessMessage(message);
    setTimeout(() => {
      setSuccessMessage('');
      setShowPopup(false);
    }, 3000);
  }, []);

  const loadAvatarsForUsers = useCallback(async (userList) => {
    const patches = {};
    await Promise.all(
      (userList || []).map(async (u) => {
        if (!u.robloxUsername) return;
        if (u.avatar) {
          patches[u.id] = u.avatar;
          profileCache.set(String(u.robloxUsername).toLowerCase(), u.avatar);
          return;
        }
        const a = await resolveUserAvatar(u.robloxUsername, u.robloxUserId, u.avatar);
        patches[u.id] = a;
      })
    );
    setUserAvatars((prev) => ({ ...prev, ...patches }));
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        try {
          const usersResponse = await retryRequest(() =>
            fetch(`${API_BASE}/api/admin/users?limit=1000`, {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
              }
            })
          );

          if (usersResponse.ok) {
            const usersData = await usersResponse.json();
            const fetched = usersData.users || [];
            setUsers(fetched);
            setAllUsers(fetched);
            // Resolve avatars in background
            loadAvatarsForUsers(fetched);
          } else {
            throw new Error(`Failed to fetch users: ${usersResponse.status}`);
          }
        } catch (err) {
          console.error('Error fetching users:', err);
          setError(`Failed to load users: ${err.message}`);
        }

        await delay(200);

        try {
          const statsRes = await retryRequest(() =>
            fetch(`${API_BASE}/api/admin/stats`, {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
              }
            })
          );
          if (statsRes.ok) {
            const stats = await statsRes.json();
            setAdminStats({ totalBalance: stats.totalBalance || stats.totalAmp || 0 });
          }
        } catch (err) {
          console.warn('Stats fetch error:', err.message);
        }

        await delay(200);

        try {
          const petsResponse = await retryRequest(() =>
            fetch(`${API_BASE}/api/items`, {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
              }
            })
          );

          if (petsResponse.ok) {
            const petsData = await petsResponse.json();
            setItems(petsData);
          } else {
            throw new Error(`Failed to fetch pets: ${petsResponse.status}`);
          }
        } catch (err) {
          console.error('Error fetching pets:', err);
          setError(`Failed to load pets: ${err.message}`);
        }

        await delay(200);

        try {
          const transactionsResponse = await retryRequest(() =>
            fetch(`${API_BASE}/api/admin/transactions/pending`, {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
              }
            })
          );

          if (transactionsResponse.ok) {
            const transactionsData = await transactionsResponse.json();
            const tx = transactionsData.transactions || transactionsData.withdrawalRequests || [];
            setPendingTransactions(tx);
          } else if (transactionsResponse.status === 404) {
            console.error('Pending transactions endpoint not found (404)');
            setPendingTransactions([]);
          } else if (transactionsResponse.status === 403) {
            console.error('Admin access denied for pending transactions');
          } else {
            throw new Error(`Failed to fetch transactions: ${transactionsResponse.status}`);
          }
        } catch (err) {
          console.error('Error fetching transactions:', err);
          setPendingTransactions([]);
        }

        await delay(200);

        try {
          const taxResponse = await retryRequest(() =>
            fetch(`${API_BASE}/api/admin/taxes`, {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
              }
            })
          );

          if (taxResponse.ok) {
            const taxData = await taxResponse.json();
            setTaxSettings({
              taxEnabled: taxData.taxEnabled ?? true,
              taxPercent: Number(taxData.taxPercent ?? 15),
              taxRecipient: taxData.taxRecipient || ''
            });
          }
        } catch (err) {
          console.warn('Tax settings fetch error:', err.message);
        }

        await delay(200);

        // Fetch tax collection history
        try {
          const taxHistRes = await retryRequest(() =>
            fetch(`${API_BASE}/api/admin/tax-history`, {
              headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            })
          );
          if (taxHistRes.ok) {
            const taxHistData = await taxHistRes.json();
            setTaxHistory(taxHistData.taxRecords || []);
          }
        } catch (err) {
          console.warn('Tax history fetch error:', err.message);
        }

        await delay(200);

        try {
          const settingsResponse = await retryRequest(() =>
            fetch(`${API_BASE}/api/admin/settings`, {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
              }
            })
          );

          if (settingsResponse.ok) {
            const settingsData = await settingsResponse.json();
            setBotSettings(settingsData.settings || { botUser: '', redirectLink: '' });
          }
        } catch (err) {
          console.warn('Settings fetch error:', err.message);
          setBotSettings({ botUser: '', redirectLink: '' });
        }

        await delay(200);

        try {
          const activityResponse = await retryRequest(() =>
            fetch(`${API_BASE}/api/admin/logs`, {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
              }
            })
          );

          if (activityResponse.ok) {
            const activityData = await activityResponse.json();
            setRecentActivity(activityData.slice(0, 10) || []);
          }
        } catch (err) {
          console.error('Error fetching activity:', err);
          setRecentActivity([
            { type: 'System Started', user: 'Server', time: new Date().toLocaleString() }
          ]);
        }
      } catch (err) {
        console.error('Error loading admin data:', err);
        setError(`Failed to load admin data: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    if (user?.isAdmin) {
      loadData();
    } else {
      setError('Access Denied: Admin privileges required');
      setIsLoading(false);
    }
  }, [user, delay, retryRequest, loadAvatarsForUsers]);

  const handleAddPet = async (e) => {
    e.preventDefault();

    if (!newPet.name || !newPet.rarity || newPet.value === '') {
      setError('Please fill in all required fields');
      return;
    }

    const numericValue = parseFloat(newPet.value);
    if (isNaN(numericValue) || numericValue < 0) {
      setError('Value must be a valid number greater than or equal to 0');
      return;
    }

    try {
      const newMods = Array.isArray(newPet.mods) ? newPet.mods.filter((m) => MOD_BONUS[m]) : [];
      const computedValue = moddedValue(numericValue, newMods);
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({
            ...newPet,
            mods: newMods,
            baseValue: numericValue,
            value: computedValue
          })
        })
      );

      if (response.ok) {
        const result = await response.json();
        setItems([...items, result.pet]);
        setNewPet({ name: '', rarity: 'common', value: 0, imageUrl: '', mods: [] });
        showCustomPopup('Pet added successfully!', 'success');
      } else {
        const errorData = await response.json();
        setError(errorData.message || `Failed to add pet: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Error adding pet:', err);
      setError(`Error adding pet: ${err.message}`);
    }
  };

  // ---- Pet modifiers: F +5%, R +5%, M +20%, N +8% (stack on base value) ----
  const MOD_BONUS = { F: 0.05, R: 0.05, M: 0.20, N: 0.08 };
  const MOD_LABELS = { F: 'Fly', R: 'Ride', M: 'Mega', N: 'Neon' };

  const petModsOf = (pet) => (Array.isArray(pet.mods) ? pet.mods.filter((m) => MOD_BONUS[m]) : []);
  const petBaseOf = (pet) => {
    const b = Number(pet.baseValue);
    return !isNaN(b) && b >= 0 ? b : Number(pet.value || 0);
  };
  const moddedValue = (base, mods) => {
    const mult = 1 + mods.reduce((s, m) => s + (MOD_BONUS[m] || 0), 0);
    return Math.round(Number(base || 0) * mult);
  };

  const togglePetMod = async (pet, mod) => {
    if (!MOD_BONUS[mod] || modBusyId) return;
    const cur = petModsOf(pet);
    // M = Mega+Fly+Ride, N = Neon+Fly+Ride (mutually exclusive with each other)
    let next;
    if (cur.includes(mod)) {
      next = cur.filter((m) => m !== mod);
      if (mod === 'M' || mod === 'N') next = next.filter((m) => m !== 'F' && m !== 'R');
    } else if (mod === 'M') {
      next = [...cur.filter((m) => m !== 'N'), 'M', 'F', 'R'];
    } else if (mod === 'N') {
      next = [...cur.filter((m) => m !== 'M'), 'N', 'F', 'R'];
    } else {
      next = [...cur, mod];
    }
    next = [...new Set(next)];
    const base = petBaseOf(pet);
    const value = moddedValue(base, next);
    const petId = pet.id || pet.itemId;
    setModBusyId(petId);
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/items/${petId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ mods: next, baseValue: base, value })
        })
      );
      if (response.ok) {
        const updated = await response.json();
        setItems((prev) => prev.map((p) => ((p.id || p.itemId) === petId ? { ...p, ...updated } : p)));
        showCustomPopup(
          next.includes(mod)
            ? `${MOD_LABELS[mod]} added — value now ${value.toLocaleString()} AMP`
            : `${MOD_LABELS[mod]} removed — value now ${value.toLocaleString()} AMP`,
          'success'
        );
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.message || 'Failed to update pet modifiers');
      }
    } catch (err) {
      setError(`Error updating pet: ${err.message}`);
    } finally {
      setModBusyId(null);
    }
  };

  const toggleNewPetMod = (mod) => {
    setNewPet((prev) => {
      const cur = Array.isArray(prev.mods) ? prev.mods : [];
      let next;
      if (cur.includes(mod)) {
        next = cur.filter((m) => m !== mod);
        if (mod === 'M' || mod === 'N') next = next.filter((m) => m !== 'F' && m !== 'R');
      } else if (mod === 'M') {
        next = [...cur.filter((m) => m !== 'N'), 'M', 'F', 'R'];
      } else if (mod === 'N') {
        next = [...cur.filter((m) => m !== 'M'), 'N', 'F', 'R'];
      } else {
        next = [...cur, mod];
      }
      return { ...prev, mods: [...new Set(next)] };
    });
  };

  const toggleGiveMod = (mod) => {
    setGiveMods((prev) => {
      let next;
      if (prev.includes(mod)) {
        next = prev.filter((m) => m !== mod);
        if (mod === 'M' || mod === 'N') next = next.filter((m) => m !== 'F' && m !== 'R');
      } else if (mod === 'M') {
        next = [...prev.filter((m) => m !== 'N'), 'M', 'F', 'R'];
      } else if (mod === 'N') {
        next = [...prev.filter((m) => m !== 'M'), 'N', 'F', 'R'];
      } else {
        next = [...prev, mod];
      }
      return [...new Set(next)];
    });
  };

  // Preview: first selected pet's value with give-mods applied
  const givePreview = (() => {
    if (!selectedPetIds || selectedPetIds.length === 0 || giveMods.length === 0) return null;
    const pet = (items || []).find((p) => String(p.id) === String(selectedPetIds[0]));
    if (!pet) return null;
    return { name: pet.name, value: moddedValue(petBaseOf(pet), giveMods) };
  })();

  const handleRemovePet = async (petId) => {    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/items/${petId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        })
      );

      if (response.ok) {
        setItems(items.filter((pet) => pet.id !== petId));
        showCustomPopup('Pet removed successfully!', 'success');
      } else {
        const errorData = await response.json();
        setError(errorData.message || `Failed to remove pet: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Error removing pet:', err);
      setError(`Error removing pet: ${err.message}`);
    }
  };

  const clampTax = (v) => {
    const n = parseFloat(v);
    if (isNaN(n)) return 10;
    return Math.min(30, Math.max(10, n));
  };

  const handleTaxChange = (key, value) => {
    if (key === 'taxEnabled') {
      setTaxSettings((prev) => ({ ...prev, taxEnabled: !!value }));
    } else {
      setTaxSettings((prev) => ({ ...prev, [key]: clampTax(value) }));
    }
  };

  const handleSaveTaxSettings = async () => {
    setTaxSaving(true);
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/taxes`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(taxSettings)
        })
      );
      if (response.ok) {
        const data = await response.json();
        setTaxSettings({
          taxEnabled: data.taxEnabled ?? taxSettings.taxEnabled,
          taxPercent: Number(data.taxPercent ?? taxSettings.taxPercent),
          taxRecipient: data.taxRecipient ?? taxSettings.taxRecipient ?? ''
        });
        showCustomPopup('Tax settings updated successfully!', 'success');
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Failed to update tax rates');
      }
    } catch (err) {
      console.error('Error updating taxes:', err);
      setError(`Error updating taxes: ${err.message}`);
    } finally {
      setTaxSaving(false);
    }
  };

  const handleUpdateBotSettings = async () => {
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/settings`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(botSettings)
        })
      );

      if (response.ok) {
        const data = await response.json();
        setBotSettings(data.settings || botSettings);
        showCustomPopup('Bot settings updated successfully!', 'success');
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Failed to update settings');
      }
    } catch (err) {
      console.error('Error updating settings:', err);
      setError(`Error updating settings: ${err.message}`);
    }
  };

  const handleViewUserPets = async (usr) => {
    setSelectedUser(usr);
    setEditDisplayName(usr.displayName || usr.robloxDisplayName || '');
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/users/inventory/${usr.id}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        })
      );

      if (response.ok) {
        const data = await response.json();
        setUserPets(data.items || []);
      } else {
        const errorData = await response.json();
        console.error('Error fetching user pets:', errorData);
        setUserPets([]);
        setError(errorData.message || `Failed to fetch user pets: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Error fetching user pets:', err);
      setUserPets([]);
      setError(`Error fetching user pets: ${err.message}`);
    }
  };

  const handleSaveDisplayName = async () => {
    if (!selectedUser || savingName) return;
    const name = editDisplayName.trim();
    if (!name) {
      setError('Display name cannot be empty');
      return;
    }
    setSavingName(true);
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/users/${selectedUser.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ displayName: name })
        })
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const patch = { displayName: data.displayName || name, robloxDisplayName: data.displayName || name };
        setSelectedUser((prev) => (prev ? { ...prev, ...patch } : prev));
        setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, ...patch } : u)));
        showCustomPopup(`Display name set to ${name}`, 'success');
      } else {
        setError(data.message || 'Failed to update display name');
      }
    } catch (err) {
      setError(`Error updating display name: ${err.message}`);
    } finally {
      setSavingName(false);
    }
  };

  const handleAddPetToUser = async () => {
    const ids = (selectedPetIds || []).filter(Boolean);
    if (!selectedUser || ids.length === 0) {
      setError('Please select a user and at least one pet');
      return;
    }
    const qty = Math.max(1, parseInt(addUserQty || 1, 10) || 1);

    setAddUserBusy(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const itemId of ids) {
        try {
          const response = await retryRequest(() =>
            fetch(`${API_BASE}/api/admin/user/${selectedUser.id}/add-item`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token')}`
              },
              body: JSON.stringify({ itemId, quantity: qty, mods: giveMods })
            })
          );
          if (response.ok) ok++;
          else failed++;
        } catch (e) {
          failed++;
        }
      }
      if (ok > 0) {
        const modSuffix = giveMods.length > 0 ? ` with ${giveMods.join('')} (+${Math.round(giveMods.reduce((s, m) => s + (MOD_BONUS[m] || 0), 0) * 100)}%)` : '';
        showCustomPopup(`Gave ${ids.length} item${ids.length === 1 ? '' : 's'} × ${qty} to ${displayUser(selectedUser)}${modSuffix}!`, 'success');
        handleViewUserPets(selectedUser);
        setSelectedPetIds([]);
        setGiveMods([]);
      }
      if (failed > 0) setError(`Failed for ${failed} item(s)`);
    } catch (err) {
      console.error('Error adding items to user:', err);
      setError(`Error adding items to user: ${err.message}`);
    } finally {
      setAddUserBusy(false);
    }
  };

  const handleRemovePetFromUser = async (petId) => {
    if (!selectedUser) {
      setError('No user selected');
      return;
    }

    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/user/${selectedUser.id}/remove-pet/${petId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        })
      );

      if (response.ok) {
        setUserPets(userPets.filter((pet) => pet.id !== petId));
        showCustomPopup('Pet removed from user successfully!', 'success');
      } else {
        const errorData = await response.json();
        setError(errorData.message || `Failed to remove pet from user: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Error removing pet from user:', err);
      setError(`Error removing pet from user: ${err.message}`);
    }
  };

  const updateUserInState = useCallback((userId, patch) => {
    const apply = (list) =>
      list.map((u) => (u.id === userId ? { ...u, ...patch } : u));
    setAllUsers((prev) => apply(prev));
    setUsers((prev) => apply(prev));
    if (selectedUser && selectedUser.id === userId) {
      setSelectedUser((prev) => (prev ? { ...prev, ...patch } : prev));
    }
  }, [selectedUser]);

  const handleUserStatusChange = async (usr, newStatus) => {
    const identifier = usr.robloxUsername || usr.id;
    setStatusActions((prev) => ({ ...prev, [usr.id]: 'loading' }));
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(identifier)}/status`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ status: newStatus, reason: `Admin action: ${newStatus}` })
        })
      );

      if (response.ok) {
        const data = await response.json();
        const isActive = newStatus === 'active';
        const isBanned = newStatus === 'banned';
        const isFrozen = newStatus === 'frozen';
        updateUserInState(usr.id, {
          isActive,
          isBanned,
          isFrozen,
          status: newStatus
        });
        showCustomPopup(
          `User ${usr.robloxUsername || usr.id} status changed to ${newStatus}`,
          'success'
        );
        setRecentActivity((prev) => [
          {
            type: `User ${newStatus}`,
            user: user?.robloxDisplayName || user?.displayName || 'Admin',
            time: new Date().toLocaleString(),
            details: data.message || ''
          },
          ...prev.slice(0, 9)
        ]);
      } else {
        const errData = await response.json();
        setError(errData.message || `Failed to update status: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Error changing user status:', err);
      setError(`Error: ${err.message}`);
    } finally {
      setStatusActions((prev) => ({ ...prev, [usr.id]: 'idle' }));
    }
  };

  const handleToggleAdmin = async (usr) => {
    const identifier = usr.robloxUsername || usr.id;
    setLoading(true);
    try {
      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(identifier)}/admin`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          }
        })
      );

      if (response.ok) {
        const data = await response.json();
        updateUserInState(usr.id, { isAdmin: !usr.isAdmin });
        showCustomPopup(data.message, 'success');
        setRecentActivity((prev) => [
          {
            type: usr.isAdmin ? 'Admin Removed' : 'Admin Granted',
            user: user?.robloxDisplayName || 'Admin',
            time: new Date().toLocaleString(),
            details: data.message
          },
          ...prev.slice(0, 9)
        ]);
      } else {
        const errData = await response.json();
        setError(errData.message || 'Failed to toggle admin');
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveTransaction = async (transactionId) => {
    try {
      setTransactionStatus((prev) => ({ ...prev, [transactionId]: 'loading' }));

      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/transactions/${transactionId}/status`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'completed' })
        })
      );

      if (response.ok) {
        const data = await response.json();
        setPendingTransactions((prev) => prev.filter((t) => t.id !== transactionId));
        showCustomPopup('Transaction marked as paid!', 'success');

        setRecentActivity((prev) => [
          {
            type: 'Transaction Paid',
            user: user?.robloxDisplayName || user?.displayName || 'Admin',
            time: new Date().toLocaleString(),
            details: `Marked transaction #${transactionId} as paid for ${data.amount} AMP`
          },
          ...prev.slice(0, 9)
        ]);
      } else if (response.status === 400) {
        const errorData = await response.json();
        setError(errorData.message || 'Invalid transaction request');
      } else if (response.status === 404) {
        setError('Transaction not found');
      } else {
        throw new Error(`Failed to approve transaction: ${response.status}`);
      }
    } catch (err) {
      console.error('Error approving transaction:', err);
      setError(`Error approving transaction: ${err.message}`);
      setTransactionStatus((prev) => ({ ...prev, [transactionId]: 'error' }));
    } finally {
      setTransactionStatus((prev) => ({ ...prev, [transactionId]: 'idle' }));
    }
  };

  const handleRejectTransaction = async (transactionId) => {
    try {
      setTransactionStatus((prev) => ({ ...prev, [transactionId]: 'loading' }));

      const response = await retryRequest(() =>
        fetch(`${API_BASE}/api/admin/transactions/${transactionId}/status`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'rejected' })
        })
      );

      if (response.ok) {
        const data = await response.json();
        setPendingTransactions((prev) => prev.filter((t) => t.id !== transactionId));
        showCustomPopup('Transaction cancelled!', 'success');

        setRecentActivity((prev) => [
          {
            type: 'Transaction Cancelled',
            user: user?.robloxDisplayName || user?.displayName || 'Admin',
            time: new Date().toLocaleString(),
            details: `Cancelled transaction #${transactionId} for ${data.amount} AMP`
          },
          ...prev.slice(0, 9)
        ]);
      } else if (response.status === 400) {
        const errorData = await response.json();
        setError(errorData.message || 'Invalid transaction request');
      } else if (response.status === 404) {
        setError('Transaction not found');
      } else {
        throw new Error(`Failed to reject transaction: ${response.status}`);
      }
    } catch (err) {
      console.error('Error rejecting transaction:', err);
      setError(`Error rejecting transaction: ${err.message}`);
      setTransactionStatus((prev) => ({ ...prev, [transactionId]: 'error' }));
    } finally {
      setTransactionStatus((prev) => ({ ...prev, [transactionId]: 'idle' }));
    }
  };

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchTerm(value);

    if (!allUsers || !Array.isArray(allUsers)) {
      setUsers([]);
      return;
    }

    const term = value.toLowerCase();
    if (!term) {
      setUsers(allUsers);
      return;
    }

    const filtered = allUsers.filter((u) => {
      const rn = (u.robloxUsername || '').toLowerCase();
      const dn = (u.displayName || u.robloxDisplayName || '').toLowerCase();
      const id = String(u.id || '').toLowerCase();
      return rn.includes(term) || dn.includes(term) || id.includes(term);
    });

    setUsers(filtered);
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    setUsers(allUsers);
  };

  const closePopup = () => {
    setShowPopup(false);
    setTimeout(() => {
      setPopupMessage('');
      setPopupType('info');
    }, 300);
  };

  // Resolve a withdrawal item's image: stored image first, then the live catalog
  const txItemImage = (it) => {
    if (it.image || it.imageUrl) return it.image || it.imageUrl;
    const id = it.itemId || it.id;
    const found = (items || []).find((p) => p.id === id || p.itemId === id);
    if (found) return found.imageUrl || found.image || '/default-item.png';
    return '/default-item.png';
  };

  // Expand withdrawal lines into single-unit thumbs (multiples side by side)
  const txUnits = (tx) => {
    const units = [];
    (tx.items || []).forEach((it, si) => {
      const q = Math.max(1, parseInt(it.quantity || 1, 10) || 1);
      for (let i = 0; i < q; i++) units.push({ ...it, unitKey: `${it.itemId || it.id || si}:${i}` });
    });
    return units;
  };

  const displayUser = (usr) => usr.robloxDisplayName || usr.displayName || usr.robloxUsername || 'Anonymous';

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading Admin Panel...</p>
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <div className="loading-container">
        <p>Access Denied: Admin privileges required</p>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <div className="page-header">
        <h1>Admin Panel</h1>
        {error && <div className="admin-inline-error">{error}</div>}
      </div>

      <div className="admin-content">
        <div className="admin-tabs">
          <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            Dashboard
          </button>
          <button className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            Manage Users
          </button>
          <button className={`tab-btn ${activeTab === 'pets' ? 'active' : ''}`} onClick={() => setActiveTab('pets')}>
            Manage Pets
          </button>
          <button className={`tab-btn ${activeTab === 'transactions' ? 'active' : ''}`} onClick={() => setActiveTab('transactions')}>
            Transactions
          </button>
          <button className={`tab-btn ${activeTab === 'taxes' ? 'active' : ''}`} onClick={() => setActiveTab('taxes')}>
            Taxes
          </button>
          <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
            Settings
          </button>
          {String(user?.robloxUsername || '').toLowerCase() === 'pooppantspro' && (
            <button className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => { setActiveTab('audit'); fetchAudits(); }}>
              Bet Analytics
            </button>
          )}
        </div>

        <div className="admin-tab-content">
          {activeTab === 'dashboard' && (
            <div className="admin-dashboard">
              <div className="admin-stats-grid">
                <div className="stat-card">
                  <h3>Total Users</h3>
                  <p className="stat-number">{allUsers.length}</p>
                </div>
                <div className="stat-card">
                  <h3>Total Pets</h3>
                  <p className="stat-number">{items.length}</p>
                </div>
                <div className="stat-card">
                  <h3>Pending Transactions</h3>
                  <p className="stat-number">{pendingTransactions.length}</p>
                </div>
                <div className="stat-card highlight">
                  <h3>Total Amp in Circulation</h3>
                  <p className="stat-number">
                    {Number(adminStats.totalBalance || 0).toLocaleString()} AMP
                  </p>
                </div>
              </div>

              <div className="recent-activity">
                <h3>Recent Activity</h3>
                <div className="activity-list">
                  {recentActivity.length > 0 ? (
                    recentActivity.map((activity, index) => (
                      <div key={index} className="activity-item">
                        <span className="activity-type">{activity.type}</span>
                        <span className="activity-user">{activity.user}</span>
                        <span className="activity-time">{activity.time}</span>
                      </div>
                    ))
                  ) : (
                    <div className="no-activity">No recent activity</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="manage-users">
              <div className="search-bar">
                <input
                  type="text"
                  placeholder="Search users by username, display name, or ID..."
                  value={searchTerm}
                  onChange={handleSearch}
                  className="form-control"
                />
                <button type="button" className="btn btn-secondary" onClick={handleClearSearch}>
                  Clear
                </button>
                {isOwner && (
                  <button
                    type="button"
                    className={`btn ${wipeUsersArmed ? 'btn-warning' : 'btn-danger'}`}
                    onClick={handleWipeUsers}
                    disabled={wipeUsersBusy}
                  >
                    {wipeUsersBusy
                      ? 'Wiping...'
                      : wipeUsersArmed
                        ? 'Click again: delete ALL users except POOpPANTSpro'
                        : 'Wipe all users'}
                  </button>
                )}
              </div>

              <div className="users-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px' }}>Avatar</th>
                      <th>ID</th>
                      <th>Roblox Username</th>
                      <th>Display Name</th>
                      <th>Status</th>
                      <th>Role</th>
                      <th style={{ width: '320px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((usr) => {
                      const avatarSrc = userAvatars[usr.id] || usr.avatar || getFallbackAvatar(usr);
                      const displayName = displayUser(usr);
                      const userStatus = usr.isBanned
                        ? 'banned'
                        : usr.isFrozen
                        ? 'frozen'
                        : !usr.isActive
                        ? 'inactive'
                        : 'active';
                      const loading = statusActions[usr.id] === 'loading';
                      return (
                        <tr key={usr.id} className={`status-${userStatus}`}>
                          <td>
                            <div className="admin-user-avatar">
                              <img
                                src={avatarSrc || DEFAULT_AVATAR}
                                alt=""
                                onError={(e) => {
                                  const fb = getFallbackAvatar(usr);
                                  if (e.target.src !== fb) e.target.src = fb;
                                  else e.target.src = DEFAULT_AVATAR;
                                }}
                              />
                            </div>
                          </td>
                          <td className="mono small">{usr.id.substring(0, 8)}…</td>
                          <td>@{usr.robloxUsername || '—'}</td>
                          <td title={usr.robloxDisplayName ? 'Roblox Display Name' : ''}>
                            {displayName}
                            {usr.robloxDisplayName && <span className="rbx-badge">✓</span>}
                          </td>
                          <td>
                            <span className={`status-badge status-${userStatus}`}>
                              {userStatus}
                            </span>
                          </td>
                          <td>
                            <span className={`role-badge ${usr.isAdmin ? 'admin' : 'user'}`}>
                              {usr.isAdmin ? 'Admin' : 'User'}
                            </span>
                          </td>
                          <td className="admin-user-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => handleViewUserPets(usr)}>
                              View Pets
                            </button>
                            {usr.id !== user?.id && (
                              <button
                                className={`btn ${usr.isAdmin ? 'btn-warning' : 'btn-info'} btn-sm`}
                                onClick={() => handleToggleAdmin(usr)}
                                disabled={loading}
                              >
                                {loading ? '...' : usr.isAdmin ? 'Remove Admin' : 'Make Admin'}
                              </button>
                            )}
                            {userStatus !== 'banned' ? (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => handleUserStatusChange(usr, 'banned')}
                                disabled={loading}
                              >
                                {loading ? '...' : 'Ban'}
                              </button>
                            ) : (
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() => handleUserStatusChange(usr, 'active')}
                                disabled={loading}
                              >
                                {loading ? '...' : 'Unban'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan="7" className="empty-row">No users match your search</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {selectedUser && (
                <div className="user-pets-section">
                  <h3>Inventory for {displayUser(selectedUser)}</h3>
                  <div className="displayname-row">
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Display name"
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      maxLength={32}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleSaveDisplayName}
                      disabled={savingName}
                    >
                      {savingName ? 'Saving...' : 'Set Name'}
                    </button>
                  </div>
                  <div className="inventory-grid">
                    {userPets.length > 0 ? (
                      userPets.map((item) => (
                        <div key={item.id} className="inventory-item">
                          <img
                            className="admin-thumb"
                            src={item.details?.imageUrl || item.image || item.imageUrl || '/default-item.png'}
                            alt={item.details?.name || item.name || 'item'}
                            onError={(e) => { e.target.src = '/default-item.png'; }}
                          />
                          <div className="inventory-item-info">
                            <div className="item-name">{item.details?.name || item.name}{(item.quantity || 1) > 1 && ` × ${item.quantity}`}</div>
                            <div className="item-value">{Number(item.value || 0).toLocaleString()} AMP</div>
                            <span className={`badge badge-${item.details?.rarity || item.rarity}`}>
                              {item.details?.rarity || item.rarity}
                            </span>
                          </div>
                          <button
                            className="btn btn-danger"
                            onClick={() => handleRemovePetFromUser(item.id)}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="empty-row">This user has no items</div>
                    )}
                  </div>
                  <div className="add-pet-to-user">
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Search items..."
                      value={addUserPetSearch}
                      onChange={(e) => setAddUserPetSearch(e.target.value)}
                    />
                    <select
                      multiple
                      size={5}
                      className="form-control"
                      value={selectedPetIds}
                      onChange={(e) => setSelectedPetIds(Array.from(e.target.selectedOptions, (o) => o.value))}
                      title="Hold Ctrl/Cmd to pick multiple items"
                    >
                      {items
                        .filter((pet) => !addUserPetSearch || (pet.name || '').toLowerCase().includes(addUserPetSearch.toLowerCase()))
                        .map((pet) => (
                          <option key={pet.id} value={pet.id}>
                            {pet.name} ({Number(pet.value || 0).toLocaleString()} AMP)
                          </option>
                        ))}
                    </select>
                    <input
                      type="number"
                      min="1"
                      className="form-control add-user-qty"
                      value={addUserQty}
                      onChange={(e) => setAddUserQty(e.target.value)}
                      title="How many of each selected item"
                    />
                    <div className="mod-btn-row give-mods">
                      <span className="mod-row-label">Mods:</span>
                      {['F', 'R', 'M', 'N'].map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`mod-btn small ${giveMods.includes(m) ? 'active' : ''}`}
                          title={`${MOD_LABELS[m]} (+${Math.round(MOD_BONUS[m] * 100)}%)`}
                          onClick={() => toggleGiveMod(m)}
                        >
                          {m}
                        </button>
                      ))}
                      {givePreview && (
                        <span className="mod-preview">
                          {givePreview.name} → {givePreview.value.toLocaleString()} AMP
                        </span>
                      )}
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleAddPetToUser}
                      disabled={addUserBusy || selectedPetIds.length === 0}
                    >
                      {addUserBusy
                        ? 'Giving...'
                        : `Add ${selectedPetIds.length} item${selectedPetIds.length === 1 ? '' : 's'} × ${addUserQty}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'pets' && (
            <div className="manage-pets">
              <div className="add-pet-form">
                <h3>Add New Pet</h3>
                <form onSubmit={handleAddPet}>
                  <div className="form-group">
                    <label className="form-label">Pet Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={newPet.name}
                      onChange={(e) => setNewPet({ ...newPet, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rarity</label>
                    <select
                      className="form-control"
                      value={newPet.rarity}
                      onChange={(e) => setNewPet({ ...newPet, rarity: e.target.value })}
                    >
                      <option value="common">Common</option>
                      <option value="uncommon">Uncommon</option>
                      <option value="rare">Rare</option>
                      <option value="epic">Epic</option>
                      <option value="legendary">Legendary</option>
                      <option value="mythic">Mythic</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Value (AMP) — base before modifiers</label>
                    <input
                      type="number"
                      className="form-control"
                      value={newPet.value}
                      onChange={(e) => setNewPet({ ...newPet, value: parseInt(e.target.value) || 0 })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Modifiers</label>
                    <div className="mod-btn-row">
                      {['F', 'R', 'M', 'N'].map((m) => {
                        const active = (newPet.mods || []).includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            className={`mod-btn ${active ? 'active' : ''}`}
                            title={`${MOD_LABELS[m]} (+${Math.round(MOD_BONUS[m] * 100)}%)`}
                            onClick={() => toggleNewPetMod(m)}
                          >
                            {m}
                          </button>
                        );
                      })}
                      <span className="mod-preview">
                        → {moddedValue(parseFloat(newPet.value) || 0, newPet.mods || []).toLocaleString()} AMP
                      </span>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Image URL</label>
                    <input
                      type="text"
                      className="form-control"
                      value={newPet.imageUrl || ''}
                      onChange={(e) => setNewPet({ ...newPet, imageUrl: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary">Add Pet</button>
                </form>
              </div>

              <div className="pets-list">
                <h3>All Pets</h3>
                {isOwner && (
                  <div className="danger-zone">
                    <button
                      className={`btn ${purgeArmed ? 'btn-warning' : 'btn-danger'}`}
                      onClick={handlePurgeCommons}
                      disabled={purgeBusy}
                    >
                      {purgeBusy
                        ? 'Deleting...'
                        : purgeArmed
                          ? 'Click again to confirm: delete ALL commons/uncommons'
                          : 'Delete all Common + Uncommon pets'}
                    </button>
                    <div className="wipe-row">
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Pet name to wipe everywhere, e.g. Bat Dragon (MFR)"
                        value={wipeName}
                        onChange={(e) => setWipeName(e.target.value)}
                      />
                      <button
                        className={`btn ${wipeArmed ? 'btn-warning' : 'btn-danger'}`}
                        onClick={handleWipeEverywhere}
                        disabled={wipeBusy}
                      >
                        {wipeBusy
                          ? 'Wiping...'
                          : wipeArmed
                            ? 'Click again to confirm wipe'
                            : 'Wipe from everyone'}
                      </button>
                    </div>
                  </div>
                )}
                <div className="search-bar">
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search items by name..."
                    value={petSearch}
                    onChange={(e) => setPetSearch(e.target.value)}
                  />
                </div>
                <div className="inventory-grid">
                  {items
                    .filter((pet) => !petSearch || (pet.name || '').toLowerCase().includes(petSearch.toLowerCase()))
                    .map((pet) => (
                      <div key={pet.id} className="inventory-item">
                        <img
                          className="admin-thumb"
                          src={pet.imageUrl || pet.image || '/default-item.png'}
                          alt={pet.name || 'item'}
                          onError={(e) => { e.target.src = '/default-item.png'; }}
                        />
                        <div className="inventory-item-info">
                          <div className="item-name">{pet.name}</div>
                          <div className="item-value">{Number(pet.value || 0).toLocaleString()} AMP</div>
                          {petModsOf(pet).length > 0 && (
                            <div className="mod-active-row">
                              {petModsOf(pet).map((m) => (
                                <span key={m} className="mod-tag" title={`${MOD_LABELS[m]} (+${Math.round(MOD_BONUS[m] * 100)}%)`}>{m}</span>
                              ))}
                              <span className="mod-base">base {petBaseOf(pet).toLocaleString()}</span>
                            </div>
                          )}
                          <span className={`badge badge-${pet.rarity}`}>{pet.rarity}</span>
                        </div>
                        <div className="mod-btn-row">
                          {['F', 'R', 'M', 'N'].map((m) => (
                            <button
                              key={m}
                              type="button"
                              className={`mod-btn small ${petModsOf(pet).includes(m) ? 'active' : ''}`}
                              title={`${MOD_LABELS[m]} (+${Math.round(MOD_BONUS[m] * 100)}%)`}
                              disabled={modBusyId === (pet.id || pet.itemId)}
                              onClick={() => togglePetMod(pet, m)}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleRemovePet(pet.id)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="manage-transactions">
              <div className="transactions-header">
                <h3>Pending Transactions</h3>
                <button
                  className="btn btn-refresh"
                  onClick={async () => {
                    setTransactionsLoading(true);
                    try {
                      const transactionsResponse = await retryRequest(() =>
                        fetch(`${API_BASE}/api/admin/transactions/pending`, {
                          headers: {
                            Authorization: `Bearer ${localStorage.getItem('token')}`,
                            'Content-Type': 'application/json'
                          }
                        })
                      );

                      if (transactionsResponse.ok) {
                        const transactionsData = await transactionsResponse.json();
                        setPendingTransactions(
                          transactionsData.transactions ||
                            transactionsData.withdrawalRequests ||
                            []
                        );
                        setTransactionError('');
                      } else {
                        throw new Error(`Failed to refresh transactions: ${transactionsResponse.status}`);
                      }
                    } catch (err) {
                      console.error('Error refreshing transactions:', err);
                      setTransactionError(`Failed to refresh transactions: ${err.message}`);
                      showCustomPopup(`Failed to refresh transactions: ${err.message}`, 'error');
                    } finally {
                      setTransactionsLoading(false);
                    }
                  }}
                  disabled={transactionsLoading}
                >
                  {transactionsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {transactionError && <div className="alert alert-danger">{transactionError}</div>}

              <div className="transactions-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>User</th>
                      <th>Amount</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingTransactions.length > 0 ? (
                      pendingTransactions.map((tx) => (
                        <tr key={tx.id}>
                          <td className="mono small">{String(tx.id || '').substring(0, 10)}…</td>
                          <td>
                            <div className="tx-user">{tx.displayName || tx.userName || tx.robloxUsername || tx.userId}</div>
                            {tx.robloxUsername && (
                              <div className="tx-username">@{tx.robloxUsername}</div>
                            )}
                          </td>
                          <td>
                            <div>{Number(tx.amount || 0).toLocaleString()} AMP</div>
                            {tx.type === 'item_withdrawal' && Array.isArray(tx.items) && tx.items.length > 0 && (() => {
                              const units = txUnits(tx);
                              const shown = units.slice(0, 5);
                              const left = units.length - shown.length;
                              return (
                                <div className="tx-thumbs" onClick={() => setViewTxItems(tx.items)} title="View all pets">
                                  {shown.map((u) => (
                                    <img
                                      key={u.unitKey}
                                      src={txItemImage(u)}
                                      alt={u.name || u.itemName || 'item'}
                                      className="tx-thumb"
                                      onError={(e) => { e.target.src = '/default-item.png'; }}
                                    />
                                  ))}
                                  {left > 0 && <span className="tx-more">+{left}</span>}
                                </div>
                              );
                            })()}
                          </td>
                          <td>{tx.type || 'withdrawal'}</td>
                          <td>
                            <span
                              className={`badge ${
                                tx.status === 'completed'
                                  ? 'badge-success'
                                  : tx.status === 'pending'
                                  ? 'badge-warning'
                                  : tx.status === 'rejected'
                                  ? 'badge-danger'
                                  : 'badge-warning'
                              }`}
                            >
                              {tx.status}
                            </span>
                          </td>
                          <td>{tx.createdAt ? new Date(tx.createdAt).toLocaleString() : '—'}</td>
                          <td>
                            <div className="transaction-actions">
                              <button
                                className="btn btn-success"
                                onClick={() => handleApproveTransaction(tx.id)}
                                disabled={transactionStatus[tx.id] === 'loading'}
                              >
                                {transactionStatus[tx.id] === 'loading' ? 'Processing...' : 'Mark as Paid'}
                              </button>
                              <button
                                className="btn btn-danger"
                                onClick={() => handleRejectTransaction(tx.id)}
                                disabled={transactionStatus[tx.id] === 'loading'}
                              >
                                {transactionStatus[tx.id] === 'loading' ? 'Processing...' : 'Cancel'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7">No pending transactions</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {viewTxItems && (
                <div className="modal-overlay" onClick={() => setViewTxItems(null)}>
                  <div className="tx-items-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h3>Withdrawn Pets ({viewTxItems.reduce((s, it) => s + Math.max(1, parseInt(it.quantity || 1, 10) || 1), 0)})</h3>
                      <button className="modal-close-btn" onClick={() => setViewTxItems(null)}>×</button>
                    </div>
                    <div className="inventory-grid wallet-inventory-grid">
                      {viewTxItems.flatMap((it, si) => {
                        const q = Math.max(1, parseInt(it.quantity || 1, 10) || 1);
                        return Array.from({ length: q }, (_, i) => (
                          <div key={`${it.itemId || it.id || si}:${i}`} className="inventory-item wallet-inventory-item">
                            <div className="item-image">
                              <img
                                src={txItemImage(it)}
                                alt={it.name || it.itemName || 'item'}
                                onError={(e) => { e.target.src = '/default-item.png'; }}
                              />
                            </div>
                            <div className="item-details">
                              <h4>{it.name || it.itemName || 'Unknown'}</h4>
                              <p className="item-value">{Number(it.value || 0).toLocaleString()} AMP</p>
                              <span className={`badge badge-${it.rarity || 'common'}`}>{it.rarity || 'common'}</span>
                            </div>
                          </div>
                        ));
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'taxes' && (
            <div className="admin-taxes">
              <h3>House Tax</h3>
              <p className="tax-hint">
                When ON, every finished bet gives random item(s) worth about the set %
                to the tax recipient. The winner always keeps at least one item.
              </p>
              <div className="tax-toggle-row">
                <button
                  className={`tax-toggle-btn on ${taxSettings.taxEnabled ? 'active' : ''}`}
                  onClick={() => handleTaxChange('taxEnabled', true)}
                >
                  Tax ON
                </button>
                <button
                  className={`tax-toggle-btn off ${!taxSettings.taxEnabled ? 'active' : ''}`}
                  onClick={() => handleTaxChange('taxEnabled', false)}
                >
                  Tax OFF
                </button>
                <span className={`tax-state ${taxSettings.taxEnabled ? 'on' : 'off'}`}>
                  {taxSettings.taxEnabled ? `ON — ${Number(taxSettings.taxPercent || 0).toFixed(1)}%` : 'OFF'}
                </span>
              </div>
              <div className="tax-row">
                <div className="tax-row-info">
                  <span className="tax-row-label">Tax Percentage</span>
                  <span className="tax-row-desc">Items taken from every bet (10% - 30%)</span>
                </div>
                <div className="tax-row-controls">
                  <input
                    type="range"
                    min="10"
                    max="30"
                    step="0.5"
                    value={taxSettings.taxPercent ?? 15}
                    onChange={(e) => handleTaxChange('taxPercent', e.target.value)}
                    className="tax-slider"
                    disabled={!taxSettings.taxEnabled}
                  />
                  <div className="tax-number-wrap">
                    <input
                      type="number"
                      min="10"
                      max="30"
                      step="0.5"
                      value={taxSettings.taxPercent ?? 15}
                      onChange={(e) => handleTaxChange('taxPercent', e.target.value)}
                      className="form-control tax-number"
                      disabled={!taxSettings.taxEnabled}
                    />
                    <span className="tax-pct">%</span>
                  </div>
                </div>
              </div>
              <div className="tax-row tax-recipient-row">
                <div className="tax-row-info">
                  <span className="tax-row-label">Tax Recipient</span>
                  <span className="tax-row-desc">User that receives taxed items (pick or type username)</span>
                </div>
                <div className="tax-row-controls">
                  <input
                    type="text"
                    list="tax-recipient-users"
                    className="form-control tax-recipient-input"
                    placeholder="e.g. AdminUser"
                    value={taxSettings.taxRecipient || ''}
                    onChange={(e) => setTaxSettings((prev) => ({ ...prev, taxRecipient: e.target.value }))}
                  />
                  <datalist id="tax-recipient-users">
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.robloxUsername || u.id}>
                        {displayUser(u)} ({Number(u.balance || 0).toLocaleString()} AMP)
                      </option>
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="tax-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleSaveTaxSettings}
                  disabled={taxSaving}
                >
                  {taxSaving ? 'Saving...' : 'Save Tax Settings'}
                </button>
                <span className="tax-summary">
                  {taxSettings.taxEnabled
                    ? `Taking ~${Number(taxSettings.taxPercent || 0).toFixed(1)}% of every bet → ${taxSettings.taxRecipient || '— (no recipient: no item tax taken)'}`
                    : 'Tax is OFF — winners keep everything'}
                </span>
              </div>

              {/* Taxed Items History */}
              <div className="tax-history">
                <h3><Icon name="board" size={16} /> Taxed Items History</h3>
                {taxHistory.length === 0 ? (
                  <p className="tax-history-empty">No tax collections yet.</p>
                ) : (
                  <div className="tax-history-list">
                    {taxHistory.map((record) => (
                      <div key={record.id} className="tax-history-card">
                        <div className="tax-history-header">
                          <div className="tax-history-winner">
                            <span className="tax-history-label">Winner</span>
                            <span className="tax-history-value">{record.winnerDisplayName}</span>
                          </div>
                          <div className="tax-history-meta">
                            <span className="tax-history-pill pets">
                              <Icon name="coin" size={12} /> {record.totalPets ?? '?'} pets
                            </span>
                            <span className="tax-history-pill rate">
                              {record.taxRate}% tax
                            </span>
                            <span className="tax-history-pill value">
                              ◆ {record.taxValue.toLocaleString()} AMP
                            </span>
                          </div>
                          <div className="tax-history-recipient">
                            <span className="tax-history-label">To</span>
                            <span className="tax-history-value">{record.taxRecipientUsername}</span>
                          </div>
                          <span className="tax-history-date">
                            {new Date(record.timestamp).toLocaleString()}
                          </span>
                        </div>
                        {record.taxItems.length > 0 && (
                          <div className="tax-history-items">
                            {record.taxItems.map((item, idx) => (
                              <div key={idx} className="tax-history-item-chip">
                                <span className="tax-item-name">{item.name}</span>
                                {item.quantity > 1 && <span className="tax-item-qty">×{item.quantity}</span>}
                                <span className="tax-item-val">{item.value.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="admin-settings">
              <div className="bot-settings">
                <h3>Bot Settings</h3>
                <div className="tax-toggle-row">
                  <button
                    className={`tax-toggle-btn on ${botSettings.botEnabled ? 'active' : ''}`}
                    onClick={() => setBotSettings({ ...botSettings, botEnabled: true })}
                  >
                    Turn ON
                  </button>
                  <button
                    className={`tax-toggle-btn off ${!botSettings.botEnabled ? 'active' : ''}`}
                    onClick={() => setBotSettings({ ...botSettings, botEnabled: false })}
                  >
                    Turn OFF
                  </button>
                  <span className={`tax-state ${botSettings.botEnabled ? 'on' : 'off'}`}>
                    {botSettings.botEnabled ? 'Bot ON' : 'Bot OFF'}
                  </span>
                </div>
                <div className="form-group">
                  <label className="form-label">Bot Username</label>
                  <input
                    type="text"
                    className="form-control"
                    value={botSettings.botUser || ''}
                    onChange={(e) => setBotSettings({ ...botSettings, botUser: e.target.value })}
                    placeholder="Enter bot username"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Redirect Link</label>
                  <input
                    type="text"
                    className="form-control"
                    value={botSettings.redirectLink || ''}
                    onChange={(e) => setBotSettings({ ...botSettings, redirectLink: e.target.value })}
                    placeholder="Enter redirect link"
                  />
                </div>
                <button className="btn btn-primary" onClick={handleUpdateBotSettings}>
                  Save Settings
                </button>
              </div>
            </div>
          )}

          {activeTab === 'audit' && isOwner && (
            <div className="admin-audit">
              <div className="audit-header">
                <div>
                  <h3>Bet Analytics</h3>
                  <p className="audit-sub">
                    Projected outcomes for open bets, computed from stored seeds.
                  </p>
                </div>
                <div className="audit-actions">
                  <button
                    className={`btn ${auditWinsOnly ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setAuditWinsOnly((v) => !v)}
                    title="Toggle between favorable outcomes and all open bets"
                  >
                    {auditWinsOnly ? 'Wins only ✓' : 'Show all'}
                  </button>
                  <button className="btn btn-secondary" onClick={fetchAudits} disabled={auditLoading}>
                    {auditLoading ? 'Checking...' : '↻ Refresh'}
                  </button>
                </div>
              </div>
              {auditLoading ? (
                <div className="loading-container"><div className="loading-spinner"></div></div>
              ) : (() => {
                const shown = auditWinsOnly ? audits.filter((p) => p.youWin) : audits;
                return shown.length === 0 ? (
                  <div className="empty-row">
                    {audits.length === 0
                      ? 'No open bets to analyze right now.'
                      : 'No favorable outcomes right now.'}
                  </div>
                ) : (
                  <div className="audit-list">
                    {shown.map((p) => (
                      <div key={p.id} className={`audit-row ${p.youWin ? 'win' : 'lose'}`}>
                        <img
                          src={p.creatorAvatar || '/default-avatar.png'}
                          alt={p.creatorUsername}
                          className="audit-avatar"
                          onError={(e) => { e.target.src = '/default-avatar.png'; }}
                        />
                        <div className="audit-info">
                          <span className="audit-creator">{p.creatorUsername}</span>
                          <span className="audit-meta">
                            <Icon name="diamond" size={12} /> {Number(p.creatorValue || 0).toLocaleString()} · {p.itemCount} items ·
                            creator holds <strong>{p.creatorSide === 'heads' ? 'H' : 'T'}</strong> ·
                            joiner gets <strong>{p.joinerSide === 'heads' ? 'H' : 'T'}</strong> ·
                            lands <strong>{p.outcome === 'heads' ? 'H' : 'T'}</strong>
                          </span>
                        </div>
                        <span className={`audit-badge ${p.youWin ? 'win' : 'lose'}`}>
                          {p.youWin ? 'YOU WIN' : 'YOU LOSE'}
                        </span>
                        <div className="audit-seed">
                          <span className="audit-seed-label">Seed:</span>
                          {['heads', 'tails'].map((s) => (
                            <button
                              key={s}
                              className={`seed-btn ${s} ${p.outcome === s ? 'active' : ''}`}
                              disabled={!!rotatingId}
                              onClick={() => rotateSeed(p.id, s)}
                              title={`Rotate seed to land ${s} (fairness testing)`}
                            >
                              {s === 'heads' ? 'H' : 'T'}
                            </button>
                          ))}
                        </div>
                        {p.youWin && (
                          <button
                            className="btn btn-primary btn-sm audit-join-btn"
                            onClick={() => navigate('/coinflip')}
                            title="Go to the lobby to join this bet"
                          >
                            Join
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
      <AnimatedPopup
        show={showPopup}
        onClose={closePopup}
        message={popupMessage}
        type={popupType}
      />
    </div>
  );
}

export default AdminPanel;
