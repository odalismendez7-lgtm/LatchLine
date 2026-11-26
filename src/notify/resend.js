// Resend transactional-email adapter. It sends only when explicitly enabled with server-side secrets.
import { NotifyError, validateSendRequest } from "./provider.js";

const ENDPOINT = "https://api.resend.com/emails";

function mapError(status) {
  if (status === 401 || status === 403) return new NotifyError("provider_auth", "Email provider authentication or sender-domain verification failed.");
  if (status === 400 || status === 422) return new NotifyError("invalid_request", "Email provider rejected the message.");
  if (status === 409) return new NotifyError("idempotency_conflict", "Email provider reported an idempotency conflict.");
  if (status === 429) return new NotifyError("rate_limited", "Email provider rate limit reached.", { retryable: true });
  if (status >= 500) return new NotifyError("provider_unavailable", "Email provider is temporarily unavailable.", { retryable: true });
  return new NotifyError("provider_error", "Email provider rejected the request.");
}

export class ResendEmailProvider {
  id = "resend";
  channels = ["email"];
  simulated = false;
  #key;
  #from;
  #fetch;
  #endpoint;

  constructor({ apiKey, from, fetchImpl = globalThis.fetch, endpoint = ENDPOINT } = {}) {
    if (typeof apiKey !== "string" || !apiKey.trim()) throw new NotifyError("disabled", "Resend requires a server-side API key.");
    if (typeof from !== "string" || !from.trim() || /[\\r\\n]/.test(from)) throw new NotifyError("disabled", "Resend requires a verified sender address.");
    if (typeof fetchImpl !== "function") throw new NotifyError("disabled", "A fetch implementation is required.");
    this.#key = apiKey;
    this.#from = from.trim();
    this.#fetch = fetchImpl;
    this.#endpoint = endpoint;
  }

  async getDeliveryStatus(providerMessageId) {
    if (typeof providerMessageId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(providerMessageId)) {
      throw new NotifyError("invalid_request", "Invalid provider message ID.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7500);
    try {
      let response;
      try {
        response = await this.#fetch(`${this.#endpoint}/${encodeURIComponent(providerMessageId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.#key}` },
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) throw new NotifyError("timeout", "Email status request timed out.", { retryable: true });
        throw new NotifyError("provider_unavailable", "Email provider could not be reached.", { retryable: true });
      }
      if (!response.ok) throw mapError(response.status);
      let payload;
      try { payload = await response.json(); } catch { throw new NotifyError("invalid_response", "Email provider returned an unreadable status.", { retryable: true }); }
      const event = payload?.last_event;
      if (event === "delivered" || event === "opened" || event === "clicked") return { status: "delivered" };
      if (event === "bounced" || event === "suppressed" || event === "failed") return { status: "failed", code: event };
      // Sent, queued, scheduled, and delivery_delayed are not delivery confirmation.
      return { status: "pending" };
    } finally {
      clearTimeout(timer);
    }
  }

  async send(request) {
    validateSendRequest(request);
    if (request.channel !== "email") throw new NotifyError("invalid_request", "Resend email provider cannot send SMS.");
    if (request.idempotencyKey.length > 256) throw new NotifyError("invalid_request", "Idempotency key is too long.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7500);
    try {
      let response;
      try {
        response = await this.#fetch(this.#endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": request.idempotencyKey,
          },
          body: JSON.stringify({ from: this.#from, to: [request.to], subject: request.subject, text: request.text }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) throw new NotifyError("timeout", "Email provider request timed out.", { retryable: true });
        throw new NotifyError("provider_unavailable", "Email provider could not be reached.", { retryable: true });
      }
      if (!response.ok) throw mapError(response.status);
      let payload;
      try { payload = await response.json(); } catch { throw new NotifyError("invalid_response", "Email provider returned an unreadable response.", { retryable: true }); }
      if (typeof payload?.id !== "string" || !payload.id) throw new NotifyError("invalid_response", "Email provider returned no message ID.", { retryable: true });
      return { providerId: this.id, providerMessageId: payload.id, simulated: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
