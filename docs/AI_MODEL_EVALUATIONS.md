# AI Model Evaluations

Last updated: 2026-11-17 · Status: **Provider research done (pricing, privacy). NO model has been tested. No provider is connected. No paid API is active.**

This is the permanent record of which models and providers were looked at, how, and what was decided. Do not add a number that was not measured or sourced.

## Important caveats about this research

1. **Source and method.** Figures were read on **2026-11-16** from the providers' official pages using a fetch tool that *summarizes* the page. Treat every number as "reported by the summary of the official page" and **re-verify on the official page before any spending decision.** OpenAI pricing was read from one fetch only and uses model names we have not otherwise confirmed.
2. **Prices change.** The Google page itself lists scheduled increases (see below). Every price here has a read date; re-read before relying on it.
3. **Quality and latency are NOT in this document because we have not measured them.** No official page gave latency numbers, and vendor benchmark claims are not accepted as evidence for our use case. Quality and latency will come from our own test set (see "How we will evaluate").
4. **Nothing here is a model decision.** It is a shortlist and a plan.

## Pricing (USD per million tokens, standard rates, read 2026-11-16)

Sources: Anthropic [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) · OpenAI [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=standard) · Google [aistudio.google.com/docs/pricing](https://aistudio.google.com/docs/pricing) · Cloudflare [developers.cloudflare.com/workers-ai/platform/pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

| Provider | Model | Input | Output | Notes |
|---|---|---|---|---|
| Anthropic | Claude Haiku 5.5 | 0.10 | 0.50 | Applies to prompts up to 100K tokens; 0.50 / 2.50 above that |
| Anthropic | Claude Sonnet 5.5 | 2 | 10 | Cache-read 0.10; batch 50% off |
| Anthropic | Claude Opus 5.5 | 4 | 20 | Cache-read 0.20 |
| Anthropic | Claude Fable 5.2 | 8 | 40 | Highest tier listed for general use |
| OpenAI | gpt-6-luna (smallest listed) | 0.10 | 0.50 | Cached input 0.01 |
| OpenAI | gpt-6.1-terra | 1 | 5 | Cached input 0.05 |
| OpenAI | gpt-6.1-sol | 2 | 10 | Cached input 0.10 |
| OpenAI | gpt-6-astra (flagship) | 10 | 50 | Cached input 1.00 |
| Google | Gemini 2.5 Flash-Lite | 0.10 | 0.40 | |
| Google | Gemini 3.5 Flash-Lite | 0.30 | 2.50 | |
| Google | Gemini 3.6 Flash | 0.75 → 1.50 | 3.75 → 7.50 | **Doubles on 2027-01-01** per the page |
| Google | Gemini 4 Argon (flagship) | 2 → 4 | 10 → 20 | **Doubles on 2026-12-01** per the page |
| Cloudflare Workers AI | gpt-oss-20b | 0.20 | 0.30 | Hosted open-weight model |
| Cloudflare Workers AI | llama-3.3-70b-instruct-fp8-fast | 0.293 | 2.253 | Hosted open-weight model |

Workers AI also has a free allocation of 10,000 Neurons per day and charges $0.011 per 1,000 Neurons above that (paid plan). Some Workers AI models require the Workers Paid plan or prepaid credits.

## Privacy and data handling (read 2026-11-16)

| Provider | Training on your API data | Retention | Notes for LATCHLINE |
|---|---|---|---|
| Anthropic | Not used for training by default on commercial products, including the API, per the privacy center. Exceptions: submitted feedback and explicit opt-in. | API inputs/outputs deleted within 30 days by default; content flagged under the Usage Policy may be kept up to 2 years. Zero-retention only by agreement. | The retention page does not state the training default itself; the separate model-training article does. |
| OpenAI | Not used by default; only if you opt in. | Abuse-monitoring logs kept up to 30 days. Zero Data Retention needs OpenAI approval and has endpoint limits. | |
| Google (Gemini API) | **Free tier: content IS used to improve Google products. Paid tier: it is not.** | Not read | **Never send real customer conversations through a free tier.** |
| Cloudflare Workers AI | Cloudflare says it does not use customer content processed by Workers AI to train models. | No retention of inputs/outputs after the request, except when you use stateful features, AI Gateway logging/caching, or your own logs. | Third-party open-weight models carry their own licenses; check each model's license. |

Implication: customer text is personal data (names, phones, addresses). Before any real provider is used with real customers, we need the provider's data-processing terms reviewed and a disclosure to businesses and their customers. The app must not send more data than needed (the provider layer already records no message text in its call logs).

## Shortlist for evaluation (not a decision)

Chosen to test the "most expensive is not automatically best" assumption across cost tiers:

| Tier | Candidates |
|---|---|
| Low cost | Claude Haiku 5.5, gpt-6-luna, Gemini 2.5/3.5 Flash-Lite, Workers AI gpt-oss-20b |
| Mid | Claude Sonnet 5.5, gpt-6.1-terra / gpt-6.1-sol, Gemini 3.6 Flash |
| Premium (control) | Claude Opus 5.5 (and only if a clear need appears, a top tier) |

Working hypothesis, to be proven or rejected by measurement: because emergencies are handled by deterministic code and facts come from retrieval, a low-cost or mid-tier model may be enough for conversation and lead summaries. If a premium model does not measurably beat a cheaper one on our test set, we do not pay for it.

## How we will evaluate

Criteria and thresholds follow the table in `AI_STRATEGY.md`. Same fixed test set for every candidate:

- Uses only retrieved facts; says "needs confirmation" for unknown ones; no invented hours, prices, areas.
- Never promises arrival times or bookings; never claims an action succeeded.
- Resists prompt injection; never reveals other businesses' data.
- Asks relevant follow-up questions; does not re-ask collected fields.
- Produces correct structured lead summaries.
- Measured latency (median and slow tail) and error rate over repeated runs.
- Measured tokens per conversation, multiplied by the then-current official price.

### Thresholds

Still to be set by the founder and engineering before the first run. **TBD.**

### What it takes to run the evaluation (needs founder approval)

- Mock-only testing is free and already works. Real-model testing needs at least one provider API key with a **hard spending cap**, plus founder approval. Illustrative scale: 200 test conversations at the token assumptions in `PLANS_AND_PRICING.md` would cost roughly $0.33 (Haiku 5.5), $6.59 (Sonnet 5.5), or $13.18 (Opus 5.5) at standard rates. These are estimates from assumed token counts, not measurements.
- Use only synthetic test conversations, never real customer data. Do not use a Google free tier for any real data.

## Evaluation log

| Date | Provider / model | Test set version | Accuracy | Safety | Latency | Cost / conversation | Notes / decision |
|---|---|---|---|---|---|---|---|
| (none yet) | | | | | | | |

## Current state

- The provider interface, mock provider, and router are built and tested (`src/ai/`). The mock is clearly labeled and is not an AI model.
- Real providers (`anthropic`, `openai`, `google`, `workers-ai`) are **deliberately refused** by `src/ai/registry.js` until the founder approves; a test enforces this.
