# Architecture

Last updated: 2026-11-17 · Status: PROPOSED (approved decisions are logged in `DECISIONS.md`)

## Current state (after Stage 2)

Built and tested (see `TEST_CASES.md`):

- `src/safety/detector.js` + `src/packs/plumbing.js`: deterministic emergency detector and the plumbing industry pack (rules, default procedures, intake fields). Runs before and independent of any AI.
- `src/knowledge/`: knowledge-base schema and validation, retrieval of verified facts only, a tenant-scoped store, and a demo business with no verified facts.
- `src/ai/`: provider interface, labeled mock provider, registry that refuses real providers, and a router with fallback, retries, timeouts, circuit breaker, and call recording.
- `src/index.js`: the prototype Worker now uses the safety layer and knowledge retrieval for `/api/chat`. Origin allow-list, validation, and response shape are unchanged.

Not built: database, authentication, tenant data layer, conversation engine (the model is not called anywhere yet), lead service, notifications, dashboard, rate limiting, entitlements, analytics, real widget. `index.html` is still the Stage 0 scripted demo and does not call the API.

Assessment: the **platform choice (Cloudflare Workers) is suitable** and kept. See "Platform limits" below for what the free plan can and cannot support.

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

## Planned data model (summary)

`businesses`, `users`, `memberships` (user↔business, role), `sessions`, `knowledge_facts` (typed, verified flag, verified_by/at), `knowledge_faqs`, `conversations`, `messages`, `leads` (with dedupe key), `handoffs`, `notifications_outbox` (status, attempts, last_error), `plans`, `plan_entitlements`, `business_subscriptions`, `usage_counters`, `audit_log`, `ai_calls` (provider, model, latency, tokens).

## Open questions (need research, not guesses)

- Whether Cloudflare's free plan terms allow commercial use (not checked).
- Pricing of R2 for exports beyond the Time Travel window (not researched).
- Free notification path for development (mock now; real email/SMS later requires approval).
- Dashboard framework.
- Which AI model(s) to use: needs measured evaluation (`AI_MODEL_EVALUATIONS.md`).

Resolved in Stage 2: free-tier limits and backup options for Workers and D1 (above).
