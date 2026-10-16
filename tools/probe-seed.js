/**
 * Probe the local API for what a seeded demo actually needs.
 *
 * Answering three questions the seeder cannot answer by itself:
 *   - is the dev-login account an admin, and does the grant route accept it
 *   - which route serves the pet catalogue
 *   - where the catalogue lives on disk in local JSON mode
 *
 *   node tools/probe-seed.js
 */
const API = process.env.API_BASE || 'http://localhost:5000';

(async () => {
  const r = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'local-admin' })
  });
  const d = await r.json();
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${d.token}` };

  console.log(`\n  dev-login ${r.status}`);
  const flags = [];
  for (const k of ['isAdmin', 'role', 'isOperator', 'isModerator', 'username', 'robloxUsername']) {
    if (d.user && d.user[k] !== undefined) flags.push(`${k}=${JSON.stringify(d.user[k])}`);
  }
  console.log(`  user: ${flags.join(' ')}`);

  for (const p of [
    '/api/admin/items?limit=5',
    '/api/items?limit=5',
    '/api/catalog/items',
    '/api/pet-catalog',
    '/api/values'
  ]) {
    const x = await fetch(`${API}${p}`, { headers: h });
    const t = await x.text();
    let n = '';
    try { const j = JSON.parse(t); n = `items=${(j.items || j.data || j).length ?? '?'}`; } catch (_) { /* not json */ }
    console.log(`  ${p.padEnd(28)} ${x.status}  ${n}  ${t.slice(0, 70).replace(/\s+/g, ' ')}`);
  }

  console.log('');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });