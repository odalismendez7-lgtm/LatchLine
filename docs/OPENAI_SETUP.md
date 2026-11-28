# OpenAI provider setup

Status: adapter implemented on `codex/latchline-completion`; **not yet connected to an account, not live-tested, and not approved for real customer data**.

## What is implemented

- OpenAI Responses API adapter at `src/ai/openai.js`.
- Explicit model selection; no model is silently chosen by the adapter.
- Server-side API key only; `store: false`; no customer text in application call logs.
- Bounded output tokens, timeout/abort, sanitized provider errors, and usage capture.
- The deterministic emergency detector, knowledge retrieval, lead persistence, response guard and notification rules remain in front of / around the model. The model cannot mark a lead saved or a notification sent.

Official API reference: https://developers.openai.com/api/reference/cli/resources/responses/methods/create
Official model list and pricing: https://developers.openai.com/api/docs/models/compare and https://developers.openai.com/api/docs/pricing

## Selected initial evaluation candidate

Use `gpt-6-luna` as the first low-cost evaluation candidate, not as a final quality decision. It is listed by OpenAI as a current model supporting the Responses API. Verify current price and availability in the official pricing page before enabling usage. Do not infer quality from price.

## Local setup

Create a local `.dev.vars` file (never commit it) with:

```dotenv
LATCHLINE_AI_PROVIDER="openai"
OPENAI_API_KEY="your-api-key"
OPENAI_MODEL="gpt-6-luna"
```

The Worker entry reads these values only from server-side environment bindings. Without all three values, it stays on the mock provider.

## Hosted setup (only after a separate deployment decision)

1. In the Cloudflare dashboard, add `LATCHLINE_AI_PROVIDER=openai` and `OPENAI_MODEL=gpt-6-luna` as Worker variables.
2. Add `OPENAI_API_KEY` as an encrypted Worker secret. Never put the key in Git, the widget, browser JavaScript, a URL, a screenshot, or a chat message.
3. Set an OpenAI API project budget / usage limits and alerts before any live traffic.
4. Deploy only after the hosted D1, auth, security, privacy, emergency and rollback gates are approved.
5. Run the controlled evaluation suite with synthetic data and inspect latency, token usage, refusal behavior, hallucinations, Spanish quality, and every emergency / failure path.

OpenAI API usage is billed separately from a ChatGPT subscription. Do not enable the provider until the API project has a spending limit that the founder accepts.

## Privacy gate

The API adapter sends the system instructions, verified business grounding, and recent conversation messages needed for a model response. Those messages can contain personal information if a customer supplied it. `store: false` is a request setting, not a substitute for reviewing current API data controls, retention, applicable data-processing terms, the business's privacy notice, and customer disclosure. **Do not use real customer conversations until that review is complete.**

## Current blockers

- No API key or OpenAI project is connected.
- No model quality evaluation has been run; the new adapter tests use a fake HTTP response.
- No hosted Worker or D1 deployment has been approved or verified.
- The response guard is heuristic and must be adversarially evaluated against real model outputs.
- No real email/SMS provider exists; a saved lead still does not reach a real plumber.
- No licensed plumbing professional has reviewed emergency procedures.
