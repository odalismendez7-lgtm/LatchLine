// Explicit provider registry. Mock remains the safe default; live providers require server-side credentials.
import { ProviderError } from "./errors.js";
import { MockProvider } from "./mock.js";
import { OpenAIProvider } from "./openai.js";
import { WorkersAIProvider } from "./workers-ai.js";

export function createProvider(config) {
  if (config?.type === "mock") return new MockProvider(config);
  if (config?.type === "openai") return new OpenAIProvider(config);
  if (config?.type === "workers-ai") return new WorkersAIProvider(config);
  throw new ProviderError("disabled", `AI provider type '${String(config?.type)}' is not supported or enabled. Other live providers require explicit founder approval and a separately reviewed adapter.`);
}
