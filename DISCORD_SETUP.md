# Discord Linking Setup

The site links Discord accounts via official Discord OAuth2. One-time setup (about 5 minutes):

## 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> and log in.
2. **New Application** — name it `AMPCOIN` (or anything).
3. Open **OAuth2** in the left menu.
4. Under **Redirects**, click **Add Another Redirect** and paste exactly:
   `https://YOUR-BACKEND.b4a.run/api/auth/discord/callback`
   (replace `YOUR-BACKEND` with your real Back4App domain, e.g.
   `https://ampcoin-xxxx.b4a.run/api/auth/discord/callback`)
5. Save changes.
6. Copy the **Client ID** (OAuth2 page) and **Client Secret**
   (click *Reset Secret* if none is shown — copy it immediately).

## 2. Set backend environment variables (Back4App)

Dashboard → your app → Settings/Environment, add:

| Key                      | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `DISCORD_CLIENT_ID`      | client ID from step 1                                        |
| `DISCORD_CLIENT_SECRET`  | client secret from step 1                                    |
| `DISCORD_REDIRECT_URI`   | same redirect URI as step 1 (the `/api/auth/discord/callback` URL) |
| `CLIENT_URL`             | `https://ampcoin.co.uk` (already set)                        |

Then **redeploy** the backend.

## 3. Done

Users open **Settings** from the header and click **Link Discord** →
approve on Discord → return with the Discord name + avatar shown. One
Discord account can only be linked to one site account. Unlink anytime
from the same Settings modal.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| "Discord linking is not configured" page | env vars missing or backend not redeployed |
| Discord shows `redirect_uri` / "Invalid OAuth2 redirect_uri" | redirect URI in Discord portal must match `DISCORD_REDIRECT_URI` exactly (https, no trailing slash) |
| "Link expired — try again" | took longer than 10 min; click Link Discord again |
| "Already linked to another account" | that Discord is on a different site account; unlink it there first |
