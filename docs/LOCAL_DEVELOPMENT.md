# Local Development

Everything here is free, runs only on your computer (127.0.0.1), uses a local database file, and sends nothing to anyone. **No account, no payment, no deployment.** Requires Node 22.5 or newer (`node --version`).

## What each command really is

| Command | What runs | Is it the Cloudflare runtime? |
|---|---|---|
| `npm run dev` | `scripts/dev-server.mjs`: the app (`createApp`) on Node, SQLite file `.data/dev.sqlite`, mock AI, mock notifier, **simulated** account email | No |
| `npm run dev:worker` | `scripts/worker-sim.mjs`: the **real Worker entry `src/index.js`** and the real D1 adapter, on Node, with a D1-*shaped* object over a SQLite file `.data/worker-sim.sqlite` | **No.** Not workerd, no CPU limit, not real D1 (KI-40) |
| `npm test` | Every automated test (unit, in-process API, real child-process runtime tests, browser tests, and the workerd tests below) | Partly: the `workerd.*` files run on the real local runtime |
| `npm run test:workerd` | The 30 tests on **workerd + local D1** (free, local only) | **Yes (local):** real workerd and local D1; it cannot show CPU/memory limits or the production hashing cap (KI-30, KI-40) |
| `npm run migrate:local` then `npm run dev:workerd` | `wrangler d1 migrations apply --local`, then the app on workerd at http://127.0.0.1:8787 (state in `.data/wrangler`) | Yes (local) |
| `npm run measure:workerd` | Times hashing options on workerd | Wall time only; no CPU limit applies locally |
| `npm run count:d1` | Counts D1 queries per request | Counts come from our code |
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

Since 2026-11-21 the app runs on the real local Cloudflare runtime. What is still not possible locally:

| Not done | Why | What is needed |
|---|---|---|
| Workers CPU and memory limits | Local workerd neither enforces nor reports them (proven by `tests/workerd.probe.test.mjs`) | A deployed probe Worker on a real Cloudflare account: founder approval |
| The production PBKDF2 iteration cap and hash CPU on Workers | Local workerd has no cap; production reportedly has one (KI-30) | Same |
| Hosted D1 behavior | Local D1 is a SQLite file | A real Cloudflare account and database: founder approval. Do **not** create one without it |
| Cron on its real schedule; isolate eviction and cold start | The cron handler is run by hand; restarts are tested, evictions are not | Deployed Worker |
| Real email/SMS/AI | Disabled by design | Founder approval |

Full results: `docs/RUNTIME_VALIDATION.md`.

## Real local runtime (VERIFIED 2026-11-21 with wrangler 4.166.0 and workerd 2026-11-19)

Free and local-only; it never logs in and never contacts a Cloudflare account when `--local` is used. `npm install` installs wrangler (needs network once). The checked-in `wrangler.local.example.toml` is the local config (you do not need to copy it):

```
npm install
npm run migrate:local     # wrangler d1 migrations apply latchline-local --local  (database in .data/wrangler)
npm run dev:workerd       # http://127.0.0.1:8787  (dashboard: /app, simulated mailbox: /app#dev)
npm run test:workerd      # the 30 real-runtime tests (uses temporary folders, not .data)
```

The example file sets `LATCHLINE_ACCOUNTS = "mock-local"` and the dev mailbox flag **only for this local use**. Never put those in the checked-in `wrangler.toml`: a test fails if you do. Wrangler may print a warning that it could not fetch `Request.cf` (harmless; it falls back) and, if a proxy is set, a proxy notice. Stop with Ctrl+C; leftovers can be cleared with `pkill -f workerd`.
