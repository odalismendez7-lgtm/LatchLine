// OpenAI Responses API adapter. The API key is supplied only by the server runtime secret.
// Customer text is sent only when this provider is explicitly selected by deployment config.
// Responses are not stored by default (store:false); no tools or external retrieval are enabled.
import { ProviderError } from "./errors.js";
import { validateRequest } from "./provider.js";

function errorForStatus(status) {
  if (status === 401 || status === 403) return new ProviderError("authentication", "AI provider authentication failed");
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return new ProviderError(status === 429 ? "rate_limit" : "unavailable", "AI provider is temporarily unavailable", { retryable: true });
  }
  return new ProviderError("provider_rejected", "AI provider rejected the request");
}

export class OpenAIResponsesProvider {
  constructor({ apiKey, model, fetchImpl = globalThis.fetch, baseUrl = "https://api.openai.com/v1", id = "openai-responses" } = {}) {
    if (typeof apiKey !== "string" || !apiKey.trim()) throw new ProviderError("configuration", "OpenAI API key is missing");
    if (typeof model !== "string" || !model.trim()) throw new ProviderError("configuration", "OpenAI model must be configured explicitly");
    if (typeof fetchImpl !== "function") throw new ProviderError("configuration", "Fetch is unavailable in this runtime");
    this.id = id;
    this.modelId = model;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.endpoint = `${String(baseUrl).replace(/\/+$/, "")}/responses`;
  }

  async generate(request) {
    validateRequest(request);
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          model: this.modelId,
          instructions: request.system,
          input: request.messages.map((m) => ({ role: m.role, content: m.content })),
          max_output_tokens: Math.max(16, request.maxTokens ?? 256),
          store: false,
        }),
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new ProviderError("timeout", "AI provider request timed out", { retryable: true });
      throw new ProviderError("network", "AI provider could not be reached", { retryable: true });
    }
    if (!response.ok) throw errorForStatus(response.status);
    let data;
    try { data = await response.json(); }
    catch { throw new ProviderError("invalid_response", "AI provider returned invalid JSON"); }
    if (data?.status && data.status !== "completed") {
      throw new ProviderError("incomplete_response", "AI provider did not complete the response", { retryable: true });
    }
    const text = Array.isArray(data?.output)
      ? data.output.flatMap((item) => item?.type === "message" && Array.isArray(item.content) ? item.content : [])
          .filter((part) => part?.type === "output_text" && typeof part.text === "string")
          .map((part) => part.text).join("\n").trim()
      : "";
    if (!text) throw new ProviderError("invalid_response", "AI provider returned no text");
    const usage = data?.usage ?? {};
    return {
      text,
      usage: {
        inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
        outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
      },
      latencyMs: 0,
      providerId: this.id,
      modelId: this.modelId,
      mock: false,
    };
  }
}
