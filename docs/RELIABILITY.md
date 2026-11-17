# Reliability and 24/7 Operation

Last updated: 2026-11-17 · Status: DESIGN, plus an AI router implemented and tested (fallback, retries, timeouts, circuit breaker, explicit degraded result). Nothing else beyond a basic `/health` endpoint exists. The customer-facing degraded mode, monitoring, backups, and alerts are not built.

**We never promise zero errors or uninterrupted availability.** We measure real performance and publish limitations. Targets below are goals to be measured, not guarantees.

## Design goals

| Capability | Plan |
|---|---|
| Health checks | `/health` (liveness) and a deeper readiness check (database reachable, AI provider status, notifier status). Reports honestly which parts are mocked or down. |
| Monitoring | Structured logs for every request; metrics for error rate, latency, AI failures, notification failures. Free tooling first; paid monitoring only with founder approval. |
| Error reporting | Errors are captured with context (business id, request id, no customer PII in logs) and surfaced to the operator; repeated failures raise an alert. |
| Automatic recovery | Retries with backoff for transient failures; circuit breaker around AI providers; idempotent operations so retries are safe. |
| Database backups | Scheduled export/backup, with retention defined, and a **tested** restore. Method depends on host capabilities (to verify and record). |
| Failure handling | Every failure produces an explicit stored result. Nothing silently disappears. |
| AI provider outage | Fallback to another provider if configured; otherwise **honest degraded mode** (below). |
| Notification failure detection | Outbox pattern: each notification has a status (pending, sent, failed), attempts, last error. Failed ones retry, then appear prominently in the dashboard. Customers are never told a human was notified unless delivery is confirmed. |
| Human escalation | Emergency and handoff paths do not depend on the AI model. |
| Recovery procedures | Written runbooks, kept in `docs/runbooks/` as they are created, and rehearsed. |

## Honest degraded mode (AI unavailable)

1. The safety layer still runs (it does not need the model).
2. The widget tells the customer plainly that the assistant is temporarily limited.
3. It collects the minimum contact details and issue via simple structured prompts.
4. The lead is saved and marked "captured without AI".
5. If saving fails, the customer is told their request was **not** recorded and is given the business's verified contact method, if one is configured.

## Measurement (to be built)

Uptime/error rate, p50/p95 response latency, AI failure and fallback counts, notification success rate, time-to-first-response. Published in an operator view with the measurement period, and any limits documented here. Until measured, no numbers are claimed.

## Known limitations today

No monitoring, no database, no backups, no fallback. The prototype Worker is stateless, so it has nothing to back up and also nothing to recover.
