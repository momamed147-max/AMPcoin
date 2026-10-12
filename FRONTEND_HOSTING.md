# Frontend hosting

The frontend (the site players load) is hosted on **Cloudflare Pages**.
The backend is on Railway.

| Piece | Host | Where |
|---|---|---|
| Frontend | Cloudflare Pages | `ampcoin.co.uk` |
| Backend | Railway, project `captivating-surprise` | `https://ampbet.up.railway.app` |

## Why there is no deploy workflow here

An earlier `release-on-bunny.yml` workflow deployed to Bunny CDN. That account is
not this project's - every run failed at "Set up job" before executing a single
step, so it never deployed anything and never will. It was removed rather than
fixed, because fixing it would have meant shipping to the wrong account.

There is deliberately **no** GitHub Actions workflow for the frontend. Cloudflare
Pages builds it from the repository, and a second deploy pushing to the same
project makes the two fight ("another deployment is in progress").

## If the Pages build needs changing

In the Cloudflare dashboard, Workers & Pages -> the project -> Settings -> Builds:

- **Framework preset**: Create React App
- **Build command**: `npm run build`
- **Build output directory**: `frontend/build`
- **Root directory**: `frontend`

## The one thing that must be set

`REACT_APP_API_URL` = `https://ampbet.up.railway.app`

under Settings -> Environment variables -> Production.

This is compiled into the bundle **at build time**. If it is missing the build
still succeeds and every request goes to `http://localhost:5000`, so the site
looks deployed and is completely dead - no error, just an empty page.

Note that the root `package.json` build script is deliberately a no-op:

    "build": "echo 'Frontend deployed separately on Cloudflare Pages - skipping build'"

so the Pages project must point at `frontend/`, not the repository root.

To check a deploy actually shipped, grep the served bundle for a string only
recent code produces - a stale build is otherwise hard to spot, because the site
keeps working perfectly while being weeks out of date.
