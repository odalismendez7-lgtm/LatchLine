# Roadmap and Future Improvements

Last updated: 2026-11-16 · Each stage ends with: what was built, files changed, tests run, errors/limitations, next step. Nothing deploys publicly or costs money without founder approval.

## Stages

| Stage | Scope | Exit criteria |
|---|---|---|
| 1 (done) | Docs foundation, test harness, baseline tests | Docs written, baseline tests run and recorded |
| 2 | Research: free-tier limits of host/database, AI provider candidates, cost model (all from official sources, dated). Core engine skeleton: provider interface + mock provider, industry-pack format, knowledge-base schema, safety layer v1 with tests | Research recorded in `AI_MODEL_EVALUATIONS.md` and `PLANS_AND_PRICING.md`; safety tests for KI-1/KI-2 passing |
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
