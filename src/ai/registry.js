// Explicit provider registry. Mock remains the safe default; live providers require server-side credentials.
import { ProviderError } from "./errors.js";
import { MockProvider } from "./mock.js";
import { OpenAIProvider } from "./openai.js";

export function createProvider(config) {
  if (config?.type === "mock") return new MockProvider(config);
  if (config?.type === "openai") return new OpenAIProvider(config);
  throw new ProviderError("disabled", `AI provider type '${String(config?.type)}' is not supported or enabled. Other live providers require explicit founder approval and a separately reviewed adapter.`);
}
