// Read/write queries behind the business dashboard. Tenant-scoped like everything in forBusiness():
// every statement binds business_id. Callers authorize the user first (src/dashboard/authz.js).
import { DbError } from "./errors.js";
import { nowIso, newId, json, parse, guard, CONTACT_MISSING } from "./util.js";

export const LEAD_STATUSES = ["new", "contacted", "won", "lost", "spam"];
const like = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) ? Math.min(Math.max(lo, Math.trunc(Number(n))), hi) : d);

export function dashboardRepo(db, B) {
  const audit = (actor, action, target, detail = {}) => ({
    sql: "INSERT INTO audit_log (id, business_id, actor, action, target, detail, created_at) VALUES (?,?,?,?,?,?,?)",
    params: [newId("aud"), B, actor, action, target ?? null, json(detail), nowIso()],
  });
  const leadCols = `id, name, phone, email, zip, issue_category, issue_text, urgency, preferred_contact, preferred_time, emergency, status, duplicate_count, zip_in_verified_area, summary, created_at, updated_at, ${CONTACT_MISSING}`;

  return Object.freeze({
    async overview() {
      return guard(async () => {
        const one = async (sql, p = []) => (await db.first(sql, [B, ...p])).n;
        return {
          leadsTotal: await one("SELECT COUNT(*) n FROM leads WHERE business_id = ?"),
          leadsNew: await one("SELECT COUNT(*) n FROM leads WHERE business_id = ? AND status = 'new'"),
          urgentOpen: await one("SELECT COUNT(*) n FROM leads WHERE business_id = ? AND emergency = 1 AND status = 'new'"),
          incompleteEmergency: await one("SELECT COUNT(*) n FROM leads WHERE business_id = ? AND emergency = 1 AND status = 'new' AND phone IS NULL AND email IS NULL"),
          conversationsTotal: await one("SELECT COUNT(*) n FROM conversations WHERE business_id = ?"),
          handoffsOpen: await one("SELECT COUNT(*) n FROM conversations WHERE business_id = ? AND status = 'needs_human'"),
        };
      });
    },
    async searchLeads({ status, urgent, incomplete, q, limit = 25, offset = 0, contactHidden = false } = {}) {
      return guard(async () => {
        const where = ["business_id = ?"], p = [B];
        if (status !== undefined && status !== null && status !== "") { if (!LEAD_STATUSES.includes(status)) throw new DbError("invalid_data", "unknown status"); where.push("status = ?"); p.push(status); }
        if (urgent === true || urgent === "1" || urgent === "true") where.push("emergency = 1");
        if (incomplete === true || incomplete === "1" || incomplete === "true") where.push("phone IS NULL AND email IS NULL");
        if (typeof q === "string" && q.trim()) {
          const term = q.trim().slice(0, 60), l = like(term);
          if (contactHidden) {
            // The caller may not see phone/email, which customers also type into free text. Searching that text (even by
            // letters) lets them confirm or rebuild a hidden value piece by piece through the result count, so they
            // can search name and ZIP only.
            where.push("(name LIKE ? ESCAPE '\\' OR zip LIKE ? ESCAPE '\\')"); p.push(l, l);
          } else { where.push("(name LIKE ? ESCAPE '\\' OR issue_text LIKE ? ESCAPE '\\' OR zip LIKE ? ESCAPE '\\')"); p.push(l, l, l); }
        }
        const lim = clamp(limit, 1, 100, 25), off = clamp(offset, 0, 100000, 0);
        const rows = await db.all(`SELECT ${leadCols} FROM leads WHERE ${where.join(" AND ")} ORDER BY emergency DESC, created_at DESC, rowid DESC LIMIT ? OFFSET ?`, [...p, lim, off]);
        const total = (await db.first(`SELECT COUNT(*) n FROM leads WHERE ${where.join(" AND ")}`, p)).n;
        return { rows: rows.map((r) => ({ ...r, emergency: !!r.emergency, contact_missing: !!r.contact_missing })), total };
      });
    },
    async exportLeads(limit = 5000) {
      return guard(async () => (await db.all(`SELECT ${leadCols} FROM leads WHERE business_id = ? ORDER BY created_at, rowid LIMIT ?`, [B, clamp(limit, 1, 5000, 5000)])).map((r) => ({ ...r, emergency: !!r.emergency, contact_missing: !!r.contact_missing })));
    },
    async leadDetail(id) {
      return guard(async () => {
        const r = await db.first(`SELECT ${leadCols}, conversation_id, emergency_categories FROM leads WHERE id = ? AND business_id = ?`, [id, B]);
        if (!r) return null;
        const events = await db.all("SELECT type, detail, created_at FROM lead_events WHERE business_id = ? AND lead_id = ? ORDER BY created_at, rowid LIMIT 100", [B, id]);
        return { ...r, emergency: !!r.emergency, contact_missing: !!r.contact_missing, emergency_categories: parse(r.emergency_categories, []), events: events.map((e) => ({ type: e.type, detail: parse(e.detail, {}), created_at: e.created_at })) };
      });
    },
    async setLeadStatus(actorId, id, status) {
      if (!LEAD_STATUSES.includes(status)) throw new DbError("invalid_data", "unknown status");
      return guard(async () => {
        const cur = await db.first("SELECT status FROM leads WHERE id = ? AND business_id = ?", [id, B]);
        if (!cur) throw new DbError("not_found", "lead not found for this business");
        const t = nowIso();
        const r = await db.batch([
          { sql: "UPDATE leads SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?", params: [status, t, id, B] },
          { sql: "INSERT INTO lead_events (id, business_id, lead_id, type, detail, created_at) VALUES (?,?,?,?,?,?)", params: [newId("evt"), B, id, "status_changed", json({ from: cur.status, to: status, by: actorId }), t] },
          audit(actorId, "lead_status_changed", id, { from: cur.status, to: status }),
        ]);
        if (r[0].changes !== 1) throw new DbError("not_found", "lead not found for this business");
        return { from: cur.status, to: status };
      });
    },
    /** Permanently erases the lead AND its conversation and messages (cascade). The audit row keeps ids only. */
    async deleteLead(actorId, id) {
      return guard(async () => {
        const l = await db.first("SELECT conversation_id FROM leads WHERE id = ? AND business_id = ?", [id, B]);
        if (!l) throw new DbError("not_found", "lead not found for this business");
        await db.batch([
          { sql: "DELETE FROM conversations WHERE id = ? AND business_id = ?", params: [l.conversation_id, B] },
          audit(actorId, "lead_deleted", id, { conversationId: l.conversation_id }),
        ]);
      });
    },
    async updateBusinessName(actorId, name) {
      return guard(async () => {
        const r = await db.batch([
          { sql: "UPDATE businesses SET name = ? WHERE id = ?", params: [name, B] },
          audit(actorId, "business_name_changed", B),
        ]);
        if (r[0].changes !== 1) throw new DbError("not_found", "business not found");
      });
    },
    async recordExport(actorId, count) { return guard(() => db.batch([audit(actorId, "leads_exported", null, { count })])); },
    async listConversations({ status, urgent, limit = 25, offset = 0 } = {}) {
      return guard(async () => {
        const where = ["business_id = ?"], p = [B];
        if (status) { if (!["open", "needs_human", "closed", "limited"].includes(status)) throw new DbError("invalid_data", "unknown status"); where.push("status = ?"); p.push(status); }
        if (urgent === true || urgent === "1" || urgent === "true") where.push("urgent = 1");
        const rows = await db.all(`SELECT id, status, urgent, lead_id, message_count, created_at, updated_at FROM conversations WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, rowid DESC LIMIT ? OFFSET ?`, [...p, clamp(limit, 1, 100, 25), clamp(offset, 0, 100000, 0)]);
        return rows.map((r) => ({ ...r, urgent: !!r.urgent }));
      });
    },
    async conversationDetail(id) {
      return guard(async () => {
        const c = await db.first("SELECT id, status, urgent, lead_id, message_count, created_at, updated_at FROM conversations WHERE id = ? AND business_id = ?", [id, B]);
        if (!c) return null;
        const messages = await db.all("SELECT id, role, content, created_at FROM messages WHERE business_id = ? AND conversation_id = ? ORDER BY created_at, rowid LIMIT 200", [B, id]);
        return { ...c, urgent: !!c.urgent, messages };
      });
    },
    /** Handoff requests = notifications of kind human_requested, plus conversations awaiting a human. */
    async handoffs(limit = 50) {
      return guard(async () => {
        const rows = await db.all(
          `SELECT c.id AS conversation_id, c.lead_id, c.urgent, c.updated_at, l.name, l.phone, l.email, l.issue_text, l.status AS lead_status
             FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id AND l.business_id = c.business_id
            WHERE c.business_id = ? AND c.status = 'needs_human' ORDER BY c.urgent DESC, c.updated_at DESC LIMIT ?`, [B, clamp(limit, 1, 100, 50)]);
        return rows.map((r) => ({ ...r, urgent: !!r.urgent }));
      });
    },
    async notificationHistory(limit = 50) {
      return guard(async () => db.all(
        `SELECT id, lead_id, kind, variant, priority, channel, status, attempts, last_error, simulated, created_at, sent_at
           FROM notifications WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`, [B, clamp(limit, 1, 200, 50)]));
    },
  });
}
