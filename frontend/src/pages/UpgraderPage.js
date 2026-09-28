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
function landingPoint(chance, won, nudge = 0) {
  const green = Math.max(1, Math.min(CELLS - 1, Math.round((chance / 100) * CELLS)));
  const cells = [];
  for (let i = 0; i < CELLS; i++) cells.push(i < green);
  const wanted = cells.map((g, i) => (g === won ? i : -1)).filter((i) => i >= 0);
  if (!wanted.length) return 50;
  const pick = wanted[Math.floor(((won ? green : CELLS - green) * 0.5 + nudge) % wanted.length)];
  return ((pick + 0.5) / CELLS) * 100;
}

function ItemRow({ item, value, max, onChange, onReset, dimmed }) {
  const [qty, setQty] = useState(0);
  useEffect(() => { setQty(Math.min(max, value)); /* eslint-disable-line */ }, [value, max]);
  const avail = Number(item.quantity) || 1;
  const step = (n) => setQty((q) => Math.max(0, Math.min(avail, q + n)));
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
        <span className="ug-item-val"><Icon name="diamond" size={11} /> {(Number(item.value) || 0).toLocaleString()}</span>
        <ModBadges mods={item.mods || item.variantMods} />
      </div>
      <div className="ug-stepper">
        <button type="button" onClick={() => step(-1)} disabled={qty <= 0}>-</button>
        <span className={qty > 0 ? 'on' : ''}>{qty}</span>
        <button type="button" onClick={() => step(1)} disabled={qty >= avail}>+</button>
      </div>
      {qty > 0 && (
        <button type="button" className="ug-item-clear" onClick={() => { setQty(0); onReset(item.itemId || item.id); }}>x</button>
      )}
    </div>
  );
}

const UpgraderPage = ({ socket }) => {
  const [stock, setStock] = useState([]);
  const [stockUnits, setStockUnits] = useState(0);
  const [inventory, setInventory] = useState([]);
  const [potSel, setPotSel] = useState({});   // itemId -> qty (your pets at risk)
  const [upSel, setUpSel] = useState({});    // itemId -> qty (from the house shelf)
  const [chance, setChance] = useState(45);
  const [taxRate, setTaxRate] = useState(0);
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

  const MAX = 60;
  const served = Math.min(MAX, Math.max(1, Number(chance) || 1));
  // Mirrors the server: chance x (1 + bonus x (1 - tax)) = 0.9, so the live
  // preview is what the player actually gets, tax included.
  const keep = Math.max(1 - (taxRate || 0), 0.05);
  const bonus = served > 0 ? (0.9 / (served / 100) - 1) / keep : 0;
  const totalMultiplier = 1 + bonus;
  const targetValue = potValue * bonus;
  const capped = Number(chance) > MAX;

  const greenCells = Math.max(1, Math.min(CELLS - 1, Math.round((served / 100) * CELLS)));
  const cells = useMemo(
    () => Array.from({ length: CELLS }, (_, i) => i < greenCells),
    [greenCells]
  );

  const busyRound = busy || phase === 'spinning';
  const canStart = potItems.length > 0 && upItems.length > 0 && potValue > 0 && served > 0 && upValue >= targetValue && !busyRound;
  const upgradeShort = upItems.length > 0 && upValue < targetValue;
  // The server pays the single cheapest shelf pet when the bonus is smaller than
  // anything on offer, but refuses if that would overshoot by too much.
  const cheapestShelf = stock.reduce((m, i) => {
    const v = Number(i.value) || 0;
    return v > 0 && v < m ? v : m;
  }, Infinity);
  const shelfTooCoarse = potValue > 0 && Number.isFinite(cheapestShelf) && cheapestShelf > targetValue * 1.25;

  /** Sweep the arrow across the battery and let it settle on the real outcome. */
  const runWheel = useCallback((won, chancePercent, duration = 4200) => {
    cancelAnimationFrame(rafRef.current);
    const target = landingPoint(chancePercent, won);
    const start = performance.now();
    // ease-out-quint: a hard launch that bleeds off, like a real gauge needle
    const ease = (t) => 1 - Math.pow(1 - t, 5);
    const steps = (t) => {
      const e = ease(t);
      // sweep out past the far end first, so it reads as a throw rather than a slide
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
        body: JSON.stringify({ potItems, upgradeeItems: upItems, targetPercent: chance })
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

      await new Promise((r2) => setTimeout(r2, 4600));
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
          ? `Upgraded! ${claimed.potValue.toLocaleString()} AMP came back plus ${claimed.payoutValue.toLocaleString()} more.`
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
            <div className="ug-readout">
              <div className="ug-readout-row">
                <span className="ug-label">Win chance</span>
                <span className={`ug-chance ${capped ? 'capped' : ''}`}>{served}%</span>
              </div>
              <input
                type="range" className="ug-slider" min={5} max={70} step={5}
                value={chance} disabled={busyRound}
                onChange={(e) => setChance(Number(e.target.value))}
              />
              {capped && <div className="ug-cap-note">Capped at {MAX}% — that is the most you can be offered.</div>}
              <div className="ug-readout-row ug-multi-row">
                <span className="ug-label">Win returns</span>
                <span className="ug-mult">{totalMultiplier.toFixed(2)}x</span>
              </div>
              <div className="ug-target">
                Risk <strong>{potValue.toLocaleString()}</strong>. A win gets it back plus{' '}
                <strong>{targetValue.toLocaleString()}</strong> upgraded
                {taxRate > 0 && <span className="ug-tax"> (tax applies to the upgrade)</span>}
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
                <span className="ug-end win">Get {totalMultiplier.toFixed(2)}x back</span>
              </div>
            </div>

            <div className="ug-verdict">
              {phase === 'spinning' && <span className="ug-dots"><span /><span /><span /></span>}
              {phase === 'done' && result && (
                result.won
                  ? <span className="ug-verdict-win">
                    <Icon name="trophy" size={17} />
                    {result.potValue.toLocaleString()} back + {result.payoutValue.toLocaleString()} upgraded
                  </span>
                  : <span className="ug-verdict-lose"><Icon name="close" size={17} /> Lost {result.potValue.toLocaleString()} AMP</span>
              )}
              {phase === 'idle' && !round && <span className="ug-idle">Stage your pets and an upgrade, then hit Upgrade.</span>}
              {round && phase !== 'done' && <span className="ug-idle">Upgrade in progress...</span>}
            </div>

            {result && phase === 'done' && (
              <div className="ug-result-detail">
                {result.won ? (
                  <>
                    <span>Your <strong>{result.potValue.toLocaleString()}</strong> came back</span>
                    <span className="ug-plus">+ {result.payoutValue.toLocaleString()} upgraded</span>
                    <div className="ug-gain-list">
                      {(result.payout || []).map((p, i) => (
                        <span key={i} className="ug-gain">
                          {p.image && <img src={p.image} alt="" onError={(e) => { e.target.style.visibility = 'hidden'; }} />}
                          {p.name}{p.quantity > 1 ? ` x${p.quantity}` : ''}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <span className="ug-loss-note">Your pets went onto the upgrader's shelf. Try again.</span>
                )}
              </div>
            )}

            {shelfTooCoarse && (
              <div className="ug-short-note">
                The smallest pet on the shelf is worth {cheapestShelf.toLocaleString()}, too much to pay a{' '}
                {Math.round(targetValue).toLocaleString()} upgrade. Raise your win chance, or ask an admin
                to stock smaller pets.
              </div>
            )}

            <button className="ug-btn" disabled={!canStart || shelfTooCoarse} onClick={startUpgrade}>
              {busyRound ? 'Upgrading...' : 'Upgrade'}
            </button>
            <div className="ug-hint">
              A win returns better pets than you put in. A loss loses the pot outright.
              House edge 10%, tax applies to the payout.
            </div>
          </div>

          {/* ── what you are risking ── */}
          <div className="ug-panel">
            <h3>Your pets <span className="ug-count">{potItems.length ? `${potItems.length} picked` : ''}</span></h3>
            <p className="ug-panel-sub">These are at risk. On a win they come back upgraded.</p>
            <div className="ug-list">
              {inventory.length === 0 && <div className="ug-empty">No pets in your inventory.</div>}
              {inventory.map((i) => (
                <ItemRow
                  key={i.itemId || i.id} item={i}
                  value={potSel[i.itemId || i.id] || 0} max={Number(i.quantity) || 1}
                  onChange={setQty(setPotSel)} onReset={setQty(setPotSel)}
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
            <h3>Upgrade <span className="ug-count">{stockUnits} on the shelf</span></h3>
            <p className="ug-panel-sub">
              {potValue > 0
                ? <>A {served}% win pays <strong>{targetValue.toLocaleString()}</strong>, so pick at least that much.</>
                : 'Taken from the upgrader stock when you start.'}
            </p>
            <div className="ug-list">
              {stock.length === 0 && <div className="ug-empty">The upgrader is out of stock. Ask an admin to fill it.</div>}
              {stock.map((i) => {
                const total = Number(i.value) * (Number(i.quantity) || 1);
                const tooSmall = potValue > 0 && total < targetValue;
                return (
                  <ItemRow
                    key={i.itemId} item={i}
                    value={upSel[i.itemId] || 0} max={Number(i.quantity) || 1}
                    onChange={setQty(setUpSel)} onReset={setQty(setUpSel)}
                    dimmed={tooSmall}
                  />
                );
              })}
            </div>
            <div className="ug-total">
              <span>Selected upgrade</span>
              <span className={upgradeShort ? 'short' : ''}>
                <Icon name="diamond" size={13} /> {upValue.toLocaleString()}
                {upgradeShort && ` / ${targetValue.toLocaleString()} needed`}
              </span>
            </div>
            {upgradeShort && (
              <div className="ug-short-note">
                Too small to cover the multiplier. Pick more, or lower your chance.
              </div>
            )}
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
                  {h.chance}% chance @ {Number(h.totalMultiplier || (1 + Number(h.multiplier || 0))).toFixed(2)}x
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
