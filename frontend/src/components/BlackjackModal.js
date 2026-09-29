import React, { useState, useMemo } from 'react';
import AnimatedPopup from './AnimatedPopup';
import ModBadges from './ModBadges';
import ModalPortal from './ModalPortal';
import Icon from './Icon';
import { API_BASE } from '../apiConfig';
import './ModBadges.css';
import './BlackjackModal.css';

// Create or join a blackjack bet, in the same shape as every other bet on the
// site: a modal, a grid of pet tiles, and a total that has to land inside the
// other side's band before the button will fire.
const BlackjackModal = ({ mode, table, userInventory, onClose, onDone }) => {
  const isJoin = mode === 'join';
  const [sel, setSel] = useState({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const stackKeyOf = (i) => i.itemId || i.id;
  const stackQtyOf = (i) => Math.max(1, parseInt(i.quantity || 1, 10) || 1);

  // A join has to land within the dealer's 5% band, published by the server.
  const lo = isJoin ? Number(table?.minJoinValue || 0) : 0;
  const hi = isJoin ? Number(table?.maxJoinValue || Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  const target = isJoin ? Number(table?.creatorValue || 0) : 0;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? userInventory.filter((i) => String(i.name || i.itemName || '').toLowerCase().includes(q))
      : userInventory;
    return [...list].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  }, [userInventory, search]);

  const total = useMemo(() => userInventory.reduce(
    (s, i) => s + (Number(i.value) || 0) * (sel[stackKeyOf(i)] || 0), 0
  ), [userInventory, sel]);

  // Per-unit tiles: clicking picks one more, clicking a picked tile drops back
  // to that many. Same interaction as the other bet modals.
  const toggle = (key, idx) => {
    setSel((prev) => {
      const cur = prev[key] || 0;
      const next = idx < cur ? idx : cur + 1;
      const stack = userInventory.find((i) => stackKeyOf(i) === key);
      const clamped = Math.min(next, stack ? stackQtyOf(stack) : next);
      const n = { ...prev };
      if (clamped <= 0) delete n[key];
      else n[key] = clamped;
      return n;
    });
  };

  const pickedCount = Object.values(sel).reduce((a, b) => a + b, 0);
  const tooLow = isJoin && pickedCount > 0 && total < lo;
  const tooHigh = isJoin && pickedCount > 0 && total > hi;
  const inBand = !isJoin || (pickedCount > 0 && total >= lo && total <= hi);
  // Close enough to the band that a warning is not worth blocking on.
  const nearlyThere = isJoin && pickedCount > 0 && !inBand
    && total >= lo * 0.8 && total <= hi * 1.2;

  const selectedItems = userInventory
    .filter((i) => (sel[stackKeyOf(i)] || 0) > 0)
    .map((i) => ({
      itemId: stackKeyOf(i),
      name: i.name,
      value: i.value,
      quantity: sel[stackKeyOf(i)]
    }));

  const submit = async () => {
    if (!selectedItems.length || busy) return;
    setBusy(true);
    try {
      const url = isJoin
        ? `${API_BASE}/api/blackjack/tables/${table.id}/join`
        : `${API_BASE}/api/blackjack/tables`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ selectedItems })
      });
      const d = await res.json();
      if (!res.ok) {
        setNotice({ message: d.message || 'Could not place that bet', type: 'error' });
        return;
      }
      onDone(d);
    } catch {
      setNotice({ message: 'Something went wrong', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalPortal>
      <div className="cf-modal-overlay" onClick={onClose}>
        {notice && (
          <AnimatedPopup message={notice.message} type={notice.type} onClose={() => setNotice(null)} />
        )}
        <div className="cf-modal bjm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <button className="cf-modal-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>

          <div className="bjm-head">
            <h2>{isJoin ? 'Join Blackjack' : 'Create Blackjack Bet'}</h2>
            <p className="bjm-sub">
              {isJoin
                ? 'You take the player seat. The dealer draws first, then you hit or stand.'
                : 'You take the dealer seat. A player joins to play against you, or call the house bot.'}
            </p>
          </div>

          {isJoin && (
            <div className="bjm-band">
              <span className="bjm-band-label">Their wager</span>
              <span className="bjm-band-val">
                <Icon name="diamond" size={12} /> {target.toLocaleString()}
              </span>
              <span className="bjm-band-arrow">&rarr;</span>
              <span className="bjm-band-label">You must match</span>
              <span className="bjm-band-val">
                {lo.toLocaleString()} &ndash; {hi.toLocaleString()}
              </span>
            </div>
          )}

          <div className="bjm-search">
            <Icon name="search" size={13} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your pets"
              aria-label="Search your pets"
            />
          </div>

          <div className="bjm-grid">
            {shown.length === 0 && <div className="bjm-empty">No pets match.</div>}
            {shown.map((i) => {
              const key = stackKeyOf(i);
              const avail = stackQtyOf(i);
              const picked = sel[key] || 0;
              return (
                <button
                  type="button"
                  key={key}
                  className={`bjm-tile ${picked > 0 ? 'picked' : ''}`}
                  onClick={() => toggle(key, picked)}
                  title={`${i.name || i.itemName} - ${i.value} each`}
                >
                  {Array.from({ length: avail }, (_, n) => (
                    <span
                      key={n}
                      className={`bjm-unit ${n < picked ? 'on' : ''}`}
                      role="presentation"
                    >
                      <img
                        src={i.image || i.imageUrl || '/default-item.png'}
                        alt=""
                        onError={(e) => { e.target.style.visibility = 'hidden'; }}
                      />
                    </span>
                  ))}
                  <span className="bjm-tile-meta">
                    <span className="bjm-tile-name">{i.name || i.itemName}</span>
                    <span className="bjm-tile-val">
                      <Icon name="diamond" size={9} /> {(Number(i.value) || 0).toLocaleString()}
                    </span>
                    <ModBadges mods={i.mods || i.variantMods} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className={`bjm-total ${tooLow || tooHigh ? 'bad' : ''}`}>
            <span>
              {pickedCount} {pickedCount === 1 ? 'pet' : 'pets'} selected
            </span>
            <span className="bjm-total-val">
              <Icon name="diamond" size={13} /> {total.toLocaleString()}
            </span>
          </div>

          {(tooLow || tooHigh) && (
            <div className={`bjm-warn ${nearlyThere ? 'near' : ''}`}>
              {tooLow
                ? `${(lo - total).toLocaleString()} more needed to reach ${lo.toLocaleString()}.`
                : `${(total - hi).toLocaleString()} over the ${hi.toLocaleString()} limit.`}
            </div>
          )}
          {isJoin && inBand && (
            <div className="bjm-ok">
              <Icon name="check" size={13} /> In range &mdash; ready to join
            </div>
          )}

          <div className="bjm-actions">
            <button className="cf-topbar-btn" onClick={onClose} type="button">Cancel</button>
            <button
              className="cf-topbar-btn cf-topbar-btn-gold"
              onClick={submit}
              disabled={!selectedItems.length || !inBand || busy}
              type="button"
            >
              <Icon name="plus" size={13} /> {isJoin ? 'Join as Player' : 'Post the Bet'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};

export default BlackjackModal;
