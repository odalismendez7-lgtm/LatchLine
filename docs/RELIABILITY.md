# Reliability and 24/7 Operation

Last updated: 2026-11-18 (Stage 4) · Status: DESIGN, plus implemented and tested: AI router, honest degraded replies in the engine (AI down, database down, lead not saved), rate-limit store fallback, honest `/health`. Monitoring, backups, alerts, and notifications are not built.

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

## What is implemented today (Stage 3)

- AI outage: the engine returns a fixed reply, flags `degraded.ai`, keeps collecting details; the mock's text is not shown.
- Database down at the start: safety guidance still returned; customer told nothing can be saved; no conversation id issued; `/health` returns 503.
- Lead write fails or the database lies about success: customer told the business has NOT received the details, verified phone offered if known; the next message retries and saves once.
- Rate-limit store down: falls back to per-instance memory counts and reports degraded.
- Notification provider outage: retried with backoff (emergency 15 s to 15 min, normal 1 min to 1 hour, 5 or 8 attempts), then `failed` and listed in `needsAttention`. The customer's reply is unaffected.
- Database failure while queueing: the lead stays saved, the engine retries queueing on later turns, and a scheduled sweep recovers leads with no notification.
- Database failure after a provider accepted: row stays `sending`, re-sent after the lease with the same idempotency key (at-least-once, KI-22).
- Crashed dispatcher: lease expiry reclaims the row; the dead attempt is recorded.
- Not yet: a "captured without AI" lead mode (the engine collects the same fields with or without AI, but there is no marker), notifications, backups, metrics.

## Stage 5 note

The dashboard shows notification history and the `needsAttention` list, so a failed or undeliverable notification is now visible to an authorized person, using the exact honest wording from `src/notify/status.js`. It is still not an alert: nobody is paged. Dashboard and account failures return generic errors (never internals).

## Stage 6 note

Tested in real processes: clean restart and hard kill keep accounts, sessions, leads and the notification queue; an interrupted send is re-sent once after restart; a database write lock gives a calm 503 and the app recovers without a restart. Still untested on the Workers runtime and real D1 (KI-40).

## Measurement (to be built)

Uptime/error rate, p50/p95 response latency, AI failure and fallback counts, notification success rate, time-to-first-response. Published in an operator view with the measurement period, and any limits documented here. Until measured, no numbers are claimed.

## Known limitations today

No monitoring, no backups, no notifications. The database path has only run on local SQLite and a fake D1 (KI-15). Free-tier D1 daily write limits could cut off lead saving mid-day (KI-16); the engine would report it as NOT saved.
