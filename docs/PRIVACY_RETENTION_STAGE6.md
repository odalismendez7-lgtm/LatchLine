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
A possible starting policy is to allow the business owner to choose a retention period for conversation records and leads, with a clearly explained default, and to offer a business-wide data export and deletion workflow. Exact periods, exceptions, backup expiry, and whether leads are retained separately from messages are undecided. **No automatic deletion currently occurs as a result of this document.**

## Stage 6 acceptance criteria
- [ ] Founder approves explicit retention periods and exceptions.
- [ ] A customer-facing privacy notice accurately describes collection, use, sharing, retention, deletion, and limitations.
- [ ] Business-owner deletion/export endpoints and UI exist and are authorization-tested.
- [ ] Deletion covers conversations, messages, leads, lead events, notifications, related records, and business-specific data as appropriate; dependencies are mapped before implementation.
- [ ] Retention sweeper is bounded, tenant-safe, idempotent, and observable without leaking customer data.
- [ ] Tests cover foreign tenant denial, partial-failure rollback, repeat deletion, dependent rows, and post-delete verification.
- [ ] Backup/provider/log retention is documented and verified or clearly stated as a limitation.
- [ ] No production/legal-compliance claim is made without independent review.
