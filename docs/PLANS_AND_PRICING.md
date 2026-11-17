# Subscription Plans and Pricing

Last updated: 2026-11-16 · Status: **PROVISIONAL. No price below is final. No billing is active.**

## Current proposal (from founder)

| Plan | Proposed price | Status |
|---|---|---|
| Starter | $99/month | provisional |
| Growth | $199/month | provisional |
| Pro | $299/month | provisional |

## Requirement: research before final prices

Final prices will be recommended only after we research and calculate real operating costs. **That research has not been done yet.** No cost figure appears in this repo until it is sourced and dated.

### Cost model to be completed (per business, per month)

| Cost driver | How we will determine it | Status |
|---|---|---|
| AI model usage | Measure tokens per typical conversation with the mock/real providers on our test set; multiply by the provider's *current official* price (record date + URL) | NOT DONE |
| Hosting / compute / database | Check the host's current official pricing and free-tier limits (record date + URL) | NOT DONE |
| SMS notifications | Provider pricing × expected notifications per plan | NOT DONE |
| Email notifications | Provider pricing / free limits | NOT DONE |
| Payment processing fees | Provider's official fee schedule | NOT DONE |
| Monitoring / error reporting | Free-tier limits vs paid | NOT DONE |
| Support time | Founder's own estimate | NOT DONE |

Outputs of the research: cost per conversation, cost per business at low/typical/high usage, break-even usage per plan, and a recommended price and usage limit per plan with the assumptions written down.

## Draft plan shape (NOT decided; for discussion)

Limits are intentionally blank until cost research sets them.

| Capability | Starter | Growth | Pro |
|---|---|---|---|
| Website chat widget | yes | yes | yes |
| Verified knowledge base | yes | yes | yes |
| Emergency recognition | yes (all plans) | yes | yes |
| Lead capture + dashboard | yes | yes | yes |
| Monthly conversation limit | TBD | TBD | TBD |
| Notification channels | TBD | TBD | TBD |
| Staff user seats | TBD | TBD | TBD |
| Analytics depth | TBD | TBD | TBD |
| Number of widgets / locations | TBD | TBD | TBD |

Principle: **safety features (emergency recognition, honesty guardrails) are never gated behind a higher tier.**

## Architecture requirement: plans are data

Plans, limits, and feature access must be changeable without rewriting application code:

- `plans`: id, name, price (display only until billing is approved), active flag.
- `plan_entitlements`: plan id → feature key → value (boolean or numeric limit).
- `business_subscriptions`: business id → plan id → status, period dates.
- `usage_counters`: business id, metric, period → count.
- One `entitlements` service answers "may this business do X?" and "how much of Y is left?". Feature code calls this service and never checks a plan name directly.
- Per-business overrides are supported (e.g. a pilot customer).
- Billing is a separate adapter behind an interface. **Not activated** until the founder approves.

## Decision log (pricing)

| Date | Decision | By |
|---|---|---|
| 2026-11-16 | Three tiers planned; $99 / $199 / $299 proposed, provisional pending cost research | Founder |
