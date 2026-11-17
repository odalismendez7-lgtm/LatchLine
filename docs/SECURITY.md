# Security Requirements

Last updated: 2026-11-16 · Status: REQUIREMENTS (none implemented yet except a basic origin allow-list and message-length limit in the prototype)

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

## Known weaknesses today

See `KNOWN_ISSUES.md`. Notably: the prototype's origin check is not authentication (non-browser clients can set any `Origin` header), and there is no rate limiting.

## Rules for contributors

1. No secrets in code, docs, tests, or commit messages.
2. Any new table must include `business_id` and appear in the cross-tenant test.
3. Any new endpoint must declare its auth requirement and have an unauthorized-access test.
4. Security-relevant changes are recorded in `DECISIONS.md`.
