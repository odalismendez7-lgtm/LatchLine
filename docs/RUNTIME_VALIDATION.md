# Runtime Validation: the real local Cloudflare runtime

Date: 2026-11-21 · Branch: `stage-6-runtime-validation` (from commit `28c1d0bc`; `main` untouched) · Status: **validation only. Nothing deployed, no account, no remote database, no paid plan, no real email or hosting.**

This is the first time LATCHLINE ran on the real local Cloudflare runtime. Until now only a Node stand-in had been used (KI-40).

## In plain words

- The app **does run** on the real local runtime (workerd) with a real local D1 database. Registration, sign-in, sessions, leads, notifications (mock), tenant isolation, restarts, a hard kill and a database fault all behaved correctly. **30 new tests pass; the whole suite is 790 passing, 0 failing, 0 skipped.**
- The big question, whether password hashing can run on Cloudflare, is **still not answered.** The local runtime ran the full-strength hash (600,000 PBKDF2 iterations) fine, but Cloudflare's own engineers have said the open-source runtime removed a 100,000-iteration cap that the hosted service **kept**. So this local success is not evidence that it works once deployed. The only real answer needs a Cloudflare account and a deployed test Worker, which needs your approval (see "Decisions for the founder").
- The local runtime **cannot check CPU or memory limits at all** (it neither enforces nor reports them). I proved that, so the CPU-limit part of this validation could only be done by measuring wall-clock time and comparing it to Cloudflare's published limits.
- Password hashing stays **fail-closed and full strength.** Nothing was weakened and no replacement was chosen. The options, measured costs and trade-offs are below.

## What was installed (all free, all local)

| Tool | Version | Notes |
|---|---|---|
| `wrangler` | 4.166.0 | dev dependency in `package.json` (committed with `package-lock.json`, all packages from registry.npmjs.org) |
| `workerd` | 2026-11-19 | comes with wrangler |
| Local D1 | via wrangler/Miniflare | a SQLite file under the `--persist-to` folder |

No `wrangler login`, no API token, no account id was used or needed. `wrangler` was started with `--local` and metrics off. One thing it does do on start: it tries to fetch placeholder `Request.cf` data from Cloudflare (a read-only lookup). In this sandbox that was blocked, wrangler printed a warning and used a default, and nothing was harmed. Our code does not use `request.cf`.

## Results against your checklist

| # | You asked to verify | Result | Evidence |
|---|---|---|---|
| 1 | Migrations | **Pass.** `wrangler d1 migrations apply --local` applied all 4 files to an empty database; a second run was a clean "No migrations to apply"; each is recorded once. The resulting schema is **identical** to the one the Node test path builds (only each tool's own bookkeeping table differs) | `tests/workerd.probe.test.mjs` |
| 2 | Transactions | **Pass.** D1 `batch()` is all-or-nothing (a failing 2nd statement rolled back the 1st). Foreign keys are enforced by D1 without any PRAGMA. `UPDATE ... RETURNING` works and a second claim of the same row returns nothing. A raw `BEGIN` is **rejected** by D1; the app never uses one on D1 (only `batch()`), so this is a documented limit, not a bug | probe tests; `grep` of `src/` |
| 3 | Authentication | **Pass** on workerd: register, simulated verification, login, full-strength hash stored, wrong password and unknown email give identical answers, cross-business access is 404, forged CSRF/origin is 403 | `tests/workerd.runtime.test.mjs` |
| 4 | Sessions | **Pass.** Idle timeout, 12-hour absolute limit, logout; the same cookie still works after a runtime restart | same file |
| 5 | Failure handling | **Pass.** A database fault (a table the write needs is missing, which makes D1 return a real `D1_ERROR`) gave a clean 503 `temporarily_unavailable` with `Retry-After`, no internals in the response, nothing half-written, reads still worked, and it recovered by itself. Concurrency: 12 simultaneous uses of one single-use token, exactly 1 won; 14 simultaneous wrong logins, exactly 10 counted (the limit), rest 429 | same file |
| 6 | Persistence | **Pass.** Data, sessions, simulated mail, audit log and notification queue survive a clean restart (SIGTERM) and a hard kill (SIGKILL); an interrupted send was re-sent once, not duplicated; a deleted lead stayed deleted | same file |
| 7 | Fail-closed hashing | **Pass** on workerd with an **emulated** 100,000 cap (see below): registration and login answer 503 `auth_unavailable` for known and unknown emails alike, no user/business/session/token/email/weaker hash is created, an existing 600,000-iteration hash is left untouched | `tests/workerd.runtime.test.mjs` (3 tests) |
| 8 | CPU limits | **Cannot be validated locally** (see next section). Measured wall time instead | `tests/workerd.probe.test.mjs` |
| 9 | Other Worker constraints | Bundle **234 KiB** (62.6 KiB gzipped). Most **D1 queries in one request: 16** (the request that creates a lead), against the Free-plan limit of 50. Output of the runtime never contained passwords, tokens or phone numbers. Memory limit: **cannot be validated locally** | `npm run count:d1`; `wrangler deploy --dry-run` |
| 10 | Accounts OFF by default | **Pass** on workerd: with the flags off there is no dashboard, no account API, no mailbox; health works | same file |

## What the local runtime can NOT tell us (pinned by tests so a change is noticed)

1. **CPU limits are not enforced.** With `[limits] cpu_ms = 10` configured, a ~2.4 second compute loop completed with `ok`.
2. **CPU time is not reported.** workerd's own trace says `cpu_time_ms: 0` for a 600,000-iteration hash that took ~80 ms. Clocks inside a Worker also do not advance during synchronous work, so code cannot time itself; all timings here are measured from outside.
3. **Memory limit is not enforced.** A 200 MB (and, in a manual check, 300 MB) allocation succeeded; Cloudflare documents 128 MB per isolate.
4. **No PBKDF2 iteration cap locally**, while production reportedly has one (next section).
5. **It is not hosted D1.** Local D1 is a SQLite file. Hosted D1's replication, latency, quotas, Time Travel backups and failure modes are untested.
6. **Cron was run by hand** (`--test-scheduled`), not by the real schedule trigger.
7. **Isolate eviction and cold starts** were not simulated (restarts were). The Worker keeps its app in module memory (KI-39).

## Password hashing: what is known, measured, and not known

### The limit
- Cloudflare's workerd issue #1346 (read through a cached mirror; the date was not shown) says Workers cap Web Crypto PBKDF2 at **100,000 iterations** to prevent denial of service, because CPU limits cannot interrupt BoringSSL mid-hash. A maintainer said the open-source workerd made the limit configurable with the default **removed**, while **production keeps the current limit** "for at least some period of time". The issue was still open. That matches what I saw: 600,000 runs locally.
- Our code requires 600,000 (OWASP guidance for PBKDF2-HMAC-SHA256) and refuses to start below that. If production refuses it, every sign-up and sign-in answers 503 (fail-closed). That is the safe failure, but it means **no one could register on a deployed Free or Paid Worker** until this is resolved.
- Cloudflare's published CPU limit is a separate matter: **10 ms (Free)**, 30 s default and up to 5 min (Paid). Source: developers.cloudflare.com/workers/platform/limits (read through a summarizing fetch tool, KI-13).

### Measured on workerd (this computer: 2 vCPU Intel Xeon 2.3 GHz; median of 15 requests; "over idle" = minus a 4.1 ms empty request)

| Option | Over idle (ms) | Max (ms) |
|---|---|---|
| PBKDF2-SHA256 100,000 (the reported production cap) | 12 | 19 |
| PBKDF2-SHA256 300,000 | 42 | 51 |
| **PBKDF2-SHA256 600,000 (current setting)** | **78** | 95 |
| PBKDF2-SHA512 210,000 | 86 | 135 |
| scrypt N=131072 r=8 p=1 (~128 MiB) | 262 | 286 |
| scrypt N=65536 r=8 p=2 (~64 MiB) | 256 | 301 |
| scrypt N=32768 r=8 p=3 (~32 MiB) | 177 | 210 |
| scrypt N=16384 r=8 p=5 (~16 MiB) | 136 | 162 |
| scrypt N=8192 r=8 p=10 (~8 MiB) | 133 | 142 |

Reading it: Node measured 78 ms for the same 600,000 hash, so workerd adds no extra cost. **Even the 100,000-iteration cap costs ~12 ms here, over the Free plan's 10 ms CPU budget.** Production hardware may be faster or slower; these are for comparing options, not promises. Hashing time is almost all CPU (native crypto), so wall time here is a fair upper-bound estimate of CPU time, but that is an estimate, not a measurement.

### Options (none chosen; none implemented)

| Option | Tested here? | What we know | Trade-offs and cost |
|---|---|---|---|
| **A. Keep PBKDF2-SHA256 600,000 via Web Crypto** | Runs locally; production unknown | Works on local workerd. Production reportedly refuses above 100,000 | Cheapest and already built and tested. May be impossible on the hosted service. Needs a real deployed test to know |
| **B. scrypt via `node:crypto` (needs the `nodejs_compat` flag)** | Yes, locally | Available and ran at all five OWASP-listed parameter sets. 133-262 ms. Cloudflare's docs list scrypt as supported with no stated cap; whether production has one is **untested** | Different algorithm (memory-hard, good). 2-3x the CPU of option A. Needs a new hash format (our hashes already name their algorithm, so the format can coexist) and new tests. The 128 MiB setting cannot fit Cloudflare's documented 128 MB isolate memory; 32 MiB or less would be the realistic range |
| **C. PBKDF2 with 100,000 or fewer iterations** | Measured only | Fits any cap | **This is weakening.** Roughly 6x cheaper for an attacker who steals the database than the OWASP setting. **Not done and not recommended** without an explicit founder decision |
| **D. Argon2id** | Partly | `crypto.argon2` is **not** available in workerd. WebAssembly **cannot be compiled from bytes at run time** ("disallowed by embedder"), so WASM libraries that embed the module as base64 fail. A precompiled `.wasm` import might work: **untested** | OWASP's first choice, but adds a third-party dependency and a build step, and its memory and CPU use on Workers are unknown |
| **E. Workers Paid plan** | n/a | $5/month minimum includes 10M requests and 30M CPU-ms; overage $0.30 per million requests and $0.02 per million CPU-ms (pricing page dated 2026-11-18). At ~80 ms per hash that is ~375,000 hashes per month included (my arithmetic) | Fixes the **CPU** limit, but by itself does **not** remove a PBKDF2 iteration cap (the cap was set separately). Costs money: needs founder approval |
| **F. No passwords** (passkeys or emailed one-time links) | No | Would avoid hashing cost entirely | Emailed links need a real email provider (KI-31) and approval; passkeys need a different login design. Large change |
| **G. External identity service, or sign-in hosted elsewhere** | No | Not researched | Moves hashing off Workers. Adds a vendor, a dependency, privacy questions and likely cost |

**On the Free plan** (10 ms CPU), none of the hashing options above fit, measured here. So the Free plan cannot support password sign-in at any acceptable strength; this is a hosting-cost question for the founder, not a code bug.

### The test that would settle it
Deploy a one-endpoint **probe Worker** (no customer data, no secrets; it would only report whether a hash of N iterations succeeded and how long it took) to a real Cloudflare account and call it. This is the only way to learn the true production cap and CPU behaviour. It needs a Cloudflare account and a public URL, so **it has not been done and needs your explicit approval.** `scripts/probe/worker.js` is already written for it.

## Failures and limitations hit during this validation (honest log)

1. **Two failures were my own test bug, not product bugs.** My first concurrency test sent 30 logins from one client, which used up the real per-IP limit of 30 per 15 minutes, so later logins correctly got 429. Reduced to 14 and rerun: 18/18.
2. **One schema-comparison failure was my filter,** which excluded only one of the two migration tools' bookkeeping tables. The real app schemas are identical. Fixed and rerun: 12/12.
3. **The "write lock" fault used in the Node tests was not reused.** It does not apply to D1. I used a missing-table fault instead (a real `D1_ERROR`). Lock contention behavior on hosted D1 is untested.
4. **D1 query counts were measured on the Node stand-in** using the same Worker code (call counts come from our logic, not the runtime). A cron sweep with a large backlog was **not** measured; it could exceed the Free-plan limit of 50 queries per invocation (KI-44).
5. Limits quoted from Cloudflare's docs were read through a summarizing fetch tool, and the workerd issue through a cached mirror with no date. Re-verify before any spend or deployment (KI-13).
6. Sandbox note: Wrangler's `Request.cf` lookup was blocked (harmless); a proxy warning and an "AI agent" notice appear in its output.

## Decisions for the founder (no action taken)

1. **Approve one real-runtime hashing test?** A throwaway probe Worker on a free Cloudflare account answers the production-cap question definitively. Exposes a public URL (with no data); no cost on the Free plan.
2. **Hosting plan:** password sign-in cannot fit the Free plan's 10 ms CPU limit (measured). Workers Paid is $5/month minimum. Plan prices ($99/$199/$299) remain provisional until cost research is done.
3. **If production caps PBKDF2:** choose between options B, D, F or G above. I will not choose or implement one without your decision and a real-runtime test of it.

## Reproduce

```
npm install
npm run test:workerd        # 30 tests on workerd + local D1 (about 60 s)
npm test                    # everything (790 tests; the workerd files skip with a reason if wrangler is missing)
npm run measure:workerd     # hashing timing table
npm run count:d1            # D1 queries per request
npm run migrate:local && npm run dev:workerd   # run the app on workerd at http://127.0.0.1:8787
```
