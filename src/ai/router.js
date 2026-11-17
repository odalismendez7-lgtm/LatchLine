// AI router: ordered fallback, bounded retries with backoff, per-provider
// circuit breaker, timeouts, and call recording.
//
// generate() NEVER throws and never returns text unless a provider returned a
// valid reply. On total failure it returns { ok:false, degraded:true, ... } so
// the caller must handle the outage honestly (see docs/RELIABILITY.md).
// Call records contain no customer text and no system prompt.

import { ProviderError, normalizeError } from "./errors.js";
import { validateRequest, validateResult } from "./provider.js";

const DEFAULT_TIMEOUT_MS = 8000;

export class AIRouter {
  #providers;
  #state = new Map();
  #retries;
  #baseBackoffMs;
  #sleep;
  #now;
  #onCall;
  #threshold;
  #cooldownMs;

  constructor({ providers = [], retries = 1, baseBackoffMs = 200, sleep, now, onCall, breaker = {} } = {}) {
    this.#providers = providers;
    this.#retries = retries;
    this.#baseBackoffMs = baseBackoffMs;
    this.#sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = now ?? Date.now;
    this.#onCall = onCall;
    this.#threshold = breaker.failureThreshold ?? 5;
    this.#cooldownMs = breaker.cooldownMs ?? 30000;
    for (const p of providers) this.#state.set(p.id, { failures: 0, openedAt: null, trial: false });
  }

  status() {
    const out = {};
    for (const [id, s] of this.#state) {
      out[id] = { state: s.openedAt === null ? "closed" : "open", consecutiveFailures: s.failures };
    }
    return out;
  }

  async generate(request) {
    try {
      validateRequest(request);
    } catch (e) {
      return { ok: false, degraded: false, code: "invalid_request", errors: [{ providerId: null, code: "invalid_request", message: e.message }] };
    }
    if (this.#providers.length === 0) {
      return { ok: false, degraded: true, code: "no_providers_configured", errors: [] };
    }

    const errors = [];
    for (const provider of this.#providers) {
      const st = this.#state.get(provider.id);
      if (st.openedAt !== null && this.#now() - st.openedAt < this.#cooldownMs) {
        errors.push({ providerId: provider.id, code: "circuit_open", message: "provider temporarily skipped after repeated failures" });
        continue;
      }
      // Breaker closed, or cooldown elapsed: allow a call. The failure count is not
      // reset while open, so one failed trial re-opens the breaker immediately.

      for (let attempt = 0; attempt <= this.#retries; attempt++) {
        let result;
        try {
          result = await this.#callOnce(provider, request);
        } catch (raw) {
          const err = normalizeError(raw);
          errors.push({ providerId: provider.id, code: err.code, message: err.message });
          this.#recordFailure(st);
          if (err.retryable && attempt < this.#retries && st.openedAt === null) {
            await this.#sleep(this.#baseBackoffMs * 2 ** attempt);
            continue;
          }
          break;
        }
        st.failures = 0;
        st.openedAt = null;
        return { ok: true, ...result, attempts: errors.length + 1 };
      }
    }
    return { ok: false, degraded: true, code: "all_providers_failed", errors };
  }

  #recordFailure(st) {
    st.failures += 1;
    if (st.failures >= this.#threshold) st.openedAt = this.#now();
  }

  async #callOnce(provider, request) {
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ac = new AbortController();
    const started = Date.now();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new ProviderError("timeout", `provider exceeded ${timeoutMs} ms`, { retryable: true }));
      }, timeoutMs);
    });
    try {
      const result = validateResult(await Promise.race([provider.generate({ ...request, signal: ac.signal }), timeout]));
      this.#record(provider, { ok: true, latencyMs: Date.now() - started, usage: result.usage });
      return result;
    } catch (raw) {
      const err = normalizeError(raw);
      this.#record(provider, { ok: false, errorCode: err.code, latencyMs: Date.now() - started });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  #record(provider, { ok, errorCode, latencyMs, usage }) {
    if (!this.#onCall) return;
    const price = provider.pricing;
    const costEstimateUsd =
      ok && usage && price ? (usage.inputTokens * price.inputPerMTokUsd + usage.outputTokens * price.outputPerMTokUsd) / 1_000_000 : null;
    const record = { providerId: provider.id, modelId: provider.modelId, ok, latencyMs, costEstimateUsd };
    if (usage) record.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    if (errorCode) record.errorCode = errorCode;
    try {
      this.#onCall(record);
    } catch {
      // Logging must never break a customer request.
    }
  }
}
