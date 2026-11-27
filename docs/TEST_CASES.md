# Test Cases and Results

Last updated: 2026-11-27 (Step 4 website setup onboarding)

Run all tests: `npm test` (Node 22.5+, no network, no cost). The real-runtime files need the free local `wrangler` dev dependency (`npm install`); they skip with a visible reason without it.

Rule: nothing is called production-ready unless the required checks below have passed and the result is recorded here with a date. "TODO" tests are required behavior that does not exist yet. They are expected to fail, are shown as failing, and are never counted as passing.

## 2026-11-27: Step 3 structured service address

GitHub Actions PR run: [45915682629](https://github.com/odalismendez7-lgtm/LatchLine/actions/runs/45915682629) — **1,272 passed, 0 failed**. This run included the Node test suite and real Playwright/Chromium widget browser tests. The PR remains a draft against `stage-6-runtime-validation`; nothing was merged or deployed.

## 2026-11-27: Step 4 website setup onboarding

GitHub Actions PR run: [45916853882](https://github.com/odalismendez7-lgtm/LatchLine/actions/runs/45916853882) — **1,276 passed, 0 failed**. Coverage includes authorized site-key retrieval, HTTPS-only origin validation, duplicate registration, audited origin add/remove, public widget configuration allowed only for registered origins, role-based denial, and desktop/mobile browser tests for the first-run setup page and embed snippet. This is local automated verification only; no hosted Worker, production domain, or real customer website has been connected.

## Required test categories

| Category | Status |
|---|---|
| Normal customer conversations | Engine happy paths pass (multi-turn capture, several details in one message, unverified facts never stated). Mock AI only |
| Incorrect or missing information | Validation tests (96) and in-conversation rejections pass: bad phones, names, ZIPs, injection-like names. ZIP outside the verified list is stored "unconfirmed", never refused |
| Emergency conversations | 164 safety tests pass (99 + 65 Stage 3: Spanish, water heater, generic emergency, negation fixes). Engine tests confirm safety replies work with the database down, the AI down, and the message cap reached |
| Lead capture | Pass: saved only after transaction + readback; failures reported as NOT saved; retry after recovery saves once; fake-success database detected |
| Structured service address | Pass: customer-supplied address parsed into street, unit, city, state; optional prompt/skip; no blocking when urgency, handoff, ZIP decline, or frustration takes priority; malformed and multiline input rejected; address hidden from roles without contact permission. No geocoding/USPS validation |
| Failed notifications | Pass with the mock: provider outage, permanent error, malformed response, timeout, unknown exception, database failure before/after provider acceptance, crashed dispatcher (lease), retry/backoff, exhaustion to `failed` and `needsAttention`. Real providers untested (KI-24) |
| Human handoff | Pass: phrase detection (positive and negative), honest "cannot connect live", handoff notification queued with the lead, repeated requests deduplicated, "NOT received" when it cannot be recorded, emergency priority carried. No live transfer exists |
| AI service outages | Router tests plus engine tests: outage gives an honest fallback and a degraded flag; mock text hidden; unsafe AI replies replaced |
| Duplicate leads | Pass: merge by phone/email, window, identical customer reply, no cross-business merging. Race between simultaneous conversations not tested (KI-20) |
| Unauthorized access (including cross-business) | **Stage 5:** pass over HTTP for the dashboard and account APIs (see the Stage 5 log). Earlier: pass at the data layer and API (now including the notification outbox: contacts, enqueue, claim, settle, reconcile, SQL spy, composite foreign keys, messages built from the right business only): cross-tenant read/write/merge denied, composite foreign keys with raw SQL, SQL spy, hostile ids, site key/origin mismatch, suspended business. Demo authentication only (KI-31) |
| Prompt injection | Worker, engine, and safety tested with injection strings against the mock. Not tested against a real model |
| Mobile and desktop interfaces | **Stage 5:** 21 dashboard browser tests (desktop and phone). Earlier: 19 browser tests (Chromium via Playwright) at 1280x800 and 375x700: live chat, emergency text, lead flow, XSS-as-text, offline/429/unreachable messages, no horizontal scroll. Visual review by a person not done |
| Rate limiting | Pass: burst 429 with Retry-After, window rollover, per-business limit, DB-backed store, store failure fallback. Not load-tested |
| Backup restore drill | Not built |

## Result log

### 2026-11-25: Stage 7 widget + Stage 7B adversarial audit

Full suite **1232 / 1232 pass, 0 fail, 0 skipped** (was 1067 at Stage 6). All on a local runtime: in-memory SQLite, mock AI, Playwright headless Chromium. **None of this is hosted-Cloudflare, real-provider, real-model, real-screen-reader or real-phone verification.**

| Area | Tests | File |
|---|---|---|
| Widget server side (`/widget.js`, `/api/widget/config`, tenant scoping, leakage, size budget, bundle freshness) | 21 | `tests/widget.server.test.mjs` |
| Widget in real Chromium on a separate website origin (mount rules, failures, emergencies, recovery, restart, XSS, accessibility, 375px phone, tablet) | 51 | `tests/widget.browser.test.mjs` |
| Conversation evaluation (64 scenarios, aggregate gates, determinism, metric self-tests, name/probe/long-emergency regressions) | see `eval.conversation.test.mjs` | `tests/eval.conversation.test.mjs`, `tests/eval/conversation.eval.mjs`, results in `CONVERSATION_EVAL.md` |
| Stage 7B tenant/abuse checks (40 interleaved conversations across two businesses, ids, probes) | see file | `tests/adversarial.7b.test.mjs` |

Deliberate test changes: the widget test that pinned "New chat discards a pending reply" now pins "New chat is refused while a reply is pending" (review finding 10: discarding could drop an emergency reply). Existing engine tests were not changed; all 1130 earlier tests still pass after the engine fixes.

See `WIDGET_AUDIT_7B.md` for the defects found, fixes and the independent review.

### 2026-11-23: Stage 6 production-readiness gate

Result: full suite 1067 tests, 1067 pass, 0 fail (1043 before). New: `tests/tenant.isolation.test.mjs` (6), `tests/emergency.workflow.test.mjs` (17), shared `tests/helpers/web.mjs`. Defects reproduced before fixing: R1 (no safety text on business-limit hit, database down at site-key lookup; two tests failed on the old code), R2 (deletion audit row). Mutation checks: scoping removed from one lead query and one dashboard query: the isolation tests failed both times. One existing test was changed deliberately: `tests/app.test.mjs` "database down: chat returns 503" sent "I smell gas" and required no safety text; it now uses a normal message for the 503 case and a new test requires the safety text plus "not saved" for the emergency case.
NOT verified (no access/provider): hosted D1, real email/SMS, delivery receipts, deployed Workers behaviour. Mock services and in-memory SQLite only. Not production-ready: see `PRODUCTION_READINESS_GATE.md`.

### 2026-11-23: Stage 6d independent security and reliability audit

Result: full suite 1043 tests, 1043 pass, 0 fail (991 before; 51 new in `tests/audit.emergency.test.mjs` and 1 new local-D1 probe test for the compare-and-set pattern). Findings, severity, fixes and unresolved risks: `docs/SECURITY_AUDIT_6d.md`. Method: attack scripts first (each suspected bug reproduced before fixing), mutation checks (each fix removed again to prove its test fails), then two independent reviewer passes by agents that had not written the code; the second pass found two more bugs (odd-separator phone redaction, split-emoji text) which were fixed and re-tested. Bugs found: A1 to A10 in the audit document. No test was weakened; the weak assertions the reviewer pointed out (cap test passing with zero alerts) were tightened.

Limits: mock AI, mock notifier, in-memory SQLite and local workerd only. Hosted D1, real delivery, real customers and a real model were NOT tested. Not production-ready.

### 2026-11-22: Stage 6d emergency partial-lead persistence (KI-23/KI-47)

Result: full suite 991 tests, 991 pass, 0 fail (926 before + 65 new in `tests/emergency.partial.test.mjs`; some existing assertions changed deliberately, see below). Covered: abandoned emergency after the safety message (lead + one alert, no contact, nothing invented); incomplete contact (phone only, email only, declined, junk); duplicate and retried messages and parallel requests (one lead, one alert, idempotency keys); tenant isolation (other business cannot read or update the lead); database failure at create/update (customer told NOT saved, safety text still shown, recovery on a later message with no duplicate); notification/outbox failure (lead kept, alert retried, reply never claims notification); later completion (phone/email/ZIP/name update the same lead, one `contact_added` alert); emergency after an ordinary recorded request; emergency after a merged request; reset / never-mind / declined-contact with an existing lead; dashboard filter and counts; alert rendering without contact; seeded random runs with invariants.

Bugs found by the tests and an independent fresh-eyes review, each fixed and kept as a regression test: contradictory "nothing has been recorded" after reset / never mind / declined contact when an emergency lead already existed; reset leaving stale lead state so the next emergency message erased the saved phone; an emergency after a merged request modifying another conversation's lead; emergency text not stored when upgrading an ordinary lead; sewage emergencies mislabelled in alerts; my own patch deleting the yes/no handoff answer after a request was recorded (caught by an existing test).

Deliberate changes to existing tests: emergency question order is now issue, phone, ZIP, name; emergency chats send an extra early alert; migration count is 5 in db/probe/notify tests.

Limits of this run (what it does NOT show):
- Mock notifier and in-memory SQLite only. No real email/SMS delivery, no real D1, no hosted runtime.
- Conversations are scripted/generated; no real customers, no real model (KI-46). Wording not reviewed by a professional (KI-12).
- Not evidence of production readiness. It is not production-ready.

### 2026-11-22: Stage 6c conversation intelligence (deterministic dialogue layer, mock AI only)

Result: full suite 926 tests, 926 pass, 0 fail (790 before this stage + 136 new). New files: `tests/conversation.signals.test.mjs` (signal detectors incl. false-positive lists, odd input, regex speed), `tests/conversation.test.mjs` (scripted transcripts through the real engine and an in-memory database: memory, corrections, repetition, frustration/handoff, stuck recovery, minimal collection, honesty, emergencies, failure recovery, tenant isolation, review regressions), `tests/conversation.property.test.mjs` (guard table, knowledge policy answers, partial leads downstream, 10 seeded random 60-turn runs over two businesses with invariants), `tests/helpers/convo.mjs`.

What the random runs checked on every turn: a non-empty reply; no invented confirmation/arrival/price text; "recorded" only with a real lead for that conversation; no identical consecutive replies; no markup echoed; leads and conversations never cross businesses; stored state stays bounded. A one-off run of 300 extra seeds (not kept as a test) found 0 violations after the fixes below.

Bugs the new tests/review found and fixed (kept as regression tests): empty reply on some state combinations (random run); repeat-reply check silently ignored replies longer than 300 characters (random run); "my name is ..." taken as the problem description; "that's not my phone number" answered with the business phone; reset left the old question; "hi" and instruction-like text stored as the problem; "reset the breaker" wiped the chat; "nothing else works" read as "never mind"; a lead saved in the same turn as "nothing has been recorded"; an annoyed description discarded; "shut it off but still pouring" read as a false alarm; "are you a real person? I want a human" ignored.

Deliberate changes to 2 existing tests (see DECISIONS 60). Checks that the tests can fail: removing the ask cap failed 11 tests, removing the appointment guard rule failed 3, removing the repeat-reply memory failed 4 (each restored).

Limits of this run (what it does NOT show):
- No real language model was used; the mock AI only. Nothing here shows how a real model would answer behind the guards (KI-46).
- All conversations are ones we wrote or generated from a fixed list of messages. No real customer transcripts. English only outside the emergency layer.
- The seeded runs are a bounded search, not a proof. Phrasing we did not think of can still be misread.
- Emergency wording was not reviewed by a licensed professional (KI-12). (Superseded for contact-less emergencies by Stage 6d below.)
- This is not evidence the product or the AI is production-ready. It is not.

### 2026-11-21: Stage 6 runtime validation (real local Cloudflare runtime)

Command: `npm test` on Node v22.23.5, wrangler 4.166.0, workerd 2026-11-19, local D1, after the last change. Branch `stage-6-runtime-validation` from `28c1d0bc`. Full report: `docs/RUNTIME_VALIDATION.md`.

| File | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Existing files (unchanged) | 760 | 760 | 0 | 0 |
| `tests/workerd.runtime.test.mjs` (new) | 18 | 18 | 0 | 0 |
| `tests/workerd.probe.test.mjs` (new) | 12 | 12 | 0 | 0 |
| **Total** | **790** | **790** | **0** | **0** |

What actually ran, on workerd with a real local D1 (migrations applied by `wrangler d1 migrations apply --local`), over real HTTP:
- `workerd.runtime` (14 tests): dashboard page and CSP; registration, simulated verification, login with the full-strength hash stored; no account enumeration; simulated contact verification; a customer chat creating a lead and the mock notification sent by the cron handler, labeled simulated; audit events; cross-business and forged-request denial; **12 concurrent uses of one token (exactly 1 wins) and 14 concurrent wrong logins (exactly 10 counted)**; a real `D1_ERROR` fault giving a clean 503 with nothing half-written and self-recovery; idle/absolute/logout session expiry; persistence across clean restart and **hard kill**, an interrupted send re-sent once; delete without resurrection; runtime output free of passwords, tokens and phone numbers. Plus accounts-OFF (1 test) and **fail-closed hashing under an EMULATED 100,000 cap (3 tests)**.
- `workerd.probe` (12 tests): migrations apply once and re-run as a no-op, schema identical to the Node path; `batch()` atomic, foreign keys enforced, `RETURNING` single-use, raw `BEGIN` rejected; PBKDF2 600,000 runs locally; scrypt available and runs at five OWASP-listed parameter sets, argon2 absent, WebAssembly cannot be compiled at run time; **pinned limitations of the local runtime** (CPU limit not enforced and CPU time reported as 0; memory limit not enforced).

Measurements (not pass/fail): hashing times (`npm run measure:workerd`), D1 queries per request (`npm run count:d1`, most 16), bundle 234 KiB (62.6 KiB gzipped) via `wrangler deploy --dry-run`.

Failures during this work, all mine and fixed (details in `RUNTIME_VALIDATION.md`): a test burst that correctly hit the per-IP login limit, and a schema-comparison filter that missed one bookkeeping table.

Could NOT be tested, and why:
- CPU limits, memory limit and the production PBKDF2 cap: local workerd does not enforce or report them (proven by the pinned tests). Needs a deployed probe on a real Cloudflare account (founder approval).
- Hosted D1, real cron timing, isolate eviction and cold start, a cron sweep with a large backlog (KI-15, KI-40, KI-44).
- Real email, SMS or AI (disabled by design).
- This is not evidence the product is production-ready. It is not.

### 2026-11-19: Stage 6 (runtime and database integration)

Command: `npm test` on Node v22.23.4 with Playwright Chromium available, run after the last code change.

| File | Tests | Pass | Fail | TODO |
|---|---|---|---|---|
| Stage 1-5 files (20 files; `auth.test.mjs` now 46) | 706 | 706 | 0 | 0 |
| `tests/runtime.process.test.mjs` (new) | 25 | 25 | 0 | 0 |
| `tests/worker.runtime.test.mjs` (new) | 12 | 12 | 0 | 0 |
| `tests/worker.ui.test.mjs` (new) | 12 | 12 | 0 | 0 |
| `tests/hash.platform.test.mjs` (new) | 5 | 5 | 0 | 0 |
| **Total** | **760** | **760** | **0** | **0** |

What actually ran:
- `runtime.process`: two servers (the app on Node, and the real Worker entry on a D1-shaped shim) each started as a separate OS process with a real SQLite file and called over real HTTP: registration, simulated verification, login (full-strength hash checked in the file), simulated contact verification, a customer chat creating a lead, mock notification sent and labeled simulated, status update and audit events, cross-business and hostile-id and CSRF/origin attacks, a database write-lock fault (503, no internals, no partial write, no session cookie, self-recovery), idle and absolute session expiry and logout, clean restart (same cookie still valid; leads, contacts, audit, queue, simulated mail persist; stored hash still verifies), a hard kill with an interrupted notification that is re-sent exactly once, delete not resurrecting, and a scan of process output for secrets. Plus the Worker entry with accounts switched off (404 everywhere).
- `worker.runtime`: the real `src/index.js` with the D1 adapter: default-off flag and wrangler.toml check, mailbox flags and localhost rule, missing-salt 503, full account flow, cross-business denial, simulated-mail purge, injected D1 outages (503, no internals, recovery, no enumeration, no partial write), scheduled recovery.
- `worker.ui`: desktop and phone browsers against the Worker-entry process: register, simulated verify, sign in, every section without horizontal scroll, database-outage message, restart keeping the browser signed in, idle-timeout explanation, no CSP/console errors.
- `hash.platform`: a simulated platform that refuses 600,000-iteration PBKDF2: registration and login fail closed with 503, nothing created, no enumeration, old hashes still verify without being replaced by a weaker one; startup guard. Mutation-checked (5 breakages killed).
- `auth.test.mjs`: new test that hashing cannot be weakened without an explicit test-only opt-out.

Mutation checks on Stage 6 code: 9 deliberate breakages (hash guard, accounts flag, dev-mailbox flag, 503 mapping, mailer persistence, session-ended handling, outage message, expired-lease reclaim, mail purge): all 9 killed.

Could NOT be tested, and why:
- Anything on the real Cloudflare local runtime (`wrangler dev`, workerd, Miniflare) or local/real D1: not installed, package downloads blocked here (KI-40, KI-15).
- Password-hash CPU time on Workers (only Node measured; KI-30).
- Workers isolate lifecycle, CPU and subrequest limits, cron on the runtime, behind-HTTPS behavior (KI-39, KI-40).
- Safari/Firefox, accessibility audit, independent review (KI-37).
- This is not evidence the product is production-ready. It is not.

### 2026-11-19: Stage 5

Command: `npm test` on Node v22.23.4 (Playwright Chromium installed), run after the last code change.

| File | Tests | Pass | Fail | TODO |
|---|---|---|---|---|
| Stage 1-4 files (16 files, unchanged counts) | 574 | 574 | 0 | 0 |
| `tests/auth.test.mjs` | 45 | 45 | 0 | 0 |
| `tests/contacts.test.mjs` | 18 | 18 | 0 | 0 |
| `tests/dashboard.test.mjs` | 47 | 47 | 0 | 0 |
| `tests/dashboard.ui.test.mjs` | 21 | 21 | 0 | 0 |
| **Total** | **705** | **705** | **0** | **0** |

Covered: password hashing and policy; registration, verification, login, generic errors and timing; brute-force 429; session expiry (idle, absolute), logout, revocation; recovery; audit contents (no secrets); contact management and simulated verification (expiry, attempts including parallel guesses, cooldown, daily cap, cross-business, real vs simulated, dispatcher refusal of real providers for simulated contacts); HTTP hardening (CSRF, origin, content type, size, headers); role matrix; viewer masking; last-owner and invitation rules; cross-business attacks (every route 404 identical to a nonexistent business, edit/delete/export/verify/invite attempts leave the other business unchanged, hostile ids, body/query overrides, removed members, SQL spy on the new repositories); settings confirmation; CSV injection; honest notification wording; browser tests at 1280x800 and 375x700 (layout, no horizontal scroll, touch targets, hostile markup shown as text, strict CSP with no violations, cookie invisible to scripts, nothing in web storage, simulated labels).

Mutation checks on the Stage 5 code: 19 deliberate breakages (membership check, permission check, same-origin check, CSRF check, contact masking, message redaction, CSV escaping, dispatcher guard, simulated-as-real verification, attempt cap in two places, code expiry, last-owner demote and removal, invitation email match, settings confirmation, tenant filter on a status update, absolute and idle session expiry). 16 killed at once. 3 survived: the two attempt-cap guards (each redundant with the other; removing both together is killed after a parallel-guess test was added) and the tenant filter on the status UPDATE (redundant with the tenant-checked read just before it; the new SQL-spy test now covers it). Bugs found by testing: team routes read the wrong id (fixed); a message popup covered buttons on phones (fixed); toast lost on re-render (fixed).

What this run does NOT show:
- No real email, SMS, or AI was used; account emails and verification codes are simulated (KI-31, KI-36).
- Password hashing cost on Workers is unmeasured (KI-30). Nothing ran on real D1 or Workers, or behind HTTPS hosting (KI-15, KI-39).
- Browser checks are Chromium only, with no accessibility audit and no review by a person (KI-37).
- No load test, no independent security review, same author wrote code and tests.
- This is demo authentication, not production-ready, and the product is not production-ready.

### 2026-11-18: Stage 4

Command: `npm test` on Node v22.23.4, run after the last code change.

| File | Tests | Pass | Fail | TODO |
|---|---|---|---|---|
| `tests/safety.test.mjs` | 99 | 99 | 0 | 0 |
| `tests/safety.stage3.test.mjs` | 65 | 65 | 0 | 0 |
| `tests/validation.test.mjs` | 96 | 96 | 0 | 0 |
| `tests/knowledge.test.mjs` | 32 | 32 | 0 | 0 |
| `tests/ai-provider.test.mjs` | 27 | 27 | 0 | 0 |
| `tests/db.test.mjs` | 29 | 29 | 0 | 0 |
| `tests/ratelimit.test.mjs` | 13 | 13 | 0 | 0 |
| `tests/engine.test.mjs` | 40 | 40 | 0 | 0 |
| `tests/app.test.mjs` | 25 | 25 | 0 | 0 |
| `tests/ui.test.mjs` | 19 | 19 | 0 | 0 |
| `tests/baseline.worker.test.mjs` | 19 | 19 | 0 | 0 |
| `tests/worker.stage2.test.mjs` | 4 | 4 | 0 | 0 |
| `tests/notifications.repo.test.mjs` | 30 | 30 | 0 | 0 |
| `tests/notify.provider.test.mjs` | 21 | 21 | 0 | 0 |
| `tests/notify.dispatcher.test.mjs` | 31 | 31 | 0 | 0 |
| `tests/notify.integration.test.mjs` | 24 | 24 | 0 | 0 |
| **Total** | **574** | **574** | **0** | **0** |

Mutation checks on the Stage 4 code: 34 deliberate breakages (idempotency removed, emergency fan-out reduced, verified-contact check removed, priority ordering, lease/attempt guards, retry limit, delivery-state guard, error-code sanitizing, attention list, tenant scoping of reads, reconcile filter, idempotency key reuse, delivery confirmation logic, provider timeout, provider-identity check, control-character stripping, wording of statuses and emergency text, registry refusal, handoff detection and denial patterns, engine priority and kind mapping, pending-retry logic, API exposure of internal flags). First run: 30 killed, 4 survived. All 4 were real test gaps (lead-missing path, receipt from a different provider, control-character stripping, wording for a real non-simulated provider); tests were added and all 4 are now killed. A bug found while writing tests: the "sending" status text said "not yet accepted by the provider", which is wrong in the case where the provider had accepted but the database write failed; the wording was corrected.

What this run does NOT show:
- No real email or SMS provider exists; nothing real was ever sent. Delivery confirmation exists only for the mock (KI-24).
- Nothing ran on real D1 or the real Workers runtime; cron and `waitUntil` dispatch are untested there (KI-15, KI-28).
- Contact verification, owner login and a dashboard do not exist, so businesses are `undeliverable` in practice (KI-25).
- No load or long-run test; no real transcripts.
- The same author wrote the code and the tests; no independent review has happened.
- This is not evidence the product is production-ready. It is not.

### 2026-11-17: Stage 3

Command: `npm test` on Node v22.23.4, run after the last code change.

| File | Tests | Pass | Fail | TODO |
|---|---|---|---|---|
| `tests/safety.test.mjs` | 99 | 99 | 0 | 0 |
| `tests/safety.stage3.test.mjs` | 65 | 65 | 0 | 0 |
| `tests/validation.test.mjs` | 96 | 96 | 0 | 0 |
| `tests/knowledge.test.mjs` | 32 | 32 | 0 | 0 |
| `tests/ai-provider.test.mjs` | 27 | 27 | 0 | 0 |
| `tests/db.test.mjs` | 29 | 29 | 0 | 0 |
| `tests/ratelimit.test.mjs` | 13 | 13 | 0 | 0 |
| `tests/engine.test.mjs` | 40 | 40 | 0 | 0 |
| `tests/app.test.mjs` | 25 | 25 | 0 | 0 |
| `tests/ui.test.mjs` | 19 | 19 | 0 | 0 |
| `tests/baseline.worker.test.mjs` | 19 | 19 | 0 | 0 |
| `tests/worker.stage2.test.mjs` | 4 | 4 | 0 | 0 |
| **Total** | **468** | **468** | **0** | **0** |

All four Stage 2 TODO tests are now ordinary passing tests (rate limiting, demo page calls `/api/chat`, Spanish emergencies, water-heater steam/banging).

Mutation checks on the new code (temporarily breaking it and confirming tests fail, then restoring byte-for-byte): 24 mutants (tenant scoping removed, list filter removed, readback check removed, duplicate merge disabled, message cap disabled, urgency default, mock-text gate, guard rules, origin check, rate-limit checks, suspended check, safety-on-429, window math, limiter off-by-one, composite foreign key, phone CHECK). First run: 20 killed, 4 survived. Review of the 4: two were real test gaps (phone/email readback comparison; fixed by a new test), one was an equivalent mutant in my test harness (regex still matched; redone and killed), one was dead code that could not matter (`r.saved === true`, removed), and one is an early-exit optimization duplicated by a later size check (Content-Length header; left as is, not independently observable).

What this run does NOT show:
- Nothing ran against real D1, a real AI model, or the real Workers runtime (KI-15, KI-14, KI-19). The D1 adapter was tested against a fake built on SQLite.
- UI tests check behavior, not appearance; a human has not looked at the page on a phone.
- No load, concurrency, or long-running test. No real customer transcripts.
- The same test author wrote the code and the tests. An independent review has not happened.
- This is not evidence the product is production-ready. It is not.

### 2026-11-17: Stage 2

Command: `npm test` on Node v22.23.4. Run after the final code change.

| File | Tests | Pass | Fail | TODO |
|---|---|---|---|---|
| `tests/safety.test.mjs` | 99 | 97 | 0 | 2 |
| `tests/knowledge.test.mjs` | 32 | 32 | 0 | 0 |
| `tests/ai-provider.test.mjs` | 27 | 27 | 0 | 0 |
| `tests/baseline.worker.test.mjs` | 19 | 17 | 0 | 2 |
| `tests/worker.stage2.test.mjs` | 4 | 4 | 0 | 0 |
| **Total** | **181** | **177** | **0** | **4** |

The 4 TODO tests were confirmed to fail (they are required behavior that does not exist):
1. Rate limiting: a burst of 60 requests never returns 429 (KI-5).
2. The demo page does not call the backend (KI-3).
3. Non-English emergency phrasing is not detected (KI-12).
4. Steam and banging from a water heater is not escalated (KI-12).

How the tests were checked for strength (mutation checks, done by temporarily breaking the code and confirming tests fail, then restoring it byte-for-byte):
- Router: 9 deliberate breakages (breaker never skips, success not resetting failures, timeouts not enforced, malformed replies accepted, observer errors not contained, non-retryable errors retried, cost invented without a price, backoff not growing, half-open handling). 8 were caught. The 9th was equivalent code (redundant logic), which was removed rather than left untested.
- Safety: disabling the exemption list, the clause-break rule, or the uncertainty override each made tests fail. The first versions of the tests did **not** catch the clause-break and uncertainty changes; tests were added until they did.
- A negation probe found two real misses ("not just a gas leak", "without warning the pipe burst"). Fixed and added as regression tests.

Local performance (Node, not the Workers runtime): safety layer plus retrieval over 20,000 calls on 5 message types: median 0.017 ms, 95th percentile 0.140 ms, 99th percentile 0.173 ms, maximum 1.008 ms. Workers Free allows 10 ms CPU per request. Must be re-measured on the real runtime.

Limits of this run (what it does NOT show):
- Nothing was tested against a real AI model, a database, authentication, or a browser. The AI tests use the mock provider.
- The emergency phrasings are ones we wrote. Real customers will phrase things we did not think of. The detector has not been tested on real transcripts and its procedures have not been reviewed by a licensed professional.
- Retrieval tests use test knowledge bases; the demo business has no verified facts.
- This is not evidence the product is production-ready. It is not.

### 2026-11-16: Stage 1 baseline against the Stage 0 prototype (historical)

12 passed, 0 unexpectedly failed, 7 TODO (all confirmed failing). The 7 gaps were: "I smell gas", CO detector, sewage backup, false "electrical" alarm, hours question, rate limiting, demo page not calling the backend. Five of these were fixed in Stage 2 (and are now ordinary tests); two remain TODO.
