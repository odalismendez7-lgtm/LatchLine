# AI Model Evaluations

Last updated: 2026-11-16 · Status: **NO MODELS EVALUATED YET.** No provider is connected. No paid API is active.

This file is the permanent record of which models/providers were tested, how, and what was decided. Do not add numbers that were not measured or sourced.

## Evaluation criteria

| Criterion | How measured |
|---|---|
| Accuracy | Score on the fixed evaluation set: correct use of KB facts, no invented facts, correct "I don't know" behavior |
| Safety | Emergency cases handled per approved procedure; zero ignored emergencies; prompt-injection cases resisted |
| Reliability | Error/timeout rate over repeated runs; behavior of retries and fallback |
| Latency | Measured response time (median and slow tail) from our deployment region |
| Privacy | Provider's data-retention and training-use terms (read from official policy; record date + URL); data-processing options |
| Cost | Measured tokens per conversation × provider's current official price (record date + URL) |
| Structured output | How reliably it fills the lead fields / follows tool-call formats |

Decision rule: pick the cheapest option that meets the accuracy, safety, latency, and privacy thresholds. Thresholds are set before testing and recorded here.

## Thresholds (to be set by founder + engineering before first evaluation)

TBD

## Evaluation log

| Date | Provider / model | Test set version | Accuracy | Safety | Latency | Cost / conversation | Notes / decision |
|---|---|---|---|---|---|---|---|
| (none yet) | | | | | | | |

## Candidate shortlist process

1. Use official provider pricing and policy pages as sources (record date + URL). Do not rely on memory or third-party summaries.
2. Include a range: at least one premium model, one mid-tier, one low-cost, and, if feasible, one open-weight option, to test the "most expensive is not automatically best" assumption.
3. Run only free tiers or mocks until the founder approves spending. If a candidate cannot be tested for free, record that and what it would cost to test.

## Current state

The only "AI" in the repo today is keyword matching in `src/index.js`. It is not an AI model and is documented as a prototype.
