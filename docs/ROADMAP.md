# Roadmap and Future Improvements

Last updated: 2026-11-17 · Each stage ends with: what was built, files changed, tests run, errors/limitations, next step. Nothing deploys publicly or costs money without founder approval.

## Stages

| Stage | Scope | Exit criteria |
|---|---|---|
| 1 (done) | Docs foundation, test harness, baseline tests | Docs written, baseline tests run and recorded |
| 2 (done, 2026-11-17) | Research: hosting limits, AI provider pricing and privacy. Provider interface + mock + router, industry pack, knowledge schema and retrieval, safety layer v1, Worker wired to safety and retrieval | Research recorded; 181 tests: 177 pass, 0 fail, 4 TODO. Leftovers carried forward: professional review of safety procedures (KI-12), re-verify prices (KI-13), real-runtime measurements (KI-14) |
| 3 (done, 2026-11-17) | Data layer with tenant isolation, conversation engine, KB loading, response guard, lead capture with dedupe, rate limiting, emergency gaps closed, UI connected | 468 tests pass, 0 TODO. Carried forward: real D1 verification (KI-15), notifications/dashboard (KI-18), retention policy (KI-17), professional review (KI-12) |
| 4 | Notifications outbox (mock), handoff, degraded mode, failure tests | Failed-notification and AI-outage tests passing |
| 5 (done, 2026-11-19) | Auth, roles, owner dashboard (mobile + desktop), contact verification (simulated) | 705 tests pass, including cross-business and UI tests. Carried forward: KI-30 to KI-39 |
| 6 (done as far as possible, 2026-11-19) | Runtime and database integration: real-process and Worker-entry integration tests, persistence, failure handling, local setup. **Cloudflare runtime tools could not be installed, so workerd/local-D1 runs and the hash CPU measurement remain open (KI-40, KI-30)** | 760 tests pass |
| 7 | Entitlements/plans (no billing), analytics | Entitlement and metric-accuracy tests passing |
| 8 | Security hardening (rate limits, validation, audit log), backup/restore drill, runbooks, readiness report | Full test matrix in `TEST_CASES.md` run and results recorded |

## Stage 4 (done, 2026-11-18): notifications and human handoff

Provider-independent notifier adapter with a mock default, outbox with idempotency, retries and priorities, honest delivery statuses, handoff requests, emergency escalation, scheduled recovery. 574 tests pass. No real email/SMS provider exists. Carried forward: KI-18, KI-22 to KI-29.

## Stage 5 (done, 2026-11-19): owner accounts, contact verification, dashboard

Demo authentication with real logic and a mock mailer, roles, tenant-checked dashboard API and UI, simulated contact verification, settings feeding the verified knowledge base. Not production-ready (see `SECURITY.md`).

## Next up (proposal, needs founder go-ahead)

Decisions that need you: (0) allow package installs so the free local Cloudflare runtime (`wrangler`, local D1) can be installed and the Stage 6 integration tests rerun on it (KI-40); (1) measure password hashing on a free local Workers runtime and decide how to handle KI-30; (2) choose and approve a real email provider after a cost/privacy/terms review (needed for real accounts, real contact verification and real notifications, KI-31/36); (3) approve any hosting. Engineering work that needs no spending: per-business notification budget and spam protection (KI-27), cleanup of unverified accounts (KI-33), retention/deletion policy (KI-17/38), accessibility review (KI-37), a dashboard "Website" page for site key and allowed origins (KI-42).

## Future improvements (not scheduled)

- Real billing integration (requires approval).
- Real SMS/email providers (requires approval).
- Calendar integration for real appointment booking.
- Additional industries via new industry packs (HVAC, electrical, etc.).
- Semantic search in the knowledge base if simple retrieval proves insufficient.
- Voice or phone-call channel.
- Owner-recorded job outcomes for richer (clearly labeled) reporting.
