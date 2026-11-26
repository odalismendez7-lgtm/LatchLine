import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NotifyError, normalizeNotifyError, validateSendRequest, validateSendResult } from "../src/notify/provider.js";
import { MockNotifier } from "../src/notify/mock.js";
import { ResendEmailProvider } from "../src/notify/resend.js";
import { createNotifier, createChannelMap } from "../src/notify/registry.js";
import { renderNotification } from "../src/notify/render.js";

const req = (o = {}) => ({ channel: "email", to: "o@acme.example", subject: "Hi", text: "Body", idempotencyKey: "key-12345678", priority: "normal", ...o });

describe("request/result validation", () => {
  test("accepts a good request", () => assert.ok(validateSendRequest(req())));
  test("rejects malformed requests", () => {
    for (const bad of [null, 5, req({ channel: "fax" }), req({ to: "x" }), req({ to: "a@b.co\r\nBcc: z@y.co" }), req({ to: "a@b.co,c@d.co" }), req({ text: "  " }), req({ text: "x".repeat(2001) }), req({ subject: "a\nb" }), req({ subject: "" }), req({ idempotencyKey: "short" }), req({ channel: "sms", to: "+15125550100", subject: undefined, text: "" })])
      assert.throws(() => validateSendRequest(bad), (e) => e.code === "invalid_request", JSON.stringify(bad)?.slice(0, 50));
  });
  test("sms needs no subject", () => assert.ok(validateSendRequest(req({ channel: "sms", to: "+15125550100", subject: undefined }))));
  test("malformed provider results are rejected as retryable invalid_response", () => {
    for (const bad of [null, {}, { providerId: "x" }, { providerId: "x", providerMessageId: "", simulated: true }, { providerId: "x", providerMessageId: "m", simulated: "yes" }])
      assert.throws(() => validateSendResult(bad), (e) => e.code === "invalid_response" && e.retryable === true);
    assert.ok(validateSendResult({ providerId: "x", providerMessageId: "m", simulated: false }));
  });
  test("unknown thrown values become safe retryable errors with no leaked message", () => {
    const e = normalizeNotifyError(new Error("API key sk-SECRET rejected for jane@example.com"));
    assert.equal(e.code, "unknown_error");
    assert.ok(!e.message.includes("SECRET") && !e.message.includes("jane"));
    assert.equal(normalizeNotifyError(Object.assign(new Error("x"), { name: "AbortError" })).code, "timeout");
    const own = new NotifyError("invalid_recipient", "no", { retryable: false });
    assert.equal(normalizeNotifyError(own), own);
  });
});

describe("mock notifier", () => {
  test("is labeled simulated and records the message instead of sending", async () => {
    const m = new MockNotifier();
    const r = await m.send(req());
    assert.equal(r.simulated, true);
    assert.equal(m.simulated, true);
    assert.equal(m.outbox.length, 1);
    assert.equal(m.outbox[0].to, "o@acme.example");
  });
  test("a repeated idempotency key does not create a second message", async () => {
    const m = new MockNotifier();
    const a = await m.send(req()); const b = await m.send(req());
    assert.equal(a.providerMessageId, b.providerMessageId);
    assert.equal(b.deduplicated, true);
    assert.equal(m.outbox.length, 1);
    await m.send(req({ idempotencyKey: "other-key-1234" }));
    assert.equal(m.outbox.length, 2);
  });
  test("send success is not delivery: status stays pending until a receipt is confirmed", async () => {
    const m = new MockNotifier();
    const { providerMessageId } = await m.send(req());
    assert.equal((await m.getDeliveryStatus(providerMessageId)).status, "pending");
    m.confirm(providerMessageId, "delivered");
    assert.equal((await m.getDeliveryStatus(providerMessageId)).status, "delivered");
    m.confirm(providerMessageId, "failed", "mailbox_full");
    assert.deepEqual(await m.getDeliveryStatus(providerMessageId), { status: "failed", code: "mailbox_full" });
  });
  test("failure injection works and failed sends leave nothing in the outbox", async () => {
    const m = new MockNotifier({ behavior: () => { throw new NotifyError("provider_unavailable", "down", { retryable: true }); } });
    await assert.rejects(m.send(req()), (e) => e.code === "provider_unavailable");
    assert.equal(m.outbox.length, 0);
    assert.equal(m.calls, 1);
  });
  test("invalid requests are refused before the behavior hook runs", async () => {
    let ran = false;
    const m = new MockNotifier({ behavior: () => { ran = true; } });
    await assert.rejects(m.send(req({ to: "bad" })), (e) => e.code === "invalid_request");
    assert.equal(ran, false);
  });
  test("unknown message ids are errors", async () => {
    const m = new MockNotifier();
    await assert.rejects(m.getDeliveryStatus("nope"));
    assert.throws(() => m.confirm("nope"));
  });
});

describe("registry", () => {
  test("creates the mock", () => assert.ok(createNotifier({ type: "mock" }) instanceof MockNotifier));
  test("creates Resend only with explicit configuration; other real providers remain disabled", () => {
    assert.ok(createNotifier({ type: "resend-email", apiKey: "test-key", from: "alerts@example.com" }) instanceof ResendEmailProvider);
    for (const type of ["sendgrid", "twilio", "ses", "resend", "email", "sms", "", undefined, null])
      assert.throws(() => createNotifier({ type }), (e) => e.code === "disabled", String(type));
    assert.throws(() => createNotifier(undefined), (e) => e.code === "disabled");
  });
  test("channel map routes each channel to a provider", () => {
    const a = new MockNotifier(); a.id = "a"; a.channels = ["email"];
    const b = new MockNotifier(); b.id = "b"; b.channels = ["sms"];
    const map = createChannelMap([a, b]);
    assert.equal(map.email.id, "a"); assert.equal(map.sms.id, "b");
    assert.ok(Object.isFrozen(map));
  });
});

describe("rendering", () => {
  const lead = { name: "Jane Doe", phone: "+15125550142", zip: "62701", issue_text: "kitchen sink leaking", emergency_categories: [] };
  const biz = { name: "Acme Plumbing" };
  test("new lead email has a one-line subject and contact details", () => {
    const m = renderNotification({ kind: "new_lead", priority: "normal", channel: "email", business: biz, lead });
    assert.match(m.subject, /^New inquiry - Acme Plumbing$/);
    assert.match(m.text, /Jane Doe, \+15125550142, ZIP 62701/);
    assert.match(m.text, /not a confirmation of any visit or price/);
  });
  test("emergency text says LATCHLINE cannot dispatch and never claims help was sent", () => {
    const m = renderNotification({ kind: "new_lead", priority: "emergency", channel: "email", business: biz, lead: { ...lead, emergency_categories: ["gas_leak"] } });
    assert.match(m.subject, /EMERGENCY.*gas smell/);
    assert.match(m.text, /cannot dispatch/);
    assert.doesNotMatch(m.text, /dispatched|on the way|help is coming|we (have )?(sent|called)/i);
  });
  test("urgent, handoff, and repeat variants", () => {
    assert.match(renderNotification({ kind: "new_lead", priority: "urgent", channel: "email", business: biz, lead }).subject, /^URGENT new inquiry/);
    assert.match(renderNotification({ kind: "human_requested", priority: "normal", channel: "email", business: biz, lead }).subject, /asked to speak with a person/);
    assert.match(renderNotification({ kind: "repeat_contact", priority: "normal", channel: "email", business: biz, lead }).subject, /Repeat inquiry/);
  });
  test("sms is short, has no subject, and starts with the priority", () => {
    const m = renderNotification({ kind: "new_lead", priority: "emergency", channel: "sms", business: biz, lead: { ...lead, issue_text: "x".repeat(500) } });
    assert.equal(m.subject, undefined);
    assert.ok(m.text.length <= 320);
    assert.match(m.text, /^EMERGENCY/);
  });
  test("customer text cannot inject headers or extra lines into the subject or sms", () => {
    const evil = { ...lead, name: "Jane\r\nBcc: attacker@evil.example", issue_text: "line1\nline2 line3" };
    const e = renderNotification({ kind: "new_lead", priority: "normal", channel: "email", business: { name: "Acme\r\nX: y" }, lead: evil });
    assert.doesNotMatch(e.subject, /[\r\n]/);
    assert.doesNotMatch(e.text.split("\n\n")[0], /[\r\n]/);
    const s = renderNotification({ kind: "new_lead", priority: "normal", channel: "sms", business: biz, lead: evil });
    assert.ok(!/[\r\n]/.test(s.text) && !s.text.includes(String.fromCharCode(0x2028)));
  });
  test("missing fields render as placeholders, never 'undefined' or 'null'", () => {
    const m = renderNotification({ kind: "new_lead", priority: "normal", channel: "email", business: null, lead: {} });
    assert.doesNotMatch(m.text + m.subject, /undefined|null/);
  });
  test("control characters are stripped from every field", () => {
    const evil = { name: "Ja" + String.fromCharCode(0, 7, 0x9f) + "ne", phone: "+15125550142", zip: "62701", issue_text: "a" + String.fromCharCode(0x1b) + "b", emergency_categories: [] };
    const m = renderNotification({ kind: "new_lead", priority: "normal", channel: "email", business: { name: "Ac" + String.fromCharCode(0) + "me" }, lead: evil });
    for (const ch of [0, 7, 0x1b, 0x9f]) assert.ok(!(m.subject + m.text).includes(String.fromCharCode(ch)), String(ch));
    assert.match(m.text, /Ja ne/);
  });
});


describe("Resend email adapter (HTTP mocked)", () => {
  test("sends plain-text email with the stable idempotency key and never logs the secret", async () => {
    let captured;
    const provider = new ResendEmailProvider({
      apiKey: "re_test_secret",
      from: "LATCHLINE <alerts@example.com>",
      fetchImpl: async (url, init) => {
        captured = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ id: "email_123" }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    const result = await provider.send(req());
    assert.equal(captured.url, "https://api.resend.com/emails");
    assert.equal(captured.init.headers.Authorization, "Bearer re_test_secret");
    assert.equal(captured.init.headers["Idempotency-Key"], "key-12345678");
    assert.deepEqual(captured.body, { from: "LATCHLINE <alerts@example.com>", to: ["o@acme.example"], subject: "Hi", text: "Body" });
    assert.deepEqual(result, { providerId: "resend", providerMessageId: "email_123", simulated: false });
    assert.equal(provider.channels.includes("email"), true);
    assert.equal(provider.channels.includes("sms"), false);
  });

  test("rejects missing API key or sender and refuses SMS", async () => {
    assert.throws(() => new ResendEmailProvider({ from: "alerts@example.com" }), (e) => e.code === "disabled");
    assert.throws(() => new ResendEmailProvider({ apiKey: "x", from: "bad\\nFrom" }), (e) => e.code === "disabled");
    const provider = new ResendEmailProvider({ apiKey: "x", from: "alerts@example.com", fetchImpl: async () => { throw new Error("must not run"); } });
    await assert.rejects(() => provider.send(req({ channel: "sms", to: "+15125550100", subject: undefined })), (e) => e.code === "invalid_request");
  });

  test("maps Resend email events to honest delivery states", async () => {
    for (const [event, expected] of [["sent", "pending"], ["delivery_delayed", "pending"], ["queued", "pending"], ["delivered", "delivered"], ["opened", "delivered"], ["clicked", "delivered"], ["bounced", "failed"], ["suppressed", "failed"], ["failed", "failed"]]) {
      let url;
      const provider = new ResendEmailProvider({ apiKey: "x", from: "alerts@example.com", fetchImpl: async (u, init) => {
        url = u; assert.equal(init.method, "GET");
        return new Response(JSON.stringify({ id: "email_123", last_event: event }), { status: 200 });
      } });
      const result = await provider.getDeliveryStatus("email_123");
      assert.equal(url, "https://api.resend.com/emails/email_123");
      assert.equal(result.status, expected, event);
      if (expected === "failed") assert.equal(result.code, event);
    }
  });

  test("does not treat unknown status as delivered and validates provider message IDs", async () => {
    const provider = new ResendEmailProvider({ apiKey: "x", from: "alerts@example.com", fetchImpl: async () =>
      new Response(JSON.stringify({ last_event: "unknown_future_state" }), { status: 200 }) });
    assert.deepEqual(await provider.getDeliveryStatus("email_123"), { status: "pending" });
    await assert.rejects(() => provider.getDeliveryStatus("../other"), (e) => e.code === "invalid_request");
  });

  test("maps authentication, sender verification, validation, rate limit and server errors safely", async () => {
    for (const [status, code, retryable] of [[401, "provider_auth", false], [403, "provider_auth", false], [422, "invalid_request", false], [429, "rate_limited", true], [503, "provider_unavailable", true]]) {
      const provider = new ResendEmailProvider({ apiKey: "x", from: "alerts@example.com", fetchImpl: async () => new Response("private provider detail", { status }) });
      await assert.rejects(() => provider.send(req()), (e) => e.code === code && e.retryable === retryable && !e.message.includes("private"));
    }
  });

  test("requires a valid provider message ID and bounds idempotency keys", async () => {
    const empty = new ResendEmailProvider({ apiKey: "x", from: "alerts@example.com", fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }) });
    await assert.rejects(() => empty.send(req()), (e) => e.code === "invalid_response");
    const longKey = new ResendEmailProvider({ apiKey: "x", from: "alerts@example.com", fetchImpl: async () => { throw new Error("must not run"); } });
    await assert.rejects(() => longKey.send(req({ idempotencyKey: "x".repeat(257) })), (e) => e.code === "invalid_request");
  });
});
