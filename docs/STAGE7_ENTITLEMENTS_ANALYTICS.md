# Stage 7 — Entitlements and analytics

Status: in progress; billing is inactive.

## Guardrails
- Plans and entitlement values are data; no scattered plan-name checks.
- Tenant-specific overrides supported.
- Safety/emergency protections and truthful responses are never gated.
- Proposed prices remain display-only and provisional pending cost review.
- Analytics use counted records, state period/sample size, and never claim revenue or wins without owner-entered outcomes.
- No deployment, paid resource, payment processor, or real provider activation.

## Migration foundation
Migration 0009 creates plans, plan entitlement JSON values, business subscription assignments, per-business overrides and period-based usage counters. It does not seed plan prices, assign plans, or restrict live traffic.

## Exit criteria
1. Tenant-isolated entitlement resolver, overrides, default deny for unknown keys.
2. Safe usage recording and period queries.
3. Analytics API/UI, factual metrics with explicit period.
4. Tests for isolation, overrides, unknown keys, usage, periods and metric accuracy.
5. Passing CI with recorded results.
