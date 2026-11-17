# Analytics and Customer Value

Last updated: 2026-11-16 · Status: DESIGN (nothing implemented)

Goal: give owners a real reason to stay by showing measurable value, **without inventing results or exaggerating revenue**.

## Rules

1. Only report what is counted from real records.
2. If the data needed for a metric is missing (for example, business hours not configured), show "not available" and say what to set up. Do not guess.
3. Never present estimated revenue, "money saved", or "jobs won" as fact. LATCHLINE does not know whether a lead became a paying job unless the owner records the outcome.
4. Any estimate must be labeled as an estimate and use assumptions the owner entered themselves (shown next to the number).
5. Show the measurement period and sample size.

## Metrics (planned)

| Owner benefit | Metric | Source |
|---|---|---|
| Capture missed inquiries | Inquiries received outside configured business hours; conversations that ended with contact details captured | Conversations + business hours config |
| Organize leads | Leads by status, issue category, urgency; duplicates merged | Lead records |
| Respond efficiently | Median time to first response (system-measured); share answered from verified KB without human help; leads handed off | Message timestamps, handoff records |
| Identify urgent situations | Emergencies flagged; time from flag to notification attempt and delivery status | Safety layer + outbox |
| Reduce repetitive work | Count of repeat questions answered from KB (hours, area, services) | KB answer counts |
| Understand activity | Conversations per day/week, peak times, common issue types, unanswered-question list (what to add to KB) | Conversation data |
| Outcome (owner-entered) | Lead outcome: won / lost / unknown, entered by owner | Owner input; shown as "owner-reported" |

## Honest-by-design features

- **"Needs your attention" view**: failed notifications, unanswered questions, unconfirmed KB facts. Value comes from help, not vanity numbers.
- **Weekly summary** built only from counted data.
- **Operator-side measurement** of the product itself (latency, failures) is kept separate from customer-facing value metrics.

## Retention measures for the founder (internal)

Active businesses, weekly dashboard logins, KB completeness, leads handled, support contacts, cancellations with reasons. Reported as counted, with small-sample warnings.
