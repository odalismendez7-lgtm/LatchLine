# Architecture

Last updated: 2026-11-17 (Stage 3) · Status: PROPOSED (approved decisions are logged in `DECISIONS.md`)

## Current state (after Stage 5)

Built and tested (see `TEST_CASES.md`):

- `src/safety/` + `src/packs/plumbing.js`: deterministic emergency detector (English and Spanish) and the plumbing industry pack. Runs before and independent of any AI or database.
- `src/validation/normalize.js`: validation and normalization of messages, phones (US), emails, ZIPs, names.
- `src/knowledge/`: schema, verified-only retrieval, tenant-scoped store.
- `src/ai/`: provider interface, labeled mock, registry refusing real providers, router (fallback, retries, timeouts, circuit breaker).
- `src/db/` + `migrations/0001_init.sql`: adapter interface with SQLite (dev/tests) and D1 (unverified) adapters; `forBusiness` tenant handles; composite foreign keys; append-only audit log.
- `src/ratelimit/`: fixed-window limiter with memory and database stores.
- `src/engine/`: conversation engine (slots, KB answers, guarded AI, lead save with readback, dedupe, honest failures).
- `src/app.js`: HTTP app (`createApp`): site key, per-business origins, limits, safety-on-429. `src/index.js` uses it when a D1 database is bound, otherwise stays the stateless prototype.
- `scripts/dev-server.mjs`: local server on 127.0.0.1 with SQLite and the demo business; serves `index.html`, which calls `/api/chat` in that mode.

Request flow (chat): rate limit, size/JSON checks, site key to business, origin must be registered for that business, business limit, then the engine: normalize, safety, conversation (tenant handle), slots, answer, save + readback.

Stage 4 additions:

- `migrations/0002_notifications.sql`: `business_contacts`, `notifications` (outbox), `notification_attempts`, all with composite tenant foreign keys.
- `src/db/notifications.js`: tenant-scoped outbox repository (idempotent enqueue, priority claim with leases, status transitions, `needsAttention`, `reconcileMissing`).
- `src/notify/`: `provider.js` (interface, errors, validation), `mock.js`, `registry.js` (refuses real providers), `render.js` (safe text), `dispatcher.js` (send, retry, confirm), `status.js` (the only wording for statuses).
- `src/engine/handoff.js` and engine changes: queue `new_lead`, `repeat_contact`, `human_requested` after the database confirms the lead; emergency leads at emergency priority to every verified channel.
- `src/app.js`: best-effort dispatch after a queue (`waitUntil`) and `runScheduled()` (recovery + retries); `src/index.js` exports `scheduled` for the cron in `wrangler.toml`.

Notification flow: lead saved and read back, then queued (separate step, retried on later turns, recovered by the sweep), then dispatcher claims by priority, renders from tenant data, calls the provider with the idempotency key, records `sent`, later records `delivered` only if the provider confirms.


Stage 5 additions (after Stage 5):

- `migrations/0003_accounts.sql`: `users`, `sessions`, `auth_tokens`, `memberships`, `invitations`, `contact_verifications`, and `business_contacts.simulated_verified_at`.
- `src/auth/`: `crypto.js` (PBKDF2, tokens, codes), `mailer.js` (mock only; real mailers refused), `permissions.js` (role table), `repo.js` (platform-level account data), `service.js` (register, verify, login, sessions, recovery, invitations).
- `src/db/`: `members.js` (memberships, invitations, audit view), `contactVerify.js` (hashed codes, attempts), `dashboard.js` (lead search/status/delete/export, conversations, handoffs, notification history). All reached only through `forBusiness`.
- `src/dashboard/`: `authz.js` (the only place a dashboard request obtains a tenant handle; masking), `api.js` (`/api/auth/*`, `/api/me`, `/api/biz/:id/*`), `contactService.js`, `settings.js` (settings to verified knowledge-base facts), `client.js` + `page.js` (the single-page UI with a nonce CSP, served at `/app`).
- `src/app.js` takes an optional `accounts` option. Without it nothing new is reachable. `src/index.js` does not pass it (KI-32). `scripts/dev-server.mjs` passes the mock mailer with dev mode (simulated mailbox at `/app#dev`).

Dashboard request flow: same-origin check, cookie to session (idle/absolute expiry), CSRF header for changes, membership lookup for the URL's business id (404 if none), permission check (403), then a tenant handle for that business only, then role-based masking of customer contact details.

Real providers later: replace the mock mailer with an adapter exposing `send` and `simulated:false`; the verification service, dispatcher guard and UI labels adapt automatically (simulated flag drives wording and what verification means).

Not built: production authentication (real email, MFA), real contact verification, real notification providers, delivery webhooks, entitlements, analytics, backups, embeddable widget, real AI, real D1 verification.

Assessment: Cloudflare Workers remains suitable. Real D1 behavior is untested (KI-15).

## Platform limits (Cloudflare, read 2026-11-16; details in `PLANS_AND_PRICING.md`)

- Workers Free: 100,000 requests/day, 10 ms CPU per request. Paid is $5/month minimum.
- D1 Free: 100,000 rows written/day, 5 million read/day, 5 GB. Exceeding the daily limits returns errors until 00:00 UTC.
- D1 Time Travel (automatic point-in-time restore): 7 days on Free, 30 days on Paid.
- Consequence: Free is suitable for development and a small pilot, not paying customers. Moving to Paid costs money and needs founder approval.

## Target architecture

```
Customer website
   |  embeds <script> widget (per-business public key)
   v
Chat API (Worker)  ---->  Safety layer (deterministic, first)
   |                         |
   |                         v
   |                  Conversation engine --> Knowledge retrieval (per business)
   |                         |             --> AIProvider router (mock | provider A | provider B)
   |                         |             --> Response guard
   v                         v
Data layer (tenant-scoped repository) <---- Lead service ----> Notification outbox
   |                                                              |
   v                                                              v
Owner API (authenticated) <--- Dashboard (web)            Notifier adapters (mock | email | SMS)
   |
   +--> Entitlements service (plans, limits, features) --> Billing adapter (NOT ACTIVE)
   +--> Audit log, metrics, error reporting
```

## Principles

1. **Tenant isolation by construction.** Every table carries `business_id`. All data access goes through a repository layer that *requires* a business id and adds it to every query; there is no code path that reads data without one. Automated cross-tenant access tests are mandatory.
2. **Public widget key is not a secret.** It only identifies a business for the public chat endpoint, with strict rate limits and no access to private data. Owner access uses real authentication.
3. **Interfaces at every external boundary.** AI provider, notifier, billing, and storage each sit behind an interface with a mock implementation. This keeps development free and testable, and lets us swap vendors.
4. **Industry packs are data.** Emergency rules, intake fields, vocabulary, and KB schema live in a configuration "pack" (`plumbing` first). Core code is industry-neutral so other service industries can be added without a rebuild.
5. **Entitlements are data.** Plans, limits, and features are stored and checked through one service (see `PLANS_AND_PRICING.md`).
6. **Honest state.** Anything that can fail (AI call, lead save, notification) returns an explicit result that is stored. User-facing claims are generated only from real results.
7. **Idempotency.** Lead creation and notification delivery are idempotent so retries and duplicates cannot create double leads or double notifications.

## Proposed stack (free tier, to be confirmed in Stage 2)

| Layer | Proposal | Notes |
|---|---|---|
| API / compute | Cloudflare Workers (already in repo) | Free-tier limits to be verified from official docs and recorded |
| Database | Cloudflare D1 (SQLite) | Strong fit for per-tenant `business_id` model; backups/export approach to verify |
| Widget | Plain JavaScript, no framework, embeddable | Small, fast, mobile-friendly |
| Dashboard | Static web app served by the same platform | Framework decision logged when made |
| Tests | Node built-in test runner | No dependencies needed |
| AI | Mock by default; real providers behind interface | No paid API without approval |

No item above is purchased or deployed. Nothing is public. If the free tier cannot support something, we record exactly what is missing and what it would cost.

## Data model

Implemented in `migrations/0001_init.sql`: `businesses`, `business_origins`, `knowledge_bases`, `conversations`, `messages`, `leads`, `lead_events`, `audit_log`, `rate_limits`. Planned, not built:

`businesses`, `users`, `memberships` (user↔business, role), `sessions`, `knowledge_facts` (typed, verified flag, verified_by/at), `knowledge_faqs`, `conversations`, `messages`, `leads` (with dedupe key), `handoffs`, `notifications_outbox` (status, attempts, last_error), `plans`, `plan_entitlements`, `business_subscriptions`, `usage_counters`, `audit_log`, `ai_calls` (provider, model, latency, tokens).

## Open questions (need research, not guesses)

- Whether Cloudflare's free plan terms allow commercial use (not checked).
- Pricing of R2 for exports beyond the Time Travel window (not researched).
- Free notification path for development (mock now; real email/SMS later requires approval).
- Dashboard framework.
- Which AI model(s) to use: needs measured evaluation (`AI_MODEL_EVALUATIONS.md`).

Resolved in Stage 2: free-tier limits and backup options for Workers and D1 (above).
