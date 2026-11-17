// The one interface LATCHLINE uses to talk to any AI model.
//
//   provider.generate({ system, messages, maxTokens?, timeoutMs?, signal? })
//     -> { text, usage: { inputTokens, outputTokens }, latencyMs,
//          providerId, modelId, mock? }
//     or throws a ProviderError (see errors.js)
//
// `system` is trusted instructions written by LATCHLINE. `messages` carry
// customer text and are treated as untrusted DATA. A new vendor is added by
// writing one adapter that implements generate(); nothing else changes.

import { ProviderError } from "./errors.js";

export function validateRequest(req) {
  const bad = (msg) => new ProviderError("invalid_request", msg);
  if (!req || typeof req !== "object") throw bad("request must be an object");
  if (typeof req.system !== "string") throw bad("system must be a string");
  if (!Array.isArray(req.messages) || req.messages.length === 0) throw bad("messages must be a non-empty list");
  for (const m of req.messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) throw bad("message role must be 'user' or 'assistant'");
    if (typeof m.content !== "string") throw bad("message content must be a string");
  }
  if (req.maxTokens !== undefined && !(Number.isInteger(req.maxTokens) && req.maxTokens > 0)) throw bad("maxTokens must be a positive integer");
  if (req.timeoutMs !== undefined && !(Number.isFinite(req.timeoutMs) && req.timeoutMs > 0)) throw bad("timeoutMs must be a positive number");
  return req;
}

export function validateResult(result) {
  const ok =
    result &&
    typeof result.text === "string" &&
    result.text.trim() !== "" &&
    result.usage &&
    Number.isFinite(result.usage.inputTokens) &&
    Number.isFinite(result.usage.outputTokens);
  if (!ok) throw new ProviderError("invalid_response", "provider returned an empty or malformed response");
  return result;
}

/** Rough token estimate for the mock only (about 4 characters per token). Real providers report real usage. */
export const estimateTokens = (s) => Math.max(1, Math.ceil(String(s).length / 4));
