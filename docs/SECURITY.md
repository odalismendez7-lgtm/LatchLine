# Security Requirements

Last updated: 2026-11-19 (Stage 6) · Status: REQUIREMENTS, partly implemented (see the table below). Not security-reviewed by anyone independent.

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

## Implemented in Stage 5 (DEMO authentication, not production-ready)

| Area | Built and tested | Missing / caveats |
|---|---|---|
| Passwords | PBKDF2-SHA256, 600,000 iterations, random salt, parameters in the hash, rehash on login, length 12-128 with a common-password and email check, constant-time compare; no plaintext in the database, audit log, or responses (tested) | Cost never measured on Workers (KI-30); no breach database, no MFA (KI-35) |
| Sessions | Random token, only its hash stored; 30 min idle and 12 h absolute expiry; new token per login; logout, logout-everywhere, password change and reset revoke sessions; HttpOnly SameSite=Strict cookie (`__Host-` + Secure on https) | Not run behind real HTTPS hosting (KI-39); no session list UI |
| Attack protections | Generic errors, identical answers for known/unknown emails, dummy-hash timing, per-IP and per-email throttles (429 + Retry-After), CSRF token + same-origin check on every state change, JSON-only, 16 KB limit, strict nonce CSP, no `innerHTML`, hostile markup shown as text (browser-tested) | Lockout trade-off (KI-34); no CAPTCHA (KI-33) |
| Recovery | Forgot-password never reveals whether an account exists; reset links last 1 hour, work once, newest wins, weak passwords do not burn the link | Links are only SIMULATED emails (KI-31) |
| Authorization | Deny-by-default role table, membership checked in the database on every request, 404 for non-members (no existence leak), 403 for missing permission, last-owner protection, invitations bound to the invited verified email | Roles are coarse; no per-lead assignment |
| Tenant isolation over HTTP | 20+ cross-business attempts (read, edit, delete, export, verify, invite, role change, guessed ids, hostile ids, body/query overrides, removed members) all denied with the business unchanged; SQL spy covers the new repositories | Not tested on real D1 (KI-15) |
| Contact verification | See Decision 42; simulated-only with the mock; cannot be upgraded to real | Real provider untested (KI-36) |
| Audit | Account, lead, settings, contact, team and export events; ids and field names only | No alerting |

**Demo vs production.** What exists is real security logic running against a mock mailer on a local server. It is **demo authentication**. It becomes production authentication only after: real email delivery (KI-31), a measured hashing cost on the target platform (KI-30), HTTPS hosting re-tests (KI-39), bot protection (KI-33), and an independent security review. None has happened.

## Stage 6: runtime-specific security notes

| Topic | State |
|---|---|
| Platform cannot hash | Authentication fails closed (503, nothing created, no enumeration); simulated with a capped `deriveBits` in `tests/hash.platform.test.mjs`. Whether Workers really caps PBKDF2 at 100,000 is reported but unverified (KI-30) |
| Hash strength | Startup guard refuses fewer than 600,000 iterations (tested, mutation-checked). Real cost on Workers unmeasured; Node suggests it exceeds the free CPU limit (KI-30). Unresolved, not weakened |
| Exposure | The dashboard is reachable through the Worker entry only with `LATCHLINE_ACCOUNTS=mock-local`; default off and absent from `wrangler.toml` (tested, KI-32). Dev mailbox needs its own flag and a localhost request |
| Persistence of secrets | Only hashes of passwords and tokens are stored. The dev-only `simulated_mail` table holds raw one-time tokens by design, purged after 2 hours (KI-41) |
| Isolation in real processes | Cross-business attacks, hostile ids, missing CSRF and foreign origins were re-run over real HTTP against two server processes, before and after restarts |
| Outages | A write lock (process tests) and injected D1 errors (Worker tests) give 503 without internals, no session cookie, no partial writes, identical answers for known and unknown emails, and automatic recovery |
| Logs | Server output of the real processes was scanned: no passwords, session tokens or customer phone numbers |
| Not verified | Workers CPU and memory limits and the production PBKDF2 cap (local workerd shows none of them, KI-30, KI-40), isolate eviction (the app is cached in module memory), hosted D1 semantics, HTTPS behavior behind Cloudflare (KI-39, KI-40). Validated on local workerd 2026-11-21: tenant isolation, sessions, CSRF/origin checks, single-use tokens and throttles under concurrency, fail-closed hashing |

## Known weaknesses today

See `KNOWN_ISSUES.md`. Notably: origin and site key are not authentication (KI-6), personal data is stored unencrypted with no retention policy (KI-17), leads reach nobody real (KI-18), accounts use a mock mailer (KI-31), and hashing cost on Workers is unmeasured (KI-30).

## Rules for contributors

1. No secrets in code, docs, tests, or commit messages.
2. Any new table must include `business_id` and appear in the cross-tenant test.
3. Any new endpoint must declare its auth requirement and have an unauthorized-access test.
4. Security-relevant changes are recorded in `DECISIONS.md`.
