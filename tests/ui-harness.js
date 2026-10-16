/**
 * Boots whatever this suite needs, so it cannot silently report "0 passed".
 *
 * run-all.js starts the backend on :5000 but has no reason to serve the built
 * frontend on :3000, and it leaves the lobby empty. Two suites in this repo have
 * already reported 0 passed for exactly that reason, which reads like a pass and
 * is really a skip - so this one takes responsibility for its own prerequisites
 * and seeds its own rows.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const BUILD = path.join(__dirname, '..', 'frontend', 'build');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1200, () => { socket.destroy(); resolve(false); });
  });
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') url = '/index.html';
    const file = path.join(BUILD, url);
    if (!file.startsWith(BUILD)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) {
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

/**
 * Put joinable rows in the lobby, from accounts other than the viewer.
 */
async function seedLobby(API) {
  const loginAs = async (name) => {
    const res = await fetch(`${API}/api/auth/dev-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name }),
    });
    if (!res.ok) return null;
    return res.json();
  };

  const inventoryOf = async (who) => {
    const inv = await (await fetch(`${API}/api/users/inventory/${who.user.id}`, {
      headers: { Authorization: `Bearer ${who.token}` },
    })).json();
    return (inv.items || []).filter((i) => Number(i.value) > 0 && (i.quantity || 1) >= 1);
  };

  const logins = await Promise.all(['tester', 'local-player-2'].map((n) => loginAs(n)));
  const creators = logins.filter((who) => who && who.user && who.token);
  let created = 0;
  for (const who of creators) {
    const items = await inventoryOf(who);
    if (items.length < 2) continue;
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
  return created;
}

module.exports = { portInUse, startStaticServer, seedLobby, BUILD };