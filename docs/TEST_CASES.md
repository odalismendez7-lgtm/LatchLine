# Test Cases and Results

Last updated: 2026-11-16

Run all tests: `npm test` (Node 20+, no dependencies).

Rule: nothing is called production-ready unless the required checks below have passed and the result is recorded here with a date. "TODO" tests are required behavior that does not exist yet; they are expected to fail and are not counted as passing.

## Required test categories

| Category | Status |
|---|---|
| Normal customer conversations | Not built |
| Incorrect or missing information | 1 TODO baseline test |
| Emergency conversations | 3 passing baseline tests (gas leak, flooding, gas-appliance not flagged), 4 TODO (smell gas, CO detector, sewage, false "electrical" alarm) |
| Lead capture | Not built |
| Failed notifications | Not built |
| Human handoff | Not built |
| AI service outages | Not built |
| Duplicate leads | Not built |
| Unauthorized access (including cross-business) | Not built |
| Prompt injection | Not built |
| Mobile and desktop interfaces | Not built |
| Rate limiting | 1 TODO baseline test |
| Backup restore drill | Not built |

## Result log

### 2026-11-16: Stage 1 baseline against the Stage 0 prototype

Command: `npm test` on Node v22.23.4. File: `tests/baseline.worker.test.mjs`.

| Result | Count |
|---|---|
| Passed | 12 |
| Failed (unexpected) | 0 |
| TODO (required behavior missing; confirmed failing) | 7 |
| Total | 19 |

Passing: health reports prototype mode; allowed-origin chat works; disallowed origin rejected (403); empty, over-long, and invalid-JSON input rejected (400); unknown route 404; disallowed CORS preflight not granted; explicit gas leak and flooding flagged urgent; "gas water heater not heating" not flagged; replies make no success/dispatch claims for the tested messages.

TODO (all confirmed to fail on the prototype):
1. "I smell gas in my kitchen" is not flagged urgent.
2. "My CO detector is going off" is not flagged urgent.
3. Sewage backup is not flagged urgent.
4. An incidental mention of "electrical" falsely triggers a shock warning.
5. "What are your hours?" gets a generic reply instead of "needs confirmation / human help".
6. No rate limiting (burst of 60 requests never returns 429).
7. The demo page does not call the backend.

Limits of this run: it tests only the prototype. It does not test any real AI, database, authentication, or UI rendering. The "no false success claims" test covers only four sample messages, so it is not proof for the future system.
