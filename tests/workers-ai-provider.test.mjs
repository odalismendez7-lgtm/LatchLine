import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WorkersAIProvider, DEFAULT_WORKERS_AI_MODEL } from "../src/ai/workers-ai.js";
import { ProviderError } from "../src/ai/errors.js";

const request = {
  system: "You are a careful plumbing assistant.",
  messages: [{ role: "user", content: "My sink is leaking." }],
  maxTokens: 120,
  timeoutMs: 1000,
};

describe("Cloudflare Workers AI binding adapter (binding mocked)", () => {
  test("uses the configured model, system/user messages and bounded output", async () => {
    let captured;
    const provider = new WorkersAIProvider({
      ai: { run: async (...args) => {
        captured = args;
        return { choices: [{ message: { content: "I can help with that." } }], usage: { prompt_tokens: 31, completion_tokens: 9 } };
      } },
      model: "test-model",
    });
    const result = await provider.generate(request);
    assert.equal(captured[0], "test-model");
    assert.deepEqual(captured[1].messages, [
      { role: "system", content: request.system },
      { role: "user", content: "My sink is leaking." },
    ]);
    assert.equal(captured[1].max_tokens, 120);
    assert.equal(captured[1].stream, false);
    assert.deepEqual(captured[1].chat_template_kwargs, { enable_thinking: false });
    assert.deepEqual(captured[2], { rejectIfBusy: true });
    assert.equal(result.text, "I can help with that.");
    assert.deepEqual(result.usage, { inputTokens: 31, outputTokens: 9 });
    assert.equal(result.mock, false);
    assert.equal(result.providerId, "cloudflare-workers-ai");
  });

  test("has a documented default model but still requires an AI binding", () => {
    assert.equal(DEFAULT_WORKERS_AI_MODEL, "@cf/google/gemma-4-26b-a4b-it");
    assert.throws(() => new WorkersAIProvider(), (error) => error instanceof ProviderError && error.code === "disabled");
  });

  test("maps binding errors to safe retryable errors without leaking details", async () => {
    const provider = new WorkersAIProvider({ ai: { run: async () => { throw new Error("private account diagnostic"); } }, model: "test-model" });
    await assert.rejects(() => provider.generate(request), (error) =>
      error instanceof ProviderError && error.code === "unavailable" && error.retryable && !error.message.includes("private"));
  });

  test("rejects empty model output", async () => {
    const provider = new WorkersAIProvider({ ai: { run: async () => ({ choices: [{ message: { content: " " } }] }) }, model: "test-model" });
    await assert.rejects(() => provider.generate(request), (error) => error.code === "invalid_response");
  });

  test("does not call the binding when the request was already aborted", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const provider = new WorkersAIProvider({ ai: { run: async () => { calls += 1; } }, model: "test-model" });
    await assert.rejects(() => provider.generate({ ...request, signal: controller.signal }), (error) => error.code === "timeout");
    assert.equal(calls, 0);
  });
});
