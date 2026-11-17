# Feature Status

Last updated: 2026-11-17

A feature is **Done** only when it is implemented, tested (tests passing and recorded in `TEST_CASES.md`), and reviewed. Nothing below is Done yet. "In progress" means part is built and tested but the requirement is not yet met. "Prototype" means a stand-in that does not meet the requirement.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Website chat widget | Prototype | `index.html` is a scripted demo, not connected to the API, not embeddable |
| 2 | AI conversation engine | Not started | The provider layer exists (row 14) but no code calls a model yet |
| 3 | Verified business knowledge base | In progress | Schema, validation, retrieval of verified facts only, and per-business store built and tested. Not connected to a database or conversation engine; no real business data; demo business has no verified facts |
| 4 | Structured customer/job collection | Prototype | Intake fields defined in the plumbing pack; nothing collects or stores them yet. The page's scripted flow is not real collection |
| 5 | Emergency recognition and safety handling | In progress | Detector built and tested (7 categories, negation, false-alarm tests). English only; phrase-based; default procedure texts **not reviewed by a licensed professional or a plumbing business** (KI-12) |
| 6 | Lead creation and management | Not started | |
| 7 | Human handoff and notifications | Not started | |
| 8 | Business dashboard | Not started | |
| 9 | Secure registration and login | Not started | |
| 10 | Multi-business support, strict data separation | In progress | Knowledge reads are tenant-scoped and tested. No database, no auth, no other tenant data yet |
| 11 | Conversation history and reporting | Not started | |
| 12 | Monitoring and error handling | Prototype | `/health` only. The AI router records calls but nothing stores or reports them yet |
| 13 | Subscription plans/entitlements | Not started | Design and cost research in `PLANS_AND_PRICING.md` |
| 14 | AI provider interface + mock provider | In progress | Interface, labeled mock, registry (real providers refused), router with fallback, retries, timeout, circuit breaker, call recording: built and tested. No real provider (disabled by design) |
| 15 | Analytics for owner value | Not started | |
| 16 | Backups and recovery | Not started | D1 Time Travel researched (7 days Free / 30 days Paid); nothing set up or tested |
| 17 | Rate limiting | Not started | |
| 18 | Audit logging | Not started | |

## Stage log

| Stage | Date | Result |
|---|---|---|
| 0 | before 2026-11-16 | Prototype demo page + Worker (not by this team) |
| 1 | 2026-11-16 | Documentation foundation, test harness, baseline tests. No product features added. |
| 2 | 2026-11-17 | Safety layer, knowledge retrieval, AI provider interface, Worker wired to safety + retrieval, provider and hosting research. 181 tests: 177 pass, 0 fail, 4 TODO (tracked). No real AI connected; nothing deployed. |
