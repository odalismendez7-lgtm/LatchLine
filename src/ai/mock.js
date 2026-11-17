// Mock provider: free, offline, deterministic. The default during development.
// It is NOT an AI model and must never be presented to customers as one.
// `handler(request)` may return a string or throw, to simulate any behavior.

import { ProviderError } from "./errors.js";
import { validateRequest, estimateTokens } from "./provider.js";

export class MockProvider {
  constructor({ id = "mock", modelId = "mock-1", latencyMs = 0, handler, pricing = null } = {}) {
    this.id = id;
    this.modelId = modelId;
    this.latencyMs = latencyMs;
    this.pricing = pricing; // { inputPerMTokUsd, outputPerMTokUsd } or null; never guessed
    this.handler = handler ?? (() => "[mock reply] A team member will review your request. This is a development stand-in, not a real AI.");
  }

  async generate(request) {
    validateRequest(request);
    const started = Date.now();
    if (this.latencyMs > 0) await delay(this.latencyMs, request.signal);
    else if (request.signal?.aborted) throw new ProviderError("timeout", "aborted", { retryable: true });
    const text = this.handler(request);
    const inputText = request.system + request.messages.map((m) => m.content).join("");
    return {
      text,
      usage: { inputTokens: estimateTokens(inputText), outputTokens: typeof text === "string" ? estimateTokens(text) : 0 },
      latencyMs: Date.now() - started,
      providerId: this.id,
      modelId: this.modelId,
      mock: true,
    };
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new ProviderError("timeout", "aborted", { retryable: true })); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}
