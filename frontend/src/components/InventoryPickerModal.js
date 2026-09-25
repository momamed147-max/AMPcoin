import React, { useEffect, useState } from 'react';
import Icon from './Icon';
import ModalPortal from './ModalPortal';
import './InventoryPickerModal.css';

// Reusable inventory-grid modal used by tipping and giveaway creation.
// Clicking an item calls onSelect(item).
const InventoryPickerModal = ({
  isOpen,
  title,
  subtitle,
  items,
  loading,
  busyId,
  note,
  noteType,
  onClose,
  onSelect,
  actionLabel = 'Select'
}) => {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (isOpen) setSearch('');
  }, [isOpen]);

  if (!isOpen) return null;

  const q = search.trim().toLowerCase();
  const visible = q
    ? (items || []).filter((it) =>
        (it.details?.name || it.name || it.itemName || '').toLowerCase().includes(q)
      )
    : items || [];

  const valueOf = (it) => Number(it.value || it.details?.value || 0) || 0;
  const imgOf = (it) => it.details?.imageUrl || it.imageUrl || it.image || '/default-item.png';

  return (
    <ModalPortal>
    <div className="ipm-overlay" onClick={onClose}>
      <div className="ipm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="inventory-picker-title">
        <div className="ipm-header">
          <div>
            <h2 className="ipm-title" id="inventory-picker-title">{title}</h2>
            {subtitle && <div className="ipm-subtitle">{subtitle}</div>}
          </div>
          <button className="ipm-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="ipm-search-row">
          <input
            type="text"
            className="ipm-search"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="ipm-grid">
          {loading ? (
            <div className="ipm-empty">
              <div className="ipm-spinner" />
              <p>Loading inventory...</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="ipm-empty">
              <p>{(items || []).length === 0 ? 'You have no items' : 'No items match your search'}</p>
            </div>
          ) : (
            visible.map((item) => {
              const key = item.itemId || item.id;
              const qty = Math.max(1, parseInt(item.quantity || 1, 10) || 1);
              return (
                <button
                  type="button"
                  key={key}
                  className={`ipm-item ${busyId === key ? 'busy' : ''}`}
                  onClick={() => busyId !== key && onSelect && onSelect(item)}
                  title={item.details?.name || item.name || item.itemName}
                  disabled={busyId === key}
                >
                  <img
                    src={imgOf(item)}
                    alt=""
                    onError={(e) => { e.target.src = '/default-item.png'; }}
                  />
                  {qty > 1 && <span className="ipm-qty">×{qty}</span>}
                  <div className="ipm-item-name">
                    {(item.details?.name || item.name || item.itemName || 'Item')}
                  </div>
                  <div className="ipm-item-val">{valueOf(item).toLocaleString()} AMP</div>
                  {busyId === key && <span className="ipm-busy">...</span>}
                  <span className="ipm-action-hint">{actionLabel}</span>
                </button>
              );
            })
          )}
        </div>

        {note && <div className={`ipm-note ${noteType === 'error' ? 'error' : 'ok'}`}>{note}</div>}
      </div>
    </div>
    </ModalPortal>
  );
};

export default InventoryPickerModal;
