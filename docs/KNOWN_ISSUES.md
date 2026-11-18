# Known Issues

Last updated: 2026-11-18 (Stage 4) · Each issue is confirmed by a test or by reading the code, as noted.

## Open

| ID | Severity | Issue | Evidence | Planned fix |
|---|---|---|---|---|
| KI-3 | Medium (reduced) | The hosted demo page still runs the offline scripted flow (no API is deployed), and that flow's own emergency check treats "gas water heater" as an emergency. The page calls the real API only on localhost or with `?api=` | `index.html`; UI tests | Deploy only with founder approval; widget (Stage 5) |
| KI-6 | High | Site key and origin allow-list are not authentication: non-browser clients can send any `Origin` header and the site key is public | `src/app.js` | Rate limits (done), bot protection, per-business keys rotation, owner auth |
| KI-12 | High | Emergency detector limits: phrase-based, so unusual wording can be missed; the 3-word negation window is a heuristic; "my steam boiler is hissing and shaking" is deliberately not flagged; Spanish rules and Spanish procedure text are unreviewed by a native speaker; other languages are not detected; default procedure texts are **unreviewed by any licensed professional or plumbing business**. Conservative false positives exist (e.g. "sink is leaking badly" is treated as flooding) | Tests; Stage 3 probes found and fixed gaps, so more are likely | Real transcripts; professional review before any real customer use; consider a model second opinion that can only escalate |
| KI-13 | Medium | AI and hosting prices and privacy terms were read through a summarizing fetch tool; no latency measured | `AI_MODEL_EVALUATIONS.md` | Re-verify before any spend; measure latency |
| KI-14 | Medium | Unchecked: Cloudflare free-plan commercial-use terms; R2 export pricing; CPU time of the safety layer and engine on the real Workers runtime (measured only on Node, and the engine not at all) | `PLANS_AND_PRICING.md` | Check terms; measure in a free local Workers runtime |
| KI-15 | High | The D1 adapter and the D1 path in `src/index.js` have **never run against real D1** (tested only against a fake D1 on SQLite). Migrations were never applied with `wrangler`. `node:sqlite` (dev/tests) is experimental in Node 22 | `tests/db.test.mjs` | Create a free D1 database only after founder approval; run migrations and a smoke test |
| KI-16 | Medium | Rate limiting is per IP (`CF-Connecting-IP`) so shared networks share a budget; fixed windows allow up to 2x the limit across a boundary; the database store costs about 2 writes per message (estimate: roughly 7 writes per chat message in total, so about 14,000 messages/day against the D1 Free 100,000-writes/day limit; not measured); the prototype (no-database) mode has no safety exception when rate-limited | Code review; `src/ratelimit` | Measure; tune limits; consider Cloudflare's own rate-limit features after approval |
| KI-17 | High | Customer data is stored in plain columns with no application-level encryption, no retention or deletion policy, and no way for a customer to request deletion. A conversation id is a bearer token (unguessable, but anyone holding it can continue that conversation) | Schema; `docs/SECURITY.md` | Retention/deletion policy, privacy notice, review before real data |
| KI-18 | High (reduced) | A notification is now queued for every saved lead, but only the **mock** provider exists, so no real person is notified. There is still no dashboard. A saved lead therefore still reaches nobody in practice. Do not use with real customers | `src/notify/`; `docs/TEST_CASES.md` | Founder-approved email/SMS provider (adapter slot exists), then dashboard (Stage 5) |
| KI-19 | Medium | The AI response guard is pattern-based and was tested only with the mock provider and hand-written bad replies; a real model may produce unsafe text it does not catch. Slot extraction (names, issue text, urgency) is heuristic and English-only; non-emergency prompts are English only | `src/engine/` | Evaluate with real transcripts and, after approval, a real model |
| KI-20 | Low | Duplicate detection merges by phone or email within 30 days: a shared household phone merges different jobs into one lead (the new issue text is kept only in the lead event). Two simultaneous conversations with the same phone could both create a lead (no unique constraint) | `src/db/tenant.js` | Dashboard review of merged events; transactional dedupe key |
| KI-21 | Low | No schema for users, memberships, plans, or usage; knowledge base documents are stored as one JSON blob per business and can only be set from code or the dev seed | `migrations/` | Later stages |
| KI-22 | Medium | Delivery to the provider is at-least-once. If the database fails after a provider accepted a message, the row stays `sending` and is re-sent after its lease expires with the same idempotency key. The mock (and most real vendors) deduplicates on that key, but this was only tested with the mock | `tests/notify.dispatcher.test.mjs` | Verify with the chosen real provider's idempotency behavior before enabling |
| KI-23 | High | An emergency conversation that never reaches contact capture (the customer stops after the safety message) creates **no lead and no notification**, because notifications hang off saved leads. The customer does get the safety instructions | `src/engine/engine.js` | Decide with the founder whether to alert the business about contact-less emergency chats |
| KI-24 | Medium | Real delivery confirmation is untested: only the mock reports delivery. A real provider's receipts (webhook or status API) need their own adapter code and tests. Until then a real message would stay `sent`, never `delivered`, which is the honest state | `src/notify/mock.js` | Adapter + webhook endpoint with signature checks, after approval |
| KI-25 | High | Business notification contacts can be added only from code. There is no owner login and no verification flow (a code or link sent to the address/phone proving ownership). Sending to an unverified address could expose customer data to the wrong person, so the system refuses unverified contacts, which means every business is `undeliverable` until verification exists | `src/db/notifications.js` | Owner auth + verification flow (Stage 5) |
| KI-26 | High | Notification text contains the customer's name, phone, ZIP and issue and would be sent to a third-party provider and over email/SMS (unencrypted in transit to the recipient's mailbox or phone). No privacy notice, data-processing terms, or retention rules exist | `src/notify/render.js` | Privacy review before any real provider |
| KI-27 | High | No cap on notifications per business or per day. A flood of fake leads (rate limits slow but do not stop it) would, with a real paid provider, send many messages to the owner and cost money. Not an issue with the mock | `src/app.js` | Per-business notification budget, digesting, and spam scoring before enabling a real provider |
| KI-28 | Medium | The scheduled run (cron) and the `waitUntil` dispatch after a lead are written but never ran on the real Workers runtime. Free-plan CPU and subrequest limits for dispatching several messages in one invocation are unmeasured | `src/index.js`, `wrangler.toml` | Test in a local Workers runtime, then real, after approval |
| KI-29 | Low | "Talk to a person" detection is a small English/Spanish phrase list; other phrasings, languages, or frustration without that phrase are missed. There is no live transfer; the bot says so | `src/engine/handoff.js` | Real transcripts; live handoff design |

## Process

New issues are added with an ID, severity, evidence, and planned fix. Fixed issues move to the Resolved table with date and test reference; they are not deleted.

## Resolved

| ID | Date | Resolution |
|---|---|---|
| KI-1 | 2026-11-17 | The Worker now uses the new safety layer. "I smell gas", CO detector alarms, and sewage backups are detected; covered by 99 safety tests and the baseline tests. Remaining detector limits are tracked in KI-12 |
| KI-2 | 2026-11-17 | An incidental mention of "electrical" no longer triggers a shock warning; tested with false-alarm cases |
| KI-9 | 2026-11-16 | Added README, `.gitignore`, docs index |
| KI-11 | 2026-11-17 | Claude GitHub App installed by the founder; Stage 1 pushed and verified |
| KI-4 | 2026-11-17 | Conversation engine and response guard built (`src/engine/`, 40 engine tests). Remaining limits tracked in KI-19. Real business knowledge still requires verified data entry |
| KI-5 | 2026-11-17 | Rate limiting built and tested (`tests/ratelimit.test.mjs`, `tests/app.test.mjs`); the former TODO test is now a passing test. Limits and caveats in KI-16 |
| KI-7 | 2026-11-17 | Businesses are resolved by site key and per-business registered origins in the database; tenant isolation tested (KI-15 covers the real-D1 gap) |
| KI-8 | 2026-11-17 | Verified business emergency procedures are loaded from the business knowledge base and passed to the detector (engine tests, safety tests) |
| KI-18 (partly) | 2026-11-18 | Outbox, dispatcher, retries, priority and escalation built and tested with the mock provider. The remaining risk is tracked in the reduced KI-18 and KI-22 to KI-29 |
