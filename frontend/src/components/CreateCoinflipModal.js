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

const CreateCoinflipModal = ({ onClose, onCreated, userId, socket, userInventory, gameType = 'coinflip', match = null }) => {
  const isRps = gameType === 'rps' || gameType === 'rps-join';
  const isRpsJoin = gameType === 'rps-join';
  const isBlackjack = gameType === 'blackjack' || gameType === 'blackjack-join';
  const isBlackjackJoin = gameType === 'blackjack-join';
  const isJoin = isRpsJoin || isBlackjackJoin;
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
  // RPS turns: switch off = single turn, switch on = pick 1-5 turns.
  const [turnsOn, setTurnsOn] = useState(false);
  const [turnCount, setTurnCount] = useState(3);
  // RPS side: creator picks at creation, joiner picks at join.
  const [rpsSide, setRpsSide] = useState('rock');

  const activeTurns = isRps && turnsOn ? turnCount : 1;
  // A join has to land inside the creator's accepted value band. RPS and
  // Blackjack publish the same minJoinValue/maxJoinValue fields.
  const joinLo = isJoin ? Number(match?.minJoinValue || 0) : 0;
  const joinHi = isJoin ? Number(match?.maxJoinValue || Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  const joinTarget = isJoin ? Number(match?.creatorValue || 0) : 0;
  const joinName = isBlackjackJoin
    ? (match?.creatorUsername || 'Dealer')
    : (match?.playerOne?.displayName || match?.playerOne?.username || 'Player');
  const joinAvatar = isBlackjackJoin
    ? (match?.creatorAvatar || '/default-avatar.svg')
    : (match?.playerOne?.avatar || '/default-avatar.svg');

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

  // Auto select: fill the wager with the highest-value items that still fit
  // inside the accepted range, then top up with a closer-fitting stack.
  const autoSelect = () => {
    if (!isJoin || inventory.length === 0) return;
    const lo = Math.max(1, joinLo);
    const hi = joinHi;
    if (hi < lo) {
      showNotice('This bet no longer accepts wagers.', 'error');
      return;
    }
    const maxByKey = {};
    const units = [];
    inventory.forEach((item) => {
      const value = item.value || item.details?.value || 0;
      if (value <= 0) return;
      const key = stackKeyOf(item);
      const qty = stackQtyOf(item);
      maxByKey[key] = qty;
      for (let i = 0; i < qty; i += 1) units.push({ key, value });
    });
    units.sort((a, b) => b.value - a.value);
    const picked = {};
    let total = 0;
    for (const unit of units) {
      if (total >= lo) break;
      if ((picked[unit.key] || 0) >= (maxByKey[unit.key] || 1)) continue;
      if (total + unit.value <= hi) {
        picked[unit.key] = (picked[unit.key] || 0) + 1;
        total += unit.value;
      }
    }
    if (total < lo) {
      const seen = new Set();
      const rest = units
        .filter((unit) => {
          if (seen.has(unit.key)) return false;
          seen.add(unit.key);
          return (picked[unit.key] || 0) < (maxByKey[unit.key] || 1);
        })
        .sort((a, b) => a.value - b.value);
      const fit = rest.find((unit) => total + unit.value >= lo && total + unit.value <= hi)
        || rest.find((unit) => total + unit.value <= hi);
      if (fit) {
        picked[fit.key] = (picked[fit.key] || 0) + 1;
        total += fit.value;
      }
    }
    if (Object.keys(picked).length === 0) {
      showNotice('No combination of your items fits that value range.', 'warning');
      return;
    }
    setSelectedQty(picked);
    if (total < lo) {
      showNotice(`Closest match is ${total.toLocaleString()} AMP — you need at least ${lo.toLocaleString()}.`, 'warning');
    }
  };

  const handleCreateCoinflip = async () => {
    if (selectedCount === 0) {
      showNotice('Please select at least one item to bet', 'warning');
      return;
    }
    if (isJoin) {
      const total = getTotalValue();
      if (total < joinLo || total > joinHi) {
        showNotice(`Your wager must be between ${joinLo.toLocaleString()} and ${joinHi.toLocaleString()} AMP.`, 'warning');
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint = isRpsJoin
        ? `/api/rps/matches/${match?.id}/join`
        : isRps
          ? '/api/rps'
          : isBlackjackJoin
            ? `/api/blackjack/tables/${match?.id}/join`
            : isBlackjack
              ? '/api/blackjack/tables'
              : '/api/coinflip';
      const selectedItems = selectedEntries.map(({ item, qty }) => ({
        itemId: item.itemId || item.id,
        name: item.details?.name || item.name,
        quantity: qty,
        value: item.value || item.details?.value || 0
      }));
      const payload = isRps
        ? { rounds: activeTurns, side: rpsSide, selectedItems }
        : isBlackjack
          ? { selectedItems }
          : {
            selectedItems,
            sideChosen: selectedSide,
            maxJoinPets: limitationsOn ? (maxJoinPets === 0 ? null : maxJoinPets) : null
          };
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(payload)
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

        // There is no cash balance to decrement. This used to do exactly that:
        // every coinflip wager - which is items - subtracted the item value
        // from a cash figure that was never spent and never paid back, so the
        // number only ever fell. The wager is escrow server-side and the
        // inventory updates arrive over the socket.

        onClose();
      } else {
        if (response.status === 429) {
          showNotice('Too many requests — slow down a few seconds and try again.', 'error');
        } else {
          showNotice(
            data.message
              || (isRps
                ? 'Failed to update the RPS bet'
                : isBlackjack
                  ? 'Failed to update the Blackjack bet'
                  : 'Failed to create coinflip'),
            'error'
          );
        }
      }
    } catch (error) {
      console.error(`Error creating ${isRps ? 'RPS bet' : isBlackjack ? 'Blackjack bet' : 'coinflip'}:`, error);
      showNotice(`Error creating ${isRps ? 'RPS bet' : isBlackjack ? 'Blackjack bet' : 'coinflip'}`, 'error');
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
        <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={isRps ? 'RPS bet' : isBlackjack ? 'Blackjack bet' : 'Create coinflip'}>
          <div className="modal-header">
            <h2>
              {isRps
                ? (isRpsJoin ? 'Join RPS Bet' : 'Create RPS Bet')
                : isBlackjack
                  ? (isBlackjackJoin ? 'Join Blackjack Bet' : 'Create Blackjack Bet')
                  : 'Create Coinflip Game'}
            </h2>
            <button className="close-modal" onClick={onClose} aria-label="Close create bet">
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>{isRps ? 'Preparing your items...' : isBlackjack ? 'Preparing your wager...' : 'Loading...'}</p>
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
      <div className="cf-modal cf-join-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={isRps ? 'RPS bet' : isBlackjack ? 'Blackjack bet' : 'Create coinflip'}>
        <button className="cf-modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>

        <div className="cf-join-content">
          {/* Left: your side + limits + select controls */}
          <div className="cf-join-left">
            <div className="cf-join-vs-head">
              <span className="cf-join-vs-label">
                {isRps
                  ? (isRpsJoin ? 'JOINING' : 'POST RPS BET')
                  : isBlackjack
                    ? (isBlackjackJoin ? 'JOINING BLACKJACK' : 'POST BLACKJACK BET')
                    : 'CREATE BET'}
              </span>
              {isJoin && (
                <div className="cf-join-vs-user">
                  <img
                    className="cf-join-vs-avatar"
                    src={joinAvatar}
                    alt={joinName}
                    onError={(e) => { e.target.src = '/default-avatar.svg'; }}
                  />
                  <div className="cf-join-vs-meta">
                    <span className="cf-join-vs-name">{joinName}</span>
                    <span className="cf-join-vs-side cf-rps-side-badge">
                      <Icon name={isBlackjackJoin ? 'card' : 'rpsScissors'} size={11} /> {joinTarget.toLocaleString()} AMP
                      {isBlackjackJoin ? ' · dealer' : ''}
                    </span>
                  </div>
                </div>
              )}
              <div className="cf-join-vs-total">
                <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {getTotalValue().toLocaleString()}
                <span className="cf-join-vs-sub">
                  {isJoin
                    ? `Join ${joinLo.toLocaleString()}–${joinHi.toLocaleString()}`
                    : `${selectedCount} items selected`}
                </span>
              </div>
            </div>

            {isRps && (
              <div className="cf-create-opt-group">
                <div className="cf-join-bet-items-title">TURNS</div>
                <div className={`cf-limitations ${turnsOn ? 'on' : ''}`}>
                  <div className="cf-limit-switch-row">
                    <span className="cf-limit-label">Multiple Turns</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={turnsOn}
                      className={`cf-limit-switch ${turnsOn ? 'on' : ''}`}
                      onClick={() => setTurnsOn((on) => !on)}
                    >
                      <span className="cf-limit-knob" />
                    </button>
                  </div>
                  <div className={`cf-limit-dropdown ${turnsOn ? 'open enabled' : ''}`}>
                    <div className="cf-rps-turn-row" role="group" aria-label="Number of turns">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`cf-rps-turn-btn ${activeTurns === n ? 'active' : ''}`}
                          disabled={!turnsOn}
                          aria-pressed={activeTurns === n}
                          onClick={() => setTurnCount(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className="cf-rps-turn-note">
                      {turnsOn
                        ? `${activeTurns} turn${activeTurns === 1 ? '' : 's'} — most round wins takes the pot.`
                        : 'Single throw. Winner takes the pot.'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isRps && (
              <div className="cf-create-opt-group">
                <div className="cf-join-bet-items-title">YOUR MOVE</div>
                <div className="cf-create-side-row cf-rps-side-select-row">
                  {['rock', 'paper', 'scissors'].map((move) => (
                    <button
                      key={move}
                      type="button"
                      data-move={move}
                      className={`cf-rps-side-btn ${rpsSide === move ? 'active' : ''}`}
                      onClick={() => setRpsSide(move)}
                      aria-pressed={rpsSide === move}
                    >
                      <Icon name={`rps${move.charAt(0).toUpperCase() + move.slice(1)}`} size={28} />
                      <span>{move.charAt(0).toUpperCase() + move.slice(1)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isBlackjack && (
              <div className="cf-create-opt-group">
                <div className="cf-join-bet-items-title">{isBlackjackJoin ? 'THE HAND' : 'YOUR ROLE'}</div>
                <div className="cf-rps-turn-note">
                  {isBlackjackJoin
                    ? 'You are the dealer: the bet creator will hit or stand. Your wager must sit inside the player\'s 5% band.'
                    : 'You are the player: post your wager, then wait for a dealer or call the house bot. Blackjack pays 3:2.'}
                </div>
              </div>
            )}

            {!isRps && !isBlackjack && (<>
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
            </>)}

            <div className="cf-create-opt-group">
              <div className="cf-join-bet-items-title">SELECT</div>
              <div className="cf-create-side-row cf-rps-select-row">
                <button type="button" className="cf-join-action-btn" onClick={selectAll}>
                  Select All
                </button>
                {isJoin && (
                  <button type="button" className="cf-join-action-btn" onClick={autoSelect} disabled={loading || inventory.length === 0}>
                    Auto Select
                  </button>
                )}
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
                        src={item.details?.imageUrl || item.image || '/default-item.svg'}
                        alt={item.details?.name || item.name}
                        className="cf-join-bet-item-img"
                        onError={(e) => { e.target.src = '/default-item.svg'; }}
                      />
                      <span className="cf-join-bet-item-name">{item.details?.name || item.name}{qty > 1 ? ` ×${qty}` : ''}</span>
                      <span className="cf-join-bet-item-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {((item.value || item.details?.value || 0) * qty).toLocaleString()}</span>
                      <button className="cf-bet-item-x" onClick={() => clearStack(stackKeyOf(item))} title="Remove" aria-label={`Remove ${item.details?.name || item.name || 'item'}`}>
                        <Icon name="close" size={12} />
                      </button>
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
                        src={item.details?.imageUrl || item.image || '/default-item.svg'}
                        alt={item.details?.name || item.name}
                        className="cf-inv-img"
                        onError={(e) => {
                          e.target.src = '/default-item.svg';
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
            <div className="cf-join-selected-info">
              {isJoin ? (() => {
                const total = getTotalValue();
                const inRange = total >= joinLo && total <= joinHi;
                if (selectedCount === 0) {
                  return <span className="cf-range-bad">Pick items to match {joinTarget.toLocaleString()} AMP</span>;
                }
                return inRange
                  ? <span className="cf-range-ok"><Icon name="check" size={13} /> {total.toLocaleString()} AMP</span>
                  : total > joinHi
                    ? <span className="cf-range-bad">{total.toLocaleString()} AMP — {Math.max(0, total - joinHi).toLocaleString()} over the limit</span>
                    : <span className="cf-range-bad">{total.toLocaleString()} AMP — {Math.max(0, joinLo - total).toLocaleString()} more needed</span>;
              })() : (
                <span>
                  {selectedCount} items · <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {getTotalValue().toLocaleString()} AMP
                </span>
              )}
            </div>
            <button className="cf-join-action-btn" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              className="cf-confirm-btn"
              onClick={handleCreateCoinflip}
              disabled={selectedCount === 0 || loading || (isJoin && (getTotalValue() < joinLo || getTotalValue() > joinHi))}
            >
              {loading
                ? (isJoin ? 'Joining...' : isBlackjack ? 'Posting...' : 'Creating...')
                : isRps
                  ? `${isRpsJoin ? 'Join' : 'Post'} RPS Bet (${getTotalValue().toLocaleString()} AMP)`
                  : isBlackjack
                    ? `${isBlackjackJoin ? 'Join' : 'Post'} Blackjack Bet (${getTotalValue().toLocaleString()} AMP)`
                    : `Create Game (${getTotalValue().toLocaleString()} AMP)`}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};

export default CreateCoinflipModal;