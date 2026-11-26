import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../src/ai/openai.js";
import { ProviderError } from "../src/ai/errors.js";

const request = {
  system: "You are a careful plumbing assistant.",
  messages: [{ role: "user", content: "My sink is leaking." }],
  maxTokens: 120,
  timeoutMs: 1000,
};

describe("OpenAI Responses adapter (network mocked)", () => {
  test("sends instructions and conversation input without enabling provider storage", async () => {
    let captured;
    const provider = new OpenAIProvider({
      apiKey: "test-secret",
      model: "test-model",
      fetchImpl: async (url, init) => {
        captured = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "I can help with that." }] }],
          usage: { input_tokens: 23, output_tokens: 7 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    const result = await provider.generate(request);
    assert.equal(captured.url, "https://api.openai.com/v1/responses");
    assert.equal(captured.init.headers.Authorization, "Bearer test-secret");
    assert.equal(captured.body.model, "test-model");
    assert.equal(captured.body.instructions, request.system);
    assert.deepEqual(captured.body.input[0], { role: "user", content: [{ type: "input_text", text: "My sink is leaking." }] });
    assert.equal(captured.body.store, false);
    assert.equal(result.text, "I can help with that.");
    assert.deepEqual(result.usage, { inputTokens: 23, outputTokens: 7 });
    assert.equal(result.mock, false);
    assert.equal(result.providerId, "openai");
  });

  test("uses output_text when supplied by the API", async () => {
    const provider = new OpenAIProvider({ apiKey: "x", model: "m", fetchImpl: async () =>
      new Response(JSON.stringify({ output_text: "  A concise answer. ", usage: { input_tokens: 1, output_tokens: 2 } }), { status: 200 }) });
    assert.equal((await provider.generate(request)).text, "A concise answer.");
  });

  test("does not expose provider response bodies or credentials in errors", async () => {
    const provider = new OpenAIProvider({ apiKey: "super-secret", model: "m", fetchImpl: async () =>
      new Response("super-secret internal provider diagnostic", { status: 401 }) });
    await assert.rejects(() => provider.generate(request), (error) =>
      error instanceof ProviderError && error.code === "auth" && !error.message.includes("super-secret"));
  });

  test("marks rate limits and server errors retryable", async () => {
    for (const [status, code] of [[429, "rate_limit"], [503, "unavailable"]]) {
      const provider = new OpenAIProvider({ apiKey: "x", model: "m", fetchImpl: async () => new Response("", { status }) });
      await assert.rejects(() => provider.generate(request), (error) => error.code === code && error.retryable === true);
    }
  });

  test("rejects missing key or model instead of making an ambiguous request", () => {
    assert.throws(() => new OpenAIProvider({ model: "m" }), (error) => error.code === "disabled");
    assert.throws(() => new OpenAIProvider({ apiKey: "x" }), (error) => error.code === "disabled");
  });

  test("rejects empty model output", async () => {
    const provider = new OpenAIProvider({ apiKey: "x", model: "m", fetchImpl: async () =>
      new Response(JSON.stringify({ output: [], usage: { input_tokens: 1, output_tokens: 0 } }), { status: 200 }) });
    await assert.rejects(() => provider.generate(request), (error) => error.code === "invalid_response");
  });
});
