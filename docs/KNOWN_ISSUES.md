# Known Issues

Last updated: 2026-11-16 · Issues found in the Stage 0 prototype during the Stage 1 audit. Each is confirmed by a test or by reading the code, as noted.

| ID | Severity | Issue | Evidence | Planned fix |
|---|---|---|---|---|
| KI-1 | High (safety) | Emergency detection misses common phrasings, e.g. "I smell gas", "CO detector going off", sewage backup | TODO tests 1–3 fail | Replace with broad, tested safety layer (Stage 2) |
| KI-2 | Medium | False emergency: any mention of "electrical" triggers a shock warning | TODO test 4 fails | Context-aware rules + false-positive tests |
| KI-3 | High | Demo page never calls the backend; its own emergency check treats "gas water heater" as an emergency | TODO test 7 fails; `index.html` code | Real widget calling the API |
| KI-4 | High | No knowledge-base use: answers about hours/prices would not be grounded | TODO test 5 fails | Knowledge base + retrieval + response guard |
| KI-5 | High | No rate limiting on public endpoint | TODO test 6 fails | Rate limiting (Stage 4) |
| KI-6 | High | Origin allow-list is not authentication: non-browser clients can send any `Origin` header | Code review (`src/index.js`) | Per-business keys, rate limits, bot protection |
| KI-7 | Medium | Single hardcoded origin and single hardcoded business; no tenant concept | Code review | Multi-tenant data model |
| KI-8 | Medium | Emergency advice text is hardcoded, not drawn from a business's approved procedure; does not mention calling emergency services in every case | Code review | Approved procedures stored per business |
| KI-9 | Low | `README.md` is one line; no `.gitignore` | Files | Fixed in Stage 1 (README, `.gitignore`) |
| KI-10 | Info | Repository is public although described as private | GitHub listing | Founder to change visibility if desired |
| KI-11 | Info | Claude GitHub App not installed; pushes refused | Tool result | Founder to install app, or receive files directly |

## Process

New issues are added with an ID, severity, evidence, and planned fix. Fixed issues are moved to a "Resolved" table with date and test reference, not deleted.

## Resolved

| ID | Date | Resolution |
|---|---|---|
| KI-9 | 2026-11-16 | Added README, `.gitignore`, docs index |
