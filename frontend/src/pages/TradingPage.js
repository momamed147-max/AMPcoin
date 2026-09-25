import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import AnimatedPopup from '../components/AnimatedPopup';
import ModBadges from '../components/ModBadges';
import ModalPortal from '../components/ModalPortal';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import '../components/ModBadges.css';
import './TradingPage.css';

const authHeaders = (json) => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  Authorization: `Bearer ${localStorage.getItem('token')}`
});

const itemVal = (it) => Number(it.value || 0) * (it.quantity || 1);

function ItemThumb({ item, onRemove }) {
  return (
    <div className="tr-thumb" title={`${item.name || item.itemName || 'Item'}`}>
      <img
        src={item.image || item.imageUrl || '/default-item.png'}
        alt={item.name || item.itemName || 'item'}
        onError={(e) => { e.target.src = '/default-item.png'; }}
      />
      <span className="tr-thumb-name">{item.name || item.itemName || 'Item'}{(item.quantity || 1) > 1 ? ` ×${item.quantity}` : ''}</span>
      <ModBadges mods={item.mods} size={13} />
      <span className="tr-thumb-val"><Icon name="diamond" size={10} /> {itemVal(item).toLocaleString()}</span>
      {onRemove && (
        <button className="tr-thumb-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove">×</button>
      )}
    </div>
  );
}

const TradingPage = ({ socket }) => {
  const { user } = useAuth();
  const [trades, setTrades] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('browse'); // browse | mine | create
  const [expanded, setExpanded] = useState({});
  const [popup, setPopup] = useState({ show: false, message: '', type: 'info' });
  const [busy, setBusy] = useState(false);

  // Create form
  const [haveSel, setHaveSel] = useState([]); // [{itemId, quantity}]
  const [wantSel, setWantSel] = useState([]); // [{itemId, quantity}]
  const [wantText, setWantText] = useState('');
  const [invSearch, setInvSearch] = useState('');
  const [catSearch, setCatSearch] = useState('');

  // Offer modal
  const [offerTrade, setOfferTrade] = useState(null);
  const [offerSel, setOfferSel] = useState([]);

  const showPopup = (message, type = 'info') => {
    setPopup({ show: true, message, type });
  };

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/trades`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTrades(data.trades || []);
      }
    } catch (e) {
      console.error('Trades fetch failed:', e.message);
    }
  }, []);

  const fetchInventory = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE}/api/users/inventory/${user.id || user.robloxUsername}`, {
        headers: authHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setInventory(data.items || []);
      }
    } catch (e) {
      console.error('Inventory fetch failed:', e.message);
    }
  }, [user]);

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/items`);
      if (res.ok) {
        const data = await res.json();
        setCatalog(Array.isArray(data) ? data : data.items || []);
      }
    } catch (e) {
      console.error('Catalog fetch failed:', e.message);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchTrades(), fetchInventory(), fetchCatalog()]).finally(() => setLoading(false));
  }, [fetchTrades, fetchInventory, fetchCatalog]);

  useEffect(() => {
    if (!socket) return;
    const onTrade = () => fetchTrades();
    const onInv = () => fetchInventory();
    socket.on('tradeUpdate', onTrade);
    socket.on('inventoryUpdate', onInv);
    return () => {
      socket.off('tradeUpdate', onTrade);
      socket.off('inventoryUpdate', onInv);
    };
  }, [socket, fetchTrades, fetchInventory]);

  // ---- Create helpers: click adds, clicking added removes ----
  const toggleHave = (item) => {
    const id = item.itemId || item.id;
    setHaveSel((prev) =>
      prev.some((s) => s.itemId === id)
        ? prev.filter((s) => s.itemId !== id)
        : [...prev, { itemId: id, quantity: 1 }]
    );
  };

  const toggleWant = (item) => {
    const id = item.itemId || item.id;
    setWantSel((prev) =>
      prev.some((s) => s.itemId === id)
        ? prev.filter((s) => s.itemId !== id)
        : [...prev, { itemId: id, quantity: 1 }]
    );
  };

  const toggleOffer = (item) => {
    const id = item.itemId || item.id;
    setOfferSel((prev) =>
      prev.some((s) => s.itemId === id)
        ? prev.filter((s) => s.itemId !== id)
        : [...prev, { itemId: id, quantity: 1 }]
    );
  };

  const haveValue = haveSel.reduce((s, sel) => {
    const it = inventory.find((i) => (i.itemId || i.id) === sel.itemId);
    return s + (it ? Number(it.value || 0) : 0);
  }, 0);

  const createTrade = async () => {
    if (haveSel.length === 0) return showPopup('Add at least one pet you are giving', 'warning');
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/trades`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ offerItems: haveSel, wantItems: wantSel, wantText })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showPopup('Trade posted!', 'success');
        setHaveSel([]);
        setWantSel([]);
        setWantText('');
        setTab('mine');
        fetchTrades();
        fetchInventory();
      } else {
        showPopup(data.message || 'Failed to post trade', 'error');
      }
    } catch (e) {
      showPopup('Server error posting trade', 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendOffer = async () => {
    if (!offerTrade || offerSel.length === 0) return showPopup('Add at least one pet to your offer', 'warning');
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/trades/${offerTrade.id}/offers`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ items: offerSel })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showPopup('Offer sent!', 'success');
        setOfferTrade(null);
        setOfferSel([]);
        fetchTrades();
        fetchInventory();
      } else {
        showPopup(data.message || 'Failed to send offer', 'error');
      }
    } catch (e) {
      showPopup('Server error sending offer', 'error');
    } finally {
      setBusy(false);
    }
  };

  const decideOffer = async (tradeId, offerId, action) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/trades/${tradeId}/offers/${offerId}/${action}`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showPopup(action === 'accept' ? 'Trade completed — pets swapped!' : 'Offer declined, pets returned.', 'success');
        fetchTrades();
        fetchInventory();
      } else {
        showPopup(data.message || 'Action failed', 'error');
      }
    } catch (e) {
      showPopup('Server error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelTrade = async (tradeId) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/trades/${tradeId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.ok) {
        showPopup('Trade cancelled, pets returned.', 'success');
        fetchTrades();
        fetchInventory();
      } else {
        const data = await res.json().catch(() => ({}));
        showPopup(data.message || 'Cancel failed', 'error');
      }
    } catch (e) {
      showPopup('Server error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const myTrades = trades.filter((t) => user && t.creatorId === user.id);
  const shown = tab === 'mine' ? myTrades : trades.filter((t) => !user || t.creatorId !== user.id);

  const filteredInv = inventory.filter((i) =>
    !invSearch || (i.name || i.itemName || '').toLowerCase().includes(invSearch.toLowerCase())
  );
  const filteredCat = catalog
    .filter((c) => !catSearch || (c.name || c.itemName || '').toLowerCase().includes(catSearch.toLowerCase()))
    .slice(0, 60);

  if (loading) {
    return (
      <div className="cf-loading">
        <div className="cf-loading-spinner"></div>
        <p>Loading trades...</p>
      </div>
    );
  }

  return (
    <div className="tr-page">
      <AnimatedPopup
        show={popup.show}
        message={popup.message}
        type={popup.type}
        onClose={() => setPopup({ show: false, message: '', type: 'info' })}
      />

      <div className="tr-topbar">
        <div className="cf-topbar-tabs">
          <button className={`cf-tab ${tab === 'browse' ? 'cf-tab-active' : ''}`} onClick={() => setTab('browse')}>
            <span className="cf-tab-label">Browse</span>
            <span className="cf-tab-count">{trades.length}</span>
          </button>
          <button className={`cf-tab ${tab === 'mine' ? 'cf-tab-active' : ''}`} onClick={() => setTab('mine')}>
            <span className="cf-tab-label">My Trades</span>
            <span className="cf-tab-count">{myTrades.length}</span>
          </button>
        </div>
        <div className="cf-topbar-right">
          <button className="cf-topbar-btn cf-topbar-btn-gold" onClick={() => setTab('create')}>
            + New Trade
          </button>
        </div>
      </div>

      {tab === 'create' ? (
        <div className="tr-create">
          <div className="tr-create-col">
            <h3>Pets you are selling <span className="tr-val"><Icon name="diamond" size={12} /> {haveValue.toLocaleString()}</span></h3>
            <input
              className="cf-create-search"
              placeholder="Search your pets..."
              value={invSearch}
              onChange={(e) => setInvSearch(e.target.value)}
            />
            <div className="tr-pick-list">
              {haveSel.length > 0 && (
                <div className="tr-pick-selected">
                  {haveSel.map((s) => {
                    const it = inventory.find((i) => (i.itemId || i.id) === s.itemId) || s;
                    return <ItemThumb key={s.itemId} item={it} onRemove={() => toggleHave({ itemId: s.itemId })} />;
                  })}
                </div>
              )}
              <div className="tr-pick-grid">
                {filteredInv.map((item) => {
                  const id = item.itemId || item.id;
                  const added = haveSel.some((s) => s.itemId === id);
                  return (
                    <div
                      key={id}
                      className={`cf-inv-tile ${added ? 'selected' : ''}`}
                      onClick={() => toggleHave(item)}
                    >
                      <img
                        src={item.image || item.imageUrl || '/default-item.png'}
                        alt={item.name || 'item'}
                        className="cf-inv-img"
                        onError={(e) => { e.target.src = '/default-item.png'; }}
                      />
                      <div className="cf-inv-name">{item.name || item.itemName}</div>
                      <ModBadges mods={item.mods} size={14} />
                      <div className="cf-inv-val"><Icon name="diamond" size={10} />{Number(item.value || 0).toLocaleString()}</div>
                    </div>
                  );
                })}
                {filteredInv.length === 0 && <div className="cf-join-no-items">No pets in inventory</div>}
              </div>
            </div>
          </div>

          <div className="tr-create-col">
            <h3>Pets you want</h3>
            <input
              className="cf-create-search"
              placeholder="Search all site pets..."
              value={catSearch}
              onChange={(e) => setCatSearch(e.target.value)}
            />
            <div className="tr-pick-list">
              {wantSel.length > 0 && (
                <div className="tr-pick-selected">
                  {wantSel.map((s) => {
                    const it = catalog.find((c) => (c.itemId || c.id) === s.itemId) || s;
                    return <ItemThumb key={s.itemId} item={it} onRemove={() => toggleWant({ itemId: s.itemId })} />;
                  })}
                </div>
              )}
              <div className="tr-pick-grid small">
                {filteredCat.map((item) => {
                  const id = item.itemId || item.id;
                  const added = wantSel.some((s) => s.itemId === id);
                  return (
                    <div
                      key={id}
                      className={`cf-inv-tile ${added ? 'selected' : ''}`}
                      onClick={() => toggleWant(item)}
                    >
                      <img
                        src={item.image || item.imageUrl || '/default-item.png'}
                        alt={item.name || 'item'}
                        className="cf-inv-img"
                        onError={(e) => { e.target.src = '/default-item.png'; }}
                      />
                      <div className="cf-inv-name">{item.name || item.itemName}</div>
                      <div className="cf-inv-val"><Icon name="diamond" size={10} />{Number(item.baseValue ?? item.value ?? 0).toLocaleString()}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <input
              className="cf-create-search tr-want-text"
              placeholder='Or describe it, e.g. "any mega + adds"'
              value={wantText}
              onChange={(e) => setWantText(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="tr-create-bottom">
            <span className="cf-join-selected-info">
              Giving {haveSel.length} pet(s) · <Icon name="diamond" size={11} /> {haveValue.toLocaleString()}
              {wantSel.length > 0 && ` · Wanting ${wantSel.length} pet(s)`}
            </span>
            <button className="cf-confirm-btn" onClick={createTrade} disabled={busy || haveSel.length === 0}>
              {busy ? 'Posting...' : 'Post Trade'}
            </button>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="cf-empty">
          <div className="cf-empty-icon">⇄</div>
          <p>{tab === 'mine' ? 'You have no open trades' : 'No open trades right now'}</p>
          <p className="cf-empty-sub">Post the first one!</p>
        </div>
      ) : (
        <div className="tr-list">
          {shown.map((t) => {
            const isMine = user && t.creatorId === user.id;
            const myOffer = (t.offers || []).find((o) => user && o.userId === user.id);
            const isOpen = !!expanded[t.id];
            return (
              <div key={t.id} className="tr-card">
                <div className="tr-card-head">
                  <img
                    src={t.creatorAvatar || '/default-avatar.png'}
                    alt={t.creatorUsername}
                    className="tr-creator-avatar"
                    onError={(e) => { e.target.src = '/default-avatar.png'; }}
                  />
                  <div className="tr-creator-meta">
                    <span className="tr-creator-name">{t.creatorUsername}</span>
                    <span className="tr-creator-time">{t.createdAt ? new Date(t.createdAt).toLocaleString() : ''}</span>
                  </div>
                  <span className="tr-total"><Icon name="diamond" size={12} /> {Number(t.offerValue || 0).toLocaleString()}</span>
                  {isMine && (
                    <button className="cf-cancel-btn tr-cancel" onClick={() => cancelTrade(t.id)} disabled={busy}>
                      Cancel
                    </button>
                  )}
                </div>

                <div className="tr-cols">
                  <div className="tr-col">
                    <div className="tr-col-title">SELLING</div>
                    <div className="tr-items">
                      {t.offerItems.map((it, i) => <ItemThumb key={i} item={it} />)}
                    </div>
                  </div>
                  <div className="tr-swap">⇄</div>
                  <div className="tr-col">
                    <div className="tr-col-title">WANTING</div>
                    {t.wantItems && t.wantItems.length > 0 ? (
                      <div className="tr-items">
                        {t.wantItems.map((it, i) => <ItemThumb key={i} item={it} />)}
                      </div>
                    ) : (
                      <div className="tr-want-text">{t.wantText || 'Open to offers'}</div>
                    )}
                  </div>
                </div>

                <div className="tr-card-foot">
                  <button className="cf-view-btn" onClick={() => setExpanded((p) => ({ ...p, [t.id]: !p[t.id] }))}>
                    Offers ({(t.offers || []).length}) {isOpen ? '▴' : '▾'}
                  </button>
                  {!isMine && !myOffer && (
                    <button
                      className="cf-join-btn"
                      onClick={() => { setOfferTrade(t); setOfferSel([]); }}
                    >
                      Make Offer
                    </button>
                  )}
                  {!isMine && myOffer && <span className="tr-your-offer">Offer sent ✓</span>}
                </div>

                {isOpen && (
                  <div className="tr-offers">
                    {(t.offers || []).length === 0 && (
                      <div className="tr-no-offers">No offers yet — be the first!</div>
                    )}
                    {(t.offers || []).map((o) => (
                      <div key={o.id} className="tr-offer">
                        <img
                          src={o.avatar || '/default-avatar.png'}
                          alt={o.username}
                          className="tr-offer-avatar"
                          onError={(e) => { e.target.src = '/default-avatar.png'; }}
                        />
                        <div className="tr-offer-body">
                          <div className="tr-offer-head">
                            <span className="tr-offer-name">{o.username}</span>
                            <span className="tr-offer-val"><Icon name="diamond" size={11} /> {Number(o.value || 0).toLocaleString()}</span>
                          </div>
                          <div className="tr-items">
                            {o.items.map((it, i) => <ItemThumb key={i} item={it} />)}
                          </div>
                        </div>
                        {isMine && (
                          <div className="tr-offer-actions">
                            <button className="cf-confirm-btn sm" onClick={() => decideOffer(t.id, o.id, 'accept')} disabled={busy}>
                              Accept
                            </button>
                            <button className="cf-view-btn" onClick={() => decideOffer(t.id, o.id, 'decline')} disabled={busy}>
                              Decline
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Offer picker modal */}
      {offerTrade && (
        <ModalPortal>
        <div className="cf-modal-overlay" onClick={() => setOfferTrade(null)}>
          <div className="cf-modal cf-join-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cf-modal-close" onClick={() => setOfferTrade(null)}>×</button>
            <div className="cf-join-content">
              <div className="cf-join-left">
                <div className="cf-join-vs-head">
                  <span className="cf-join-vs-label">OFFERING TO</span>
                  <div className="cf-join-vs-user">
                    <img
                      src={offerTrade.creatorAvatar || '/default-avatar.png'}
                      alt={offerTrade.creatorUsername}
                      className="cf-join-vs-avatar"
                      onError={(e) => { e.target.src = '/default-avatar.png'; }}
                    />
                    <div className="cf-join-vs-meta">
                      <span className="cf-join-vs-name">{offerTrade.creatorUsername}</span>
                    </div>
                  </div>
                </div>
                <div className="cf-join-bet-items">
                  <div className="cf-join-bet-items-title">THEIR PETS</div>
                  <div className="cf-join-bet-items-list">
                    {offerTrade.offerItems.map((it, i) => (
                      <div key={i} className="cf-join-bet-item">
                        <img
                          src={it.image || it.imageUrl || '/default-item.png'}
                          alt=""
                          className="cf-join-bet-item-img"
                          onError={(e) => { e.target.src = '/default-item.png'; }}
                        />
                        <span className="cf-join-bet-item-name">{it.name || it.itemName}</span>
                        <span className="cf-join-bet-item-val"><Icon name="diamond" size={11} /> {itemVal(it).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="cf-join-bet-items">
                  <div className="cf-join-bet-items-title">YOUR OFFER ({offerSel.length})</div>
                  <div className="cf-join-bet-items-list">
                    {offerSel.length === 0 && <div className="cf-join-no-items">Pick pets on the right</div>}
                    {offerSel.map((s) => {
                      const it = inventory.find((i) => (i.itemId || i.id) === s.itemId) || s;
                      return (
                        <div key={s.itemId} className="cf-join-bet-item">
                          <img
                            src={it.image || it.imageUrl || '/default-item.png'}
                            alt=""
                            className="cf-join-bet-item-img"
                            onError={(e) => { e.target.src = '/default-item.png'; }}
                          />
                          <span className="cf-join-bet-item-name">{it.name || it.itemName}</span>
                          <span className="cf-join-bet-item-val"><Icon name="diamond" size={11} /> {Number(it.value || 0).toLocaleString()}</span>
                          <button className="cf-bet-item-x" onClick={() => toggleOffer({ itemId: s.itemId })}>×</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="cf-join-right">
                <div className="cf-join-inv-header"><span>Your Pets — click to add, click again to remove</span></div>
                <div className="cf-join-inv-grid">
                  {inventory.length === 0 && <div className="cf-join-no-items">Your inventory is empty</div>}
                  {inventory.map((item) => {
                    const id = item.itemId || item.id;
                    const added = offerSel.some((s) => s.itemId === id);
                    return (
                      <div key={id} className={`cf-inv-tile ${added ? 'selected' : ''}`} onClick={() => toggleOffer(item)}>
                        <img
                          src={item.image || item.imageUrl || '/default-item.png'}
                          alt=""
                          className="cf-inv-img"
                          onError={(e) => { e.target.src = '/default-item.png'; }}
                        />
                        <div className="cf-inv-name">{item.name || item.itemName}</div>
                        <ModBadges mods={item.mods} size={14} />
                        <div className="cf-inv-val"><Icon name="diamond" size={10} />{Number(item.value || 0).toLocaleString()}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="cf-join-bottom">
              <div className="cf-join-bottom-left">
                <span className="cf-join-selected-info">{offerSel.length} pets in offer</span>
              </div>
              <div className="cf-join-bottom-right">
                <button className="cf-join-action-btn" onClick={() => setOfferTrade(null)}>Cancel</button>
                <button className="cf-confirm-btn" onClick={sendOffer} disabled={busy || offerSel.length === 0}>
                  {busy ? 'Sending...' : 'Send Offer'}
                </button>
              </div>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default TradingPage;
