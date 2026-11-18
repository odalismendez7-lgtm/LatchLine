// The only wording used to describe a notification's state to a person.
// "delivered" appears ONLY for status 'delivered'. A message the provider has
// merely accepted is described as accepted, with delivery explicitly unconfirmed,
// and anything simulated says so.

export function describeStatus(n) {
  const sim = !!n.simulated;
  switch (n.status) {
    case "queued":
      return n.attempts > 0 ? `Not sent yet. Retry scheduled after attempt ${n.attempts} (${n.last_error ?? "error"}).` : "Waiting to be sent.";
    case "sending":
      return "Being sent. Not confirmed as sent yet.";
    case "sent":
      return sim
        ? "Accepted by the SIMULATED mock provider. Nothing real was sent. Delivery is not confirmed."
        : "Handed to the provider. Delivery is NOT confirmed.";
    case "delivered":
      return sim ? "Delivery confirmed by the mock provider (simulated; no real message was sent)." : "Delivery confirmed by the provider.";
    case "delivery_failed":
      return "The provider reported it could not deliver this. The business has NOT been notified.";
    case "failed":
      return `Could not be sent after ${n.attempts} attempt${n.attempts === 1 ? "" : "s"}. The business has NOT been notified.`;
    case "undeliverable":
      return "No verified contact on file. The business has NOT been notified.";
    default:
      return "Unknown status.";
  }
}

/** True only when a provider confirmed delivery. The single place callers should ask. */
export const isConfirmedDelivered = (n) => n?.status === "delivered";
