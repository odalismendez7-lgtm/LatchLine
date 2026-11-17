# Feature Status

Last updated: 2026-11-16

A feature is **Done** only when it is implemented, tested (tests passing and recorded in `TEST_CASES.md`), and reviewed. "Prototype" means a stand-in that does not meet the requirement.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Website chat widget | Prototype | `index.html` demo page, scripted, not connected to the API, not embeddable |
| 2 | AI conversation engine | Not started | Current Worker is keyword rules, not an AI |
| 3 | Verified business knowledge base | Not started | `AQUAFLOW_KNOWLEDGE_BASE.md` is a human-readable test document, not loaded by any code |
| 4 | Structured customer/job collection | Prototype | Client-side fixed order in `index.html`; nothing stored |
| 5 | Emergency recognition and safety handling | Prototype (weak) | Narrow regex; 4 documented gaps (`KNOWN_ISSUES.md`) |
| 6 | Lead creation and management | Not started | |
| 7 | Human handoff and notifications | Not started | |
| 8 | Business dashboard | Not started | |
| 9 | Secure registration and login | Not started | |
| 10 | Multi-business support, strict data separation | Not started | |
| 11 | Conversation history and reporting | Not started | |
| 12 | Monitoring and error handling | Prototype | `/health` only |
| 13 | Subscription plans/entitlements | Not started | Design in `PLANS_AND_PRICING.md` |
| 14 | AI provider interface + mock provider | Not started | Design in `AI_STRATEGY.md` |
| 15 | Analytics for owner value | Not started | Design in `ANALYTICS.md` |
| 16 | Backups and recovery | Not started | |
| 17 | Rate limiting | Not started | |
| 18 | Audit logging | Not started | |

## Stage log

| Stage | Date | Result |
|---|---|---|
| 0 | before 2026-11-16 | Prototype demo page + Worker (not by this team) |
| 1 | 2026-11-16 | Documentation foundation, test harness, baseline tests. No product features added. |
