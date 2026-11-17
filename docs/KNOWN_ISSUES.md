# Known Issues

Last updated: 2026-11-17 · Each issue is confirmed by a test or by reading the code, as noted.

## Open

| ID | Severity | Issue | Evidence | Planned fix |
|---|---|---|---|---|
| KI-3 | High | Demo page never calls the backend; its own emergency check treats "gas water heater" as an emergency | TODO test fails; `index.html` code | Real widget calling the API (Stage 5) |
| KI-4 | Medium (reduced) | Retrieval exists and the Worker uses it, but there is no conversation engine or response guard, and no real business knowledge base. The Worker answers only from the demo business, which has no verified facts | Code review | Conversation engine + response guard (Stage 3) |
| KI-5 | High | No rate limiting on the public endpoint | TODO test fails | Rate limiting (Stage 7) |
| KI-6 | High | Origin allow-list is not authentication: non-browser clients can send any `Origin` header | Code review (`src/index.js`) | Per-business keys, rate limits, bot protection |
| KI-7 | Medium | Single hardcoded origin and single hardcoded business; no tenant concept in the Worker | Code review | Multi-tenant data model (Stage 3) |
| KI-8 | Low (reduced) | The detector supports verified per-business emergency procedures, but the Worker does not load any because there is no database yet | Code review | Load from the business knowledge base (Stage 3) |
| KI-10 | Info | Repository is public although described as private | GitHub listing | Founder to change visibility if desired |
| KI-12 | High | Emergency detector limits: English only; phrase-based, so unusual wording can be missed; no rule for steam/pressure hazards from a water heater; the 3-word negation window is a heuristic that could suppress a real emergency in rare phrasing; default procedure texts are **unreviewed by any licensed professional or plumbing business** | 2 TODO tests fail; probes during Stage 2 found and fixed other gaps, so more are likely | Expand tests with real transcripts; professional review of procedures before any real customer use; consider a second-opinion check by the model that can only escalate, never suppress |
| KI-13 | Medium | AI and hosting prices and privacy terms were read through a summarizing fetch tool; OpenAI pricing came from one fetch. No official latency data exists for any provider and we have measured none. Several prices change on announced dates | `AI_MODEL_EVALUATIONS.md` | Re-verify on official pages before any spend; measure latency in Stage 3 |
| KI-14 | Medium | Unchecked: whether Cloudflare's free plan terms allow commercial use; R2 export pricing; behavior of the safety layer's CPU time on the real Workers runtime (measured only on Node) | `PLANS_AND_PRICING.md` | Check terms; measure on the Workers runtime in a free local runtime test |

## Process

New issues are added with an ID, severity, evidence, and planned fix. Fixed issues move to the Resolved table with date and test reference; they are not deleted.

## Resolved

| ID | Date | Resolution |
|---|---|---|
| KI-1 | 2026-11-17 | The Worker now uses the new safety layer. "I smell gas", CO detector alarms, and sewage backups are detected; covered by 99 safety tests and the baseline tests. Remaining detector limits are tracked in KI-12 |
| KI-2 | 2026-11-17 | An incidental mention of "electrical" no longer triggers a shock warning; tested with false-alarm cases |
| KI-9 | 2026-11-16 | Added README, `.gitignore`, docs index |
| KI-11 | 2026-11-17 | Claude GitHub App installed by the founder; Stage 1 pushed and verified |
