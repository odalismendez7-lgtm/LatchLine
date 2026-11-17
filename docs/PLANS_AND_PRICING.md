# Subscription Plans and Pricing

Last updated: 2026-11-17 · Status: **PROVISIONAL. No price below is final. No billing is active.**

## Current proposal (from founder)

| Plan | Proposed price | Status |
|---|---|---|
| Starter | $99/month | provisional |
| Growth | $199/month | provisional |
| Pro | $299/month | provisional |

## Requirement: research before final prices

Final prices will be recommended only after real operating costs are calculated. **That research is partly done (AI model and hosting costs). The other cost drivers are not.** Every number is sourced and dated; nothing is guessed.

### Cost model (per business, per month)

| Cost driver | Status | Detail |
|---|---|---|
| AI model usage | PARTLY DONE | Official prices recorded in `AI_MODEL_EVALUATIONS.md` (read 2026-11-16). Cost per conversation below uses **assumed** token counts; real counts come from Stage 3 measurement. |
| Hosting / compute / database | PARTLY DONE | Cloudflare limits and prices below (read 2026-11-16). Commercial-use terms of the free plan not yet checked. |
| SMS notifications | NOT DONE | Needs a provider choice. |
| Email notifications | NOT DONE | Needs a provider choice. |
| Payment processing fees | NOT DONE | Needs the payment provider's official fee schedule. |
| Monitoring / error reporting | NOT DONE | Free-tier limits vs paid. |
| Support time | NOT DONE | Founder's estimate. |

### Hosting: Cloudflare (read 2026-11-16, page dated Nov 13, 2026)

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

| Item | Free | Paid |
|---|---|---|
| Workers base price | $0 | $5.00 minimum per account per month |
| Workers requests | 100,000 per day | 10 million per month included, then $0.30 per extra million |
| Workers CPU time | 10 ms per request | 30 million CPU-ms per month included, then $0.02 per extra million |
| D1 rows read | 5 million per day | 25 billion per month included, then $0.001 per million |
| D1 rows written | 100,000 per day | 50 million per month included, then $1.00 per million |
| D1 storage | 5 GB total | 5 GB included, then $0.75 per GB-month |
| D1 point-in-time restore (Time Travel) | 7 days | 30 days |

Notes:
- On the Free plan, exceeding the daily D1 limits makes queries return errors until 00:00 UTC. That would be an outage for every business at once, so **the Free plan is for development and a small pilot only, not for paying customers.**
- Time Travel is automatic, always on, and has no extra cost. For longer retention, Cloudflare suggests exporting to R2 (a separate service; its pricing is not yet researched).
- Free write budget example: if each customer message writes 5 rows, the Free plan allows about 20,000 messages per day across all businesses combined (100,000 ÷ 5). The 5 is an assumption.
- Measured locally on Node (not on the Workers runtime): the safety layer plus retrieval took a median of 0.017 ms and a worst case of about 1 ms per message over 20,000 calls, far below the 10 ms Free CPU limit. This is indicative only and must be re-measured on the real runtime.

### AI cost per conversation (illustrative, NOT measured)

Assumptions, all unmeasured: 8 customer turns; 1,200 tokens of system prompt plus business facts sent every turn; 40-token customer messages; 80-token replies; full history resent each turn; no caching or batch discounts. That gives **13,280 input and 640 output tokens** per conversation. Prices as of 2026-11-16.

| Model | Per conversation | Per 300 conversations | Per 1,000 conversations |
|---|---|---|---|
| Claude Haiku 5.5 | $0.00165 | $0.49 | $1.65 |
| Gemini 2.5 Flash-Lite | $0.00158 | $0.48 | $1.58 |
| gpt-6-luna | $0.00165 | $0.49 | $1.65 |
| Workers AI gpt-oss-20b | $0.00285 | $0.85 | $2.85 |
| Gemini 3.5 Flash-Lite | $0.00558 | $1.68 | $5.58 |
| Gemini 3.6 Flash (price doubles 2027-01-01) | $0.01236 | $3.71 | $12.36 |
| gpt-6.1-terra | $0.01648 | $4.94 | $16.48 |
| Claude Sonnet 5.5 | $0.03296 | $9.89 | $32.96 |
| gpt-6.1-sol | $0.03296 | $9.89 | $32.96 |
| Claude Opus 5.5 | $0.06592 | $19.78 | $65.92 |
| Claude Fable 5.2 | $0.13184 | $39.55 | $131.84 |

What this does and does not tell us:
- **Under these assumptions**, model cost is a small share of a $99 plan even for mid-tier models, so price is more likely to be decided by usage limits, notification costs, payment fees, and support time than by the model. This must be re-checked with measured tokens and real conversation volumes.
- It does **not** include notifications, payment fees, monitoring, support, or the Workers Paid plan.
- It assumes every conversation is a long one; real volume per business is unknown until pilots.
- Long conversations, longer prompts, or retries raise cost; caching and batch discounts can lower it. None are included.

### Outputs still required before recommending final prices

Measured cost per conversation; cost per business at low/typical/high usage; notification and payment costs; break-even usage per plan; recommended price and usage limit per plan, with assumptions written down.

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

Plans, limits, and features must be changeable without rewriting application code:

- `plans`: id, name, price (display only until billing is approved), active flag.
- `plan_entitlements`: plan id → feature key → value (boolean or numeric limit).
- `business_subscriptions`: business id → plan id → status, period dates.
- `usage_counters`: business id, metric, period → count.
- One `entitlements` service answers "may this business do X?" and "how much of Y is left?". Feature code calls this service and never checks a plan name directly.
- Per-business overrides are supported (e.g. a pilot customer).
- Billing is a separate adapter behind an interface. **Not activated** until the founder approves.
- The AI router already records provider, model, latency, tokens, and a cost estimate per call (only when a price is configured), which feeds usage counters and cost tracking.

## Decision log (pricing)

| Date | Decision | By |
|---|---|---|
| 2026-11-16 | Three tiers planned; $99 / $199 / $299 proposed, provisional pending cost research | Founder |
| 2026-11-17 | Hosting and AI cost research recorded (partial). Prices remain provisional. | Engineering |
