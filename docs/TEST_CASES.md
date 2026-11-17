# Test Cases and Results

Last updated: 2026-11-17

Run all tests: `npm test` (Node 20+, no dependencies, no network, no cost).

Rule: nothing is called production-ready unless the required checks below have passed and the result is recorded here with a date. "TODO" tests are required behavior that does not exist yet. They are expected to fail, are shown as failing, and are never counted as passing.

## Required test categories

| Category | Status |
|---|---|
| Normal customer conversations | Not built (no conversation engine) |
| Incorrect or missing information | Covered for retrieval: unverified/missing facts are never stated (32 knowledge tests, 4 Worker tests). Not covered end to end with a model |
| Emergency conversations | 97 safety tests pass (57 emergency phrasings across 7 categories; 22 no-alarm checks, of which 20 are ordinary questions and 2 are blank inputs; plus negation, uncertainty, injection, approved-procedure, and robustness tests). 2 known gaps tracked as TODO |
| Lead capture | Not built |
| Failed notifications | Not built |
| Human handoff | Not built |
| AI service outages | Router-level tests pass (fallback, retries, timeout, circuit breaker, total outage returns an explicit degraded result). Customer-facing degraded mode not built |
| Duplicate leads | Not built |
| Unauthorized access (including cross-business) | Knowledge isolation tests pass (scoped handle, unknown id, tamper, name probing). No authentication or database exists to test |
| Prompt injection | Safety layer and Worker tested with injection strings. Not tested against a real model |
| Mobile and desktop interfaces | Not built |
| Rate limiting | 1 TODO test (fails) |
| Backup restore drill | Not built |

## Result log

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
