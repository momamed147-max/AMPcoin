import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AnimatedPopup from '../components/AnimatedPopup';
import { CoinLoader } from '../components/CoinChip';
import '../components/CoinChip.css';
import Icon from '../components/Icon';
import ModBadges from '../components/ModBadges';
import '../components/ModBadges.css';
import { API_BASE } from '../apiConfig';
import { playBetPlaced } from '../sound';
import './UpgraderPage.css';

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const json = () => ({ 'Content-Type': 'application/json', ...auth() });

const stackValue = (it) => (Number(it.value) || 0) * (Number(it.quantity) || 1);
const CELLS = 40; // battery segments

/**
 * Where the arrow stops, as a fraction of the track.
 * The server has already decided the round, so the arrow is aimed at a cell of
 * the matching colour rather than being left to decide the outcome.
 */
function landingPoint(chance, won) {
  const green = Math.max(1, Math.min(CELLS - 1, Math.round((chance / 100) * CELLS)));
  const cells = [];
  for (let i = 0; i < CELLS; i++) cells.push(i < green);
  const wanted = cells.map((g, i) => (g === won ? i : -1)).filter((i) => i >= 0);
  if (!wanted.length) return 50;
  const pick = wanted[Math.floor(wanted.length / 2)];
  return ((pick + 0.5) / CELLS) * 100;
}

// Quantity lives in the PARENT, not here. Holding it locally meant the parent
// never learned what was picked, so the pot stayed at zero and the Upgrade
// button never became usable.
function ItemRow({ item, value, max, onChange, dimmed }) {
  const avail = Number(item.quantity) || 1;
  const id = item.itemId || item.id;
  const qty = Math.min(Number(value) || 0, avail);
  const step = (n) => onChange(id, Math.max(0, Math.min(avail, qty + n)));
  return (
    <div className={`ug-item ${qty > 0 ? 'picked' : ''} ${dimmed ? 'dimmed' : ''}`}>
      <img
        className="ug-item-img"
        src={item.image || item.imageUrl || '/default-item.png'}
        alt=""
        onError={(e) => { e.target.style.visibility = 'hidden'; }}
      />
      <div className="ug-item-body">
        <span className="ug-item-name">{item.name || item.itemName}</span>
        <span className="ug-item-val"><Icon name="diamond" size={11} /> {(Number(item.value) || 0).toLocaleString()} each</span>
        <ModBadges mods={item.mods || item.variantMods} />
      </div>
      <div className="ug-stepper">
        <button type="button" onClick={() => step(-1)} disabled={qty <= 0} aria-label="fewer">-</button>
        <span className={qty > 0 ? 'on' : ''}>{qty}</span>
        <button type="button" onClick={() => step(1)} disabled={qty >= avail} aria-label="more">+</button>
      </div>
      {qty > 0 && (
        <button type="button" className="ug-item-clear" onClick={() => onChange(id, 0)} aria-label="clear">x</button>
      )}
    </div>
  );
}

const UpgraderPage = ({ socket }) => {
  const [stock, setStock] = useState([]);
  const [stockUnits, setStockUnits] = useState(0);
  const [minMultiplier, setMinMultiplier] = useState(1.5);
  const [houseEdge, setHouseEdge] = useState(0.1);
  const [taxRate, setTaxRate] = useState(0);
  const [inventory, setInventory] = useState([]);
  const [potSel, setPotSel] = useState({});   // itemId -> qty (your pets at risk)
  const [upSel, setUpSel] = useState({});    // itemId -> qty (from the house shelf)
  const [round, setRound] = useState(null);
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | spinning | done
  const [arrow, setArrow] = useState(50);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState({ show: false, message: '', type: 'info' });
  const [activeTab, setActiveTab] = useState('play');
  const [history, setHistory] = useState([]);
  const rafRef = useRef(0);

  const say = (message, type = 'info') => setPopup({ show: true, message, type });

  const loadState = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/upgrader/state`, { headers: auth() });
      if (res.ok) {
        const d = await res.json();
        setStock(Array.isArray(d.stock) ? d.stock : []);
        setStockUnits(d.stockUnits || 0);
        setHistory(Array.isArray(d.history) ? d.history : []);
        setTaxRate(d.taxRate || 0);
        if (typeof d.houseEdge === 'number') setHouseEdge(d.houseEdge);
        if (typeof d.minMultiplier === 'number') setMinMultiplier(d.minMultiplier);
        if (d.active && ['pending', 'spinning'].includes(d.active.status)) setRound(d.active);
        else if (!result) setRound(null);
      }
    } catch { /* the banner below covers it */ }
  }, [result]);

  const loadInventory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users/inventory`, { headers: auth() });
      if (res.ok) {
        const d = await res.json();
        setInventory(Array.isArray(d) ? d : d.items || []);
      }
    } catch { /* shown as an empty inventory */ }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadState(), loadInventory()]);
      setLoading(false);
    })();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => { loadState(); loadInventory(); };
    socket.on('upgraderUpdate', refresh);
    socket.on('inventoryUpdate', refresh);
    return () => {
      socket.off('upgraderUpdate', refresh);
      socket.off('inventoryUpdate', refresh);
    };
  }, [socket, loadState, loadInventory]);

  const potItems = useMemo(
    () => inventory.filter((i) => (potSel[i.itemId || i.id] || 0) > 0)
      .map((i) => ({ itemId: i.itemId || i.id, name: i.name, value: i.value, quantity: potSel[i.itemId || i.id] })),
    [inventory, potSel]
  );
  const upItems = useMemo(
    () => stock.filter((i) => (upSel[i.itemId] || 0) > 0)
      .map((i) => ({ itemId: i.itemId, name: i.name, value: i.value, quantity: upSel[i.itemId] })),
    [stock, upSel]
  );

  const potValue = potItems.reduce((s, i) => s + stackValue(i), 0);
  const upValue = upItems.reduce((s, i) => s + stackValue(i), 0);

  // ── the odds follow the selection, exactly as the server computes them ──
  const returnPct = (1 - houseEdge) * 100;         // 90
  const multiplier = potValue > 0 ? upValue / potValue : 0;
  const rawChance = multiplier > 0 ? returnPct / multiplier : 0;
  const chance = Math.min(60, rawChance);
  const capped = rawChance > 60;
  const tooSmall = potValue > 0 && upValue > 0 && multiplier < minMultiplier;

  const greenCells = Math.max(1, Math.min(CELLS - 1, Math.round((chance / 100) * CELLS)));
  const cells = useMemo(
    () => Array.from({ length: CELLS }, (_, i) => i < greenCells),
    [greenCells]
  );

  const busyRound = busy || phase === 'spinning';
  const canStart = potItems.length > 0 && upItems.length > 0 && potValue > 0 && !tooSmall && !busyRound;

  /** Sweep the arrow across the battery and let it settle on the real outcome. */
  const runWheel = useCallback((won, chancePercent, duration = 4200) => {
    cancelAnimationFrame(rafRef.current);
    const target = landingPoint(chancePercent, won);
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 5);
    const steps = (t) => {
      const e = ease(t);
      const overshoot = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 26;
      const back = t < 0.06 ? (t / 0.06) * (target - 50) : 0;
      setArrow(50 + (target - 50 + overshoot + back) * e);
      if (t < 1) rafRef.current = requestAnimationFrame(() => steps((performance.now() - start) / duration));
      else setArrow(target);
    };
    rafRef.current = requestAnimationFrame(() => steps(0));
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const startUpgrade = async () => {
    if (!canStart) return;
    setBusy(true);
    setResult(null);
    try {
      const made = await fetch(`${API_BASE}/api/upgrader/round`, {
        method: 'POST', headers: json(),
        body: JSON.stringify({ potItems, upgradeeItems: upItems })
      });
      const r = await made.json();
      if (!made.ok) return say(r.message || 'Could not start the upgrade', 'error');

      setRound(r);
      playBetPlaced();
      setPhase('spinning');
      setArrow(50);

      // The outcome is decided and saved server-side before we animate anything.
      const rolledRes = await fetch(`${API_BASE}/api/upgrader/round/${r.id}/roll`, {
        method: 'POST', headers: json(), body: '{}'
      });
      const rolled = await rolledRes.json();
      if (!rolledRes.ok) return say(rolled.message || 'Could not roll', 'error');

      runWheel(rolled.won, rolled.chance);

      await new Promise((res) => setTimeout(res, 4600));
      const claimRes = await fetch(`${API_BASE}/api/upgrader/round/${r.id}/claim`, {
        method: 'POST', headers: json(), body: '{}'
      });
      const claimed = await claimRes.json();
      if (!claimRes.ok) return say(claimed.message || 'Could not settle', 'error');

      setResult(claimed);
      setPhase('done');
      setPotSel({});
      setUpSel({});
      await Promise.all([loadInventory(), loadState()]);
      setRound(null);
      say(
        claimed.won
          ? `Upgraded! ${claimed.potValue.toLocaleString()} AMP became ${claimed.payoutValue.toLocaleString()} AMP.`
          : `Upgrade failed. You lost ${claimed.potValue.toLocaleString()} AMP.`,
        claimed.won ? 'success' : 'error'
      );
    } catch {
      say('Something went wrong', 'error');
      setPhase('done');
    } finally {
      setBusy(false);
    }
  };

  const setQty = (setter) => (itemId, qty) => setter((prev) => {
    const next = { ...prev };
    if (qty > 0) next[itemId] = qty; else delete next[itemId];
    return next;
  });

  if (loading) {
    return <div className="ug-page"><div className="ug-loading"><CoinLoader size={84} label="Loading upgrader..." /></div></div>;
  }

  return (
    <div className="ug-page">
      <AnimatedPopup
        show={popup.show} message={popup.message} type={popup.type}
        onClose={() => setPopup({ show: false, message: '', type: 'info' })}
      />

      <div className="ug-tabs">
        <button className={`ug-tab ${activeTab === 'play' ? 'active' : ''}`} onClick={() => setActiveTab('play')}>
          <Icon name="jackpot" size={15} /> Upgrade
        </button>
        <button className={`ug-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <Icon name="board" size={15} /> History
        </button>
      </div>

      {activeTab === 'play' ? (
        <div className="ug-grid">
          {/* ── the battery gauge ── */}
          <div className="ug-stage">
            <div className="ug-odds">
              <div className="ug-odds-col">
                <span className="ug-label">You risk</span>
                <strong className="ug-big">{potValue.toLocaleString()}</strong>
              </div>
              <span className="ug-arrow-sep">&rarr;</span>
              <div className="ug-odds-col">
                <span className="ug-label">You get back</span>
                <strong className="ug-big win">{upValue.toLocaleString()}</strong>
              </div>
            </div>

            <div className="ug-derived">
              <div className="ug-derived-row">
                <span className="ug-label">Multiplier</span>
                <span className="ug-mult">{multiplier > 0 ? `${multiplier.toFixed(2)}x` : '--'}</span>
              </div>
              <div className="ug-derived-row">
                <span className="ug-label">Win chance</span>
                <span className="ug-chance">{chance > 0 ? `${chance.toFixed(2)}%` : '--'}</span>
              </div>
              <div className="ug-formula">
                {multiplier > 0
                  ? `${returnPct} ÷ ${multiplier.toFixed(2)} = ${rawChance.toFixed(2)}%`
                  : `${returnPct} ÷ your multiplier`}
                {capped && <span className="ug-cap-note"> capped at 60%</span>}
              </div>
            </div>

            <div className={`ug-battery ${phase === 'spinning' ? 'spinning' : ''} ${result ? (result.won ? 'won' : 'lost') : ''}`}>
              <div className="ug-battery-track">
                {cells.map((green, i) => (
                  <span key={i} className={`ug-cell ${green ? 'green' : 'red'}`} />
                ))}
                <span className="ug-fill" style={{ width: `${arrow}%` }} />
                <span className="ug-arrow" style={{ left: `${arrow}%` }} aria-hidden="true" />
              </div>
              <div className="ug-battery-ends">
                <span className="ug-end lose">Lose everything</span>
                <span className="ug-end win">{chance > 0 ? `${chance.toFixed(2)}% to ${multiplier.toFixed(2)}x` : 'Pick your items'}</span>
              </div>
            </div>

            <div className="ug-verdict">
              {phase === 'spinning' && <span className="ug-dots"><span /><span /><span /></span>}
              {phase === 'done' && result && (
                result.won
                  ? <span className="ug-verdict-win"><Icon name="trophy" size={17} /> Upgraded to {result.payoutValue.toLocaleString()} AMP</span>
                  : <span className="ug-verdict-lose"><Icon name="close" size={17} /> Lost {result.potValue.toLocaleString()} AMP</span>
              )}
              {phase === 'idle' && !round && <span className="ug-idle">Pick the pets you risk and the pets you want back.</span>}
              {round && phase !== 'done' && <span className="ug-idle">Upgrade in progress...</span>}
            </div>

            {result && phase === 'done' && (
              <div className="ug-result-detail">
                {result.won ? (
                  <>
                    <span className="ug-plus">{result.potValue.toLocaleString()} became {result.payoutValue.toLocaleString()}</span>
                    <div className="ug-gain-list">
                      {(result.payout || []).map((x, i) => (
                        <span key={i} className="ug-gain">
                          {x.image && <img src={x.image} alt="" onError={(e) => { e.target.style.visibility = 'hidden'; }} />}
                          {x.name}{x.quantity > 1 ? ` x${x.quantity}` : ''}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <span className="ug-loss-note">Your pets went onto the upgrader's shelf. Try again.</span>
                )}
              </div>
            )}

            {tooSmall && (
              <div className="ug-short-note">
                {multiplier.toFixed(2)}x needs {rawChance.toFixed(1)}% to win, but the maximum is 60%.
                Pick pets worth at least {(potValue * minMultiplier).toLocaleString()}.
              </div>
            )}

            <button className="ug-btn" disabled={!canStart} onClick={startUpgrade}>
              {busyRound ? 'Upgrading...' : 'Upgrade'}
            </button>
            <div className="ug-hint">
              Your {potValue > 0 ? `${multiplier.toFixed(2)}x ` : ''}upgrade pays
              {chance > 0 ? ` ${chance.toFixed(2)}% of the time` : ''}. House edge {Math.round(houseEdge * 100)}%,
              tax {Math.round(taxRate * 100)}% applies to the payout.
            </div>
          </div>

          {/* ── what you are risking ── */}
          <div className="ug-panel">
            <h3>Your pets <span className="ug-count">{potItems.length ? `${potItems.length} picked` : ''}</span></h3>
            <p className="ug-panel-sub">These are at risk. On a win they are swapped for the upgrade.</p>
            <div className="ug-list">
              {inventory.length === 0 && <div className="ug-empty">No pets in your inventory.</div>}
              {inventory.map((i) => (
                <ItemRow
                  key={i.itemId || i.id} item={i}
                  value={potSel[i.itemId || i.id] || 0} max={Number(i.quantity) || 1}
                  onChange={setQty(setPotSel)}
                />
              ))}
            </div>
            <div className="ug-total">
              <span>Total at risk</span>
              <span><Icon name="diamond" size={13} /> {potValue.toLocaleString()}</span>
            </div>
          </div>

          {/* ── what you win ── */}
          <div className="ug-panel">
            <h3>You get back <span className="ug-count">{stockUnits} on the shelf</span></h3>
            <p className="ug-panel-sub">
              {potValue > 0
                ? <>Needs {(potValue * minMultiplier).toLocaleString()} or more ({minMultiplier}x) to be playable.</>
                : 'Taken from the upgrader stock when you start.'}
            </p>
            <div className="ug-list">
              {stock.length === 0 && <div className="ug-empty">The upgrader is out of stock. Ask an admin to fill it.</div>}
              {stock.map((i) => (
                <ItemRow
                  key={i.itemId} item={i}
                  value={upSel[i.itemId] || 0} max={Number(i.quantity) || 1}
                  onChange={setQty(setUpSel)}
                />
              ))}
            </div>
            <div className="ug-total">
              <span>Selected upgrade</span>
              <span><Icon name="diamond" size={13} /> {upValue.toLocaleString()}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="ug-history">
          {history.length === 0 && <div className="ug-empty">No upgrades yet.</div>}
          {history.map((h) => (
            <div key={h.id} className={`ug-history-row ${h.won === null ? 'pending' : h.won ? 'won' : 'lost'}`}>
              <img
                className="ug-history-avatar"
                src={h.avatar || `https://www.roblox.com/headshot-thumbnail/image?userId=${h.userId}&width=100&height=100&format=png`}
                alt=""
                onError={(e) => { e.target.src = '/default-avatar.png'; }}
              />
              <div className="ug-history-body">
                <span className="ug-history-name">{h.username}</span>
                <span className="ug-history-detail">
                  {Number(h.multiplier || 0).toFixed(2)}x at {Number(h.chance || 0).toFixed(2)}%
                  {' · '}
                  <Icon name="diamond" size={10} /> {Number(h.potValue || 0).toLocaleString()}
                </span>
              </div>
              <span className="ug-history-outcome">
                {h.won === null ? 'in progress'
                  : h.won
                    ? `+${Number(h.payoutValue || 0).toLocaleString()}`
                    : `-${Number(h.potValue || 0).toLocaleString()}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UpgraderPage;
