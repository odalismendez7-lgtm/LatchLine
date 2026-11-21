# Local Development

Everything here is free, runs only on your computer (127.0.0.1), uses a local database file, and sends nothing to anyone. **No account, no payment, no deployment.** Requires Node 22.5 or newer (`node --version`).

## What each command really is

| Command | What runs | Is it the Cloudflare runtime? |
|---|---|---|
| `npm run dev` | `scripts/dev-server.mjs`: the app (`createApp`) on Node, SQLite file `.data/dev.sqlite`, mock AI, mock notifier, **simulated** account email | No |
| `npm run dev:worker` | `scripts/worker-sim.mjs`: the **real Worker entry `src/index.js`** and the real D1 adapter, on Node, with a D1-*shaped* object over a SQLite file `.data/worker-sim.sqlite` | **No.** Not workerd, no CPU limit, not real D1 (KI-40) |
| `npm test` | Every automated test (unit, in-process API, real child-process runtime tests, browser tests) | Same limits as above |
| `npm run dev:reset` | Deletes the local databases under `.data/` | n/a |
| `npm run measure:hash` | Times password hashing on this computer | Measures Node, not Workers |

## Start

```
npm run dev            # http://127.0.0.1:8787   (dashboard: /app)
# or, to run the Worker entry code path:
npm run dev:worker     # http://127.0.0.1:8788   (dashboard: /app)
```

Options (environment variables): `PORT`, `DB_PATH` (a file path, or `:memory:` to keep nothing), `SCHEDULE_MS` (how often the notification retry sweep runs; default 5000).

## Use the demo dashboard

1. Open `/app#register`, create an account. **No real email is sent.**
2. Open `/app#dev` (the simulated mailbox, development only, labeled SIMULATED) and click "open link" on your verification message.
3. Sign in at `/app`.
4. Contacts: add one, "Send code", read the code in `/app#dev`, confirm. It becomes **simulated-verified**, never "verified".

The demo chat page is `/` on the `npm run dev` server. Note: a business you register yourself has a site key and no registered website origin, and the dashboard has no screen for either yet (KI-42), so only the built-in demo business (`demo-plumbing`) accepts chat in the browser.

## Stop, restart, reset

- Stop: press Ctrl+C in the terminal (it shuts down cleanly; data is kept).
- Restart: run the same command. Accounts, sessions (you stay signed in), leads, settings, contacts, the notification queue and the simulated mailbox are all still there. In-memory rate-limit counters reset.
- Reset everything: stop the server, then `npm run dev:reset`.

## Test

```
npm test
```

All tests need no network. Browser tests need Playwright with Chromium and are skipped, with a visible reason, if it is missing. If `playwright` is installed outside the project, set `NODE_PATH` to the folder that contains it.

Tests that start real servers pick random ports between 20000 and 40000; in the rare event of a clash, rerun.

## What could NOT be tested here (be honest about it)

| Not done | Why | What is needed |
|---|---|---|
| Running on the real local Workers runtime (`wrangler dev` / workerd / Miniflare) | These npm packages were not installed and this environment blocked package downloads | Allow package installs, then follow "Real local runtime" below |
| Real D1 behavior, including local D1 | Same | Same. Do **not** create a remote database |
| Password-hash CPU time on Workers | Needs workerd | Same. Node numbers are in `KNOWN_ISSUES.md` KI-30 |
| Worker isolate and CPU/subrequest limits, cron on the real runtime | Needs workerd | Same |
| Real email/SMS/AI | Disabled by design | Founder approval |

## Real local runtime (UNVERIFIED: written but never run)

Free and local-only; it never contacts Cloudflare when `--local` is used and no account is needed. Needs network access once to download the packages:

```
npm install --save-dev wrangler
cp wrangler.local.example.toml wrangler.local.toml
npx wrangler d1 migrations apply latchline-local --local -c wrangler.local.toml
npx wrangler dev --local --persist-to .data/wrangler -c wrangler.local.toml
```

The example file sets `LATCHLINE_ACCOUNTS = "mock-local"` and the dev mailbox flag **only for this local use**. Never put those in the checked-in `wrangler.toml`: a test fails if you do.
