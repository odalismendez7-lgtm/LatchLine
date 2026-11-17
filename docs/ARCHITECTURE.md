# Architecture

Last updated: 2026-11-16 · Status: PROPOSED (approved decisions are logged in `DECISIONS.md`)

## Current state (Stage 0 prototype)

- `index.html`: static demo page with a scripted, client-side chat. Does not call the backend.
- `src/index.js`: Cloudflare Worker with `GET /health` and `POST /api/chat` (keyword rules, canned replies, origin allow-list, 1200-character limit).
- `wrangler.toml`: Worker config.
- No database, no authentication, no real AI, no tenant concept, no tests (until Stage 1 baseline tests).

Assessment: the **platform choice (Cloudflare Workers) is suitable** and kept. Almost all application logic is new.

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

- Free-tier limits and backup options for the chosen database/host.
- Free notification path for development (mock now; real email/SMS later requires approval).
- Dashboard framework.
