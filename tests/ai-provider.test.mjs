// AI provider interface, mock provider, and router tests.
// All providers here are mocks. No network calls, no cost.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../src/ai/errors.js";
import { MockProvider } from "../src/ai/mock.js";
import { createProvider } from "../src/ai/registry.js";
import { AIRouter } from "../src/ai/router.js";

const REQ = {
  system: "You are a plumbing assistant.",
  messages: [{ role: "user", content: "My sink PRIVATE-TEXT-123 drips" }],
  maxTokens: 200,
  timeoutMs: 500,
};

const noSleep = async () => {};

function fails(code, retryable = false) {
  return () => { throw new ProviderError(code, `mock ${code}`, { retryable }); };
}

describe("mock provider", () => {
  test("returns a well-formed, clearly labeled result", async () => {
    const p = new MockProvider({ id: "mock-a" });
    const r = await p.generate(REQ);
    assert.equal(typeof r.text, "string");
    assert.ok(r.text.length > 0);
    assert.equal(r.providerId, "mock-a");
    assert.equal(r.mock, true);
    assert.equal(typeof r.usage.inputTokens, "number");
    assert.equal(typeof r.usage.outputTokens, "number");
    assert.equal(typeof r.latencyMs, "number");
  });

  test("is deterministic for the same input", async () => {
    const p = new MockProvider({ id: "m" });
    assert.equal((await p.generate(REQ)).text, (await p.generate(REQ)).text);
  });

  test("rejects malformed requests with invalid_request", async () => {
    const p = new MockProvider({ id: "m" });
    for (const bad of [
      null, {}, { system: "x" }, { system: "x", messages: [] },
      { system: "x", messages: [{ role: "system", content: "no" }] },
      { system: "x", messages: [{ role: "user", content: 5 }] },
      { system: 5, messages: [{ role: "user", content: "hi" }] },
      { system: "x", messages: [{ role: "user", content: "hi" }], maxTokens: -1 },
    ]) {
      await assert.rejects(() => p.generate(bad), (e) => e instanceof ProviderError && e.code === "invalid_request");
    }
  });

  test("honors an abort signal", async () => {
    const p = new MockProvider({ id: "m", latencyMs: 300 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    await assert.rejects(() => p.generate({ ...REQ, signal: ac.signal }), (e) => e.code === "timeout");
  });
});

describe("registry: paid providers stay disabled", () => {
  test("mock can be created", () => {
    assert.ok(createProvider({ type: "mock", id: "m" }));
  });
  for (const type of ["anthropic", "openai", "google", "workers-ai"]) {
    test(`${type} is refused with a 'disabled' error`, () => {
      assert.throws(
        () => createProvider({ type, id: "x", apiKey: "not-a-real-key" }),
        (e) => e instanceof ProviderError && e.code === "disabled" && /approval/i.test(e.message)
      );
    });
  }
  test("unknown provider type is refused", () => {
    assert.throws(() => createProvider({ type: "nope" }), (e) => e.code === "disabled");
  });
});

describe("router: success and fallback", () => {
  test("uses the first healthy provider and records one call", async () => {
    const calls = [];
    const router = new AIRouter({ providers: [new MockProvider({ id: "a" }), new MockProvider({ id: "b" })], onCall: (c) => calls.push(c), sleep: noSleep });
    const r = await router.generate(REQ);
    assert.equal(r.ok, true);
    assert.equal(r.providerId, "a");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ok, true);
  });

  test("falls back to the next provider when the first is unavailable", async () => {
    const calls = [];
    const router = new AIRouter({
      providers: [new MockProvider({ id: "a", handler: fails("unavailable") }), new MockProvider({ id: "b" })],
      onCall: (c) => calls.push(c), sleep: noSleep,
    });
    const r = await router.generate(REQ);
    assert.equal(r.ok, true);
    assert.equal(r.providerId, "b");
    assert.deepEqual(calls.map((c) => [c.providerId, c.ok, c.errorCode]), [["a", false, "unavailable"], ["b", true, undefined]]);
  });

  test("retries a retryable error with backoff, then succeeds on the same provider", async () => {
    let n = 0;
    const sleeps = [];
    const flaky = new MockProvider({ id: "a", handler: () => { n++; if (n < 3) throw new ProviderError("rate_limit", "slow down", { retryable: true }); return "ok after retries"; } });
    const router = new AIRouter({ providers: [flaky], retries: 2, baseBackoffMs: 10, sleep: async (ms) => { sleeps.push(ms); } });
    const r = await router.generate(REQ);
    assert.equal(r.ok, true);
    assert.equal(r.text, "ok after retries");
    assert.equal(n, 3);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps[1] > sleeps[0], "backoff should grow");
  });

  test("does not retry non-retryable errors", async () => {
    let n = 0;
    const p = new MockProvider({ id: "a", handler: () => { n++; throw new ProviderError("invalid_response", "bad", { retryable: false }); } });
    const router = new AIRouter({ providers: [p, new MockProvider({ id: "b" })], retries: 3, sleep: noSleep });
    const r = await router.generate(REQ);
    assert.equal(n, 1);
    assert.equal(r.providerId, "b");
  });

  test("a provider that exceeds timeoutMs is treated as a timeout and skipped", async () => {
    const slow = new MockProvider({ id: "slow", latencyMs: 400 });
    const router = new AIRouter({ providers: [slow, new MockProvider({ id: "fast" })], sleep: noSleep, retries: 0 });
    const t0 = Date.now();
    const r = await router.generate({ ...REQ, timeoutMs: 50 });
    assert.equal(r.providerId, "fast");
    assert.ok(Date.now() - t0 < 300, "must not wait for the slow provider");
  });

  test("an empty or non-string reply is treated as a failure, not passed on", async () => {
    for (const bad of ["", "   ", null, 42]) {
      const p = new MockProvider({ id: "a", handler: () => bad });
      const router = new AIRouter({ providers: [p], sleep: noSleep });
      const r = await router.generate(REQ);
      assert.equal(r.ok, false, `value ${JSON.stringify(bad)}`);
      assert.equal(r.text, undefined);
    }
  });

  test("an unexpected thrown Error is contained and reported, never thrown to the caller", async () => {
    const p = new MockProvider({ id: "a", handler: () => { throw new Error("boom"); } });
    const router = new AIRouter({ providers: [p], sleep: noSleep });
    const r = await router.generate(REQ);
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, "unknown");
  });
});

describe("router: total outage is honest", () => {
  test("all providers failing returns ok:false with every error and no text", async () => {
    const router = new AIRouter({
      providers: [new MockProvider({ id: "a", handler: fails("unavailable") }), new MockProvider({ id: "b", handler: fails("rate_limit", false) })],
      sleep: noSleep,
    });
    const r = await router.generate(REQ);
    assert.equal(r.ok, false);
    assert.equal(r.code, "all_providers_failed");
    assert.equal(r.degraded, true);
    assert.equal(r.errors.length, 2);
    assert.equal(r.text, undefined);
  });

  test("no providers configured is reported, not thrown", async () => {
    const r = await new AIRouter({ providers: [] }).generate(REQ);
    assert.equal(r.ok, false);
    assert.equal(r.code, "no_providers_configured");
  });

  test("an invalid request fails fast without calling any provider", async () => {
    let n = 0;
    const p = new MockProvider({ id: "a", handler: () => { n++; return "x"; } });
    const r = await new AIRouter({ providers: [p] }).generate({ messages: [] });
    assert.equal(r.ok, false);
    assert.equal(r.code, "invalid_request");
    assert.equal(n, 0);
  });
});

describe("router: circuit breaker", () => {
  test("opens after consecutive failures, skips the provider, then recovers after cooldown", async () => {
    let t = 1000;
    let up = false;
    let aCalls = 0;
    const a = new MockProvider({ id: "a", handler: () => { aCalls++; if (!up) throw new ProviderError("unavailable", "down"); return "back"; } });
    const b = new MockProvider({ id: "b" });
    const router = new AIRouter({ providers: [a, b], retries: 0, sleep: noSleep, now: () => t, breaker: { failureThreshold: 3, cooldownMs: 1000 } });

    for (let i = 0; i < 3; i++) await router.generate(REQ);
    assert.equal(aCalls, 3);
    assert.equal(router.status().a.state, "open");

    await router.generate(REQ);
    await router.generate(REQ);
    assert.equal(aCalls, 3, "open breaker must skip the failing provider");

    t += 1001;
    up = true;
    const r = await router.generate(REQ);
    assert.equal(aCalls, 4, "one trial call after cooldown");
    assert.equal(r.providerId, "a");
    assert.equal(router.status().a.state, "closed");
  });

  test("a failed trial after cooldown re-opens the breaker", async () => {
    let t = 0;
    const a = new MockProvider({ id: "a", handler: fails("unavailable") });
    const router = new AIRouter({ providers: [a, new MockProvider({ id: "b" })], retries: 0, sleep: noSleep, now: () => t, breaker: { failureThreshold: 2, cooldownMs: 100 } });
    await router.generate(REQ); await router.generate(REQ);
    assert.equal(router.status().a.state, "open");
    t += 101;
    await router.generate(REQ);
    assert.equal(router.status().a.state, "open");
  });

  test("a success resets the failure count", async () => {
    let fail = true;
    const a = new MockProvider({ id: "a", handler: () => { if (fail) throw new ProviderError("unavailable", "x"); return "ok"; } });
    const router = new AIRouter({ providers: [a, new MockProvider({ id: "b" })], retries: 0, sleep: noSleep, breaker: { failureThreshold: 3, cooldownMs: 1000 } });
    await router.generate(REQ); await router.generate(REQ);
    fail = false; await router.generate(REQ);
    fail = true; await router.generate(REQ); await router.generate(REQ);
    assert.equal(router.status().a.state, "closed");
  });

  test("when every provider's breaker is open, the outage is reported immediately", async () => {
    const a = new MockProvider({ id: "a", handler: fails("unavailable") });
    const router = new AIRouter({ providers: [a], retries: 0, sleep: noSleep, breaker: { failureThreshold: 1, cooldownMs: 100000 } });
    await router.generate(REQ);
    const r = await router.generate(REQ);
    assert.equal(r.ok, false);
    assert.equal(r.degraded, true);
    assert.equal(r.errors[0].code, "circuit_open");
  });
});

describe("router: recording and privacy", () => {
  test("every attempt is recorded with provider, model, latency, usage; never the message text", async () => {
    const calls = [];
    const router = new AIRouter({ providers: [new MockProvider({ id: "a", modelId: "mock-1" })], onCall: (c) => calls.push(c), sleep: noSleep });
    await router.generate(REQ);
    const c = calls[0];
    assert.equal(c.providerId, "a");
    assert.equal(c.modelId, "mock-1");
    assert.equal(typeof c.latencyMs, "number");
    assert.equal(typeof c.usage.inputTokens, "number");
    assert.doesNotMatch(JSON.stringify(c), /PRIVATE-TEXT-123|plumbing assistant/);
  });

  test("a throwing observer cannot break the request", async () => {
    const router = new AIRouter({ providers: [new MockProvider({ id: "a" })], onCall: () => { throw new Error("logger down"); }, sleep: noSleep });
    assert.equal((await router.generate(REQ)).ok, true);
  });

  test("cost is only estimated when a price is configured; never invented", async () => {
    const calls = [];
    const noPrice = new AIRouter({ providers: [new MockProvider({ id: "a" })], onCall: (c) => calls.push(c), sleep: noSleep });
    await noPrice.generate(REQ);
    assert.equal(calls[0].costEstimateUsd, null);

    const priced = new AIRouter({
      providers: [new MockProvider({ id: "a", pricing: { inputPerMTokUsd: 1, outputPerMTokUsd: 2 }, handler: () => "x" })],
      onCall: (c) => calls.push(c), sleep: noSleep,
    });
    const r = await priced.generate(REQ);
    const u = r.usage;
    const expected = (u.inputTokens * 1 + u.outputTokens * 2) / 1_000_000;
    assert.ok(Math.abs(calls[1].costEstimateUsd - expected) < 1e-12);
  });
});
