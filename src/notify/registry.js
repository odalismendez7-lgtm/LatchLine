// Notifier registry. Mock is the default; Resend email is opt-in and requires server-side secrets.
//
// Real email and SMS vendors are DELIBERATELY refused: sending can cost money,
// contacts real people, and transmits customer details to a third party. Enabling
// one needs: its adapter, evaluation, a privacy review, and the founder's
// approval recorded in docs/DECISIONS.md.

import { NotifyError } from "./provider.js";
import { MockNotifier } from "./mock.js";
import { ResendEmailProvider } from "./resend.js";

export function createNotifier(config) {
  if (config?.type === "mock") return new MockNotifier(config);
  if (config?.type === "resend-email") return new ResendEmailProvider(config);
  throw new NotifyError("disabled", `Notification provider '${String(config?.type)}' is disabled. Real email/SMS providers require founder approval before they can be enabled.`);
}

/** Channel -> provider map. Each channel can use a different vendor later. */
export function createChannelMap(providers) {
  const map = {};
  for (const p of providers) for (const ch of p.channels) map[ch] ??= p;
  return Object.freeze(map);
}
