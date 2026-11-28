# Cloudflare Workers AI setup

Status: a binding-based provider adapter is implemented and tested with a mocked `env.AI.run()` binding. No Cloudflare account, binding, real inference, model evaluation, or production deployment has been connected.

## Why this provider is the first $0 evaluation path

Cloudflare's current Workers AI pricing documentation (checked 2026-11-26) states:
- Workers AI is available on Workers Free and Workers Paid.
- Workers Free includes **10,000 Neurons per day** at no charge.
- The daily allocation resets at 00:00 UTC. On Workers Free, requests fail when the allocation is exhausted; no automatic overage billing occurs on the Free plan.
- Workers Paid starts at $5/month and usage above the daily free allocation is priced at $0.011 per 1,000 Neurons. Do not upgrade or enable paid overages without explicit budget approval.
- Some models require a paid billing method. The chosen evaluation candidate below is not listed among those paid-only models in the current pricing page; confirm availability in the account before enabling.

Official sources:
- [Workers AI pricing and free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers AI model page: Gemma 4 26B A4B](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
- [Workers AI binding setup](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/)
- [Reject busy requests](https://developers.cloudflare.com/workers-ai/features/reject-if-busy/)

## Evaluation model candidate

`@cf/google/gemma-4-26b-a4b-it`

Cloudflare documents it as a multilingual text-generation model with a 256,000-token context window, function calling, and a Workers AI binding interface. Its listed token rates are $0.10 per million input tokens and $0.30 per million output tokens; the free daily Neuron allowance applies before paid usage. These published specs are not evidence of LATCHLINE conversation quality. It must pass our own evaluation before use with customers.

## Local / hosted configuration

The `wrangler.toml` file now declares the optional `AI` binding. The binding alone does not enable inference. To opt in, set the Worker variable:

```dotenv
LATCHLINE_AI_PROVIDER="workers-ai"
WORKERS_AI_MODEL="@cf/google/gemma-4-26b-a4b-it"
```

The mock remains the default unless `LATCHLINE_AI_PROVIDER=workers-ai` and the `AI` binding both exist. The OpenAI adapter remains available through its separate explicit configuration.

## Guardrails

- Calls are synchronous, non-streaming, pass `max_tokens` to cap generated output, and use `rejectIfBusy: true` in the binding's third argument to fail rather than wait in a capacity queue.
- Output is capped at the engine's requested token limit (currently 200 tokens).
- The deterministic safety detector, verified-knowledge grounding, lead persistence, and response guard remain in place.
- Provider failures return a safe degraded reply; they do not cause the engine to invent a result.
- Model calls receive the system grounding and recent customer messages. Do not send real customer data until the applicable Cloudflare data-processing, retention, and privacy terms are reviewed and disclosed.
- No provider quality, Spanish conversation quality, cost per real conversation, or latency has been benchmarked yet.

## Required evaluation before customer use

Run synthetic test cases covering Spanish and English, multi-turn correction, off-topic plus plumbing mixed intent, prompt injection, unsupported price/schedule/coverage questions, emergencies, hallucination pressure, provider capacity errors, and malformed outputs. Have a native Spanish speaker and a licensed plumbing professional review the relevant flows. Record latency, token/Neuron usage, response-guard catches, fallback rates, and estimated costs.

**No inference is active just because the binding exists. No Cloudflare login, paid plan, or deployment has been performed.**
