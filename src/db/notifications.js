// Tenant-scoped notification outbox. Obtained only through forBusiness(db, id).tenant.notifications;
// every statement binds business_id, and the database's composite foreign keys
// reject cross-business links as a second layer.
//
// Guarantees:
//   - Idempotent enqueue: the same (kind, lead, conversation, channel) can never
//     create two rows (UNIQUE business_id + idempotency_key, ON CONFLICT DO NOTHING).
//   - Nothing is ever marked 'delivered' here except by recordDelivery(), which
//     the dispatcher calls only when a provider confirms it.
//   - Errors are stored as short codes, never customer text or provider bodies.

import { DbError } from "./errors.js";
import { nowIso, newId, json, guard } from "./util.js";
import { normalizeEmail, normalizePhone } from "../validation/normalize.js";

export const KINDS = ["new_lead", "human_requested", "repeat_contact"];
export const PRIORITIES = { emergency: 0, urgent: 1, normal: 2 };
export const DEFAULT_MAX_ATTEMPTS = 5;
const EMERGENCY_MAX_ATTEMPTS = 8;
const CODE_RE = /^[a-z0-9_]{1,60}$/;
const safeCode = (c) => (typeof c === "string" && CODE_RE.test(c) ? c : "unknown_error");

export function notificationsRepo(db, B, leadsRepo) {
  const audit = (action, target, detail = {}) => ({
    sql: "INSERT INTO audit_log (id, business_id, actor, action, target, detail, created_at) VALUES (?,?,?,?,?,?,?)",
    params: [newId("aud"), B, "system", action, target ?? null, json(detail), nowIso()],
  });

  const contacts = {
    async add({ channel, address, verified = false, now = nowIso() }) {
      let value;
      if (channel === "email") { const v = normalizeEmail(address); if (!v.ok) throw new DbError("invalid_data", "invalid email"); value = v.value; }
      else if (channel === "sms") { const v = normalizePhone(address); if (!v.ok) throw new DbError("invalid_data", "invalid phone"); value = v.value; }
      else throw new DbError("invalid_data", "unknown channel");
      return guard(async () => {
        const id = newId("ctc");
        await db.batch([
          { sql: "INSERT INTO business_contacts (id, business_id, channel, address, verified_at, created_at) VALUES (?,?,?,?,?,?)", params: [id, B, channel, value, verified ? now : null, now] },
          audit("contact_added", id, { channel, verified: !!verified }),
        ]);
        return { id };
      });
    },
    async markVerified(id, now = nowIso()) {
      return guard(async () => {
        const r = await db.run("UPDATE business_contacts SET verified_at = ? WHERE id = ? AND business_id = ?", [now, id, B]);
        if (r.changes !== 1) throw new DbError("not_found", "contact not found for this business");
      });
    },
    async setEnabled(id, enabled) {
      return guard(async () => {
        const r = await db.run("UPDATE business_contacts SET enabled = ? WHERE id = ? AND business_id = ?", [enabled ? 1 : 0, id, B]);
        if (r.changes !== 1) throw new DbError("not_found", "contact not found for this business");
      });
    },
    async list() {
      return guard(() => db.all("SELECT id, channel, address, enabled, verified_at FROM business_contacts WHERE business_id = ? ORDER BY created_at, rowid", [B]));
    },
  };

  const sendable = () => guard(() => db.all(
    "SELECT id, channel, address FROM business_contacts WHERE business_id = ? AND enabled = 1 AND verified_at IS NOT NULL ORDER BY channel, created_at", [B]));

  function pickRecipients(list, priority) {
    if (priority === "emergency") return list; // every verified channel
    const email = list.find((c) => c.channel === "email");
    return email ? [email] : list.slice(0, 1);
  }

  const api = {
    contacts,

    /** Idempotent. Returns { created, existing, undeliverable }. */
    async enqueueForLead({ leadId, conversationId, kind, priority, now = nowIso() }) {
      if (!KINDS.includes(kind)) throw new DbError("invalid_data", "unknown notification kind");
      if (!(priority in PRIORITIES)) throw new DbError("invalid_data", "unknown priority");
      return guard(async () => {
        const recipients = pickRecipients(await sendable(), priority);
        const targets = recipients.length ? recipients : [{ id: null, channel: "none", address: null }];
        const max = priority === "emergency" ? EMERGENCY_MAX_ATTEMPTS : DEFAULT_MAX_ATTEMPTS;
        const stmts = [];
        const ids = [];
        for (const t of targets) {
          const id = newId("ntf");
          ids.push(id);
          const none = t.channel === "none";
          stmts.push({
            sql: `INSERT INTO notifications (id, business_id, lead_id, kind, priority, priority_rank, channel, recipient, idempotency_key,
                    status, max_attempts, next_attempt_at, last_error, created_at, updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(business_id, idempotency_key) DO NOTHING`,
            params: [id, B, leadId, kind, priority, PRIORITIES[priority], t.channel, t.address,
              `${kind}:${leadId}:${conversationId ?? "-"}:${t.channel}:${t.address ?? "-"}`,
              none ? "undeliverable" : "queued", max, none ? null : now, none ? "no_verified_contact" : null, now, now],
          });
        }
        stmts.push(audit("notifications_enqueued", leadId, { kind, priority, count: targets.length }));
        const res = await db.batch(stmts);
        const created = res.slice(0, targets.length).reduce((n, r) => n + r.changes, 0);
        return { created, existing: targets.length - created, undeliverable: recipients.length === 0 };
      });
    },

    /** Claim up to `limit` due rows, highest priority first. Optimistic: only one caller wins each row. */
    async claimDue({ limit = 10, now = nowIso(), leaseMs = 60_000 }) {
      return guard(async () => {
        const lease = new Date(new Date(now).getTime() + leaseMs).toISOString();
        const cands = await db.all(
          `SELECT id, status, attempts, max_attempts FROM notifications
            WHERE business_id = ? AND ((status = 'queued' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_until < ?))
            ORDER BY priority_rank, created_at, rowid LIMIT ?`, [B, now, now, Math.min(Math.max(1, limit | 0), 50)]);
        const claimed = [];
        for (const c of cands) {
          if (c.status === "sending") {
            // A previous dispatcher died mid-send. Close its attempt; it may or may not have reached the provider.
            await db.run("UPDATE notification_attempts SET outcome = 'lease_expired', finished_at = ? WHERE notification_id = ? AND business_id = ? AND finished_at IS NULL", [now, c.id, B]);
            if (c.attempts >= c.max_attempts) {
              await db.batch([
                { sql: "UPDATE notifications SET status = 'failed', last_error = 'lease_expired_exhausted', lease_until = NULL, updated_at = ? WHERE id = ? AND business_id = ? AND status = 'sending'", params: [now, c.id, B] },
                audit("notification_failed", c.id, { reason: "lease_expired_exhausted" }),
              ]);
              continue;
            }
          }
          const next = c.attempts + 1;
          const r = await db.run(
            `UPDATE notifications SET status = 'sending', attempts = ?, lease_until = ?, updated_at = ?
              WHERE id = ? AND business_id = ? AND attempts = ? AND ((status = 'queued' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_until < ?))`,
            [next, lease, now, c.id, B, c.attempts, now, now]);
          if (r.changes !== 1) continue; // someone else claimed it
          await db.run("INSERT INTO notification_attempts (id, business_id, notification_id, attempt_no, started_at) VALUES (?,?,?,?,?)", [newId("att"), B, c.id, next, now]);
          const row = await db.first("SELECT * FROM notifications WHERE id = ? AND business_id = ?", [c.id, B]);
          claimed.push({ ...row, simulated: !!row.simulated });
        }
        return claimed;
      });
    },

    async recordAccepted(id, attemptNo, { providerId, providerMessageId, simulated, now = nowIso() }) {
      return guard(async () => {
        const res = await db.batch([
          { sql: "UPDATE notifications SET status = 'sent', provider_id = ?, provider_message_id = ?, simulated = ?, sent_at = ?, lease_until = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND business_id = ? AND status = 'sending'", params: [providerId, providerMessageId, simulated ? 1 : 0, now, now, id, B] },
          { sql: "UPDATE notification_attempts SET outcome = 'accepted', finished_at = ? WHERE notification_id = ? AND business_id = ? AND attempt_no = ?", params: [now, id, B, attemptNo] },
          audit("notification_sent", id, { simulated: !!simulated }),
        ]);
        if (res[0].changes !== 1) throw new DbError("not_found", "notification not in sending state for this business");
      });
    },

    /** retryable errors requeue until max_attempts; anything else ends in 'failed'. */
    async recordFailure(id, attemptNo, { code, retryable, retryAt, now = nowIso() }) {
      return guard(async () => {
        const row = await db.first("SELECT attempts, max_attempts FROM notifications WHERE id = ? AND business_id = ?", [id, B]);
        if (!row) throw new DbError("not_found", "notification not found for this business");
        const again = !!retryable && row.attempts < row.max_attempts;
        const c = safeCode(code);
        const res = await db.batch([
          again
            ? { sql: "UPDATE notifications SET status = 'queued', next_attempt_at = ?, last_error = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND business_id = ? AND status = 'sending'", params: [retryAt, c, now, id, B] }
            : { sql: "UPDATE notifications SET status = 'failed', next_attempt_at = NULL, last_error = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND business_id = ? AND status = 'sending'", params: [c, now, id, B] },
          { sql: "UPDATE notification_attempts SET outcome = ?, error_code = ?, finished_at = ? WHERE notification_id = ? AND business_id = ? AND attempt_no = ?", params: [retryable ? "retryable_error" : "permanent_error", c, now, id, B, attemptNo] },
          audit(again ? "notification_retry_scheduled" : "notification_failed", id, { code: c, attempt: attemptNo }),
        ]);
        if (res[0].changes !== 1) throw new DbError("not_found", "notification not in sending state for this business");
        return { requeued: again };
      });
    },

    /** Only call with a provider-confirmed result. */
    async recordDelivery(id, { delivered, code, now = nowIso() }) {
      return guard(async () => {
        const res = await db.batch([
          { sql: "UPDATE notifications SET status = ?, delivered_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND business_id = ? AND status = 'sent'", params: [delivered ? "delivered" : "delivery_failed", delivered ? now : null, delivered ? null : safeCode(code), now, id, B] },
          audit(delivered ? "notification_delivered" : "notification_delivery_failed", id),
        ]);
        if (res[0].changes !== 1) throw new DbError("not_found", "notification not in sent state for this business");
      });
    },

    async awaitingConfirmation(limit = 20) {
      return guard(() => db.all("SELECT * FROM notifications WHERE business_id = ? AND status = 'sent' AND provider_message_id IS NOT NULL ORDER BY priority_rank, sent_at LIMIT ?", [B, Math.min(Math.max(1, limit | 0), 100)]));
    },

    async get(id) {
      return guard(async () => db.first("SELECT * FROM notifications WHERE id = ? AND business_id = ?", [id, B]));
    },
    async listForLead(leadId) {
      return guard(() => db.all("SELECT id, kind, priority, channel, status, attempts, last_error, simulated FROM notifications WHERE business_id = ? AND lead_id = ? ORDER BY created_at, rowid", [B, leadId]));
    },
    async attempts(id) {
      return guard(() => db.all("SELECT attempt_no, outcome, error_code FROM notification_attempts WHERE notification_id = ? AND business_id = ? ORDER BY attempt_no", [id, B]));
    },
    async counts() {
      return guard(async () => Object.fromEntries((await db.all("SELECT status, COUNT(*) AS n FROM notifications WHERE business_id = ? GROUP BY status", [B])).map((r) => [r.status, r.n])));
    },

    /**
     * Items a person must look at: nothing reached anyone, or a provider accepted
     * a message but never confirmed delivery within `staleAfterMs`.
     */
    async needsAttention({ now = nowIso(), staleAfterMs = 15 * 60_000, limit = 50 } = {}) {
      return guard(async () => {
        const cutoff = new Date(new Date(now).getTime() - staleAfterMs).toISOString();
        return db.all(
          `SELECT id, lead_id, kind, priority, channel, status, attempts, last_error FROM notifications
            WHERE business_id = ? AND (status IN ('failed', 'undeliverable', 'delivery_failed') OR (status = 'sent' AND sent_at < ?))
            ORDER BY priority_rank, created_at LIMIT ?`, [B, cutoff, Math.min(Math.max(1, limit | 0), 200)]);
      });
    },

    /** Recovery: leads saved but never queued (e.g. a crash between save and enqueue). Idempotent. */
    async reconcileMissing({ sinceDays = 7, now = nowIso(), limit = 100 } = {}) {
      return guard(async () => {
        const since = new Date(new Date(now).getTime() - sinceDays * 86400000).toISOString();
        const rows = await db.all(
          `SELECT l.id, l.conversation_id, l.emergency, l.urgency FROM leads l
            WHERE l.business_id = ? AND l.created_at >= ?
              AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.business_id = l.business_id AND n.lead_id = l.id AND n.kind = 'new_lead')
            ORDER BY l.created_at LIMIT ?`, [B, since, Math.min(Math.max(1, limit | 0), 500)]);
        let enqueued = 0;
        for (const l of rows) {
          const priority = l.emergency ? "emergency" : l.urgency === "now" ? "urgent" : "normal";
          const r = await api.enqueueForLead({ leadId: l.id, conversationId: l.conversation_id, kind: "new_lead", priority, now });
          enqueued += r.created;
        }
        return { checked: rows.length, enqueued };
      });
    },
  };
  return Object.freeze({ ...api, contacts: Object.freeze(contacts) });
}
