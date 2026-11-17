// Typed errors for the AI provider layer.
//
// code is one of:
//   timeout | rate_limit | unavailable | invalid_response | invalid_request |
//   auth | disabled | circuit_open | unknown
// `retryable` tells the router whether trying the SAME provider again could help.

export class ProviderError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Turn anything thrown by a provider into a ProviderError. */
export function normalizeError(e) {
  if (e instanceof ProviderError) return e;
  return new ProviderError("unknown", e?.message ? String(e.message) : "unexpected provider error", { retryable: false, cause: e });
}
