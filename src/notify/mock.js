// Mock notifier: free, offline, deterministic. NOTHING REAL IS EVER SENT.
// The default during development. Records what it was asked to send so tests
// can inspect it, supports failure injection, and mimics how real providers
// treat idempotency keys (a repeated key does not create a second message).

import { NotifyError, validateSendRequest } from "./provider.js";

export class MockNotifier {
  id = "mock";
  channels = ["email", "sms"];
  simulated = true;
  outbox = [];                 // messages "sent" (simulated)
  #byKey = new Map();
  #status = new Map();         // messageId -> { status, code }
  #n = 0;
  #behavior;
  calls = 0;

  /** behavior(request, callNumber) may throw a NotifyError (or anything) to simulate failures. */
  constructor({ behavior, supportsDeliveryStatus = true } = {}) {
    this.#behavior = behavior;
    if (!supportsDeliveryStatus) this.getDeliveryStatus = undefined;
  }

  async send(req) {
    this.calls += 1;
    validateSendRequest(req);
    if (this.#behavior) await this.#behavior(req, this.calls);
    const existing = this.#byKey.get(req.idempotencyKey);
    if (existing) return { providerId: this.id, providerMessageId: existing, simulated: true, deduplicated: true };
    const id = `mock_msg_${++this.#n}`;
    this.#byKey.set(req.idempotencyKey, id);
    this.#status.set(id, { status: "pending" });
    this.#cap();
    this.outbox.push({ id, channel: req.channel, to: req.to, subject: req.subject, text: req.text, priority: req.priority, idempotencyKey: req.idempotencyKey });
    return { providerId: this.id, providerMessageId: id, simulated: true };
  }

  // Bound memory in long-lived processes (the Worker isolate, the dev server).
  #cap() {
    while (this.outbox.length >= 500) this.outbox.shift();
    while (this.#byKey.size >= 2000) { const k = this.#byKey.keys().next().value; this.#status.delete(this.#byKey.get(k)); this.#byKey.delete(k); }
  }

  /** Simulates the provider's delivery receipt (what a webhook or status API would report). */
  confirm(providerMessageId, outcome = "delivered", code) {
    if (!this.#status.has(providerMessageId)) throw new NotifyError("invalid_request", "unknown message");
    this.#status.set(providerMessageId, { status: outcome, code });
  }

  async getDeliveryStatus(providerMessageId) {
    const s = this.#status.get(providerMessageId);
    if (!s) throw new NotifyError("invalid_request", "unknown message");
    return { ...s };
  }
}
