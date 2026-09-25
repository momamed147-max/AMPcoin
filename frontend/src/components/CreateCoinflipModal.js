import React, { useState } from 'react';
import AnimatedPopup from './AnimatedPopup';
import { CoinChip } from './CoinChip';
import ModBadges from './ModBadges';
import ModalPortal from './ModalPortal';
import Icon from './Icon';
import { API_BASE } from '../apiConfig';
import './CoinChip.css';
import './ModBadges.css';
import '../pages/CoinflipPage.css';
import './CreateCoinflipModal.css';

const CreateCoinflipModal = ({ onClose, onCreated, userId, socket, setBalance, userInventory }) => {
  const [selectedQty, setSelectedQty] = useState({}); // stackKey -> units selected
  const [selectedSide, setSelectedSide] = useState('heads');
  const [searchTerm, setSearchTerm] = useState('');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('value_desc');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null); // { message, type } custom popup
  const [limitationsOn, setLimitationsOn] = useState(false);
  const [maxJoinPets, setMaxJoinPets] = useState(5);
  const [limitMenuOpen, setLimitMenuOpen] = useState(false);

  const showNotice = (message, type = 'info') => {
    setNotice({ message, type });
  };

  // Use the passed inventory prop instead of fetching separately
  const inventory = userInventory || [];

  const stackKeyOf = (item) => item.itemId || item.id;
  const stackQtyOf = (item) => Math.max(1, parseInt(item.quantity || 1, 10) || 1);

  // Per-unit toggle: clicking an unselected tile adds one unit,
  // clicking a selected tile removes that unit and the ones after it.
  const toggleUnit = (stackKey, tileIdx) => {
    setSelectedQty((prev) => {
      const cur = prev[stackKey] || 0;
      const next = tileIdx < cur ? tileIdx : cur + 1;
      const stack = inventory.find((i) => stackKeyOf(i) === stackKey);
      const max = stack ? stackQtyOf(stack) : next;
      const clamped = Math.min(next, max);
      const n = { ...prev };
      if (clamped <= 0) delete n[stackKey];
      else n[stackKey] = clamped;
      return n;
    });
  };

  const clearStack = (stackKey) => {
    setSelectedQty((prev) => {
      const n = { ...prev };
      delete n[stackKey];
      return n;
    });
  };

  // Select all: one unit of every stack (respects 8-tile display rule per stack via grid)
  const selectAll = () => {
    const n = {};
    inventory.forEach((item) => {
      n[stackKeyOf(item)] = stackQtyOf(item);
    });
    setSelectedQty(n);
  };

  const clearAll = () => setSelectedQty({});

  // Selected stacks with their chosen unit counts
  const selectedEntries = inventory
    .filter((item) => (selectedQty[stackKeyOf(item)] || 0) > 0)
    .map((item) => ({ item, qty: selectedQty[stackKeyOf(item)] }));
  const selectedCount = selectedEntries.reduce((s, e) => s + e.qty, 0);

  const getTotalValue = () => {
    return selectedEntries.reduce((sum, e) => sum + ((e.item.value || e.item.details?.value || 0) * e.qty), 0);
  };

  const handleCreateCoinflip = async () => {
    if (selectedCount === 0) {
      showNotice('Please select at least one item to bet', 'warning');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/coinflip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          selectedItems: selectedEntries.map(({ item, qty }) => ({
            itemId: item.itemId || item.id,
            name: item.details?.name || item.name,
            quantity: qty,
            value: item.value || item.details?.value || 0
          })),
          sideChosen: selectedSide,
          maxJoinPets: limitationsOn ? (maxJoinPets === 0 ? null : maxJoinPets) : null
        })
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        // Backend already broadcasts newCoinflip + inventoryUpdate via socket
        // The onCreated callback inserts it into the lobby immediately for the creator

        // Guarantee the new bet posts in the current list even if the
        // socket event is missed (parent inserts it + refetches).
        if (onCreated) {
          try { onCreated(data); } catch (e) { console.error('onCreated handler failed:', e); }
        }

        // Update user balance
        if (setBalance) {
          const totalWagered = getTotalValue();
          setBalance(prev => prev - totalWagered);
        }

        onClose();
      } else {
        if (response.status === 429) {
          showNotice('Too many requests — slow down a few seconds and try again.', 'error');
        } else {
          showNotice(data.message || 'Failed to create coinflip', 'error');
        }
      }
    } catch (error) {
      console.error('Error creating coinflip:', error);
      showNotice('Error creating coinflip', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort inventory
  let filteredInventory = [...inventory];

  if (searchTerm) {
    filteredInventory = filteredInventory.filter(item =>
      (item.details?.name || item.name).toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.details?.description || item.description).toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  if (rarityFilter !== 'all') {
    filteredInventory = filteredInventory.filter(item =>
      (item.details?.rarity || item.rarity) === rarityFilter
    );
  }

  // Sort inventory
  filteredInventory.sort((a, b) => {
    switch(sortBy) {
      case 'value_asc':
        return (a.value || a.details?.value || 0) - (b.value || b.details?.value || 0);
      case 'value_desc':
        return (b.value || b.details?.value || 0) - (a.value || a.details?.value || 0);
      case 'name_asc':
        return (a.details?.name || a.name).localeCompare(b.details?.name || b.name);
      case 'name_desc':
        return (b.details?.name || b.name).localeCompare(a.details?.name || a.name);
      default:
        return (b.value || b.details?.value || 0) - (a.value || a.details?.value || 0);
    }
  });

  if (loading) {
    return (
      <ModalPortal>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Create Coinflip Game</h2>
            <button className="close-modal" onClick={onClose}>×</button>
          </div>
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading...</p>
          </div>
        </div>
      </div>
      </ModalPortal>
    );
  }

  return (
    <ModalPortal>
    <div className="cf-modal-overlay" onClick={onClose}>
      {notice && (
        <AnimatedPopup
          message={notice.message}
          type={notice.type}
          onClose={() => setNotice(null)}
        />
      )}
      <div className="cf-modal cf-join-modal" onClick={(e) => e.stopPropagation()}>
        <button className="cf-modal-close" onClick={onClose}>×</button>

        <div className="cf-join-content">
          {/* Left: your side + limits + select controls */}
          <div className="cf-join-left">
            <div className="cf-join-vs-head">
              <span className="cf-join-vs-label">CREATE BET</span>
              <div className="cf-join-vs-total">
                <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {getTotalValue().toLocaleString()}
                <span className="cf-join-vs-sub">{selectedCount} items selected</span>
              </div>
            </div>

            <div className="cf-create-opt-group">
              <div className="cf-join-bet-items-title">YOUR SIDE</div>
              <div className="cf-create-side-row">
                <button
                  type="button"
                  className={`cf-create-side ${selectedSide === 'heads' ? 'active' : ''}`}
                  onClick={() => setSelectedSide('heads')}
                >
                  <CoinChip side="heads" size={30} />
                  <span>Heads</span>
                </button>
                <button
                  type="button"
                  className={`cf-create-side ${selectedSide === 'tails' ? 'active' : ''}`}
                  onClick={() => setSelectedSide('tails')}
                >
                  <CoinChip side="tails" size={30} />
                  <span>Tails</span>
                </button>
              </div>
            </div>

            <div className="cf-create-opt-group">
              <div className="cf-join-bet-items-title">LIMITS</div>
              <div className={`cf-limitations ${limitationsOn ? 'on' : ''}`}>
                <div className="cf-limit-switch-row">
                  <span className="cf-limit-label">Limit Items</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={limitationsOn}
                    className={`cf-limit-switch ${limitationsOn ? 'on' : ''}`}
                    onClick={() => {
                      const next = !limitationsOn;
                      setLimitationsOn(next);
                      setLimitMenuOpen(next);
                    }}
                  >
                    <span className="cf-limit-knob" />
                  </button>
                </div>
                <div className={`cf-limit-dropdown ${limitationsOn && limitMenuOpen ? 'open' : ''} ${limitationsOn ? 'enabled' : ''}`}>
                  <button
                    type="button"
                    className="cf-limit-trigger"
                    disabled={!limitationsOn}
                    onClick={() => setLimitMenuOpen((o) => !o)}
                    aria-expanded={limitationsOn && limitMenuOpen}
                  >
                    Max {maxJoinPets === 0 ? 'No Limit' : `${maxJoinPets} pet${maxJoinPets === 1 ? '' : 's'}`}
                    <span className="cf-limit-caret">▾</span>
                  </button>
                  <div className="cf-limit-menu" role="listbox">
                    {[0, ...Array.from({ length: 15 }, (_, i) => i + 1)].map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="option"
                        aria-selected={maxJoinPets === n}
                        className={`cf-limit-opt ${maxJoinPets === n ? 'active' : ''}`}
                        style={{ '--i': n }}
                        onClick={() => {
                          setMaxJoinPets(n);
                          setLimitMenuOpen(false);
                        }}
                      >
                        {n === 0 ? 'No Limit' : n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="cf-create-opt-group">
              <div className="cf-join-bet-items-title">SELECT</div>
              <div className="cf-create-side-row">
                <button type="button" className="cf-join-action-btn" onClick={selectAll}>
                  Select All
                </button>
                <button type="button" className="cf-join-action-btn" onClick={clearAll}>
                  Clear
                </button>
              </div>
            </div>

            {/* Selected items preview */}
            <div className="cf-join-bet-items">
              <div className="cf-join-bet-items-title">YOUR BET ({selectedCount})</div>
              <div className="cf-join-bet-items-list">
                {selectedEntries.length > 0 ? (
                  selectedEntries.map(({ item, qty }) => (
                    <div key={item.itemId || item.id} className="cf-join-bet-item">
                      <img
                        src={item.details?.imageUrl || item.image || '/default-item.png'}
                        alt={item.details?.name || item.name}
                        className="cf-join-bet-item-img"
                        onError={(e) => { e.target.src = '/default-item.png'; }}
                      />
                      <span className="cf-join-bet-item-name">{item.details?.name || item.name}{qty > 1 ? ` ×${qty}` : ''}</span>
                      <span className="cf-join-bet-item-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {((item.value || item.details?.value || 0) * qty).toLocaleString()}</span>
                      <button className="cf-bet-item-x" onClick={() => clearStack(stackKeyOf(item))} title="Remove">×</button>
                    </div>
                  ))
                ) : (
                  <div className="cf-join-no-items">No items selected</div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Inventory grid */}
          <div className="cf-join-right">
            <div className="cf-join-inv-header">
              <span>Select Items</span>
            </div>
            <div className="cf-create-filters">
              <input
                type="text"
                className="cf-create-search"
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <select
                className="cf-create-select"
                value={rarityFilter}
                onChange={(e) => setRarityFilter(e.target.value)}
              >
                <option value="all">All Rarities</option>
                <option value="common">Common</option>
                <option value="uncommon">Uncommon</option>
                <option value="rare">Rare</option>
                <option value="epic">Epic</option>
                <option value="legendary">Legendary</option>
                <option value="mythic">Mythic</option>
              </select>
              <select
                className="cf-create-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="value_desc">Value: High to Low</option>
                <option value="value_asc">Value: Low to High</option>
                <option value="name_asc">Name: A to Z</option>
                <option value="name_desc">Name: Z to A</option>
              </select>
            </div>
            <div className="cf-join-inv-grid">
            {filteredInventory.length > 0 ? (
              filteredInventory.flatMap((item) => {
                const key = stackKeyOf(item);
                const max = stackQtyOf(item);
                const sel = selectedQty[key] || 0;
                // One tile per unit so multiples show next to each other
                return Array.from({ length: max }, (_, i) => {
                  const isSelected = i < sel;
                  return (
                    <div
                      key={`${key}:${i}`}
                      className={`cf-inv-tile ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleUnit(key, i)}
                    >
                      <img
                        src={item.details?.imageUrl || item.image || '/default-item.png'}
                        alt={item.details?.name || item.name}
                        className="cf-inv-img"
                        onError={(e) => {
                          e.target.src = '/default-item.png';
                        }}
                      />
                      <div className="cf-inv-name">{item.details?.name || item.name}</div>
                      <ModBadges mods={item.mods || item.details?.mods} size={15} />
                      <div className="cf-inv-val"><span className="cf-diamond-xs"><Icon name="diamond" size={10} /></span>{(item.value || item.details?.value || 0).toLocaleString()}</div>
                    </div>
                  );
                });
              })
            ) : (
              <div className="cf-join-no-items">No items available in your inventory</div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="cf-join-bottom">
          <div className="cf-join-bottom-left">
            <span className="cf-join-selected-info">
              {selectedCount} items · <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {getTotalValue().toLocaleString()} AMP
            </span>
          </div>
          <div className="cf-join-bottom-right">
            <button className="cf-join-action-btn" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              className="cf-confirm-btn"
              onClick={handleCreateCoinflip}
              disabled={selectedCount === 0 || loading}
            >
              {loading ? 'Creating...' : `Create Game (${getTotalValue().toLocaleString()} AMP)`}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};

export default CreateCoinflipModal;