# Test Cases and Results

Last updated: 2026-11-17 (Stage 3)

Run all tests: `npm test` (Node 22.5+, no dependencies, no network, no cost).

Rule: nothing is called production-ready unless the required checks below have passed and the result is recorded here with a date. "TODO" tests are required behavior that does not exist yet. They are expected to fail, are shown as failing, and are never counted as passing.

## Required test categories

| Category | Status |
|---|---|
| Normal customer conversations | Engine happy paths pass (multi-turn capture, several details in one message, unverified facts never stated). Mock AI only |
| Incorrect or missing information | Validation tests (96) and in-conversation rejections pass: bad phones, names, ZIPs, injection-like names. ZIP outside the verified list is stored "unconfirmed", never refused |
| Emergency conversations | 164 safety tests pass (99 + 65 Stage 3: Spanish, water heater, generic emergency, negation fixes). Engine tests confirm safety replies work with the database down, the AI down, and the message cap reached |
| Lead capture | Pass: saved only after transaction + readback; failures reported as NOT saved; retry after recovery saves once; fake-success database detected |
| Failed notifications | Not built (no notifications, KI-18) |
| Human handoff | Not built |
| AI service outages | Router tests plus engine tests: outage gives an honest fallback and a degraded flag; mock text hidden; unsafe AI replies replaced |
| Duplicate leads | Pass: merge by phone/email, window, identical customer reply, no cross-business merging. Race between simultaneous conversations not tested (KI-20) |
| Unauthorized access (including cross-business) | Pass at the data layer and API: cross-tenant read/write/merge denied, composite foreign keys with raw SQL, SQL spy, hostile ids, site key/origin mismatch, suspended business. No owner authentication exists to test |
| Prompt injection | Worker, engine, and safety tested with injection strings against the mock. Not tested against a real model |
| Mobile and desktop interfaces | 19 browser tests (Chromium via Playwright) at 1280x800 and 375x700: live chat, emergency text, lead flow, XSS-as-text, offline/429/unreachable messages, no horizontal scroll. Visual review by a person not done |
| Rate limiting | Pass: burst 429 with Retry-After, window rollover, per-business limit, DB-backed store, store failure fallback. Not load-tested |
| Backup restore drill | Not built |

## Result log

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
