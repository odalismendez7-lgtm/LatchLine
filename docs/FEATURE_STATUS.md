# Feature Status

Last updated: 2026-11-18 (Stage 4)

A feature is **Done** only when it is implemented, tested (tests passing and recorded in `TEST_CASES.md`), and reviewed. Nothing below is Done yet, including after Stage 3. "In progress" means part is built and tested but the requirement is not yet met. "Prototype" means a stand-in that does not meet the requirement.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Website chat widget | Prototype | `index.html` now calls `/api/chat` when served from localhost or opened with `?api=<url>` (browser-tested on desktop and mobile viewports). On the hosted GitHub Pages page it still runs the offline scripted demo, labeled as such, because no API is deployed. Not embeddable yet |
| 2 | AI conversation engine | In progress | `src/engine/`: safety first, validated slot collection, verified-knowledge answers, guarded AI use, honest DB/AI failure replies. The AI is the labeled mock, whose text is not shown to customers by default; the response guard has never faced a real model (KI-19) |
| 3 | Verified business knowledge base | In progress | Schema, validation, retrieval of verified facts only, and per-business store built and tested. Not connected to a database or conversation engine; no real business data; demo business has no verified facts |
| 4 | Structured customer/job collection | In progress | Name, phone, ZIP, issue, urgency collected and validated in conversation (English prompts), stored in the local database. Optional fields (email asked only if volunteered, preferred contact/time) not asked. No real-customer testing |
| 5 | Emergency recognition and safety handling | In progress | Detector built and tested (9 categories incl. water-heater hazards and a generic "emergency" fallback; negation; false-alarm tests; English and Spanish). Spanish text unreviewed by a native speaker. Phrase-based; default procedure texts **not reviewed by a licensed professional or a plumbing business** (KI-12) |
| 6 | Lead creation and management | In progress | Leads saved with transaction + readback, one per conversation, duplicates merged by phone/email within 30 days, lead events, audit log, and a notification queued for each lead. No status changes and no dashboard. In practice nobody is told until a real provider is approved and connected (KI-18) |
| 7 | Human handoff and notifications | In progress | Outbox, mock-only provider adapter, retries with backoff, priorities (emergency > urgent > normal), idempotency, honest statuses, "talk to a person" requests recorded as handoff notifications. **No real email/SMS provider exists or is enabled; nothing real has ever been sent.** Business contacts can only be added from code (no verification flow, KI-25). No live transfer exists; the bot says so |
| 8 | Business dashboard | Not started | |
| 9 | Secure registration and login | Not started | |
| 10 | Multi-business support, strict data separation | In progress | Tenant-scoped repositories, composite foreign keys, SQL-spy and cross-tenant tests, business chosen only by public site key + registered origin. Tested on local SQLite and a fake D1; never on real D1 (KI-15). No owner authentication yet |
| 11 | Conversation history and reporting | Not started | |
| 12 | Monitoring and error handling | Prototype | Notification attempts, errors (short codes) and `needsAttention` lists are stored per business, but nothing displays or alerts on them. `/health` reports database reachability honestly (503 when down). Degraded flags returned per reply. No stored metrics or alerts |
| 13 | Subscription plans/entitlements | Not started | Design and cost research in `PLANS_AND_PRICING.md` |
| 14 | AI provider interface + mock provider | In progress | Interface, labeled mock, registry (real providers refused), router with fallback, retries, timeout, circuit breaker, call recording: built and tested. No real provider (disabled by design) |
| 15 | Analytics for owner value | Not started | |
| 16 | Backups and recovery | Not started | D1 Time Travel researched (7 days Free / 30 days Paid); nothing set up or tested |
| 17 | Rate limiting | In progress | Per-client and per-business fixed windows, memory and database stores, 429 + Retry-After, fallback if the store fails. Safety replies still returned when rate-limited. Not load-tested; IP-based (KI-16) |
| 18 | Audit logging | In progress | Append-only table (database triggers) for business creation, lead creation/merge, knowledge updates, contacts, notification state changes; no customer values stored. No login or permission events yet (no auth) |

## Stage log

| Stage | Date | Result |
|---|---|---|
| 0 | before 2026-11-16 | Prototype demo page + Worker (not by this team) |
| 1 | 2026-11-16 | Documentation foundation, test harness, baseline tests. No product features added. |
| 2 | 2026-11-17 | Safety layer, knowledge retrieval, AI provider interface, Worker wired to safety + retrieval, provider and hosting research. 181 tests: 177 pass, 0 fail, 4 TODO (tracked). No real AI connected; nothing deployed. |
| 3 | 2026-11-17 | Data layer (SQLite/D1 adapters, migrations, tenant repositories), rate limiter, conversation engine with lead capture and dedupe, Worker `createApp`, local dev server, UI connected, emergency gaps closed. 468 tests, all pass, 0 TODO. Mock AI only; nothing deployed; real D1 untested. |
| 4 | 2026-11-18 | Notification outbox (migration 0002), provider-independent notifier adapter with mock default (real providers refused), dispatcher with retries/backoff/priority/leases, idempotent enqueue, delivery-confirmation model, human-handoff requests, emergency escalation to all verified channels, scheduled recovery. 574 tests, all pass. Mock only; nothing deployed; no real notification ever sent. |
