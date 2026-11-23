# Independent security and reliability audit: emergency partial-lead work (Stage 6d)

Date: 2026-11-23 · Scope: commit 6741c54 (emergency partial-lead persistence) · Method: adversarial attack scripts, failure injection, and two separate reviewer passes by agents that had not written the code. Everything was run on in-memory SQLite, a local workerd/D1 probe and the mock notifier. No real AI, email, SMS, payment, customer data or Cloudflare resource was used. **This is not a certification and does not show production readiness.**

## Confirmed problems (all reproduced first, fixed, and pinned by a regression test in `tests/audit.emergency.test.mjs`)

| # | Severity | Problem | Fix | Test |
|---|---|---|---|---|
| A1 | Medium | A follow-up alert (contact added / emergency added) could be lost for good when the outbox write failed after the lead update and the customer left; the reconcile job did not cover it. An ordinary lead upgraded to an emergency could stay at normal priority | `reconcileMissing` now rebuilds missing follow-up alerts from the lead's own update history, with the right priority, per recipient, tenant-scoped, idempotent | "alerts that should exist are recovered..." (4 tests) |
| A2 | Medium | A corrected phone/email silently overwrote the old one: the old value was lost and the business was never told (an alert already sent kept showing the old number) | Old value kept in the lead history (hidden from masked roles); one extra alert per correction, capped at 3 | "a corrected phone/email is never lost silently..." (3 tests) |
| A3 | Medium | `leads.update` only read back phone/email, so a failed emergency upgrade could be reported as done | Read-back covers every written column | "an emergency upgrade that did not persist..." |
| A4 | Low | `leads.update` accepted wrong types, oversize text, control characters, bad email, odd category names; `phone: undefined` wiped a phone | Validation and caps; `undefined` means "not provided" | "refuses bad input...", R10 |
| A5 | Medium | A read-only (viewer) dashboard user could rebuild a hidden phone/email by searching the free text of leads (a count oracle) | Viewers search name and ZIP only | "cannot recover a hidden phone number by searching", R1 |
| A6 | Medium | Viewer redaction missed phone numbers typed with odd separators (double spaces, " - ", long dash runs, slashes) that the customer-side extractor still accepts | Redaction removes any run of 10+ digits with any separators | R2 |
| A7 | Medium | Reconcile re-sent old alerts to a recipient added later, wrote audit rows on every run, could be starved by old leads, and could send "use these contact details" for a lead with no contact | Skips alerts that already exist for any recipient; no-op runs write nothing; scans in pages; wording checks the lead really has contact | R3 to R7 |
| A8 | Low | A failed correction showed "I've updated that" beside "not saved", and said the business got nothing although the earlier message was recorded | Separate honest wording for a failed update | R9 |
| A9 | Medium | Two parallel updates of one lead lost one change (categories) or lost an intermediate value | Compare-and-set writes with retry; history/audit rows exist only if the write landed | "audit round 2b" (3 tests) |
| A10 | Medium | A lone UTF-16 half (a cut emoji) made every lead update fail its read-back, so a lead update was rejected and the first alert depended on reconcile | Text normalised to well-formed before storing | R11 (2 tests) |

## Attacks that held (tests pin them so they stay that way)
Other business's conversation id (starts a fresh chat, nothing read or changed); corrupted state pointing at another business's lead; cross-tenant update/enqueue/getByConversation; fields the repository does not own; parallel chats in two businesses; dashboard access to another business's incomplete leads, counts, filters, export, delete; SQL-looking filter values; staff delete (owner only); CSV formula text; header injection in alert subjects; prompt-injection and "promise me a time/price/warranty" messages (no claims, lead unchanged); over-long messages; all of database, outbox and AI failing at once (safety text still shown, nothing claimed saved); failed update batch (lead unchanged, honest reply, recovers); concurrent dispatchers (each alert sent once); provider accepted but record failed (same idempotency key, one message); alerts never "delivered" without provider confirmation; migration 0005 on a database with existing rows, a failed migration (rolled back), CHECK constraint on raw inserts.

## Unresolved risks (see KNOWN_ISSUES KI-50 to KI-58)
- Alert flooding: anyone can type hazard words; limits are 30 requests/min per client and 600/min per business, so up to hundreds of emergency alerts per minute per business could be queued (cost once SMS is real). Capping alerts risks dropping a real emergency, so this needs a founder decision.
- After 3 corrections the last phone change is stored but triggers no further alert.
- Two chat messages of one conversation processed truly in parallel can share a correction revision number (reconcile repairs it later).
- Under heavy parallel updates of one lead (8+ at once) an update can report "not saved" although each write was valid (conservative failure).
- Real hosted D1 behaviour (migration 0005, `changes()` inside a batch, concurrency) is unverified. `changes()` inside a batch was verified only on LOCAL workerd/D1 (`tests/workerd.probe.test.mjs`).
- Viewer masking by design shows the last 4 digits of a phone and the email domain.
- Wording has not been reviewed by a professional (KI-12); real-model behaviour unverified (KI-46); notifications simulated only.
