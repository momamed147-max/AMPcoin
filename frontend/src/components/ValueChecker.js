import React, { useState, useEffect, useMemo } from 'react';
import Icon from './Icon';
import { API_BASE } from '../apiConfig';
import './ValueChecker.css';

const RARITY_COLORS = {
  legendary: '#ffaa00',
  ultra_rare: '#ff44cc',
  rare: '#0088ff',
  uncommon: '#00cc44',
  common: '#888888'
};

const RARITY_LABELS = {
  legendary: 'Legendary',
  ultra_rare: 'Ultra Rare',
  rare: 'Rare',
  uncommon: 'Uncommon',
  common: 'Common'
};

const ITEMS_PER_PAGE = 50;

const ValueChecker = ({ isOpen, onClose }) => {
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [sortField, setSortField] = useState('normal');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    // Public catalog endpoint (no admin rights needed)
    fetch(`${API_BASE}/api/items`)
      .then((r) => r.json())
      .then((data) => {
        setAllItems(Array.isArray(data) ? data : data.items || []);
      })
      .catch(() => setAllItems([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const filtered = useMemo(() => {
    let list = [...allItems];
    if (rarityFilter !== 'all') {
      list = list.filter((it) => (it.rarity || 'common').toLowerCase().replace(/\s+/g, '_') === rarityFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((it) => (it.name || it.itemName || '').toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const va = Number(a.value || 0);
      const vb = Number(b.value || 0);
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return list;
  }, [allItems, search, rarityFilter, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const pageItems = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, rarityFilter, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay vc-overlay" onClick={onClose}>
      <div className="vc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vc-header">
          <h2>Pet Values</h2>
          <button className="vc-close" onClick={onClose}>×</button>
        </div>

        <div className="vc-search-wrap">
          <span className="vc-search-icon"><Icon name="search" size={14} /></span>
          <input
            type="text"
            className="vc-search"
            placeholder="Search a pet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="vc-rarity-tabs">
          {[
            { key: 'all', label: 'All' },
            { key: 'legendary', label: 'Legendary' },
            { key: 'ultra_rare', label: 'Ultra Rare' },
            { key: 'rare', label: 'Rare' },
            { key: 'uncommon', label: 'Uncommon' },
            { key: 'common', label: 'Common' }
          ].map((r) => (
            <button
              key={r.key}
              className={`vc-rarity-tab ${rarityFilter === r.key ? 'active' : ''}`}
              onClick={() => setRarityFilter(r.key)}
              style={r.key !== 'all' ? { '--rarity-color': RARITY_COLORS[r.key] || '#888' } : undefined}
            >
              {r.key !== 'all' && <span className="vc-rarity-dot" style={{ background: RARITY_COLORS[r.key] }} />}
              {r.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="vc-loading">
            <div className="loading-spinner"></div>
            <p>Loading pet values...</p>
          </div>
        ) : (
          <>
            <div className="vc-table-wrap">
              <table className="vc-table">
                <thead>
                  <tr>
                    <th className="vc-th-pet">PET</th>
                    <th className="vc-th-val" onClick={() => handleSort('normal')}>
                      NORMAL {sortField === 'normal' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                    </th>
                    <th className="vc-th-val" onClick={() => handleSort('neon')}>
                      NEON {sortField === 'neon' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                    </th>
                    <th className="vc-th-val" onClick={() => handleSort('mega')}>
                      MEGA {sortField === 'mega' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item, idx) => {
                    const name = item.name || item.itemName || 'Unknown';
                    const rarity = (item.rarity || 'common').toLowerCase().replace(/\s+/g, '_');
                    // Base catalog value; Neon (+8%) and Mega (+20%) match the N/M mod bonuses
                    const baseVal = Number(item.baseValue ?? item.value ?? 0);
                    const normalVal = baseVal;
                    const neonVal = Math.round(baseVal * 1.08);
                    const megaVal = Math.round(baseVal * 1.20);
                    return (
                      <tr key={item.id || item.itemId || idx} className="vc-row">
                        <td className="vc-pet-cell">
                          <div className="vc-pet-info">
                            <img
                              src={item.imageUrl || item.image || '/default-item.png'}
                              alt={name}
                              className="vc-pet-img"
                              onError={(e) => { e.target.src = '/default-item.png'; }}
                            />
                            <div className="vc-pet-text">
                              <span className="vc-pet-name">{name}</span>
                              <span className="vc-pet-rarity" style={{ color: RARITY_COLORS[rarity] || '#888' }}>
                                {RARITY_LABELS[rarity] || rarity}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="vc-val-cell">
                          <span className="vc-diamond"><Icon name="diamond" size={12} /></span> {normalVal.toLocaleString()}
                        </td>
                        <td className="vc-val-cell">
                          <span className="vc-diamond"><Icon name="diamond" size={12} /></span> {neonVal.toLocaleString()}
                        </td>
                        <td className="vc-val-cell">
                          <span className="vc-diamond"><Icon name="diamond" size={12} /></span> {megaVal.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="vc-pagination">
              <button className="vc-page-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
              <span className="vc-page-info">Page {page} of {totalPages} · {filtered.length} pets</span>
              <button className="vc-page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>›</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ValueChecker;
