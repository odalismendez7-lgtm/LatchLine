# LATCHLINE Product Requirements (permanent)

Last updated: 2026-11-16 · Owner: Founder · Status: ACTIVE, binding on all development

These are standing requirements. They are changed only by the founder, and every change is recorded in `DECISIONS.md`.

**Tagline:** "Every inquiry has a next step."

## 1. Vision

LATCHLINE is an AI customer operations platform. It starts with residential plumbing businesses and is designed to extend to other service industries without a platform rebuild (see section 9).

It helps a business to:
- Respond to website inquiries around the clock *while the service is operational* (we never promise uninterrupted availability).
- Answer questions using that business's verified information only.
- Identify potential emergencies and follow approved safety procedures.
- Collect customer and job information.
- Capture and organize leads.
- Escalate to human employees.
- Give owners a dashboard to manage inquiries and leads.

Long-term goal: a product owners value enough to subscribe month after month. The goal is not sign-ups; it is a reason to stay.

## 2. Business model

Three planned subscription versions. **All prices are provisional** until operating-cost research is complete (see `PLANS_AND_PRICING.md`).

| Plan | Proposed price |
|---|---|
| Starter | $99/month |
| Growth | $199/month |
| Pro | $299/month |

Requirements:
- Plans, usage limits, and feature access are managed independently of code (entitlements are data, not hard-coded checks scattered through the app).
- **No billing or paid service is activated without founder approval.**

## 3. The AI is a major strength (not a generic chatbot)

The AI must be purpose-built for customer operations in plumbing businesses. It must:
1. Hold natural conversations, not follow a rigid script.
2. Ask relevant questions based on the customer's actual problem.
3. Remember context within the correct session only.
4. Retrieve verified information from each business's own knowledge base.
5. Recognize uncertainty and ask for clarification.
6. Identify emergencies and follow approved safety procedures.
7. Collect customer information without re-asking what it already has.
8. Produce clear, organized lead summaries.
9. Know when to transfer to a human.
10. Never invent information or pretend an action succeeded.

Model/provider rules:
- Evaluate providers on accuracy, reliability, latency, privacy, and cost.
- The provider layer is interchangeable; changing models must not require rebuilding LATCHLINE.
- The most expensive model is not assumed to be the best.
- No paid AI API is activated without founder approval.

## 4. Accuracy and safety (highest priority)

The AI must never:
- Invent business hours, prices, services, or service areas.
- Guarantee appointments or arrival times without confirmation.
- Pretend a lead or notification was submitted if it failed.
- Diagnose dangerous plumbing or electrical problems.
- Ignore emergency situations.
- Reveal another business's or customer's private information.

When information is missing, the assistant says so and offers human assistance. Every business has its own verified knowledge base. Safety outranks lead collection.

## 5. Security

Authentication and authorization; business data isolation; database security; API protection; input validation; rate limiting; secret management; audit logging; backup and recovery planning. Attempts to access another business's data must be tested. Details: `SECURITY.md`.

## 6. Reliability and 24/7 operation

Design for continuous operation and high availability: health checks and monitoring, error reporting, automatic recovery where appropriate, database backups, failure handling, AI-provider outage handling, notification-failure detection, human escalation, documented recovery procedures.

We never promise zero errors or uninterrupted availability. We measure actual performance and document limitations. Details: `RELIABILITY.md`.

## 7. Customer retention through measurable value

Analytics must show real benefits without inventing results or exaggerating revenue:
- Inquiries captured (including outside business hours).
- Leads organized.
- Customer response efficiency.
- Urgent situations identified.
- Repetitive administrative work reduced.
- Customer inquiry activity over time.

Details: `ANALYTICS.md`.

## 8. Financial restrictions (development budget: $0)

Do not purchase subscriptions, activate paid APIs, buy hosting or domains, enable paid services, deploy publicly, or create charges. Use free tools and mock integrations. Tell the founder *before* any action that could cost money or expose the app publicly.

## 9. Long-term product vision

Start with residential plumbing but keep industry-specific content (emergency rules, intake fields, vocabulary, knowledge-base schema) in **data/configuration ("industry packs")**, not woven through core code. Core platform concepts (business, knowledge base, conversation, lead, handoff, plan) stay industry-neutral.

## 10. Permanent records

These documents are maintained continuously and updated whenever a decision or implementation changes:

| Record | File |
|---|---|
| Product requirements | `docs/PRODUCT_REQUIREMENTS.md` |
| Subscription tiers and pricing decisions | `docs/PLANS_AND_PRICING.md` |
| AI strategy and model evaluations | `docs/AI_STRATEGY.md`, `docs/AI_MODEL_EVALUATIONS.md` |
| Architecture decisions | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` |
| Security requirements | `docs/SECURITY.md` |
| Features completed | `docs/FEATURE_STATUS.md` |
| Test cases and results | `docs/TEST_CASES.md` |
| Known problems | `docs/KNOWN_ISSUES.md` |
| Future improvements | `docs/ROADMAP.md` |

## 11. Development standards

- Every feature is implemented, tested, and reviewed before it is marked done.
- Incomplete features are never marked finished.
- Errors are fixed, not hidden. No fake functionality to look finished.
- If something cannot be completed in the free environment, we state exactly what is missing and what it would take.
- Nothing is called "production-ready" unless the required checks have actually passed and the results are recorded in `TEST_CASES.md`.
- After every stage: what was built, files changed, tests run, errors/limitations, next step.
