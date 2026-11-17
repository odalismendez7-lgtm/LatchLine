// Provider registry. Only the mock provider can be created today.
//
// Real vendors (Anthropic, OpenAI, Google, Workers AI) are DELIBERATELY refused
// here: using them can cost money and send customer text to a third party, and
// the founder has not approved either. Enabling one will mean writing its
// adapter, evaluating it (docs/AI_MODEL_EVALUATIONS.md), and recording the
// founder's approval in docs/DECISIONS.md.

import { ProviderError } from "./errors.js";
import { MockProvider } from "./mock.js";

export function createProvider(config) {
  if (config?.type === "mock") return new MockProvider(config);
  throw new ProviderError(
    "disabled",
    `AI provider type '${String(config?.type)}' is disabled. Real providers require founder approval before they can be enabled.`
  );
}
