# Decision Log

Append-only record of product, pricing, architecture, and security decisions. Newest at the bottom. Include date, decision, reason, and who decided.

| # | Date | Decision | Reason | Decided by |
|---|---|---|---|---|
| 1 | 2026-11-16 | Keep Cloudflare Workers as the platform; keep existing prototype files; no deletions | Suitable free-tier fit; prototype is small and its content (AI instructions, KB, page design) is useful | Engineering |
| 2 | 2026-11-16 | Three subscription tiers planned: Starter $99, Growth $199, Pro $299 (provisional) | Founder proposal; final prices only after operating-cost research | Founder |
| 3 | 2026-11-16 | Plans, limits, and features are data managed via an entitlements service | Must be changeable independently of code | Founder requirement |
| 4 | 2026-11-16 | AI access goes through an interchangeable provider interface; mock provider is default | Model must be swappable; $0 budget; deterministic tests | Founder requirement |
| 5 | 2026-11-16 | Safety layer is deterministic and runs before and independent of the AI model; safety text comes from approved procedures | Safety must not depend on model quality or availability | Engineering |
| 6 | 2026-11-16 | Only the system (from real action results) may assert that a lead was saved or a human notified | Requirement: never pretend an action succeeded | Founder requirement |
| 7 | 2026-11-16 | Industry-specific content lives in "industry packs" (data), core stays industry-neutral | Future support for other service industries without a rebuild | Founder requirement |
| 8 | 2026-11-16 | No billing, paid API, hosting, domain, or public deployment without explicit founder approval | $0 budget | Founder requirement |
| 9 | 2026-11-16 | Node's built-in test runner; tests marked `todo` record required-but-unbuilt behavior | No installs available; failures stay visible instead of hidden | Engineering |
| 10 | 2026-11-16 | Claude GitHub App was not installed at the time, so Stage 1 work was committed on branch `stage-1-foundation` and delivered as a zip (superseded by #18) | Push to GitHub was refused | Engineering |
| 11 | 2026-11-17 | Emergency detection is phrase-based rules in the industry pack, with negation handling and an explicit exemption list; bias is to flag when unsure | Deterministic, testable, independent of AI. Known limits tracked as KI-12 | Engineering |
| 12 | 2026-11-17 | A business's own emergency procedure is used only if verified (verifier + date), and can never remove the 911 instruction for life-safety categories | Safety text must not be weakened by configuration | Engineering |
| 13 | 2026-11-17 | A fact can be stated only if verified, with a value, a verifier, and a date; otherwise the assistant says it needs confirmation. A ZIP outside the verified list is "needs confirmation", not "we don't serve you" | No invented or over-confident facts | Founder requirement |
| 14 | 2026-11-17 | Knowledge is read only through a per-business frozen handle; an unknown business id throws and never falls back to another business | Strict data separation by construction | Founder requirement |
| 15 | 2026-11-17 | AI router never throws and returns text only from a valid provider reply; total failure returns an explicit degraded result; call records contain no customer text | Honest outage handling and privacy | Founder requirement |
| 16 | 2026-11-17 | Real AI providers are refused by the registry and enforced by a test until the founder approves; never send real customer data through a free tier (Google's free tier uses content to improve products) | $0 budget and privacy | Founder requirement |
| 17 | 2026-11-17 | Replaced the keyword rules inside `answer()` in `src/index.js` with the safety layer and retrieval; origin check, validation, and response shape kept. Reason: the old rules missed common emergencies (KI-1, KI-2, KI-4) | Fixes found problems without deleting other prototype work | Engineering |
| 18 | 2026-11-17 | Claude GitHub App is now installed; work is pushed to branch `stage-1-foundation`, never directly to `main` (supersedes #10) | Founder installed the app | Founder |
| 19 | 2026-11-17 | Database access only through `forBusiness(db, id)` frozen handles; every statement binds `business_id`; child tables use composite foreign keys; a SQL-spy test enforces it | Two independent layers of tenant isolation | Founder requirement |
| 20 | 2026-11-17 | A lead is reported saved only after the write transaction succeeds and a readback matches; any failure produces an explicit "NOT saved" reply and the customer is offered the verified phone if one exists | Never claim an action succeeded without proof | Founder requirement |
| 21 | 2026-11-17 | Duplicate leads (same phone or email, same business, 30 days) are merged silently and the customer reply is identical to a new lead | Avoids revealing who is already a customer | Engineering |
| 22 | 2026-11-17 | The business is chosen only by public site key plus a registered origin for that business; request-body business ids are ignored | Prevents cross-tenant selection | Engineering |
| 23 | 2026-11-17 | Mock AI text is not shown to customers by default; AI output must pass a guard (no promises, prices, times, phones, links) or a fixed reply is used | Mock is not an AI; AI must not make promises | Engineering |
| 24 | 2026-11-17 | Rate limiting: per-client and per-business fixed windows; if the shared store fails, fall back to memory (degraded, not open); a rate-limited emergency message still receives the deterministic safety reply, flagged as not saved | Blocking someone in danger is worse than the small CPU cost | Engineering |
| 25 | 2026-11-17 | SQLite (`node:sqlite`) for local dev and tests, with a D1 adapter marked unverified; Worker uses the database only when `env.DB` is bound, otherwise stays the stateless prototype | $0 budget: real D1 needs an account and deployment | Engineering |
| 26 | 2026-11-17 | Spanish emergency detection added with Spanish procedure text, marked unreviewed | Common customer language; safety must not be English-only | Engineering |
