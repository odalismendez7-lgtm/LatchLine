// One-time verification codes for notification contacts. Only a hash of each code is stored.
// Tenant-scoped: every statement binds business_id.
import { DbError } from "./errors.js";
import { nowIso, newId, json, guard } from "./util.js";

export function contactVerifyRepo(db, B) {
  const audit = (actor, action, target, detail = {}) => ({
    sql: "INSERT INTO audit_log (id, business_id, actor, action, target, detail, created_at) VALUES (?,?,?,?,?,?,?)",
    params: [newId("aud"), B, actor, action, target ?? null, json(detail), nowIso()],
  });
  return Object.freeze({
    /** Records a new challenge; refuses inside the cooldown or past the daily cap. Older open codes are cancelled. */
    async start({ actorId, contactId, codeHash, expiresAt, simulated, now, cooldownMs, dailyCap }) {
      return guard(async () => {
        const last = await db.first("SELECT created_at FROM contact_verifications WHERE business_id = ? AND contact_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [B, contactId]);
        if (last && Date.parse(now) - Date.parse(last.created_at) < cooldownMs) {
          return { ok: false, code: "cooldown", retryAfterSec: Math.max(1, Math.ceil((cooldownMs - (Date.parse(now) - Date.parse(last.created_at))) / 1000)) };
        }
        const since = new Date(Date.parse(now) - 86_400_000).toISOString();
        const n = (await db.first("SELECT COUNT(*) n FROM contact_verifications WHERE business_id = ? AND contact_id = ? AND created_at >= ?", [B, contactId, since])).n;
        if (n >= dailyCap) return { ok: false, code: "daily_limit" };
        await db.batch([
          { sql: "UPDATE contact_verifications SET consumed_at = ? WHERE business_id = ? AND contact_id = ? AND consumed_at IS NULL", params: [now, B, contactId] },
          { sql: "INSERT INTO contact_verifications (id, business_id, contact_id, code_hash, expires_at, simulated, created_at) VALUES (?,?,?,?,?,?,?)", params: [newId("cvr"), B, contactId, codeHash, expiresAt, simulated ? 1 : 0, now] },
          audit(actorId, "contact_verification_started", contactId, { simulated: !!simulated }),
        ]);
        return { ok: true };
      });
    },
    /** Checks a code. Every wrong guess is counted; at max_attempts the code is dead. */
    async check({ actorId, contactId, codeHash, now }) {
      return guard(async () => {
        const v = await db.first("SELECT * FROM contact_verifications WHERE business_id = ? AND contact_id = ? AND consumed_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1", [B, contactId]);
        if (!v) return { ok: false, code: "no_open_code" };
        if (Date.parse(v.expires_at) <= Date.parse(now)) return { ok: false, code: "expired" };
        if (v.attempts >= v.max_attempts) return { ok: false, code: "too_many_attempts" };
        // Count the attempt BEFORE comparing, atomically, so parallel guesses cannot exceed the limit.
        const c = await db.run("UPDATE contact_verifications SET attempts = attempts + 1 WHERE id = ? AND business_id = ? AND attempts < max_attempts AND consumed_at IS NULL", [v.id, B]);
        if (c.changes !== 1) return { ok: false, code: "too_many_attempts" };
        if (v.code_hash !== codeHash) {
          return { ok: false, code: v.attempts + 1 >= v.max_attempts ? "too_many_attempts" : "wrong_code", attemptsLeft: Math.max(0, v.max_attempts - v.attempts - 1) };
        }
        const u = await db.run("UPDATE contact_verifications SET consumed_at = ? WHERE id = ? AND business_id = ? AND consumed_at IS NULL", [now, v.id, B]);
        if (u.changes !== 1) return { ok: false, code: "no_open_code" };
        return { ok: true, simulated: !!v.simulated };
      });
    },
  });
}
