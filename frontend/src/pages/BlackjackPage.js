import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AnimatedPopup from '../components/AnimatedPopup';
import { CoinLoader } from '../components/CoinChip';
import '../components/CoinChip.css';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import { playBetPlaced, playCoinflipJoin } from '../sound';
import './BlackjackPage.css';

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const json = () => ({ 'Content-Type': 'application/json', ...auth() });

const SUIT_CHAR = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const isRed = (suit) => suit === 'hearts' || suit === 'diamonds';
const myId = () => {
  try { return (JSON.parse(localStorage.getItem('user') || '{}').id) || ''; } catch { return ''; }
};

const RESULT_COPY = {
  blackjack: { text: 'Blackjack! Paid 3:2', tone: 'win' },
  win: { text: 'You beat the dealer', tone: 'win' },
  dealer_bust: { text: 'Dealer busts - you win', tone: 'win' },
  push: { text: 'Push - wager returned', tone: 'push' },
  loss: { text: 'Dealer wins the pot', tone: 'loss' },
  bust: { text: 'Bust - the dealer takes the pot', tone: 'loss' }
};

const DEALER_RULE = 'Dealer stands on flat 17 and must hit a soft 17';

function Card({ card, index = 0, hidden, highlight, dimmed }) {
  if (!card) return null;
  if (hidden || card.rank === 'hidden') {
    return <div className="bj-card back" style={{ '--i': index }}><span className="bj-back-mark" /></div>;
  }
  const red = isRed(card.suit);
  return (
    <div
      className={`bj-card face ${red ? 'red' : 'black'} ${highlight ? 'highlight' : ''} ${dimmed ? 'dimmed' : ''}`}
      style={{ '--i': index }}
    >
      <span className="bj-corner tl">{card.rank}<i>{SUIT_CHAR[card.suit]}</i></span>
      <span className="bj-pip">{SUIT_CHAR[card.suit]}</span>
      <span className="bj-corner br">{card.rank}<i>{SUIT_CHAR[card.suit]}</i></span>
    </div>
  );
}

/**
 * A hand, animated.
 *
 * `seq` is bumped by the caller whenever new cards actually land, which
 * restarts the deal animation for the cards already on the table and lets the
 * newest one fly in on its own instead of the whole hand re-dealing.
 */
function Hand({ cards, seq, total, label, sub, hiddenIndex, highlight, dimmed, empty }) {
  const isMe = highlight && highlight.length > 0;
  return (
    <div className="bj-hand-row">
      <div className="bj-hand-label">
        <span className="bj-name">{label}</span>
        {sub && <span className="bj-hand-sub">{sub}</span>}
        <span className={`bj-total ${cards.length ? '' : 'muted'}`}>
          {cards.length ? total : '-'}
        </span>
      </div>
      <div className="bj-cards" key={seq}>
        {cards.length === 0 && <span className="bj-empty-cards">{empty}</span>}
        {cards.map((c, i) => (
          <Card
            key={`${seq}-${i}`}
            card={c}
            index={i}
            hidden={hiddenIndex === i}
            highlight={isMe && highlight.includes(i)}
            dimmed={dimmed && !highlight.includes(i)}
          />
        ))}
      </div>
    </div>
  );
}

/** Quantity lives here, not in the row, so the totals below are never stale. */
function Picker({ items, sel, onChange, max, emptyText }) {
  if (!items.length) return <div className="bj-empty">{emptyText}</div>;
  return (
    <div className="bj-list">
      {items.map((i) => {
        const id = i.itemId || i.id;
        const avail = Number(i.quantity) || 1;
        const qty = sel[id] || 0;
        return (
          <div key={id} className={`bj-item ${qty > 0 ? 'picked' : ''}`}>
            <img
              className="bj-item-img"
              src={i.image || i.imageUrl || '/default-item.png'}
              alt=""
              onError={(e) => { e.target.style.visibility = 'hidden'; }}
            />
            <div className="bj-item-body">
              <span className="bj-item-name">{i.name || i.itemName}</span>
              <span className="bj-item-val">
                <Icon name="diamond" size={11} /> {(Number(i.value) || 0).toLocaleString()} each
              </span>
            </div>
            <div className="bj-stepper">
              <button type="button" onClick={() => onChange(id, qty - 1)} disabled={qty <= 0} aria-label="fewer">-</button>
              <span className={qty > 0 ? 'on' : ''}>{qty}</span>
              <button
                type="button"
                onClick={() => onChange(id, qty + 1)}
                disabled={qty >= avail || (max && qty >= max)}
                aria-label="more"
              >+</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const BlackjackPage = ({ socket }) => {
  const [inventory, setInventory] = useState([]);
  const [tables, setTables] = useState([]);
  const [table, setTable] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('table');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [popup, setPopup] = useState({ show: false, message: '', type: 'info' });

  const [wager, setWager] = useState({});      // the bet I open
  const [joinSel, setJoinSel] = useState({});  // the bet I deal against
  const [joinTarget, setJoinTarget] = useState(null);
  const [showJoin, setShowJoin] = useState(false);

  const [seq, setSeq] = useState(0);  // bumps to replay the deal animation

  const say = (message, type = 'info') => setPopup({ show: true, message, type });

  const loadInventory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users/inventory`, { headers: auth() });
      if (res.ok) {
        const d = await res.json();
        setInventory(Array.isArray(d) ? d : d.items || []);
      }
    } catch { /* shown as an empty inventory */ }
  }, []);

  const loadHistory = useCallback(async () => {
    const uid = myId();
    if (!uid) return;
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/user/${uid}/history`, { headers: auth() });
      if (res.ok) setHistory(await res.json());
    } catch { /* history is optional */ }
  }, []);

  const loadTables = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables`, { headers: auth() });
      if (res.ok) {
        const d = await res.json();
        setTables(Array.isArray(d) ? d : d.tables || []);
      }
    } catch { /* shown as an empty board */ }
  }, []);

  // The table the viewer is actually sitting at, refreshed on its own so the
  // hole card and totals are always the server's, never a guess made locally.
  const loadMyTable = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables`, { headers: auth() });
      if (!res.ok) return;
      const d = await res.json();
      const list = Array.isArray(d) ? d : d.tables || [];
      const uid = myId();
      const mine = list.find(
        (t) => (t.playerSeat && t.playerSeat.id === uid) || (t.dealerSeat && t.dealerSeat.id === uid)
      );
      if (!mine) { setTable(null); return; }
      const one = await fetch(`${API_BASE}/api/blackjack/tables/${mine.id}`, { headers: auth() });
      if (one.ok) setTable(await one.json());
    } catch { /* keep whatever we had */ }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadInventory(), loadTables()]);
      await loadMyTable();
      await loadHistory();
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onTables = () => { loadTables(); loadMyTable(); };
    const onInv = () => loadInventory();
    socket.on('blackjackTables', onTables);
    socket.on('inventoryUpdate', onInv);
    socket.on('balanceUpdate', onInv);
    return () => {
      socket.off('blackjackTables', onTables);
      socket.off('inventoryUpdate', onInv);
      socket.off('balanceUpdate', onInv);
    };
  }, [socket, loadTables, loadMyTable, loadInventory]);

  const buildItems = useCallback((items, sel) => items
    .filter((i) => (sel[i.itemId || i.id] || 0) > 0)
    .map((i) => ({
      itemId: i.itemId || i.id,
      name: i.name,
      value: i.value,
      quantity: sel[i.itemId || i.id]
    })), []);

  const wagerItems = useMemo(() => buildItems(inventory, wager), [inventory, wager, buildItems]);
  const joinItems = useMemo(() => buildItems(inventory, joinSel), [inventory, joinSel, buildItems]);

  const valueOf = useCallback(
    (items, sel) => items.reduce(
      (s, i) => s + (Number(i.value) || 0) * (sel[i.itemId || i.id] || 0), 0
    ),
    []
  );
  const wagerValue = valueOf(inventory, wager);
  const joinValue = valueOf(inventory, joinSel);

  const setQty = (setter) => (itemId, qty) => setter((prev) => {
    const next = { ...prev };
    if (qty > 0) next[itemId] = qty; else delete next[itemId];
    return next;
  });

  /** Open a bet: the creator is the player, and the dealer is still to come. */
  const openTable = async () => {
    if (!wagerItems.length || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables`, {
        method: 'POST', headers: json(), body: JSON.stringify({ selectedItems: wagerItems })
      });
      const d = await res.json();
      if (!res.ok) return say(d.message || 'Could not open the table', 'error');
      setWager({});
      setDealing(true);
      setSeq((s) => s + 1);
      setTable(d);
      setActiveTab('table');
      playBetPlaced();
      setTimeout(() => setDealing(false), 700);
      await Promise.all([loadInventory(), loadTables()]);
    } catch {
      say('Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Call the house dealer onto my own table. */
  const callDealer = async () => {
    if (!table || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables/${table.id}/bot-join`, {
        method: 'POST', headers: json(), body: '{}'
      });
      const d = await res.json();
      if (!res.ok) return say(d.message || 'The dealer could not be called', 'error');
      setDealing(true);
      setSeq((s) => s + 1);
      setTable(d);
      playCoinflipJoin();
      setTimeout(() => setDealing(false), 800);
      await Promise.all([loadInventory(), loadTables()]);
    } catch {
      say('Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openJoin = (t) => { setJoinTarget(t); setJoinSel({}); setShowJoin(true); };

  const confirmJoin = async () => {
    if (!joinTarget || !joinItems.length || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables/${joinTarget.id}/join`, {
        method: 'POST', headers: json(), body: JSON.stringify({ selectedItems: joinItems })
      });
      const d = await res.json();
      if (!res.ok) return say(d.message || 'Could not deal against that table', 'error');
      setShowJoin(false);
      setDealing(true);
      setSeq((s) => s + 1);
      setTable(d);
      setActiveTab('table');
      playCoinflipJoin();
      setTimeout(() => setDealing(false), 800);
      await Promise.all([loadInventory(), loadTables()]);
    } catch {
      say('Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  };

  const act = async (path, label) => {
    if (!table || busy) return;
    setBusy(true);
    setDealing(true);
    setSeq((s) => s + 1);
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables/${table.id}/${path}`, {
        method: 'POST', headers: json(), body: '{}'
      });
      const d = await res.json();
      if (!res.ok) return say(d.message || `Could not ${label}`, 'error');
      // Let the card land before the totals change, or the animation reads as
      // the number jumping rather than the card arriving.
      await new Promise((r) => setTimeout(r, 620));
      setTable(d);
      await Promise.all([loadInventory(), loadHistory()]);
      const copy = RESULT_COPY[d.result];
      if (copy) say(copy.text, copy.tone === 'win' ? 'success' : copy.tone === 'loss' ? 'error' : 'info');
    } catch {
      say('Something went wrong', 'error');
    } finally {
      setDealing(false);
      setBusy(false);
    }
  };

  const leave = async () => {
    setTable(null);
    setSeq((s) => s + 1);
    await loadTables();
  };

  if (loading) {
    return <div className="bj-page"><div className="bj-loading"><CoinLoader size={84} label="Loading blackjack..." /></div></div>;
  }

  const me = myId();
  const iAmPlayer = !!(table && table.playerSeat && table.playerSeat.id === me);
  const iAmDealer = !!(table && table.dealerSeat && table.dealerSeat.id === me);
  const inHand = !!table && table.status === 'in_progress';
  const finished = !!table && table.status === 'waiting' ? false : !!table && table.status !== 'in_progress';
  const live = inHand && iAmPlayer;

  const playerHand = table?.playerHand || [];
  const dealerHand = table?.dealerHand || [];
  const playerBJ = playerHand.length === 2 && table?.playerValue === 21;
  const dealerBJ = dealerHand.length === 2 && table?.dealerValue === 21;
  const result = finished ? RESULT_COPY[table.result] : null;
  const iWon = finished && ['win', 'blackjack', 'dealer_bust'].includes(table.result) && iAmPlayer;
  const iLost = finished && ['loss', 'bust'].includes(table.result) && iAmPlayer;

  const openBoards = tables.filter((t) => t.status === 'waiting' && t.playerSeat && t.playerSeat.id !== me);

  return (
    <div className="bj-page">
      <AnimatedPopup
        show={popup.show} message={popup.message} type={popup.type}
        onClose={() => setPopup({ show: false, message: '', type: 'info' })}
      />

      <div className="bj-tabs">
        <button className={`bj-tab ${activeTab === 'table' ? 'active' : ''}`} onClick={() => setActiveTab('table')}>
          <Icon name="jackpot" size={15} /> Table
        </button>
        <button className={`bj-tab ${activeTab === 'deals' ? 'active' : ''}`} onClick={() => setActiveTab('deals')}>
          <Icon name="board" size={15} /> Deals
          {openBoards.length > 0 && <span className="bj-tab-count">{openBoards.length}</span>}
        </button>
        <button className={`bj-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <Icon name="board" size={15} /> History
        </button>
      </div>

      {activeTab === 'table' && (
        <div className="bj-grid">
          <div className="bj-table">
            {/* the dealer, who is whoever opened the bet's opponent */}
            <Hand
              seq={seq}
              label="Dealer"
              sub={table?.dealerSeat?.username || (table ? 'no dealer yet' : 'open a bet')}
              total={table ? table.dealerValue + (inHand ? '+?' : '') : '-'}
              cards={dealerHand}
              hiddenIndex={inHand ? 1 : -1}
              highlight={dealerBJ ? [0, 1] : []}
              dimmed={finished && !dealerBJ && table.result !== 'push'}
              empty="waiting for a dealer"
            />

            {/* the 3:2 plaque every blackjack table carries */}
            <div className="bj-plaque">
              <span className="bj-plaque-big">BLACKJACK PAYS {table?.blackjackPays || '3:2'}</span>
              <span className="bj-plaque-sub">
                {table?.houseRule || DEALER_RULE} &middot; {(table?.houseEdge ?? 0.1) * 100}% house edge
              </span>
            </div>

            <div className="bj-divider" />

            {/* the player, who is whoever opened the bet */}
            <Hand
              seq={seq}
              label="You"
              sub={table?.playerSeat?.username ? 'your hand' : 'you play this hand'}
              total={table ? table.playerValue : '-'}
              cards={playerHand}
              highlight={playerBJ || (iWon ? playerHand.map((_, n) => n) : [])}
              dimmed={finished && iLost}
              empty="open a bet to be dealt in"
            />

            {result && (
              <div className={`bj-result ${result.tone}`}>
                <strong>{iAmDealer && result.tone !== 'push'
                  ? (result.tone === 'win' ? 'The player beat you' : 'You take the pot')
                  : result.text}</strong>
                {iAmPlayer && table.profit > 0 && <span>+{table.profit.toLocaleString()} AMP</span>}
                {iAmPlayer && table.profit < 0 && <span>{table.profit.toLocaleString()} AMP</span>}
                {table.profit === 0 && <span>wager returned</span>}
                {iAmPlayer && table.tax > 0 && <span className="bj-tax">includes {table.tax.toLocaleString()} tax</span>}
                {iAmPlayer && table.rake > 0 && <span className="bj-tax">+ {table.rake.toLocaleString()} house edge</span>}
              </div>
            )}

            <div className="bj-actions">
              {!table && (
                <button className="bj-btn" disabled={!wagerItems.length || busy} onClick={openTable}>
                  Open the table
                </button>
              )}
              {table && table.status === 'waiting' && iAmPlayer && (
                <button className="bj-btn" disabled={busy} onClick={callDealer}>
                  Deal with the house
                </button>
              )}
              {table && table.status === 'waiting' && iAmDealer && (
                <span className="bj-waiting-note">
                  {table.timeoutSeconds != null && table.timeoutSeconds > 0
                    ? `the player has ${table.timeoutSeconds}s to sit down`
                    : 'waiting for the player'}
                </span>
              )}
              {live && (
                <>
                  <button className="bj-btn" disabled={busy || dealing} onClick={() => act('hit', 'hit')}>Hit</button>
                  <button className="bj-btn secondary" disabled={busy || dealing} onClick={() => act('stand', 'stand')}>Stand</button>
                </>
              )}
              {finished && <button className="bj-btn" onClick={leave}>Back to the table</button>}
            </div>

            <div className="bj-hint">{DEALER_RULE}. Blackjack pays 3:2.</div>
          </div>

          <div className="bj-panel">
            <h3>
              {table && iAmDealer ? 'Dealing against you' : 'Your wager'}
              <span className="bj-count">{wagerItems.length ? `${wagerItems.length} picked` : ''}</span>
            </h3>
            <p className="bj-panel-sub">
              {table
                ? 'The cards are already dealt. Open a new table to risk more pets.'
                : 'You open the bet and play the hand. A dealer - another player or the house - takes the other seat.'}
            </p>
            <Picker
              items={inventory}
              sel={wager}
              onChange={setQty(setWager)}
              emptyText="No pets in your inventory."
            />
            <div className="bj-total">
              <span>Total wager</span>
              <span><Icon name="diamond" size={13} /> {wagerValue.toLocaleString()}</span>
            </div>
            {!table && (
              <button className="bj-btn" disabled={!wagerItems.length || busy} onClick={openTable}>
                Open the table
              </button>
            )}
            {table && table.status === 'waiting' && (
              <button className="bj-btn secondary" onClick={leave}>Cancel the table</button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'deals' && (
        <div className="bj-boards">
          <div className="bj-boards-head">
            <h3>Open tables</h3>
            <p>
              Deal against someone else. You take the dealer seat: the player draws and stands first,
              then you turn the hole card and play to the rules.
            </p>
          </div>
          {openBoards.length === 0 && (
            <div className="bj-empty">No open tables right now. Open one and someone can deal against you.</div>
          )}
          {openBoards.map((t) => (
            <div key={t.id} className="bj-board">
              <div className="bj-board-who">
                {t.playerSeat?.avatar
                  ? <img className="bj-board-avatar" src={t.playerSeat.avatar} alt="" />
                  : <span className="bj-board-avatar fallback">{String(t.playerSeat?.username || '?').slice(0, 1)}</span>}
                <div className="bj-board-names">
                  <span className="bj-board-name">{t.playerSeat?.username || 'Unknown'}</span>
                  <span className="bj-board-sub">is playing this hand</span>
                </div>
              </div>
              <div className="bj-board-pot">
                <span className="bj-board-pot-val">
                  <Icon name="diamond" size={13} /> {Number(t.creatorValue || 0).toLocaleString()}
                </span>
                <span className="bj-board-sub">at risk</span>
              </div>
              {t.timeoutSeconds != null && (
                <span className="bj-board-timer">{t.timeoutSeconds}s</span>
              )}
              <button className="bj-btn small" onClick={() => openJoin(t)}>Deal</button>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bj-history">
          {history.length === 0 && <div className="bj-empty">No hands played yet.</div>}
          {history.slice(0, 30).map((h) => {
            const copy = RESULT_COPY[h.result] || { text: h.result, tone: 'loss' };
            return (
              <div key={h.id} className={`bj-history-row ${copy.tone}`}>
                <div className="bj-history-cards">
                  {(h.playerHand || []).slice(0, 5).map((c, i) => (
                    <span key={i} className={`bj-mini ${isRed(c.suit) ? 'red' : 'black'}`}>
                      {c.rank}{SUIT_CHAR[c.suit]}
                    </span>
                  ))}
                </div>
                <div className="bj-history-body">
                  <span className="bj-history-outcome">{copy.text}</span>
                  <span className="bj-history-detail">
                    <Icon name="diamond" size={10} /> {Number(h.betValue || 0).toLocaleString()} wagered
                  </span>
                </div>
                <span className="bj-history-profit">
                  {h.profit > 0 ? '+' : ''}{Number(h.profit || 0).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {showJoin && joinTarget && (
        <div className="bj-modal-wrap" onClick={() => setShowJoin(false)}>
          <div className="bj-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bj-modal-head">
              <h3>Deal against {joinTarget.playerSeat?.username}</h3>
              <button className="bj-modal-x" onClick={() => setShowJoin(false)} aria-label="close">x</button>
            </div>
            <p className="bj-panel-sub">
              They are risking <strong>{Number(joinTarget.creatorValue || 0).toLocaleString()}</strong>.
              You take the dealer seat and play after they stand or bust.
            </p>
            <Picker
              items={inventory}
              sel={joinSel}
              onChange={setQty(setJoinSel)}
              emptyText="No pets in your inventory."
            />
            <div className="bj-total">
              <span>Your stake</span>
              <span><Icon name="diamond" size={13} /> {joinValue.toLocaleString()}</span>
            </div>
            <div className="bj-actions">
              <button className="bj-btn secondary" onClick={() => setShowJoin(false)}>Cancel</button>
              <button className="bj-btn" disabled={!joinItems.length || busy} onClick={confirmJoin}>Take the seat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlackjackPage;
