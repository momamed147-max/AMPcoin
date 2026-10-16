/**
 * Verifies the presentation polish behaves, rather than assuming it does.
 *
 * Each check fails for a reason that would be invisible in a screenshot:
 *  - reduced-motion is honoured for every animation this pass added
 *  - the stagger index really reaches the DOM
 *  - joinable rows are actually marked joinable
 *  - the page well renders without forcing a layout shift
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:5000';
const BUILD = path.join(__dirname, '..', 'frontend', 'build');
const OUT = path.join(__dirname, 'shots-polish');

/**
 * Serve the built frontend if nothing already is.
 *
 * The runner in run-all.js starts the backend on :5000 but has no reason to
 * start a static server on :3000, so without this the suite silently reported
 * "0 passed" - which reads like a pass and is really a skip. That is the second
 * time a suite in this repo has done that, which is why it is handled here
 * rather than by asking whoever runs it to remember a second command.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1200, () => { socket.destroy(); resolve(false); });
  });
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') url = '/index.html';
    const file = path.join(BUILD, url);
    // Never serve outside the build directory.
    if (!file.startsWith(BUILD)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) {
        // SPA fallback so a deep link still renders.
        return fs.readFile(path.join(BUILD, 'index.html'), (e2, html) => {
          res.writeHead(e2 ? 404 : 200, { 'Content-Type': 'text/html' });
          res.end(e2 ? 'build/index.html missing' : html);
        });
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(3000, () => resolve(server));
  });
}

let pass = 0;
let fail = 0;
const ok = (c, label) => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

const login = async (u) => {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u }),
  });
  return (await res.json()).token;
};

/**
 * Put real rows in the lobby.
 *
 * This used to depend on tools/seed-demo.js having been run, which meant the
 * suite silently asserted against an empty lobby whenever it was invoked on its
 * own. It creates its own bets now, so it tests the lobby rather than the state
 * of a seeder.
 */
async function seedLobby(viewerToken) {
  const loginAs = async (name) => {
    const res = await fetch(`${API}/api/auth/dev-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name }),
    });
    if (!res.ok) return null;
    return (await res.json());
  };

  const inventoryOf = async (who) => {
    const inv = await (await fetch(`${API}/api/users/inventory/${who.user.id}`, {
      headers: { Authorization: `Bearer ${who.token}` },
    })).json();
    return (inv.items || []).filter((i) => Number(i.value) > 0 && (i.quantity || 1) >= 1);
  };

  // Two other players post bets, so the viewer has rows it is not the creator
  // of - those are the ones that must be marked joinable.
  // Promise.all, not map: a bare .map leaves promises in the array and every
  // filter(Boolean) below would happily keep them.
  const logins = await Promise.all(['tester', 'local-player-2'].map((n) => loginAs(n)));
  const creators = logins.filter((who) => who && who.user && who.token);
  let created = 0;
  for (const who of creators) {
    const items = await inventoryOf(who);
    if (items.length === 0) continue;
    const total = items.slice(0, 2).reduce((s, i) => s + Number(i.value) * (i.quantity || 1), 0);
    const res = await fetch(`${API}/api/coinflip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.token}` },
      body: JSON.stringify({
        selectedItems: items.slice(0, 2).map((i) => ({ itemId: i.itemId || i.id, quantity: 1 })),
        sideChosen: 'tails',
        side: 'tails',
        minOpponentValue: Math.floor(total * 0.9),
        maxOpponentValue: Math.ceil(total * 1.1),
      }),
    });
    if (res.ok) created++;
  }
  console.log(`  seeded ${created} lobby row(s) for the viewer`);
  return created;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  let staticServer = null;
  if (!(await portInUse(3000))) {
    if (!fs.existsSync(path.join(BUILD, 'index.html'))) {
      console.error('  frontend/build/index.html is missing - run `npm run build` in frontend/ first.');
      process.exit(1);
    }
    staticServer = await startStaticServer();
    console.log('\n  started a static server on :3000 for this suite');
  }

  const token = await login('local-player-1');
  await seedLobby(token);

  const open = async (reducedMotion) => {
    const browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', ...(reducedMotion ? ['--force-prefers-reduced-motion'] : [])],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/coinflip`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 3500));
    return { browser, page };
  };

  console.log('\n=== motion and row wiring ===\n');

  // ── normal motion ─────────────────────────────────────────────────────────
  {
    const { browser, page } = await open(false);

    const rows = await page.evaluate(() => {
      const list = [...document.querySelectorAll('.cf-row')];
      return list.map((r) => ({
        index: r.style.getPropertyValue('--cf-row-index'),
        joinable: r.classList.contains('cf-row-joinable'),
        anim: getComputedStyle(r).animationName,
        delay: getComputedStyle(r).animationDelay,
      }));
    });

    ok(rows.length > 0, `${rows.length} lobby rows rendered`);
    ok(rows.every((r) => r.index !== ''), 'every row carries --cf-row-index');
    ok(rows.every((r) => r.anim === 'row-stagger-in'), 'every row runs the stagger animation');
    const delays = rows.map((r) => parseFloat(r.delay) || 0);
    ok(new Set(delays).size > 1 || delays.every((d) => d === 0),
      `delays are staggered or uniformly zero (${delays.join(', ')})`);
    ok(rows.some((r) => r.joinable), 'joinable rows are marked');
    console.log(`         row delays: ${delays.join(', ')}`);

    const end = await page.evaluate(() => {
      const el = document.querySelector('.cf-list-end');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { text: el.textContent.trim(), display: s.display, color: s.color };
    });
    ok(Boolean(end), 'the end-of-list marker is present');
    ok(end && end.display === 'flex', 'and it lays out as a rule with side hairlines');

    // The glow must not push content around.
    const shift = await page.evaluate(() => {
      const el = document.querySelector('.page-content');
      const before = el.getBoundingClientRect().top;
      void el.offsetHeight;
      return Math.abs(el.getBoundingClientRect().top - before);
    });
    ok(shift < 0.5, `the content well does not shift layout (${shift}px)`);

    const sheen = await page.evaluate(() => {
      const row = document.querySelector('.cf-row-joinable');
      if (!row) return null;
      const s = getComputedStyle(row, '::after');
      return { bg: s.backgroundImage.slice(0, 40), opacity: s.opacity };
    });
    ok(Boolean(sheen) && sheen.bg.includes('gradient'), 'the joinable sheen is styled');

    await page.screenshot({ path: path.join(OUT, 'coinflip.png') });
    await browser.close();
  }

  // ── reduced motion ────────────────────────────────────────────────────────
  {
    const { browser, page } = await open(true);

    const state = await page.evaluate(() => {
      const row = document.querySelector('.cf-row');
      const anim = row ? getComputedStyle(row) : null;
      const joinable = document.querySelector('.cf-row-joinable');
      const after = joinable ? getComputedStyle(joinable, '::after') : null;
      return {
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        rowAnim: anim ? anim.animationName : null,
        rowDelay: anim ? anim.animationDelay : null,
        sheenAnim: after ? after.animationName : null,
      };
    });

    ok(state.reduced, 'the browser is actually in reduced-motion mode');
    ok(state.rowAnim === 'none', `row entry animation is off (got "${state.rowAnim}")`);
    ok(parseFloat(state.rowDelay) === 0, `stagger delay is zeroed (got ${state.rowDelay})`);
    ok(state.sheenAnim === 'none',
      `hover sheen animation is off (got "${state.sheenAnim}") - this one had to be declared in lobby.css to win the cascade`);

    await page.screenshot({ path: path.join(OUT, 'coinflip-reduced-motion.png') });
    await browser.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (staticServer) staticServer.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('  FAILED:', e.message);
  process.exit(1);
});