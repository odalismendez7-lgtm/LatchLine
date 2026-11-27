# Privacy, Retention, and Deletion — Stage 6 Baseline

**Status: founder-approved retention design; implementation and legal review still pending.** The founder approved the proposed 12-month retention period on 2026-11-27. This document is an engineering policy record, not legal advice or a claim of compliance.

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
4. Deletion must be transactional where possible, account for foreign keys and dependent rows, and leave only minimal audit evidence where legally and operationally justified; retained identifiers are pseudonymous/linkable, not anonymous. Do not claim deletion if dependent records remain.
5. Deletion and retention controls must be tested with multi-tenant fixtures, retry/failure cases, and database read-back checks before release.
6. Backups, provider retention, logs, and third-party AI/email processing require separately documented retention and deletion limitations. Deletion from the live database must not be represented as immediate deletion from backups or providers.
7. Do not send data to real AI or email providers until the business-facing disclosure, provider configuration, and appropriate consent/approval gates are reviewed.
8. Avoid legal-compliance claims. This engineering baseline is not legal advice.

## Founder-approved retention policy (approved 2026-11-27; enforcement pending)

- **Customer lead and conversation records:** retain for no longer than 12 months after the customer's last activity, then delete from the active application database.
- **Activity timestamp:** enforcement must use the most recent customer activity timestamp (not a staff edit, status change, automated notification or assistant-only message) and must be carefully validated before implementation. If the database cannot reliably distinguish customer activity, enforcement must fail closed rather than delete based on an unreliable timestamp.
- **Deletion requests:** individual lead deletion is implemented. Business-wide deletion and complete export workflows remain incomplete.
- **Audit records:** the existing immutable audit system's retention is separate and unresolved; it may retain linkable business/record identifiers and must not be represented as fully deleted or anonymous.
- **Backups, platform logs and provider data:** separate retention boundaries must be disclosed; deletion from the live database cannot promise immediate deletion from backups or third parties.
- **AI/email provider sharing:** no real provider is enabled by default; live provider setup requires accurate disclosure and configuration review.

The founder approved this retention period. Automatic enforcement is **not yet enabled**; a safe, tested sweeper, explicit timestamp definition, and verification are still required.

## Deletion dependency map (schema review)

The current SQLite/D1 migrations define these database-level cascades:
- Deleting a business cascades to its registered origins, knowledge base, conversations, leads, contacts, notifications, memberships, and invitations.
- Deleting a conversation cascades to its messages and linked lead; deleting that lead cascades to lead events and notifications; deleting a notification cascades to notification-attempt rows.
- Deleting a user cascades to that user's sessions, authentication tokens, memberships, and invitations they created.
- Audit rows intentionally have no foreign key to businesses and have database triggers preventing update or deletion. They therefore survive business deletion; the current schema can retain business, actor, target, and related record identifiers in those rows. These identifiers are not customer message content, but they are still linkable metadata and must not be described as anonymous.
- Rate-limit rows use hashed keys and time windows, without a business foreign key.

These are schema-level effects, not proof that an end-user deletion workflow exists. A production deletion design must decide whether a user account shared across multiple businesses can be deleted, how to handle ownership transfer, how long audit identifiers remain, and how backup/log/provider copies expire. The existing lead-deletion operation records a minimal audit event and deletes its conversation; this does not provide a full business or account deletion workflow.

## Stage 6 acceptance criteria
- [x] Founder approves explicit retention period (12 months after customer activity, approval 2026-11-27); exceptions and enforcement details still need review.
- [ ] A customer-facing privacy notice accurately describes collection, use, sharing, retention, deletion, and limitations.
- [ ] Business-owner deletion/export endpoints and UI exist and are authorization-tested.
- [ ] Deletion covers conversations, messages, leads, lead events, notifications, related records, and business-specific data as appropriate; dependencies are mapped before implementation.
- [ ] Retention sweeper is bounded, tenant-safe, idempotent, and observable without leaking customer data.
- [ ] Tests cover foreign tenant denial, partial-failure rollback, repeat deletion, dependent rows, and post-delete verification.
- [ ] Backup/provider/log retention is documented and verified or clearly stated as a limitation.
- [ ] No production/legal-compliance claim is made without independent review.


## Founder product requirement: plumbing-only intake (approved direction)

The customer-facing assistant is a service-intake and scheduling assistant, not a general-purpose personal-data collector. The desired intake flow is:
1. Customer selects a plumbing issue category (e.g. leak, clog/drain, water heater, pipe repair, installation, other).
2. Customer describes the plumbing issue briefly.
3. Request service address, because dispatch requires it.
4. Request customer name and phone number for service follow-up; email is optional and should be requested only where the business needs it.
5. Summarize the request and submit it to the plumbing team; avoid claiming that submission, notification or booking occurred unless confirmed.

Collection boundaries: do not solicit Social Security numbers, payment-card numbers, banking credentials, passwords, identity-document details, or unrelated sensitive information. If customers volunteer such information, the assistant should not ask them to repeat it or include it in the service summary; where practical, warn them not to share it and minimize its storage and transfer. Avoid storing/echoing unnecessary sensitive content. No unrelated marketing, sale, or sharing of customer information is intended by this product direction.

This is an approved product requirement, not yet a claim that all controls are implemented or that legal compliance is established. AI-provider processing is still processing/sharing with a provider and must be minimized, disclosed accurately, and configured with provider retention settings reviewed before live use. Email is optional for intake. The implementation and tests must ensure this structured flow and validate its behavior before release.


## Customer notice draft (not yet approved or displayed in the widget)

Use this only as a starting point for a plumbing business's own notice. The business must customize it, verify its providers and operational practices, and review it before publishing:

> This chat helps collect plumbing service requests for [Business]. We may ask for a brief description of the problem, the property's ZIP code and street address, and a name and phone number so the team can follow up. Email is optional. Do not send passwords, payment-card details, bank information, Social Security numbers, or other sensitive information here. Your request is submitted to the plumbing business for service follow-up; this chat does not itself schedule or dispatch a technician. The chat may be processed by an AI service to help answer questions and organize the request. [Business] should insert the name of its AI provider and link to its applicable privacy notice, describe any notification providers, and explain retention and deletion practices after confirming them.

This wording deliberately does **not** promise that data is never shared, that AI-provider retention is zero, that a technician is dispatched, or that the business has received a request before a confirmed save/notification result. It is a draft, not a legal notice or verified disclosure.

## Release privacy checklist (engineering gate)

- [ ] Configure only necessary AI context: avoid forwarding unrelated conversation history, volunteered sensitive information, or contact/address fields when they are not needed for the AI task. Confirm this from request-level tests and provider configuration, not documentation alone.
- [ ] Identify the actual AI, hosting, analytics/logging, email and SMS providers; verify their retention, training/use, access and deletion settings and document their role before enabling them.
- [ ] Inspect logs, exception traces, analytics, debug mailbox and audit detail for PII leakage using seeded test values and automated assertions.
- [ ] Confirm that sensitive volunteered text is not echoed into summaries, notifications, audit details or AI payloads unnecessarily; document cases where redaction cannot be reliably detected.
- [ ] Give customers and business owners an accurate notice and a usable deletion-request path. The notice must describe limits for backups and third-party copies.
- [x] Obtain founder approval for the 12-month retention schedule (2026-11-27).\n- [ ] Implement and test retention enforcement; review the customer-facing notice and seek qualified legal review before launch.

## Known current limitations

- The customer widget has not yet been proven to present the above privacy notice or enforce all collection boundaries.
- Free-text redaction and viewer-role masking are heuristic protections, not a complete sensitive-data detection system; privileged owner/staff views may still expose stored customer details.
- Real provider payloads, their retention behavior, and deletion propagation have not been independently verified. Current provider integrations remain mock/default or unconfigured.
- Business/account-wide deletion, full data export/deletion request workflows, and automatic retention enforcement are not implemented.
- The append-only audit design preserves identifiers and details across deletion; audit retention is unresolved.
