// OpenAI Responses API adapter. Opt-in only: configured by the operator with an API key
// and explicit model name. No customer content is logged by this adapter.
import { ProviderError } from "./errors.js";
import { validateRequest, validateResult, estimateTokens } from "./provider.js";

const ENDPOINT = "https://api.openai.com/v1/responses";

function extractText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === "output_text" && typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function safeError(status) {
  if (status === 401 || status === 403) return new ProviderError("auth", "AI provider authentication failed.");
  if (status === 429) return new ProviderError("rate_limit", "AI provider rate limit reached.", { retryable: true });
  if (status >= 500) return new ProviderError("unavailable", "AI provider is temporarily unavailable.", { retryable: true });
  return new ProviderError("provider_error", "AI provider rejected the request.");
}

export class OpenAIProvider {
  constructor({ apiKey, model, fetchImpl = globalThis.fetch, endpoint = ENDPOINT, id = "openai", maxOutputTokens = 700 } = {}) {
    if (typeof apiKey !== "string" || !apiKey.trim()) throw new ProviderError("disabled", "OpenAI requires an API key supplied through server-side configuration.");
    if (typeof model !== "string" || !model.trim()) throw new ProviderError("disabled", "OpenAI requires an explicitly configured model name.");
    if (typeof fetchImpl !== "function") throw new ProviderError("disabled", "A fetch implementation is required.");
    this.id = id; this.modelId = model; this.#key = apiKey; this.#fetch = fetchImpl; this.#endpoint = endpoint;
    this.#maxOutputTokens = maxOutputTokens;
  }
  #key; #fetch; #endpoint; #maxOutputTokens;

  async generate(request) {
    validateRequest(request);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (request.signal?.aborted) abort();
    else request.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, Math.min(request.timeoutMs ?? 8000, 30000));
    const started = Date.now();
    try {
      let response;
      try {
        response = await this.#fetch(this.#endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.#key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.modelId,
            instructions: request.system,
            input: request.messages.map((m) => ({ role: m.role, content: [{ type: "input_text", text: m.content }] })),
            max_output_tokens: Math.min(request.maxTokens ?? this.#maxOutputTokens, this.#maxOutputTokens),
            store: false,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new ProviderError("timeout", "AI provider request timed out.", { retryable: true });
        throw new ProviderError("unavailable", "AI provider could not be reached.", { retryable: true });
      }
      if (!response.ok) throw safeError(response.status);
      let payload;
      try { payload = await response.json(); } catch { throw new ProviderError("invalid_response", "AI provider returned an unreadable response."); }
      const text = extractText(payload);
      const usage = {
        inputTokens: Number.isFinite(payload?.usage?.input_tokens) ? payload.usage.input_tokens : estimateTokens(request.system + request.messages.map((m) => m.content).join("\n")),
        outputTokens: Number.isFinite(payload?.usage?.output_tokens) ? payload.usage.output_tokens : estimateTokens(text),
      };
      const result = validateResult({ text, usage, latencyMs: Date.now() - started, providerId: this.id, modelId: this.modelId, mock: false });
      return result;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
    }
  }
}
