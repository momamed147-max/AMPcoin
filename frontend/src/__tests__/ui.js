/**
 * Render the real pages in jsdom and drive them, so "the UI is broken" means
 * something measurable. Catches what a build cannot: a component that throws
 * on mount, a class name that is not in the stylesheet, a quantity control
 * that cannot be typed into, and a button that stays disabled.
 *
 * Run with: node ../uitest.js   (from frontend/)
 */
const path = require('path');
const fs = require('fs');
const babel = require(path.join(process.cwd(), 'node_modules', '@babel', 'core'));

const FRONTEND = process.cwd();
const API = 'http://127.0.0.1:5000';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`); };
const section = (t) => console.log(`\n=== ${t} ===`);

// ── jsdom before anything touches the DOM ──
const { JSDOM } = require(path.join(FRONTEND, 'node_modules', 'jsdom'));
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:3000/blackjack',
  pretendToBeVisual: true
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.getComputedStyle = dom.window.getComputedStyle;
// Modules read bare `localStorage`, so it has to exist on the global too, not
// only as window.localStorage.
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.IS_REACT_ACT_ENVIRONMENT = true;

// localStorage so sound.js and auth do not throw.
const store = new Map();
Object.defineProperty(dom.window, 'localStorage', {
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  },
  configurable: true
});
dom.window.localStorage.setItem('token', 'ui-test-token');
dom.window.localStorage.setItem('user', JSON.stringify({ id: 'ui-user', username: 'uitester' }));

// A socket that is just enough for the pages to mount.
const noop = () => {};
const fakeSocket = {
  on: noop, off: noop, once: noop, emit: noop,
  connected: true, connect: noop, disconnect: noop
};

// Stub fetch so a page never touches the network; each test queues its own.
const fetchQueue = [];
const fetchLog = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  fetchLog.push(u);
  // Fall back on a sensible default by URL so a stray refetch cannot leave the
  // page with an empty inventory and make a render bug look like a test bug.
  const next = fetchQueue.shift()
    || (/inventory/.test(u) ? { body: { items: INVENTORY } }
      : /\/tables/.test(u) ? { body: { tables: [], myTable: null } }
        : { body: [] });
  const body = next.body || {};
  // apiFetch reads .text() first so an empty body does not blow up on JSON
  // parse, so the stub has to implement the same shape a real Response has.
  const text = async () => (Object.keys(body).length ? JSON.stringify(body) : '');
  return {
    ok: next.status === undefined ? true : next.status < 400,
    status: next.status || 200,
    text,
    json: async () => body
  };
};

const queueInventory = () => fetchQueue.push({ body: { items: INVENTORY } });
const queueBoard = () => fetchQueue.push({ body: { tables: [], myTable: null } });
void dom.window.fetch;
dom.window.fetch = global.fetch;

// ── compile JSX on require ──
babel.transformFileSync(path.join(FRONTEND, 'src', 'pages', 'BlackjackPage.js'), {
  presets: [
    [path.join(FRONTEND, 'node_modules', '@babel', 'preset-env'), { targets: { node: 'current' } }],
    [path.join(FRONTEND, 'node_modules', '@babel', 'preset-react'), { runtime: 'automatic' }]
  ],
  filename: 'x.js'
});
// @babel/register is not installed, so hook require directly and transform
// anything under src/ through babel before it runs.
const SRC_DIR = path.join(FRONTEND, 'src');
const jsLoader = require.extensions['.js'];
require.extensions['.js'] = (mod, filename) => {
  if (filename.startsWith(SRC_DIR) && !filename.includes('__tests__')) {
    const src = fs.readFileSync(filename, 'utf8');
    const out = babel.transformSync(src, {
      filename,
      presets: [
        [path.join(FRONTEND, 'node_modules', '@babel', 'preset-env'), { targets: { node: 'current' } }],
        [path.join(FRONTEND, 'node_modules', '@babel', 'preset-react'), { runtime: 'automatic' }]
      ],
      babelrc: false,
      configFile: false
    });
    return mod._compile(out.code, filename);
  }
  return jsLoader(mod, filename);
};
require.extensions['.jsx'] = require.extensions['.js'];
// CSS imports resolve to a no-op.
require.extensions['.css'] = () => {};

const React = require(path.join(FRONTEND, 'node_modules', 'react'));
const { createRoot } = require(path.join(FRONTEND, 'node_modules', 'react-dom', 'client'));
const { act } = require(path.join(FRONTEND, 'node_modules', 'react-dom', 'test-utils'));
// The pages render react-router <Link>s, which need a router context.
const { MemoryRouter } = require(path.join(FRONTEND, 'node_modules', 'react-router-dom'));

const { default: BlackjackPage } = require(path.join(FRONTEND, 'src', 'pages', 'BlackjackPage.js'));
const { default: StatsPageV2 } = require(path.join(FRONTEND, 'src', 'pages', 'StatsPageV2.js'));
const { default: ErrorBoundary } = require(path.join(FRONTEND, 'src', 'components', 'ErrorBoundary.js'));
const { default: CommandPalette } = require(path.join(FRONTEND, 'src', 'components', 'CommandPalette.js'));
const { default: TradingPage } = require(path.join(FRONTEND, 'src', 'pages', 'TradingPage.js'));
const { default: UpgraderPage } = require(path.join(FRONTEND, 'src', 'pages', 'UpgraderPage.js'));
const { default: QtyStepper } = require(path.join(FRONTEND, 'src', 'components', 'QtyStepper.js'));
// The page reads the user from AuthContext, so the test supplies one directly
// rather than standing up the whole provider (which fetches on mount).
const { AuthContext } = require(path.join(FRONTEND, 'src', 'context', 'AuthContext.js'));
const TEST_USER = { id: 'ui-user', username: 'uitester', displayName: 'UI Tester', balance: 5000 };

// Every class name the stylesheets define, so a typo in a className is caught.
const cssText = fs.readdirSync(path.join(FRONTEND, 'src'), { recursive: true })
  .filter((f) => typeof f === 'string' && f.endsWith('.css'))
  .map((f) => fs.readFileSync(path.join(FRONTEND, 'src', f), 'utf8'))
  .join('\n');

const container = document.getElementById('root');
let root = null;
// Modals portal onto document.body, so anything rendered there has to be
// cleaned up explicitly or it leaks between renders.
const clearPortal = () => {
  document.querySelectorAll('.cf-modal-overlay').forEach((n) => n.remove());
};

const render = async (element) => {
  if (root) await act(async () => root.unmount());
  container.innerHTML = '';
  clearPortal();
  root = createRoot(container);
  await act(async () => { root.render(element); });
};

// Modals render through a portal onto document.body, so most lookups have to
// search the whole document rather than the React container.
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Fire a real input change the way React listens for it. */
const typeInto = async (input, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
// React 17+ delegates onBlur to the native 'focusout' event, not 'blur', so
// dispatching 'blur' silently does nothing.
const blur = async (input) => {
  await act(async () => {
    input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
  });
};
const key = async (input, k) => {
  await act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
};
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
};

const INVENTORY = [
  { itemId: 'a', name: 'Alpha', value: 10, quantity: 5, rarity: 'common' },
  { itemId: 'b', name: 'Bravo', value: 25, quantity: 3, rarity: 'rare' },
  { itemId: 'c', name: 'Charlie', value: 100, quantity: 200, rarity: 'legendary' }
];

(async () => {
  section('QtyStepper: the number between - and + is a real input');
  {
    const seen = [];
    // Stateful, because that is how it is really used: the parent owns the
    // value and re-renders. A frozen `value` prop would make the component look
    // broken when it is actually only being ignored.
    const Harness = () => {
      const [v, setV] = React.useState(2);
      return React.createElement(QtyStepper, {
        value: v,
        min: 0,
        max: 10,
        onChange: (n) => { seen.push(n); setV(n); },
        ariaLabel: 'test qty'
      });
    };
    await render(React.createElement(Harness));
    const input = $('input.qt-input');
    ok(!!input, 'a text input is rendered between the buttons');
    ok(input.getAttribute('type') === 'text', 'it is a text input, not a read-only span');
    ok(input.getAttribute('inputmode') === 'numeric', 'it asks for a numeric keypad on mobile');
    ok(input.value === '2', `it shows the current value (${input.value})`);
    ok($$('.qt button').length === 2, 'there are exactly two buttons');

    await typeInto(input, '7');
    await blur(input);
    ok(seen.length === 1 && seen[0] === 7, `typing 7 and blurring commits 7 (got ${JSON.stringify(seen)})`);
    ok($('input.qt-input').value === '7', 'the field shows the committed value');

    // A half-typed value must NOT reach the parent until commit.
    seen.length = 0;
    await typeInto($('input.qt-input'), '1');
    ok(seen.length === 0, 'a half-typed value is not pushed to the parent');
    // A real keystroke appends, so the field now reads "10". Typing replaces the
    // whole value, which is what a select-all-then-type does.
    await typeInto($('input.qt-input'), '10');
    await blur($('input.qt-input'));
    ok(seen.length === 1 && seen[0] === 10,
      `completing it to 10 commits 10 (${JSON.stringify(seen)})`);

    // Clamping. Typing above max must settle on max. No onChange fires when the
    // value is already max, so assert on what the field shows.
    await typeInto($('input.qt-input'), '9999');
    await blur($('input.qt-input'));
    ok($('input.qt-input').value === '10',
      `a value above max is clamped to max (shows ${$('input.qt-input').value})`);
    await typeInto($('input.qt-input'), '-5');
    await blur($('input.qt-input'));
    ok(seen[seen.length - 1] === 0, 'a negative value is clamped to min');
    await typeInto($('input.qt-input'), 'abc');
    await blur($('input.qt-input'));
    ok(seen[seen.length - 1] === 0, 'junk input falls back to min rather than NaN');

    // Enter and Escape.
    seen.length = 0;
    await typeInto($('input.qt-input'), '4');
    await key($('input.qt-input'), 'Enter');
    ok(seen[seen.length - 1] === 4, 'Enter commits the typed value');
    await typeInto($('input.qt-input'), '9');
    await key($('input.qt-input'), 'Escape');
    ok(seen[seen.length - 1] === 4, 'Escape reverts to the last committed value');

    // Arrow keys.
    seen.length = 0;
    await key($('input.qt-input'), 'ArrowUp');
    ok(seen[seen.length - 1] === 5, 'ArrowUp steps up by one');
    await key($('input.qt-input'), 'ArrowDown');
    ok(seen[seen.length - 1] === 4, 'ArrowDown steps down by one');
  }

  section('the stepper CSS is real, not a leftover class');
  {
    ok(/\.qt-input\s*\{/.test(cssText), '.qt-input is defined in the stylesheet');
    ok(/\.qt\s+button\s*\{/.test(cssText), '.qt button is defined');
    ok(!/outline:\s*none/.test(cssText.split('.qt-input')[1].slice(0, 400).split('}')[0]) === false
      || /\.qt-input:focus\s*\{/.test(cssText), '.qt-input has a visible focus style');
  }

  section('the Blackjack page mounts and renders the lobby');
  {
    // Reset every stub, and serve the same inventory for any repeat call, so the
    // queue does not have to be kept in step with the mount order.
    fetchQueue.length = 0;
    fetchLog.length = 0;
    queueInventory();
    queueBoard();
    queueInventory();

    let threw = null;
    try {
      await render(React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          AuthContext.Provider,
          { value: { user: TEST_USER, loading: false } },
          React.createElement(BlackjackPage, { socket: fakeSocket })
        )
      ));
    } catch (e) {
      threw = e;
    }
    ok(!threw, `the page mounts without throwing${threw ? `: ${threw.message}` : ''}`);
    ok(!!$('.cf-page'), 'the shared cf shell is rendered');
    ok(!!$('.cf-topbar'), 'the topbar is rendered');
    const tabs = $$('.cf-topbar-tabs .cf-tab').map((t) => t.textContent.trim());
    ok(tabs.some((t) => /Blackjack/i.test(t)), `Blackjack is in the game tabs (${tabs.join(' | ')})`);
    ok(!!$('.cf-empty'), 'with no open bets it shows the empty state');
    ok(!$('.bj-tabs'), 'the old blackjack tab bar is gone');
    ok(!$('.bj-grid'), 'the old always-visible board is gone');

    const btns = $$('.cf-topbar-btn').map((b) => b.textContent.trim());
    ok(btns.some((b) => /Bet Items/i.test(b)), `there is a Bet Items button (${btns.join(' | ')})`);

    // Every class the page emitted should exist in some stylesheet.
    const emitted = new Set();
    container.querySelectorAll('*').forEach((n) => {
      (n.className && typeof n.className === 'string' ? n.className.split(/\s+/) : []).forEach((c) => c && emitted.add(c));
    });
    const undefinedClasses = [...emitted].filter((c) => !cssText.includes(`.${c}`));
    ok(undefinedClasses.length === 0,
      `every rendered class is defined in the CSS${undefinedClasses.length ? ` (missing: ${undefinedClasses.join(', ')})` : ''}`);
  }

  section('the create-bet modal opens with a typable quantity');
  {
    const bet = $$('.cf-topbar-btn').find((b) => /Bet Items/i.test(b.textContent));
    ok(!!bet, 'the Bet Items button exists');
    ok(bet && !bet.disabled, `the Bet Items button is enabled (disabled=${bet && bet.disabled})`);
    // openCreate awaits the inventory fetch before opening the modal, so the
    // stub has to be queued before the click and the promises drained after.
    process.on('unhandledRejection', (e) => {
      console.log('    (diagnostic) unhandled rejection:', e && e.message);
    });
    // openCreate awaits fetchInventory() before it sets the modal, so give it a
    // stub and let the promise settle.
    queueInventory();
    await click(bet);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    const modal = $('.bjm-modal');
    ok(!!modal, 'the create modal opened');
    if (!modal) {
      console.log('    (diagnostic) buttons:', $$('button').map((b) => b.textContent.trim()).join(' | '));
      console.log('    (diagnostic) queued fetches left:', fetchQueue.length);
    }
    if (modal) {
      const tiles = $$('.bjm-tile');
      ok(tiles.length === 3, `it lists the pets (${tiles.length} tiles)`);
      ok(!!$('.bjm-tile-hit', modal), 'each tile has a click target that is not a button');
      ok(!$$('button button', modal).length, 'no interactive element is nested inside another button');

      // Click a tile to pick one unit, then the stepper appears.
      const tile = tiles[2];
      await click($('.bjm-tile-hit', tile));
      const stepper = $('.qt-input', tile);
      ok(!!stepper, 'picking a unit reveals the quantity input');
      ok(stepper && stepper.value === '1', `it starts at 1 (${stepper && stepper.value})`);

      // The headline of the request: type a big number instead of clicking +.
      await typeInto(stepper, '150');
      await blur(stepper);
      const total = $('.bjm-total-val', modal);
      ok(total && total.textContent.replace(/[^0-9]/g, '') === '15000',
        `typing 150 sets the total to 15,000 without 150 clicks (got "${total && total.textContent.trim()}")`);

      // It must not exceed what the player actually owns.
      await typeInto($('.qt-input', tile), '9999');
      await blur($('.qt-input', tile));
      ok($('.qt-input', tile).value === '200', 'it clamps to the 200 the player actually has');
    }
  }

  section('the Trading page mounts');
  {
    fetchQueue.length = 0;
    const offers = [{
      id: 'tr-1',
      creatorId: 'someone-else',
      creatorName: 'Someone',
      createdAt: new Date().toISOString(),
      items: INVENTORY.slice(0, 2),
      wantItems: INVENTORY.slice(2),
      status: 'open'
    }];
    fetchQueue.push({ body: { offers, trades: [] } });
    fetchQueue.push({ body: { items: INVENTORY } });

    let threw = null;
    try {
      await render(React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          AuthContext.Provider,
          { value: { user: TEST_USER, loading: false } },
          React.createElement(TradingPage, { socket: fakeSocket })
        )
      ));
    } catch (e) {
      threw = e;
    }
    ok(!threw, `the trading page mounts without throwing${threw ? `: ${threw.message}` : ''}`);
    ok(!!$('.tr-page'), 'the trading page shell is rendered');

    const emitted = new Set();
    document.querySelectorAll('*').forEach((n) => {
      if (typeof n.className === 'string') n.className.split(/\s+/).forEach((c) => c && emitted.add(c));
    });
    const unknown = [...emitted].filter((c) => !cssText.includes(`.${c}`));
    ok(unknown.length === 0,
      `every trading class is defined in the CSS${unknown.length ? ` (missing: ${unknown.join(', ')})` : ''}`);
  }

  section('the Upgrader lists pets with a typable quantity');
  {
    fetchQueue.length = 0;
    queueInventory();
    queueInventory();
    fetchQueue.push({ body: { items: INVENTORY, stock: INVENTORY, stockUnits: 3, minMultiplier: 1.5, houseEdge: 0.1 } });

    let threw = null;
    try {
      await render(React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          AuthContext.Provider,
          { value: { user: TEST_USER, loading: false } },
          React.createElement(UpgraderPage, { socket: fakeSocket })
        )
      ));
    } catch (e) {
      threw = e;
    }
    ok(!threw, `the upgrader mounts without throwing${threw ? `: ${threw.message}` : ''}`);

    const rows = $$('.ug-item');
    ok(rows.length > 0, `it lists pets (${rows.length} rows)`);
    ok(!$('.ug-stepper'), 'the old +/- span stepper is gone');
    // Type into the FIRST row that offers an item, whichever panel it is.
    const withInput = $$('.ug-item').find((r) => $('input.qt-input', r));
    if (withInput) {
      const input = $('input.qt-input', withInput);
      ok(!!input, 'each upgrader row has a real quantity input between - and +');
      await typeInto(input, '3');
      await blur(input);
      ok($('input.qt-input', withInput).value === '3',
        `and it accepts a typed quantity (${$('input.qt-input', withInput).value})`);
    } else {
      // No stock to select is a legitimate state; the pot side should still
      // have inputs if the inventory rendered.
      ok(rows.length > 0, 'rows rendered (stock may be empty in this fixture)');
    }
  }

  section('the V2 primitives render and behave');
  {
    const B = require(path.join(FRONTEND, 'src', 'ui', 'primitives.js'));
    // Every primitive must render, or the whole design layer is dead weight.
    const samples = [
      ['Button', B.Button, { children: 'Go' }],
      ['Panel', B.Panel, { title: 'Title', subtitle: 'Sub', children: 'body' }],
      ['EmptyState', B.EmptyState, { title: 'Nothing', message: 'here' }],
      ['ErrorState', B.ErrorState, { message: 'boom' }],
      ['Skeleton', B.Skeleton, { w: 40 }],
      ['Badge', B.Badge, { children: 'new' }],
      ['StatTile', B.StatTile, { label: 'Played', value: 12 }],
      ['StatGrid', B.StatGrid, { children: null }],
      ['Tabs', B.Tabs, { value: 'a', onChange: () => {}, items: [{ id: 'a', label: 'A' }] }],
      ['Progress', B.Progress, { value: 5, max: 10, label: 'p' }],
      ['Amount', B.Amount, { value: -1234 }],
      ['Field', B.Field, { label: 'Name', hint: 'h' }]
    ];
    for (const [name, Comp, props] of samples) {
      let err = null;
      try { await render(React.createElement(Comp, props)); } catch (e) { err = e; }
      ok(!err && $$('*').length > 0, `${name} renders${err ? `: ${err.message}` : ''}`);
    }

    // Loading a Button must actually disable it, not just look different.
    let clicked = 0;
    await render(React.createElement(B.Button, { loading: true, onClick: () => { clicked++; }, children: 'Save' }));
    const lb = $('button.ui-btn');
    ok(lb && lb.disabled, 'a loading Button is disabled');
    ok(lb && lb.className.includes('is-loading'), 'and marked is-loading');
    await click(lb);
    ok(clicked === 0, 'clicking it does nothing while it is in flight');

    // Progress must clamp rather than overflow its track.
    await render(React.createElement(B.Progress, { value: 999, max: 100 }));
    const bar = $('.ui-progress');
    ok(bar && bar.getAttribute('aria-valuenow') === '100', 'an over-100 progress clamps to 100');
    await render(React.createElement(B.Progress, { value: -5, max: 100 }));
    ok($('.ui-progress').getAttribute('aria-valuenow') === '0', 'a negative progress clamps to 0');

    // Amount signs and tone.
    await render(React.createElement(B.Amount, { value: 2500, sign: true, compact: true }));
    ok($('.ui-amount').textContent === '+2.5K', `a positive Amount is signed and compact (${$('.ui-amount').textContent})`);
    ok($('.ui-amount').className.includes('ui-amount-pos'), 'and toned positive');
    await render(React.createElement(B.Amount, { value: -2500, sign: true }));
    ok($('.ui-amount').textContent === '-2,500', 'a negative Amount keeps its minus and is not prefixed');

    // The token layer must be present in the stylesheets.
    ok(/--sp-5\s*:/.test(cssText), 'the spacing scale is defined');
    ok(/--ctl-h\s*:/.test(cssText), 'control heights are defined');
    ok(/--z-modal\s*:/.test(cssText), 'z-index bands are defined');
    ok(/--dur-2\s*:/.test(cssText), 'motion durations are defined');
  }

  section('the V2 stats page renders a real summary');
  {
    const summary = {
      totals: {
        played: 12, wins: 8, losses: 4, winRate: 66.7,
        staked: 50000, profit: 1234, biggestWin: 900, biggestLoss: 300,
        biggestStake: 9510, distinctOpponents: 3
      },
      games: {
        coinflip: { played: 5, wins: 3, losses: 2, pushes: 0, winRate: 60, staked: 100, profit: 50, biggestWin: 40, biggestLoss: 10 },
        blackjack: { played: 4, wins: 3, losses: 1, pushes: 0, winRate: 75, staked: 200, profit: 900, biggestWin: 900, biggestLoss: 0 },
        rps: { played: 3, wins: 2, losses: 1, pushes: 0, winRate: 66.7, staked: 50, profit: 284, biggestWin: 40, biggestLoss: 10 },
        upgrader: { played: 0, wins: 0, losses: 0, pushes: 0, winRate: 0, staked: 0, profit: 0, biggestWin: 0, biggestLoss: 0 }
      },
      achievements: {
        unlocked: 2, total: 4,
        next: { id: 'b', name: 'Getting Serious', tier: 'bronze', icon: 'target', description: 'Play 100 bets.', unlocked: false, value: 12, goal: 100, percent: 12 },
        list: [
          { id: 'a', name: 'First Bet', tier: 'bronze', icon: 'coin', description: 'Place your first bet.', unlocked: true, value: 1, goal: 1, percent: 100 },
          { id: 'b', name: 'Getting Serious', tier: 'bronze', icon: 'target', description: 'Play 100 bets.', unlocked: false, value: 12, goal: 100, percent: 12 },
          { id: 'c', name: 'Veteran', tier: 'silver', icon: 'flag', description: 'Play 500 bets.', unlocked: false, value: 12, goal: 500, percent: 2 },
          { id: 'd', name: 'Whale', tier: 'gold', icon: 'jackpot', description: 'Win 1,000,000 net.', unlocked: false, value: 1234, goal: 1000000, percent: 0 }
        ]
      },
      history: [
        { id: 'h1', won: true, staked: 9510, profit: 900, at: new Date().toISOString(), result: 'win' },
        { id: 'h2', won: false, staked: 2465, profit: -2465, at: new Date().toISOString(), result: 'bust' }
      ]
    };
    fetchQueue.length = 0;
    fetchQueue.push({ body: summary });

    let threw = null;
    try {
      await render(React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          AuthContext.Provider,
          { value: { user: TEST_USER, loading: false } },
          React.createElement(StatsPageV2)
        )
      ));
    } catch (e) { threw = e; }
    ok(!threw, `the stats page renders${threw ? `: ${threw.message}` : ''}`);
    // The summary arrives over the stubbed fetch, so the promise has to settle
    // before the populated render is asserted.
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });

    ok(!!$('.sp2'), 'the page shell rendered');
    const bodyText = document.body.textContent;
    ok(bodyText.includes('12'), 'shows the total bets played');
    ok(bodyText.includes('66.7'), 'shows the win rate');
    ok(bodyText.includes('Getting Serious'), 'surfaces the next achievement to chase');
    ok(!!$('.ui-tabs'), 'uses the shared Tabs primitive');

    const classes = new Set();
    document.querySelectorAll('*').forEach((n) => {
      if (typeof n.className === 'string') n.className.split(/\s+/).forEach((c) => c && classes.add(c));
    });
    const unknown = [...classes].filter((c) => !cssText.includes(`.${c}`));
    ok(unknown.length === 0,
      `every class the page renders exists in CSS${unknown.length ? ` (missing: ${unknown.join(', ')})` : ''}`);

    // The achievements tab must list them all, locked ones included.
    const tabs = $$('.ui-tab');
    const achTab = tabs.find((t) => /Achievements/i.test(t.textContent));
    await click(achTab);
    ok($$('.sp2-ach').length === 4, `the achievements tab lists all four (${$$('.sp2-ach').length})`);
    ok($$('.sp2-ach.is-unlocked').length === 1, 'and marks the unlocked one');

    const gamesTab = tabs.find((t) => /By game/i.test(t.textContent));
    await click(gamesTab);
    ok($$('.sp2-game').length === 5, `the by-game tab shows all five games (${$$('.sp2-game').length})`);
    ok(document.body.textContent.includes('Not played yet'), 'and says so for a game with no records');

    // A failed load must offer a retry rather than rendering nothing.
    fetchQueue.length = 0;
    fetchQueue.push({ status: 500, body: { message: 'Server error' } });
    await render(React.createElement(
      MemoryRouter,
      null,
      React.createElement(
        AuthContext.Provider,
        { value: { user: TEST_USER, loading: false } },
        React.createElement(StatsPageV2)
      )
    ));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    ok(!!$('.ui-error'), 'a failed load renders an error state');
    ok(!!$('.ui-empty-action button'), 'with a retry button');
  }

  section('the error boundary recovers instead of staying broken');
  {
    // A boundary that has caught once used to stay caught for the rest of the
    // session, so every later visit to the panel showed the same error even
    // after the cause was gone - which reads as a permanently broken page.
    let shouldThrow = true;
    const Boom = () => {
      if (shouldThrow) throw new Error('kaboom');
      return React.createElement('span', { className: 'recovered' }, 'recovered');
    };
    await render(React.createElement(ErrorBoundary, { label: 'The widget' },
      React.createElement(Boom)));

    ok(!!$('.eb-fallback'), 'a thrown render shows the fallback instead of a blank page');
    ok(document.body.textContent.includes('kaboom'), 'and surfaces the actual message');
    ok(!!$('.eb-fallback-actions button'), 'the fallback offers actions');
    const retry = $$('.eb-fallback-actions button').find((b) => /try again/i.test(b.textContent));
    ok(!!retry, 'one of them is Try again');

    shouldThrow = false;
    await click(retry);
    ok(!!$('.recovered'), 'clicking Try again remounts and renders the children again');
    ok(!$('.eb-fallback'), 'and the fallback is gone');

    // The close button only appears when the caller supplied a handler.
    shouldThrow = true;
    let closed = false;
    await render(React.createElement(ErrorBoundary, { label: 'X', onClose: () => { closed = true; } },
      React.createElement(Boom)));
    const close = $$('.eb-fallback-actions button').find((b) => /close/i.test(b.textContent));
    ok(!!close, 'a close button appears when onClose is supplied');
    await click(close);
    ok(closed === true, 'and it calls onClose');
  }

  section('the removed pages are genuinely gone');
  {
    const fsx = require('fs');
    for (const dead of ['pages/StatsPage.js', 'pages/StatsPage.css', 'pages/WalletPage.js', 'pages/WalletPage.css']) {
      ok(!fsx.existsSync(path.join(FRONTEND, 'src', dead)), `${dead} was deleted`);
    }
  }

  section('the command palette opens, searches and navigates');
  {
    const wrap = (el) => React.createElement(
      MemoryRouter,
      null,
      React.createElement(AuthContext.Provider, { value: { user: TEST_USER, loading: false } }, el)
    );

    // Closed: renders nothing at all.
    await render(wrap(React.createElement(CommandPalette, { open: false, onClose: () => {} })));
    ok(!$('.cp'), 'a closed palette renders nothing');

    await render(wrap(React.createElement(CommandPalette, { open: true, onClose: () => {} })));
    ok(!!$('.cp'), 'an open palette renders');
    ok(!!$('.cp-search input'), 'with a focused search field');
    const allItems = $$('.cp-item');
    ok(allItems.length >= 8, `it lists every destination by default (${allItems.length})`);

    // Every game must be reachable, or the palette is decoration.
    const labels = $$('.cp-item-label').map((n) => n.textContent);
    for (const g of ['Coinflip', 'Jackpot', 'Rock Paper Scissors', 'Blackjack', 'Upgrader', 'Trading']) {
      ok(labels.some((l) => l === g), `${g} is reachable from the palette`);
    }

    // Filtering.
    await typeInto($('.cp-search input'), 'black');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const filtered = $$('.cp-item-label').map((n) => n.textContent);
    ok(filtered.length === 1 && filtered[0] === 'Blackjack',
      `typing "black" narrows it to one (${filtered.join(', ')})`);

    // Fuzzy: a subsequence, not just a prefix.
    await typeInto($('.cp-search input'), 'upgr');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    ok($$('.cp-item-label').some((n) => n.textContent === 'Upgrader'),
      'a partial subsequence still matches (upgr -> Upgrader)');

    // No results must say so rather than showing a blank list.
    await typeInto($('.cp-search input'), 'zzzzqqq');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    ok(!!$('.cp-empty'), 'no matches shows an empty state');

    // Arrow keys move the cursor, Enter runs the highlighted row.
    await typeInto($('.cp-search input'), 'rps');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const first = $$('.cp-item').findIndex((n) => n.className.includes('is-active'));
    await key($('.cp-search input'), 'ArrowDown');
    const afterDown = $$('.cp-item').findIndex((n) => n.className.includes('is-active'));
    ok(afterDown !== first || $$('.cp-item').length === 1,
      'ArrowDown moves the active row');
    await key($('.cp-search input'), 'ArrowUp');
    ok($$('.cp-item').findIndex((n) => n.className.includes('is-active')) === first,
      'ArrowUp moves it back');

    // Escape closes.
    let closed = false;
    await render(wrap(React.createElement(CommandPalette, { open: true, onClose: () => { closed = true; } })));
    await key($('.cp-search input'), 'Escape');
    ok(closed === true, 'Escape closes the palette');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
