# Stage 6 production-readiness gate (2026-11-23)

**Verdict: NOT production-ready.** Two of the seven gate items could not be performed at all for lack of access, one needs a founder decision, and a real emergency alert cannot reach a person today because no real notification provider exists. Passing tests prove only what they test (mock services, in-memory SQLite, local workerd).

Suite: **1067 tests, 1067 pass, 0 fail** (1043 before this gate). Branch `stage-6-runtime-validation` only; nothing deployed, no account/resource created, no real message sent, no customer data.

| # | Gate item | Result |
|---|---|---|
| 1 | KI-55 alert flooding | Design + tradeoffs written (`ALERT_FLOOD_PROTECTION.md`). Suppression/merging **not implemented** (needs your decision). Safety-text defect found and fixed (R1) |
| 2 | Hosted D1 verification | **NOT DONE: no access.** `wrangler whoami`: "You are not authenticated". No credentials, no D1 binding in `wrangler.toml`; creating a database or `wrangler deploy --temporary` is forbidden by your rules. KI-60 |
| 3 | Real delivery verification | **NOT DONE: nothing real exists.** The registry refuses every provider except the mock and `src/index.js` wires only the mock. No credentials, no test recipients. KI-61 |
| 4 | Tenant isolation | Systematic review done: no cross-tenant leak found (see below) |
| 5 | Emergency workflow | Traced end to end; 1 defect group fixed (R1), 1 gap documented (KI-59) |
| 6 | Deletion / retention (KI-52) | Investigated, reproduced, documented, audit trail improved, safe solution proposed (not built) |
| 7 | Regression tests | 24 new tests in 3 new files + 1 deliberate edit to an old test |

## Defects and risks

| ID | Severity | Finding | Reproduction evidence | Fix | Tests | Environment verified | Remaining |
|---|---|---|---|---|---|---|---|
| R1 | **High** | A person describing an emergency received **no safety guidance** (bare 429/503/500) when the business's own request limit tripped (which an alert flood causes), when the database could not be read at the site-key lookup, or on an unexpected exception. The 503/500 replies also had no CORS header, so a browser could not even read them | `tests/emergency.workflow.test.mjs` "REPRO" block failed on the old code (429 and 503, no safety text); the old `tests/app.test.mjs` test even asserted the 503 for "I smell gas" | `src/app.js`: every failure path now falls back to the pure-code safety reply with an honest "not saved / nothing sent" sentence (`notSavedReason`: rate, busy, unavailable); readable from any site only when the origin cannot be verified (the reply holds no private data) | 5 tests + the changed `app.test.mjs` test | In-memory SQLite, mock AI | Not tested on hosted Workers/D1; the wording is not professionally reviewed (KI-12) |
| R2 | Medium | Deleting a lead erased the evidence of what was lost: the audit row did not say it was an emergency or that alerts were unsent | New KI-52 test failed on old code | Audit row now records emergency, hadContact, alertsNotYetSent (no customer details) | 1 test | In-memory SQLite | Cascade delete itself unchanged (KI-52) |
| KI-52 | Medium | Delete cascades to conversation, history and unsent alerts; later messages start a new conversation with no emergency context | 3 pinning tests | Documented; proposal: soft delete + confirm for emergency leads with unsent alerts | 4 tests | In-memory SQLite | **Needs your approval** (migration, retention policy) |
| KI-59 | High | An emergency rejected by a limit or by an outage is saved nowhere and the business is never told it was attempted | KI-55 flood tests (30 of 50 refused, no trace) | None (needs a decision) | measured in tests | In-memory SQLite | Option B in the flood doc |
| KI-55 | Medium | No cap on alert volume/cost | Flood test: 20 leads and 40 alerts from 50 clients at a 20/min limit; real limits allow ~600 leads / ~1,200 alerts per minute | Design only | 2 measuring tests | Mock | Founder decision, Turnstile access |
| KI-60 | High | Hosted D1 unverified | `wrangler whoami` | none possible | none | none | Cloudflare access + approval |
| KI-61 | High | No real provider, so no real alert can be delivered | `src/notify/registry.js`, `src/index.js` | none possible | mock only | none | Provider + adapter + approval |

## Tenant isolation review (item 4): result and method
No leak or cross-tenant write was found, and the three test levels cannot be passed by accident (I broke the scoping in two places and both tests failed, then restored it).
1. **Static scan** (permanent test): every SQL statement in `src/` that touches a table with a `business_id` column must mention it; three reviewed exceptions are listed in the test (invitation accept by secret token, two dashboard queries that build `business_id = ?` first, one audit insert keyed to a just-written row).
2. **Every repository method** (49 calls across conversations, leads, notifications, contacts, verification, members, dashboard, search, reconciliation) called by business B with A's ids: nothing of A in any response, A's rows byte-identical afterwards, and each id-taking method answers a real foreign id exactly as it answers a made-up one (no existence oracle). Reconcile/dispatch of one business never creates or sends another's alerts.
3. **Every dashboard route over HTTP** (26 routes, GET/POST/PUT/PATCH/DELETE): B's session on A's business id is refused and is byte-identical to the answer for a non-existent business; B's own business with A's resource ids answers like made-up ids; B's lists, search (`q`), incomplete filter, export, audit and notifications contain none of A's data; no session or a bad CSRF token changes nothing.
Limits: HTTP tests run on in-memory SQLite and the simulated mailer. Not tested: hosted D1, real sessions behind Cloudflare, timing side channels.

## Emergency workflow (item 5): silent failures found
- Fixed: R1 (above).
- Verified OK (tests): partial lead + one alert; contact adds one follow-up alert; duplicate POSTs and replays add nothing; outbox failure recovered by the scheduled run and not repeated on the next run; provider outage retried with the same idempotency key (one message in the end); permanent rejection appears in "needs attention" and history; fault injection at every database write of a three-message emergency (a reply that says "recorded" always has a lead; a "not saved" status always says so honestly; never a duplicate lead); a failed correction keeps the old details and says the change was not saved; alerts are "sent", never "delivered", without a receipt.
- Documented, not fixed: KI-59 (rejected emergencies invisible to the business), KI-55, KI-52.

## What was NOT verified
Hosted D1 (migration 0005, compare-and-set, rollback, lead-update flows); any real email or SMS; delivery receipts from a real provider; behaviour on the deployed Workers runtime; a real AI model; real customers; professional review of emergency wording; load behaviour.

## Honest assessment
The code is materially safer than before this gate (a person in danger now always gets the safety text, and every claim of "saved" is backed by a read-back), and tenant isolation held under a broad adversarial test. But LATCHLINE cannot yet do the one thing a plumber needs from it: **tell a real person about an emergency**. Before any production use you must: (1) choose and approve a real email/SMS provider, with an adapter, test recipients, delivery receipts and a privacy review (KI-61); (2) give Cloudflare access so migration 0005, the compare-and-set update and rollback can be verified on hosted D1 (KI-60); (3) decide the flood-protection policy and approve Turnstile (KI-55, KI-59); (4) decide delete semantics (KI-52); (5) have the emergency wording reviewed by a qualified professional (KI-12) and evaluate a real model (KI-46).
