# Security Requirements

Last updated: 2026-11-18 (Stage 4) · Status: REQUIREMENTS, partly implemented (see the table below). Not security-reviewed by anyone independent.

This repository may be **public**. Never commit secrets, customer data, real business data, or database exports.

## Requirements and how each will be verified

| Area | Requirement | Verification |
|---|---|---|
| Authentication | Owner/staff accounts with strong password hashing (or a vetted identity method), secure sessions, logout, expiry; no passwords in logs | Auth tests, review |
| Authorization | Role-based access (owner, staff) enforced server-side on every request | Per-role access tests |
| Business data isolation | All data scoped by `business_id` via a mandatory repository layer; no unscoped query path | Cross-business access tests (read, write, guess IDs, tamper tokens) must all be denied |
| Database security | Parameterized queries only; least-privilege access; no direct client DB access | Code review, injection tests |
| API protection | Public chat endpoint and owner API separated; CORS restricted per business; request size limits | Tests |
| Input validation | Validate type, length, and format of every input; escape on output (no HTML injection in dashboard/widget) | XSS and malformed-input tests |
| Rate limiting | Per client and per business on public endpoints; stricter on login and registration | Burst tests |
| Secret management | Secrets only in environment/secret store (e.g. `.dev.vars`, platform secrets); `.gitignore` blocks them; secret-scan check before commits | Pre-commit scan |
| Audit logging | Record logins, permission failures, data exports, KB changes, lead status changes, plan changes (who, what, when, business) | Tests that events are written |
| Backup and recovery | Documented backup schedule, restore procedure, and a tested restore | Restore drill recorded in `TEST_CASES.md` |
| Customer privacy | Collect only needed fields; never request passwords or payment cards in chat; data retention/deletion policy defined | Policy + tests |
| AI-specific | Customer text treated as untrusted data; model cannot access other tenants' data; model output cannot trigger privileged actions; response guard blocks invented facts/claims | Prompt-injection and leakage tests |

## Implemented in Stage 3 (and what is still missing)

| Area | Built and tested | Missing |
|---|---|---|
| Tenant isolation | Frozen per-business handles, `business_id` bound in every statement (SQL-spy test), composite foreign keys, cross-tenant read/write/merge tests, business chosen only by site key + registered origin | Never tested on real D1; no owner auth |
| Database safety | Parameterized queries only; CHECK constraints; hostile-id tests; append-only audit log via triggers | No least-privilege roles (single binding); no encryption beyond the host's |
| API protection | Per-client and per-business rate limits, 429 + Retry-After, 8 KB body limit, strict JSON checks, per-business CORS, no internals in errors, `no-store`/`nosniff` | IP-based limits only; origin is not authentication (KI-6); no bot protection |
| Input validation | Message, phone, email, ZIP, name validators; text stored as inert data (render must escape; the demo page uses `textContent`) | Dashboard output escaping not built |
| AI-specific | Customer text only in user messages; guard rejects promises/prices/times/phones/links; mock text hidden | Never tested against a real model (KI-19) |
| Audit | Business, lead, knowledge, contact, and notification events without customer values or addresses | Logins/permission failures (no auth) |
| Notifications | Per-business outbox with composite foreign keys; only verified, enabled contacts used; text built only from that business's own lead; header/control-character stripping; idempotent; error codes only (no text) stored; real providers refused by the registry | Contact verification flow (KI-25); notification volume caps (KI-27); privacy review (KI-26); webhook signature checks (none exist yet) |
| Privacy | Only needed fields collected; no passwords or cards requested | No retention/deletion policy, no encryption at app level, plain-text PII (KI-17) |

## Known weaknesses today

See `KNOWN_ISSUES.md`. Notably: origin and site key are not authentication (KI-6), personal data is stored unencrypted with no retention policy (KI-17), and leads reach nobody (KI-18).

## Rules for contributors

1. No secrets in code, docs, tests, or commit messages.
2. Any new table must include `business_id` and appear in the cross-tenant test.
3. Any new endpoint must declare its auth requirement and have an unauthorized-access test.
4. Security-relevant changes are recorded in `DECISIONS.md`.
