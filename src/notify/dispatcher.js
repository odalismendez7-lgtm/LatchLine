// Dispatcher: takes due notifications from the outbox and hands them to the
// provider for each channel. Run it after a lead is saved (best effort) and on
// a schedule (retries). It never throws; it returns a summary.
//
// Honest statuses:
//   provider accepted  -> 'sent'      (NOT delivered)
//   provider confirms  -> 'delivered' (only via getDeliveryStatus)
//   errors             -> retry with backoff until max attempts, then 'failed'
//
// If the database fails AFTER a provider accepted a message, the row stays
// 'sending'; after its lease expires it is sent again WITH THE SAME idempotency
// key, so a provider that honors idempotency keys (the mock does; real vendors
// generally do) will not send twice. This is at-least-once delivery to the
// provider, not exactly-once, and is documented as KI-22.

import { platformRepo, forBusiness } from "../db/tenant.js";
import { renderNotification } from "./render.js";
import { NotifyError, normalizeNotifyError, validateSendResult } from "./provider.js";

export const BACKOFF_SECONDS = {
  emergency: [15, 30, 60, 120, 300, 600, 900, 900],
  urgent: [30, 120, 600, 1800, 1800],
  normal: [60, 300, 900, 3600, 3600],
};

export const backoffMs = (priority, attempt) => {
  const table = BACKOFF_SECONDS[priority] ?? BACKOFF_SECONDS.normal;
  return table[Math.min(Math.max(attempt, 1), table.length) - 1] * 1000;
};

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new NotifyError("timeout", "provider exceeded time limit", { retryable: true })), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export async function dispatchDue({ db, channels, now = () => new Date().toISOString(), perBusinessLimit = 10, businessLimit = 50, sendTimeoutMs = 8000, leaseMs = 60_000 }) {
  const summary = { ok: true, businesses: 0, claimed: 0, sent: 0, retryScheduled: 0, failed: 0, delivered: 0, deliveryFailed: 0, unrecorded: 0, errors: [] };
  const err = (code) => { if (!summary.errors.includes(code)) summary.errors.push(code); };

  let ids;
  try {
    ids = await platformRepo(db).businessesWithDueNotifications(now(), businessLimit);
  } catch {
    return { ...summary, ok: false, errors: ["database_unavailable"] };
  }

  for (const id of ids) {
    summary.businesses += 1;
    let T;
    try { T = forBusiness(db, id); } catch { err("invalid_business"); continue; }
    const N = T.notifications;

    // ---- send ----
    let claimed = [];
    try { claimed = await N.claimDue({ limit: perBusinessLimit, now: now(), leaseMs }); } catch { err("database_unavailable"); summary.ok = false; }
    summary.claimed += claimed.length;

    let profile = null;
    for (const n of claimed) {
      const settleFailure = async (code, retryable) => {
        try {
          const r = await N.recordFailure(n.id, n.attempts, { code, retryable, retryAt: new Date(new Date(now()).getTime() + backoffMs(n.priority, n.attempts)).toISOString(), now: now() });
          if (r.requeued) summary.retryScheduled += 1; else summary.failed += 1;
        } catch { summary.unrecorded += 1; err("database_unavailable"); summary.ok = false; }
        err(code);
      };

      const provider = channels[n.channel];
      if (!provider) { await settleFailure("no_provider", false); continue; }

      let lead;
      try {
        lead = await T.leads.get(n.lead_id);
        profile ??= await T.profile();
      } catch { await settleFailure("database_unavailable", true); continue; }
      if (!lead) { await settleFailure("lead_missing", false); continue; }

      // A contact confirmed only by a SIMULATED code may receive mock sends and nothing else.
      if (!provider.simulated) {
        let real = false;
        try { real = await N.contacts.isRealVerified(n.channel, n.recipient); } catch { await settleFailure("database_unavailable", true); continue; }
        if (!real) { await settleFailure("contact_not_verified", false); continue; }
      }

      const msg = renderNotification({ kind: n.kind, priority: n.priority, variant: n.variant ?? null, channel: n.channel, business: profile, lead });
      let result;
      try {
        result = validateSendResult(await withTimeout(provider.send({ channel: n.channel, to: n.recipient, subject: msg.subject, text: msg.text, idempotencyKey: n.idempotency_key, priority: n.priority }), sendTimeoutMs));
      } catch (raw) {
        const e = normalizeNotifyError(raw);
        await settleFailure(e.code, e.retryable);
        continue;
      }
      try {
        await N.recordAccepted(n.id, n.attempts, { providerId: result.providerId, providerMessageId: result.providerMessageId, simulated: result.simulated, now: now() });
        summary.sent += 1;
      } catch {
        // The provider has it but we could not record that. Row stays 'sending'; the lease will expire and the
        // re-send carries the same idempotency key.
        summary.unrecorded += 1; err("database_unavailable"); summary.ok = false;
      }
    }

    // ---- confirm delivery (only what the provider actually reports) ----
    let waiting = [];
    try { waiting = await N.awaitingConfirmation(20); } catch { err("database_unavailable"); summary.ok = false; }
    for (const n of waiting) {
      const provider = channels[n.channel];
      if (!provider || provider.id !== n.provider_id || typeof provider.getDeliveryStatus !== "function") continue;
      try {
        const s = await withTimeout(provider.getDeliveryStatus(n.provider_message_id), sendTimeoutMs);
        if (s?.status === "delivered") { await N.recordDelivery(n.id, { delivered: true, now: now() }); summary.delivered += 1; }
        else if (s?.status === "failed") { await N.recordDelivery(n.id, { delivered: false, code: s.code, now: now() }); summary.deliveryFailed += 1; }
        // "pending" or anything else: stay 'sent'
      } catch { err("status_check_failed"); }
    }
  }
  return summary;
}
