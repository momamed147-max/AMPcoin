import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import AnimatedPopup from '../components/AnimatedPopup';
import ModalPortal from '../components/ModalPortal';
import BlackjackModal from '../components/BlackjackModal';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import { useAuth } from '../context/AuthContext';
import { playBetPlaced, playCoinflipJoin } from '../sound';
// The shared betting shell - topbar, lobby row, join/view modals. Blackjack
// renders it, so Blackjack has to load it; these rules used to live in
// CoinflipPage.css, which this page never imported.
import '../ui/lobby.css';
import './BlackjackPage.css';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const json = () => ({ 'Content-Type': 'application/json', ...authHeaders() });
const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
};

const SUIT_CHAR = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const isRed = (suit) => suit === 'hearts' || suit === 'diamonds';

const RESULT_COPY = {
  blackjack: { text: 'Blackjack! Paid 3:2', tone: 'win' },
  win: { text: 'You beat the dealer', tone: 'win' },
  dealer_bust: { text: 'Dealer busts - you win', tone: 'win' },
  push: { text: 'Push - wager returned', tone: 'push' },
  loss: { text: 'Dealer takes the pot', tone: 'loss' },
  bust: { text: 'Bust - the dealer takes the pot', tone: 'loss' }
};

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

/** One hand. `seq` restarts the deal animation when new cards actually land. */
function Hand({ cards, seq, total, label, sub, hiddenIndex, highlight = [], dimmed, empty }) {
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
            highlight={highlight.includes(i)}
            dimmed={dimmed && !highlight.includes(i)}
          />
        ))}
      </div>
    </div>
  );
}

const BlackjackPage = ({ socket }) => {
  const { user } = useAuth();
  const [lobby, setLobby] = useState({ tables: [], activeCount: 0 });
  const [myTable, setMyTable] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [popup, setPopup] = useState({ show: false, message: '', type: 'info' });
  const [seq, setSeq] = useState(0);

  const showPopup = useCallback(
    (message, type = 'info') => setPopup({ show: true, message, type }),
    []
  );

  const fetchInventory = useCallback(async () => {
    if (!user?.id) return;
    setInventoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/inventory/${encodeURIComponent(user.id)}`, {
        headers: authHeaders()
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setInventory(Array.isArray(d.items) ? d.items : []);
    } finally {
      setInventoryLoading(false);
    }
  }, [user?.id]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Blackjack board unavailable (${res.status})`);
      const d = await res.json();
      const list = Array.isArray(d) ? d : d.tables || [];
      setLobby({ tables: list, activeCount: list.filter((t) => t.status === 'waiting').length });
      setMyTable((cur) => {
        if (d.myTable) return d.myTable;
        // Keep a just-settled hand up briefly so the result stays readable
        // instead of vanishing on the next poll.
        if (cur?.status === 'completed'
          && Date.now() - new Date(cur.updatedAt || Date.now()).getTime() < 4 * 60 * 1000) return cur;
        return null;
      });
      setError('');
    } catch (e) {
      setError(e.message || 'Blackjack board unavailable');
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([refresh(), fetchInventory()]);
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onTables = () => refresh();
    const onInv = () => fetchInventory();
    socket.on('blackjackTables', onTables);
    socket.on('inventoryUpdate', onInv);
    return () => {
      socket.off('blackjackTables', onTables);
      socket.off('inventoryUpdate', onInv);
    };
  }, [socket, refresh, fetchInventory]);

  const openCreate = async () => {
    playBetPlaced();
    await fetchInventory();
    setModal({ mode: 'create' });
  };

  const openJoin = async (t) => {
    playCoinflipJoin();
    await fetchInventory();
    setModal({ mode: 'join', table: t });
  };

  const handleDone = (t) => {
    setModal(null);
    setSeq((s) => s + 1);
    setMyTable(t);
    setViewId(t.id);
    showPopup(
      t.status === 'waiting'
        ? 'Bet posted. Waiting for a player to join.'
        : 'Cards dealt. Play your hand.',
      'success'
    );
    fetchInventory();
    refresh();
  };

  const request = useCallback(async (path, body, label) => {
    if (busy) return null;
    setBusy(label);
    try {
      const res = await fetch(`${API_BASE}/api/blackjack/tables${path}`, {
        method: 'POST',
        headers: json(),
        body: JSON.stringify(body || {})
      });
      const d = await res.json();
      if (!res.ok) {
        showPopup(d.message || 'Blackjack action failed.', 'error');
        return null;
      }
      return d;
    } catch {
      showPopup('Something went wrong.', 'error');
      return null;
    } finally {
      setBusy('');
    }
  }, [busy, showPopup]);

  const hit = async () => {
    if (!myTable) return;
    setSeq((s) => s + 1);
    const d = await request(`/${myTable.id}/hit`, {}, 'hit');
    if (d) { setMyTable(d); await fetchInventory(); }
  };

  const stand = async () => {
    if (!myTable) return;
    setSeq((s) => s + 1);
    const d = await request(`/${myTable.id}/stand`, {}, 'stand');
    if (!d) return;
    setMyTable(d);
    await fetchInventory();
    const copy = RESULT_COPY[d.result];
    if (copy) showPopup(copy.text, copy.tone === 'win' ? 'success' : copy.tone === 'loss' ? 'error' : 'info');
  };

  // The dealer is the creator, so only they can call the house bot onto their
  // own table. This is "deal against the house" in one click.
  const callHouse = async () => {
    if (!myTable) return;
    setSeq((s) => s + 1);
    const d = await request(`/${myTable.id}/bot-join`, {}, 'bot');
    if (!d) return;
    setMyTable(d);
    showPopup('The house bot is in. It will play after you stand.', 'success');
    await fetchInventory();
  };

  // Drive the bot's hand. The bot is the player here, so it hits and stands and
  // then the dealer's hand plays out server-side.
  const runBot = async () => {
    if (!myTable) return;
    let cur = myTable;
    let guard = 0;
    while (cur.status === 'in_progress' && guard++ < 8) {
      setSeq((s) => s + 1);
      // eslint-disable-next-line no-await-in-loop
      const d = await request(`/${myTable.id}/bot-play`, {}, 'bot-play');
      if (!d) return;
      cur = d;
      setMyTable(d);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 550));
    }
    if (cur.status === 'completed') {
      const copy = RESULT_COPY[cur.result];
      showPopup(copy ? copy.text : 'Hand over', cur.result === 'win' || cur.result === 'blackjack' || cur.result === 'dealer_bust' ? 'error' : 'success');
      await fetchInventory();
    }
  };

  const closeView = () => setViewId(null);

  if (loading) {
    return <div className="cf-loading"><div className="loading-spinner" /><p>Loading Blackjack...</p></div>;
  }

  const me = user?.id;
  const waiting = lobby.tables.filter((t) => t.status === 'waiting' && t.creatorId !== me);
  const viewTable = viewId ? lobby.tables.find((t) => t.id === viewId) || myTable : null;

  return (
    <div className="cf-page bj-page">
      <AnimatedPopup
        show={popup.show} message={popup.message} type={popup.type}
        onClose={() => setPopup({ show: false, message: '', type: 'info' })}
      />

      <div className="cf-topbar">
        <div className="cf-topbar-tabs">
          <Link to="/coinflip" className="cf-tab"><span className="cf-tab-label"><Icon name="coin" size={12} /> Coinflip</span></Link>
          <Link to="/jackpot" className="cf-tab"><span className="cf-tab-label"><Icon name="jackpot" size={12} /> Jackpot</span></Link>
          <Link to="/rps" className="cf-tab"><span className="cf-tab-label"><Icon name="rpsScissors" size={12} /> RPS</span></Link>
          <button className="cf-tab cf-tab-active"><span className="cf-tab-label"><Icon name="card" size={12} /> Blackjack</span><span className="cf-tab-count">{lobby.activeCount}</span></button>
        </div>
        <div className="cf-topbar-right">
          <div className="cf-topbar-stat"><span className="cf-dice-icon"><Icon name="card" size={13} /></span><span>{waiting.length} open</span></div>
          {myTable && viewId !== myTable.id && (
            <button className="cf-topbar-btn" onClick={() => setViewId(myTable.id)}>
              <Icon name="target" size={13} /> Your table
            </button>
          )}
          <button
            className="cf-topbar-btn cf-topbar-btn-gold"
            onClick={openCreate}
            disabled={inventoryLoading || !!myTable}
            title={myTable ? 'Finish your current table first' : 'Post a new blackjack bet'}
          >
            <Icon name="plus" size={13} /> Bet Items
          </button>
        </div>
      </div>

      {error && (
        <div className="bj-error" role="alert">
          <Icon name="warn" size={15} /><span>{error}</span>
          <button type="button" onClick={refresh}>Retry</button>
        </div>
      )}

      {myTable && (
        <div className="bj-active-note">
          <Icon name="target" size={14} />
          <span>
            You have a table open &mdash; you are the {myTable.viewerIsCreator ? 'dealer' : 'player'}.
            {myTable.status === 'waiting' ? ' Waiting for someone to join.' : ' Finish the hand to start another.'}
          </span>
          <button type="button" onClick={() => setViewId(myTable.id)}>Open</button>
        </div>
      )}

      <div className="cf-lobby">
        {waiting.length > 0 ? waiting.map((t) => (
          <div key={t.id} className="cf-row bj-lobby-row">
            <div className="cf-row-players">
              <div className="cf-row-player">
                <div className="cf-row-avatar-ring ring-heads">
                  <img
                    className="cf-row-avatar"
                    src={t.dealerSeat?.avatar || '/default-avatar.svg'}
                    alt={t.dealerSeat?.username}
                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                  />
                  <span className="cf-row-chip-badge"><Icon name="card" size={18} /></span>
                </div>
              </div>
              <span className="cf-row-vs">VS</span>
              <div className="cf-row-player">
                <div className="cf-row-avatar-ring ring-tails">
                  <div className="cf-row-avatar cf-row-avatar-empty">?</div>
                </div>
              </div>
            </div>

            <div className="cf-row-items">
              {(t.creatorItems || []).slice(0, 4).map((i, n) => (
                <span key={n} className="cf-item-thumb" title={i.name}>
                  <img src={i.image || '/default-item.svg'} alt="" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                </span>
              ))}
            </div>

            <div className="cf-row-value">
              <div className="cf-row-total">
                <span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {compact(t.creatorValue)}
              </div>
              <div className="cf-row-range">
                Join {compact(t.minJoinValue)}-{compact(t.maxJoinValue)}
              </div>
              <div className="cf-row-cap">Blackjack 3:2</div>
            </div>

            <div className="cf-row-action">
              {!myTable && <button className="cf-join-btn" onClick={() => openJoin(t)}>Join</button>}
              {myTable && <span className="cf-row-cap">One table at a time</span>}
            </div>
          </div>
        )) : (
          <div className="cf-empty">
            <div className="cf-empty-icon"><Icon name="card" size={34} /></div>
            <p>No open blackjack bets</p>
            <p className="cf-empty-sub">Post an item wager to deal against it!</p>
            <button className="cf-topbar-btn cf-topbar-btn-gold" onClick={openCreate} disabled={!!myTable}>
              <Icon name="plus" size={13} /> Create Blackjack Bet
            </button>
          </div>
        )}
      </div>

      {/* ═══ The table itself ═══ */}
      {viewTable && (() => {
        const dSeat = viewTable.dealerSeat || {};
        const pSeat = viewTable.playerSeat || {};
        const iDeal = dSeat.id === me;
        const iPlay = pSeat.id === me;
        const inHand = viewTable.status === 'in_progress';
        const finished = viewTable.status === 'completed';
        const pHand = viewTable.playerHand || [];
        const dHand = viewTable.dealerHand || [];
        const pBJ = pHand.length === 2 && viewTable.playerValue === 21;
        const dBJ = dHand.length === 2 && viewTable.dealerValue === 21;
        const result = finished ? RESULT_COPY[viewTable.result] : null;
        const iWon = finished && iPlay
          && ['win', 'blackjack', 'dealer_bust'].includes(viewTable.result);
        const iLost = finished && iPlay && ['loss', 'bust'].includes(viewTable.result);
        const botTurn = inHand && pSeat.isBot;
        // A bot is always driven from the dealer's screen, since the bot has
        // no way to press its own buttons.
        const canAct = inHand && iPlay && !pSeat.isBot;

        return (
          <ModalPortal>
            <div className="cf-modal-overlay" onClick={closeView}>
              <div className="cf-modal bj-table-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <button className="cf-modal-close" onClick={closeView} aria-label="Close table"><Icon name="close" size={15} /></button>

                <div className="bj-table-top">
                  <div className={`bj-seat ${iDeal ? 'me' : ''}`}>
                    {dSeat.avatar
                      ? <img className="bj-seat-avatar" src={dSeat.avatar} alt="" onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
                      : <span className="bj-seat-avatar fallback">{(dSeat.username || '?').slice(0, 1).toUpperCase()}</span>}
                    <span className="bj-seat-name">
                      {dSeat.username || 'Dealer'}
                      {dSeat.isBot && <span className="bj-seat-tag">house</span>}
                    </span>
                    <span className="bj-seat-role">dealer</span>
                  </div>
                  <div className="bj-vs">VS</div>
                  <div className={`bj-seat ${iPlay ? 'me' : ''}`}>
                    {pSeat.avatar
                      ? <img className="bj-seat-avatar" src={pSeat.avatar} alt="" onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
                      : <span className="bj-seat-avatar fallback">{(pSeat.username || '?').slice(0, 1).toUpperCase()}</span>}
                    <span className="bj-seat-name">
                      {pSeat.username || 'Waiting'}
                      {pSeat.isBot && <span className="bj-seat-tag">house</span>}
                    </span>
                    <span className="bj-seat-role">player</span>
                  </div>
                </div>

                <div className="bj-plaque">
                  <span className="bj-plaque-big">BLACKJACK PAYS {viewTable.blackjackPays || '3:2'}</span>
                  <span className="bj-plaque-sub">
                    {viewTable.houseRule || 'Dealer stands on flat 17 and must hit a soft 17'}
                    {' \u00b7 '}
                    {Math.round((viewTable.houseEdge ?? 0.1) * 100)}% house edge
                  </span>
                </div>

                <Hand
                  seq={seq}
                  label="Dealer"
                  total={viewTable.dealerValue + (inHand ? '+?' : '')}
                  cards={dHand}
                  hiddenIndex={inHand ? 1 : -1}
                  highlight={dBJ ? [0, 1] : []}
                  dimmed={finished && !dBJ && viewTable.result !== 'push'}
                  empty="dealing"
                />

                <Hand
                  seq={seq}
                  label="Player"
                  total={viewTable.playerValue}
                  cards={pHand}
                  highlight={pBJ || (iWon ? pHand.map((_, n) => n) : [])}
                  dimmed={finished && iLost}
                  empty={viewTable.status === 'waiting' ? 'waiting for a player to join' : 'dealing'}
                />

                {result && (
                  <div className={`bj-result ${result.tone}`}>
                    <strong>{iDeal && result.tone !== 'push'
                      ? (result.tone === 'win' ? 'The player beat you' : 'You take the pot')
                      : result.text}</strong>
                    {iPlay && viewTable.profit > 0 && <span>+{viewTable.profit.toLocaleString()} AMP</span>}
                    {iPlay && viewTable.profit < 0 && <span>{viewTable.profit.toLocaleString()} AMP</span>}
                    {iPlay && viewTable.profit === 0 && <span>wager returned</span>}
                    {iPlay && viewTable.tax > 0 && <span className="bj-tax">includes {viewTable.tax.toLocaleString()} tax</span>}
                    {iPlay && viewTable.rake > 0 && <span className="bj-tax">+ {viewTable.rake.toLocaleString()} house edge</span>}
                    {iPlay && viewTable.bonusShortfall > 0 && (
                      <span className="bj-tax">
                        3:2 bonus rounded down {viewTable.bonusShortfall.toLocaleString()} by item value
                      </span>
                    )}
                  </div>
                )}

                {viewTable.status === 'waiting' && (
                  <div className="bj-waiting">
                    <div className="bj-waiting-text">
                      {iDeal
                        ? `Waiting for a player${viewTable.timeoutSeconds > 0 ? ` (${viewTable.timeoutSeconds}s)` : ''}.`
                        : 'Waiting for the hand to be dealt.'}
                    </div>
                    {iDeal && (
                      <button className="cf-topbar-btn" onClick={callHouse} disabled={busy === 'bot'}>
                        <Icon name="target" size={13} /> Deal against the house
                      </button>
                    )}
                  </div>
                )}

                {canAct && (
                  <div className="bj-actions">
                    <button className="cf-topbar-btn" onClick={hit} disabled={busy === 'hit'}>Hit</button>
                    <button className="cf-topbar-btn cf-topbar-btn-gold" onClick={stand} disabled={busy === 'stand'}>Stand</button>
                  </div>
                )}

                {botTurn && iDeal && (
                  <div className="bj-actions">
                    <button className="cf-topbar-btn cf-topbar-btn-gold" onClick={runBot} disabled={busy === 'bot-play'}>
                      <Icon name="card" size={13} /> Play the bot's hand
                    </button>
                  </div>
                )}
                {botTurn && !iDeal && (
                  <div className="bj-waiting"><div className="bj-waiting-text">The house bot is playing its hand...</div></div>
                )}

                {finished && (
                  <div className="bj-actions">
                    <button className="cf-topbar-btn" onClick={closeView}>Close</button>
                  </div>
                )}
              </div>
            </div>
          </ModalPortal>
        );
      })()}

      {modal && (
        <BlackjackModal
          mode={modal.mode}
          table={modal.table}
          userInventory={inventory}
          onClose={() => setModal(null)}
          onDone={handleDone}
        />
      )}
    </div>
  );
};

export default BlackjackPage;
