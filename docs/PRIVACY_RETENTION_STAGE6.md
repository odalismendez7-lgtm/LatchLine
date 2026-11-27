# Privacy, Retention, and Deletion — Stage 6 Baseline

**Status: proposal and engineering baseline only. Not an implemented policy or customer-facing legal notice.** No public service is deployed. The founder must approve retention periods and disclosures before production.

## Data inventory (confirmed from current implementation review)
- Conversation messages and conversation state.
- Lead details, including contact information and optional structured street address.
- Business knowledge-base/settings data and registered website origins.
- Team membership, invitations, contact-notification configuration, audit records, and notification/outbox status.
- Authentication data: password hashes, hashed sessions and one-time tokens; development simulated-mail records can contain raw one-time tokens.
- Application/provider logs and operational data may exist outside the database depending on the future hosting configuration.

## Principles and safeguards
1. Collect only fields needed for the customer inquiry and service follow-up; address capture remains optional.
2. Never put customer message text, contact values, street addresses, credentials, raw session tokens, or reset/invite tokens in routine logs or audit details.
3. Use tenant-scoped repositories and authorization for any export, delete, retention sweep, or customer-data access.
4. Deletion must be transactional where possible, account for foreign keys and dependent rows, and leave only minimal non-identifying audit evidence where legally and operationally justified. Do not claim deletion if dependent records remain.
5. Deletion and retention controls must be tested with multi-tenant fixtures, retry/failure cases, and database read-back checks before release.
6. Backups, provider retention, logs, and third-party AI/email processing require separately documented retention and deletion limitations. Deletion from the live database must not be represented as immediate deletion from backups or providers.
7. Do not send data to real AI or email providers until the business-facing disclosure, provider configuration, and appropriate consent/approval gates are reviewed.
8. Avoid legal-compliance claims. This engineering baseline is not legal advice.

## Proposed retention decision for founder review (not enforced)

This is a draft decision framework, not a binding policy or a deployed feature:
- **Customer conversation and lead records:** proposed default retention of 12 months from the last activity, with shorter/longer choices considered only after reviewing operational needs and legal obligations. This duration is a proposal and is not enforced.
- **Deletion requests:** business owners should be able to initiate deletion of individual records and, eventually, business-wide records. Individual lead deletion currently exists, but business-wide deletion and a retention sweeper do not.
- **Audit records:** avoid customer content; retain identifiers and event metadata only where justified. Audit records are not yet governed by a finalized retention schedule.
- **Backups, platform logs and provider data:** separate retention boundaries must be disclosed; deletion from the live database cannot promise immediate deletion from backups or third parties.
- **AI/email provider sharing:** no real provider is enabled by default; any live provider setup must include accurate disclosures and configuration review.

The founder must approve or replace these proposed durations and disclosures before a customer-facing policy is published or automatic deletion is enabled. **No automatic deletion currently occurs.**

## Deletion dependency map (schema review)

The current SQLite/D1 migrations define these database-level cascades:
- Deleting a business cascades to its registered origins, knowledge base, conversations, leads, contacts, notifications, memberships, and invitations.
- Deleting a conversation cascades to its messages and linked lead; deleting that lead cascades to lead events and notifications; deleting a notification cascades to notification-attempt rows.
- Deleting a user cascades to that user's sessions, authentication tokens, memberships, and invitations they created.
- Audit rows intentionally have no foreign key to businesses and have database triggers preventing update or deletion. They therefore survive business deletion; the current schema can retain the business identifier and actor identifier in those rows.
- Rate-limit rows use hashed keys and time windows, without a business foreign key.

These are schema-level effects, not proof that an end-user deletion workflow exists. A production deletion design must decide whether a user account shared across multiple businesses can be deleted, how to handle ownership transfer, how long audit identifiers remain, and how backup/log/provider copies expire. The existing lead-deletion operation records a minimal audit event and deletes its conversation; this does not provide a full business or account deletion workflow.

## Stage 6 acceptance criteria
- [ ] Founder approves explicit retention periods and exceptions.
- [ ] A customer-facing privacy notice accurately describes collection, use, sharing, retention, deletion, and limitations.
- [ ] Business-owner deletion/export endpoints and UI exist and are authorization-tested.
- [ ] Deletion covers conversations, messages, leads, lead events, notifications, related records, and business-specific data as appropriate; dependencies are mapped before implementation.
- [ ] Retention sweeper is bounded, tenant-safe, idempotent, and observable without leaking customer data.
- [ ] Tests cover foreign tenant denial, partial-failure rollback, repeat deletion, dependent rows, and post-delete verification.
- [ ] Backup/provider/log retention is documented and verified or clearly stated as a limitation.
- [ ] No production/legal-compliance claim is made without independent review.
