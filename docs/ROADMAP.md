# Roadmap and Future Improvements

Last updated: 2026-11-17 · Each stage ends with: what was built, files changed, tests run, errors/limitations, next step. Nothing deploys publicly or costs money without founder approval.

## Stages

| Stage | Scope | Exit criteria |
|---|---|---|
| 1 (done) | Docs foundation, test harness, baseline tests | Docs written, baseline tests run and recorded |
| 2 (done, 2026-11-17) | Research: hosting limits, AI provider pricing and privacy. Provider interface + mock + router, industry pack, knowledge schema and retrieval, safety layer v1, Worker wired to safety and retrieval | Research recorded; 181 tests: 177 pass, 0 fail, 4 TODO. Leftovers carried forward: professional review of safety procedures (KI-12), re-verify prices (KI-13), real-runtime measurements (KI-14) |
| 3 | Data layer with tenant isolation, conversation state, KB loading, response guard, lead service with dedupe | Cross-tenant and duplicate-lead tests passing |
| 4 | Notifications outbox (mock), handoff, degraded mode, failure tests | Failed-notification and AI-outage tests passing |
| 5 | Auth, roles, owner dashboard (mobile + desktop) | Unauthorized-access and UI tests passing |
| 6 | Entitlements/plans (no billing), analytics | Entitlement and metric-accuracy tests passing |
| 7 | Security hardening (rate limits, validation, audit log), backup/restore drill, runbooks, readiness report | Full test matrix in `TEST_CASES.md` run and results recorded |

## Future improvements (not scheduled)

- Real billing integration (requires approval).
- Real SMS/email providers (requires approval).
- Calendar integration for real appointment booking.
- Additional industries via new industry packs (HVAC, electrical, etc.).
- Semantic search in the knowledge base if simple retrieval proves insufficient.
- Voice or phone-call channel.
- Owner-recorded job outcomes for richer (clearly labeled) reporting.
