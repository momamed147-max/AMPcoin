# AMPbet Backend — Railway Deploy Guide

## 1. Push (already done — repo is `momamed147-max/AMPcoin`)

## 2. Create the service
1. https://railway.app → New Project → **Deploy from GitHub repo** → pick `AMPcoin`
2. Railway auto-detects Node (`railway.json` handles build/start).
3. No `PORT` var needed — Railway injects it, the server reads `process.env.PORT`.

## 3. Environment variables (Service → Variables)
| Key | Value |
| --- | ----- |
| `DATABASE_URL` | your Neon Postgres URI (`...pooler...neon.tech/...?sslmode=require`) |
| `JWT_SECRET` | long random string (changing it logs everyone out) |
| `CLIENT_URL` | `https://ampcoin.co.uk` |
| `NODE_ENV` | `production` |
| `DISCORD_CLIENT_ID` | (optional, for Discord linking) |
| `DISCORD_CLIENT_SECRET` | (optional) |
| `DISCORD_REDIRECT_URI` | `https://YOUR-RAILWAY-DOMAIN/api/auth/discord/callback` (optional) |

## 4. Domain
- Service → Settings → Networking → **Generate Domain** → you get
  `https://xxx.up.railway.app`.
- If you use that domain for Discord, update `DISCORD_REDIRECT_URI` to match it
  and mirror it in the Discord developer portal.

## 5. Point the frontend at it
Cloudflare Pages → `dasdif123`/new project → env var:
- `REACT_APP_API_URL` = `https://xxx.up.railway.app` (no trailing slash)
- Redeploy frontend.

## 6. Verify (in browser)
- `https://xxx.up.railway.app/api/auth/discord/status` → `{"configured":true/false}`
  (either JSON = server alive; `false` just means Discord env vars missing)
- `https://xxx.up.railway.app/api/items` → item array

## Staff roles
- Full admins retain the complete operations console.
- In **Admin Panel → Manage Users**, an admin can use **Make Moderator**.
- Moderators receive a restricted console with only **Dashboard** and **Manage Users**.
- The moderator user list exposes only the **Mute/Unmute** action; all other admin APIs remain admin-only.

## Notes
- First boot with an empty DB auto-imports `backend/db/*.json` seed files.
- Healthcheck hits `/api/auth/discord/status` (public, no auth).
- Logs: Railway service → Deployments → View Logs. If you see
  `FATAL: JWT_SECRET env var is required in production`, that var is missing.
