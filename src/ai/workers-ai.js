// Cloudflare Workers AI binding adapter. Uses the Worker-provided env.AI binding; no API key.
import { ProviderError } from "./errors.js";
import { validateRequest, validateResult, estimateTokens } from "./provider.js";

export const DEFAULT_WORKERS_AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";

function extractText(payload) {
  const value = payload?.choices?.[0]?.message?.content ?? payload?.response;
  return typeof value === "string" ? value.trim() : "";
}

export class WorkersAIProvider {
  constructor({ ai, model = DEFAULT_WORKERS_AI_MODEL, id = "cloudflare-workers-ai", maxOutputTokens = 200 } = {}) {
    if (!ai || typeof ai.run !== "function") throw new ProviderError("disabled", "Workers AI requires the Cloudflare AI binding.");
    if (typeof model !== "string" || !model.trim()) throw new ProviderError("disabled", "Workers AI requires an explicit model ID.");
    this.ai = ai;
    this.id = id;
    this.modelId = model;
    this.maxOutputTokens = maxOutputTokens;
  }

  async generate(request) {
    validateRequest(request);
    if (request.signal?.aborted) throw new ProviderError("timeout", "Workers AI request was cancelled.", { retryable: true });
    const started = Date.now();
    let payload;
    try {
      payload = await this.ai.run(this.modelId, {
        messages: [
          { role: "system", content: request.system },
          ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        max_completion_tokens: Math.min(request.maxTokens ?? this.maxOutputTokens, this.maxOutputTokens),
        stream: false,
        chat_template_kwargs: { enable_thinking: false },
      }, { rejectIfBusy: true });
    } catch {
      if (request.signal?.aborted) throw new ProviderError("timeout", "Workers AI request timed out.", { retryable: true });
      throw new ProviderError("unavailable", "Workers AI is temporarily unavailable or its daily allowance is exhausted.", { retryable: true });
    }
    const text = extractText(payload);
    if (!text) throw new ProviderError("invalid_response", "Workers AI returned no usable text.");
    const usage = {
      inputTokens: Number.isFinite(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens
        : Number.isFinite(payload?.usage?.input_tokens) ? payload.usage.input_tokens
          : estimateTokens(request.system + request.messages.map((m) => m.content).join("\n")),
      outputTokens: Number.isFinite(payload?.usage?.completion_tokens) ? payload.usage.completion_tokens
        : Number.isFinite(payload?.usage?.output_tokens) ? payload.usage.output_tokens : estimateTokens(text),
    };
    return validateResult({ text, usage, latencyMs: Date.now() - started, providerId: this.id, modelId: this.modelId, mock: false });
  }
}
