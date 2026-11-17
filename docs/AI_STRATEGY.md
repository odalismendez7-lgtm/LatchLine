# AI Strategy

Last updated: 2026-11-16 · Status: DESIGN (nothing below is implemented yet; see `FEATURE_STATUS.md`)

The AI must be a major strength: purpose-built for plumbing customer operations, not a generic chatbot.

## Design principle: the model talks, deterministic code guards

A language model is good at natural conversation and poor at guaranteeing facts. So LATCHLINE splits responsibilities:

| Responsibility | Done by | Why |
|---|---|---|
| Emergency detection and the safety message | Deterministic safety layer (rules, later strengthened), **running before and independent of the model**; the safety text comes from the business's approved procedure, not model improvisation | An outage or a bad model answer must never delay or alter safety guidance |
| Natural conversation, clarifying questions | AI model | Flexibility |
| Business facts (hours, prices, services, area, policies) | Retrieved from the business's knowledge base; model may only state facts that were retrieved | No invented facts |
| Remembering what's been collected | Structured conversation state (slots: name, phone, ZIP, issue, urgency, preferred contact, ...) | No re-asking; reliable lead data |
| Claiming an action happened (lead saved, human notified) | **Only the system**, from the actual result of the action; the model cannot assert success | No fake confirmations |
| Handoff decision | Rules + model signal (see below) | Predictable escalation |

## Components (planned)

1. **Safety layer.** Broad, tested emergency patterns (gas, CO, electrical-near-water, flooding, sewage backup, no water/heat in extreme conditions as configured by the business). Returns the approved procedure and flags the conversation. Designed to err toward flagging, with false-positive tests so everyday words don't cause alarm.
2. **Knowledge base (per business).** Typed facts (hours, service area ZIPs, services, pricing policy, emergency procedure, contact info) plus FAQ entries. Each fact has a `verified` flag, who verified it, and when. Unverified or missing = "unknown".
3. **Retrieval.** Start simple (structured lookup + keyword/FAQ match; business KBs are small). Add semantic search only if tests show it is needed.
4. **Conversation state.** Per-session, per-business. Never shared across sessions or businesses.
5. **Response guard.** After generation, check the reply: any price, hour, time promise, or service-area claim not backed by retrieved facts is blocked and replaced with the "needs confirmation" answer + offer of human help. Any success claim not backed by a system result is blocked.
6. **Lead summarizer.** Produces a structured summary (who, contact, location ZIP, issue, urgency, what the customer asked, what was and wasn't answered, flags). Built from conversation state first, model-written prose second.
7. **Handoff policy.** Hand off when: customer asks for a human; emergency flagged; the AI is uncertain after clarifying; complaint or approval needed; repeated misunderstanding; AI provider unavailable. Handoff is only reported as successful after delivery is confirmed.
8. **Prompt-injection resistance.** Customer text is data, never instructions. Tested (see `TEST_CASES.md`).

## Provider-agnostic architecture

All model access goes through one interface so the model can be changed without rebuilding LATCHLINE:

```
AIProvider.generate({ system, messages, tools?, maxTokens, timeoutMs })
  -> { text, toolCalls?, usage: { inputTokens, outputTokens }, latencyMs, providerId, modelId }
  or throws a typed ProviderError (timeout | rate_limit | unavailable | invalid_response)
```

- Providers are configured per environment (and later optionally per plan or per business).
- A **mock provider** is the default. It makes development and tests free and deterministic. It is clearly labeled and is never presented to customers as real AI.
- A **router** supports an ordered fallback list and a circuit breaker. If all providers fail, the system enters honest degraded mode (see `RELIABILITY.md`).
- Every call records provider, model, latency, token usage, and cost estimate, which feeds both cost research and analytics.
- Real providers stay switched off until the founder approves any cost.

## Model selection

Models are chosen by measured results on our own test set, not by price or reputation. Criteria and the evaluation record are in `AI_MODEL_EVALUATIONS.md`. A more expensive model is adopted only if it measurably wins on accuracy/safety for its cost.

## Quality measurement

A fixed evaluation set (`TEST_CASES.md`): normal conversations, missing/incorrect information, emergencies, injection attempts, handoff triggers, repeated-question avoidance. Each provider/model is scored on the same set; results are recorded with dates.
