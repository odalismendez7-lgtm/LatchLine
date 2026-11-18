// The one interface LATCHLINE uses to send a notification, whatever the vendor.
//
//   provider.id           string
//   provider.channels     ["email"] | ["sms"] | ["email","sms"]
//   provider.simulated    true for the mock (nothing real is ever sent)
//   provider.send({ channel, to, subject?, text, idempotencyKey, priority })
//        -> { providerId, providerMessageId, simulated }      "accepted", NOT delivered
//        or throws NotifyError(code, message, { retryable })
//   provider.getDeliveryStatus?(providerMessageId)            optional
//        -> { status: "delivered" | "pending" | "failed", code? }
//
// A real email or SMS vendor is added by writing one adapter that implements
// this and registering it in registry.js after founder approval. Nothing else
// (outbox, retries, priorities, wording of statuses) changes.
//
// Delivery is confirmed ONLY by getDeliveryStatus() (or a future webhook that
// calls the same repository method). A successful send() means "accepted".

export class NotifyError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message ?? code);
    this.name = "NotifyError";
    this.code = code;
    this.retryable = retryable;
  }
}

const RETRYABLE = new Set(["provider_unavailable", "rate_limited", "timeout", "invalid_response", "unknown_error"]);

/** Any thrown value becomes a NotifyError with a safe, short code. */
export function normalizeNotifyError(e) {
  if (e instanceof NotifyError) return e;
  const name = e?.name === "AbortError" ? "timeout" : "unknown_error";
  return new NotifyError(name, "provider call failed", { retryable: RETRYABLE.has(name) });
}

export function validateSendRequest(req) {
  const bad = (m) => new NotifyError("invalid_request", m);
  if (!req || typeof req !== "object") throw bad("request must be an object");
  if (req.channel !== "email" && req.channel !== "sms") throw bad("channel must be email or sms");
  if (typeof req.to !== "string" || req.to.length < 5 || req.to.length > 254 || /[\r\n,;]/.test(req.to)) throw bad("invalid recipient");
  if (typeof req.text !== "string" || req.text.trim() === "" || req.text.length > 2000) throw bad("text must be 1-2000 characters");
  if (req.channel === "email" && (typeof req.subject !== "string" || req.subject.trim() === "" || req.subject.length > 200 || /[\r\n]/.test(req.subject))) throw bad("email needs a single-line subject");
  if (typeof req.idempotencyKey !== "string" || req.idempotencyKey.length < 8) throw bad("idempotencyKey required");
  return req;
}

export function validateSendResult(r) {
  const ok = r && typeof r.providerId === "string" && r.providerId && typeof r.providerMessageId === "string" && r.providerMessageId && typeof r.simulated === "boolean";
  if (!ok) throw new NotifyError("invalid_response", "provider returned a malformed result", { retryable: true });
  return r;
}
