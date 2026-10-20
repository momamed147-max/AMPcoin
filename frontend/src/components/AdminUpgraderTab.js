import React, { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import { API_BASE } from '../apiConfig';
import './AdminUpgraderTab.css';

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const json = () => ({ 'Content-Type': 'application/json', ...auth() });
const units = (st) => (Array.isArray(st) ? st : []).reduce((s, i) => s + (Number(i.quantity) || 1), 0);
const worth = (st) => (Array.isArray(st) ? st : [])
  .reduce((s, i) => s + (Number(i.value) || 0) * (Number(i.quantity) || 1), 0);

/**
 * Admin tab for the Upgrader: fill the shelf that player payouts are paid
 * from. Losing pots land back here too, so it refills itself over time.
 */
const AdminUpgraderTab = () => {
  const [stock, setStock] = useState([]);
  const [mine, setMine] = useState([]);
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, me] = await Promise.all([
        fetch(`${API_BASE}/api/upgrader/stock`, { headers: auth() }),
        fetch(`${API_BASE}/api/users/inventory`, { headers: auth() })
      ]);
      if (s.ok) {
        const d = await s.json();
        setStock(Array.isArray(d.stock) ? d.stock : []);
      }
      if (me.ok) {
        const d = await me.json();
        setMine(Array.isArray(d) ? d : d.items || []);
      }
    } catch {
      setMsg({ type: 'error', text: 'Could not load upgrader stock' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const bump = (itemId, n, max) => setSel((p) => {
    const next = Math.max(0, Math.min(max, (p[itemId] || 0) + n));
    const c = { ...p };
    if (next > 0) c[itemId] = next; else delete c[itemId];
    return c;
  });

  const chosen = mine.filter((i) => (sel[i.itemId || i.id] || 0) > 0);
  const chosenWorth = chosen.reduce((s, i) => s + (Number(i.value) || 0) * (sel[i.itemId || i.id] || 0), 0);
  // Payouts are a fraction of the pot, so a shelf of only expensive pets cannot
  // pay a normal upgrade. Surfacing this here stops the game looking broken.
  const cheapest = stock.reduce((m, i) => {
    const v = Number(i.value) || 0;
    return v > 0 && v < m ? v : m;
  }, Infinity);
  const cheapestVal = Number.isFinite(cheapest) ? cheapest : 0;

  const addToStock = async () => {
    if (!chosen.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/upgrader/stock`, {
        method: 'POST', headers: json(),
        body: JSON.stringify({
          selectedItems: chosen.map((i) => ({
            itemId: i.itemId || i.id, name: i.name, value: i.value, quantity: sel[i.itemId || i.id]
          }))
        })
      });
      const d = await res.json();
      if (!res.ok) setMsg({ type: 'error', text: d.message || 'Failed to add to stock' });
      else {
        setSel({});
        setMsg({ type: 'success', text: `Added ${chosen.length} stack(s) to the upgrader` });
        await load();
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aut">
      <div className="aut-head">
        <h3>Upgrader Stock</h3>
        <p className="aut-sub">
          These pets pay out the upgrades. A player who loses their pot drops it back here,
          so the shelf refills on its own — keep it topped up so wins can actually be paid in full.
        </p>
      </div>

      <div className="aut-stats">
        <div className="aut-stat"><span>Units on the shelf</span><strong>{units(stock)}</strong></div>
        <div className="aut-stat"><span>Worth</span><strong><Icon name="diamond" size={14} /> {worth(stock).toLocaleString()}</strong></div>
        <div className="aut-stat"><span>Distinct pets</span><strong>{stock.length}</strong></div>
        <div className="aut-stat">
          <span>Cheapest pet</span>
          <strong>{cheapestVal ? <><Icon name="diamond" size={14} /> {cheapestVal.toLocaleString()}</> : 'none'}</strong>
        </div>
      </div>

      {cheapestVal > 20000 && (
        <div className="aut-msg error">
          Every pet on the shelf is worth {cheapestVal.toLocaleString()} or more. Bonus payouts are a
          fraction of the pot, so most upgrades will be refused as unpayable. Stock some cheaper pets.
        </div>
      )}

      {msg && <div className={`aut-msg ${msg.type}`}>{msg.text}</div>}

      <div className="aut-cols">
        <div className="aut-col">
          <h4>Your inventory <span className="aut-count">{chosen.length ? `${units(chosen.map((i) => ({ quantity: sel[i.itemId || i.id] })))} selected` : ''}</span></h4>
          <div className="aut-list">
            {mine.length === 0 && <div className="aut-empty">You have no pets to stock with.</div>}
            {mine.map((i) => {
              const id = i.itemId || i.id;
              const avail = Number(i.quantity) || 1;
              return (
                <div key={id} className={`aut-row ${sel[id] ? 'picked' : ''}`}>
                  <img className="aut-img" src={i.image || i.imageUrl || '/default-item.svg'} alt=""
                    onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                  <div className="aut-row-body">
                    <span className="aut-name">{i.name || i.itemName}</span>
                    <span className="aut-val"><Icon name="diamond" size={10} /> {Number(i.value || 0).toLocaleString()}</span>
                  </div>
                  <div className="aut-stepper">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => bump(id, -1, avail)} disabled={!sel[id]}>-</button>
                    <span className={sel[id] ? 'on' : ''}>{sel[id] || 0}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => bump(id, 1, avail)} disabled={(sel[id] || 0) >= avail}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="aut-total">
            <span>Selected worth</span>
            <span><Icon name="diamond" size={13} /> {chosenWorth.toLocaleString()}</span>
          </div>
          <button className="aut-btn" onClick={addToStock} disabled={busy || !chosen.length}>
            {busy ? 'Adding...' : 'Add to upgrader stock'}
          </button>
        </div>

        <div className="aut-col">
          <h4>Currently on the shelf <span className="aut-count">{units(stock)} units</span></h4>
          <div className="aut-list">
            {stock.length === 0 && (
              <div className="aut-empty">
                The shelf is empty — no upgrade can be paid out until you stock it.
              </div>
            )}
            {stock.map((i, idx) => (
              <div key={`${i.itemId}-${idx}`} className="aut-row shelf">
                <img className="aut-img" src={i.image || i.imageUrl || '/default-item.svg'} alt=""
                  onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                <div className="aut-row-body">
                  <span className="aut-name">{i.name}</span>
                  <span className="aut-val"><Icon name="diamond" size={10} /> {Number(i.value || 0).toLocaleString()}</span>
                </div>
                <span className="aut-qty">x{Number(i.quantity) || 1}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminUpgraderTab;
