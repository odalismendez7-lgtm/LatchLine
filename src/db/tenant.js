// Tenant-scoped data access. Every business-owned row is reached through
// forBusiness(db, id), which returns a frozen handle whose every SQL statement
// binds that business_id. There is deliberately no method that takes a
// business_id from a caller-supplied argument after the handle is made, and no
// "list all leads" method. The database also enforces tenant consistency with
// composite foreign keys (migrations/0001_init.sql). Two layers, both tested.

import { DbError } from "./errors.js";
import { nowIso, newId, json, parse, guard, CONTACT_MISSING } from "./util.js";
import { notificationsRepo } from "./notifications.js";
import { membersRepo } from "./members.js";
import { contactVerifyRepo } from "./contactVerify.js";
import { dashboardRepo } from "./dashboard.js";

// ---------- platform level (not tenant data): resolve a public site key ----------

export function platformRepo(db) {
  return Object.freeze({
    async businessBySiteKey(siteKey) {
      if (typeof siteKey !== "string" || siteKey.length < 8 || siteKey.length > 128) return null;
      return guard(async () => {
        const b = await db.first("SELECT id, name, industry, status FROM businesses WHERE site_key = ?", [siteKey]);
        if (!b) return null;
        const origins = await db.all("SELECT origin FROM business_origins WHERE business_id = ?", [b.id]);
        return { ...b, origins: origins.map((o) => o.origin) };
      });
    },
    async createBusiness({ id, name, industry, siteKey, origins = [] }) {
      return guard(async () => {
        const t = nowIso();
        await db.batch([
          { sql: "INSERT INTO businesses (id, name, industry, site_key, created_at) VALUES (?,?,?,?,?)", params: [id, name, industry, siteKey, t] },
          ...origins.map((o) => ({ sql: "INSERT INTO business_origins (business_id, origin) VALUES (?,?)", params: [id, o] })),
          { sql: "INSERT INTO audit_log (id, business_id, actor, action, target, detail, created_at) VALUES (?,?,?,?,?,?,?)", params: [newId("aud"), id, "system", "business_created", id, "{}", t] },
        ]);
        return { id };
      });
    },
    async isKnownOrigin(origin) {
      if (typeof origin !== "string" || origin.length > 200) return false;
      return guard(async () => !!(await db.first(
        "SELECT 1 AS x FROM business_origins o JOIN businesses b ON b.id = o.business_id WHERE o.origin = ? AND b.status = 'active' LIMIT 1", [origin])));
    },
    async activeBusinessIds(limit = 500) {
      return guard(async () => (await db.all("SELECT id FROM businesses WHERE status = 'active' ORDER BY id LIMIT ?", [Math.min(Math.max(1, limit | 0), 1000)])).map((r) => r.id));
    },
    // Dispatcher entry point: which businesses have notifications ready to send.
    // Returns ids only; all further access goes through forBusiness(db, id).
    async businessesWithDueNotifications(nowIsoString = nowIso(), limit = 50) {
      return guard(async () => (await db.all(
        `SELECT DISTINCT business_id FROM notifications
          WHERE (status = 'queued' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_until < ?) OR status = 'sent'
          LIMIT ?`, [nowIsoString, nowIsoString, Math.min(Math.max(1, limit | 0), 200)])).map((r) => r.business_id));
    },
    async ping() { return guard(() => db.ping()); },
  });
}

// ---------- tenant level ----------

const shapeLead = (r) => ({ ...r, emergency: !!r.emergency, emergency_categories: parse(r.emergency_categories, []), contact_missing: !r.phone && !r.email });

export function forBusiness(db, businessId) {
  if (typeof businessId !== "string" || businessId.length < 2) throw new DbError("unknown_business", "forBusiness needs a business id");
  const B = businessId;

  const audit = (action, target, detail = {}) => ({
    sql: "INSERT INTO audit_log (id, business_id, actor, action, target, detail, created_at) VALUES (?,?,?,?,?,?,?)",
    params: [newId("aud"), B, "system", action, target ?? null, json(detail), nowIso()],
  });

  const conversations = {
    async create() {
      return guard(async () => {
        const id = newId("cnv"), t = nowIso();
        await db.run("INSERT INTO conversations (id, business_id, created_at, updated_at) VALUES (?,?,?,?)", [id, B, t, t]);
        return { id, status: "open", state: {}, urgent: false, leadId: null, messageCount: 0 };
      });
    },
    async get(id) {
      return guard(async () => {
        const r = await db.first("SELECT * FROM conversations WHERE id = ? AND business_id = ?", [id, B]);
        return r && { id: r.id, status: r.status, state: parse(r.state, {}), urgent: !!r.urgent, leadId: r.lead_id, messageCount: r.message_count };
      });
    },
    async save(id, { state, status, urgent }) {
      return guard(async () => {
        const r = await db.run(
          "UPDATE conversations SET state = ?, status = ?, urgent = ?, updated_at = ? WHERE id = ? AND business_id = ?",
          [json(state), status, urgent ? 1 : 0, nowIso(), id, B]);
        if (r.changes !== 1) throw new DbError("not_found", "conversation not found for this business");
      });
    },
    async addMessage(conversationId, { role, content, meta }) {
      return guard(async () => {
        const id = newId("msg"), t = nowIso();
        await db.batch([
          { sql: "INSERT INTO messages (id, business_id, conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?,?)", params: [id, B, conversationId, role, String(content).slice(0, 4000), json(meta), t] },
          { sql: "UPDATE conversations SET message_count = message_count + 1, updated_at = ? WHERE id = ? AND business_id = ?", params: [t, conversationId, B] },
        ]);
        return { id };
      });
    },
    async messages(conversationId, limit = 50) {
      return guard(async () => db.all(
        "SELECT id, role, content, created_at FROM messages WHERE business_id = ? AND conversation_id = ? ORDER BY created_at, rowid LIMIT ?",
        [B, conversationId, Math.min(Math.max(1, limit | 0), 200)]));
    },
  };

  const leads = {
    // Look for a recent lead from the same person (same normalized phone OR email).
    async findDuplicate({ phone, email, withinDays = 30 }) {
      if (!phone && !email) return null;
      return guard(async () => {
        const since = new Date(Date.now() - withinDays * 86400000).toISOString();
        const clauses = [], params = [B, since];
        if (phone) { clauses.push("phone = ?"); params.push(phone); }
        if (email) { clauses.push("email = ?"); params.push(email); }
        const r = await db.first(
          `SELECT id, conversation_id, created_at FROM leads WHERE business_id = ? AND created_at >= ? AND (${clauses.join(" OR ")}) ORDER BY created_at DESC LIMIT 1`, params);
        return r ? { id: r.id, conversationId: r.conversation_id } : null;
      });
    },

    // Insert + link + event + audit in ONE transaction, then READ THE ROW BACK.
    // Only a successful readback that matches returns { saved: true }.
    async create(conversationId, lead) {
      return guard(async () => {
        const id = newId("led"), t = nowIso();
        await db.batch([
          {
            sql: `INSERT INTO leads (id, business_id, conversation_id, name, phone, email, zip, issue_category, issue_text, urgency,
                  preferred_contact, preferred_time, emergency, emergency_categories, zip_in_verified_area, summary, created_at, updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            params: [id, B, conversationId, lead.name ?? null, lead.phone ?? null, lead.email ?? null, lead.zip ?? null,
              lead.issueCategory ?? null, lead.issueText ?? null, lead.urgency ?? null, lead.preferredContact ?? null,
              lead.preferredTime ?? null, lead.emergency ? 1 : 0, json(lead.emergencyCategories ?? []),
              lead.zipInVerifiedArea ? "yes" : "unconfirmed", lead.summary ?? "", t, t],
          },
          { sql: "UPDATE conversations SET lead_id = ?, updated_at = ? WHERE id = ? AND business_id = ?", params: [id, t, conversationId, B] },
          { sql: "INSERT INTO lead_events (id, business_id, lead_id, type, detail, created_at) VALUES (?,?,?,?,?,?)", params: [newId("evt"), B, id, "created", "{}", t] },
          audit("lead_created", id, { fields: Object.keys(lead) }),
        ]);
        const back = await db.first("SELECT id, phone, email, name FROM leads WHERE id = ? AND business_id = ?", [id, B]);
        if (!back || back.id !== id || (lead.phone ?? null) !== back.phone || (lead.email ?? null) !== back.email) {
          throw new DbError("not_persisted", "lead readback did not match what was written");
        }
        return { saved: true, id };
      });
    },

    async mergeDuplicate(existingLeadId, conversationId, { note } = {}) {
      return guard(async () => {
        const t = nowIso();
        const res = await db.batch([
          { sql: "UPDATE leads SET duplicate_count = duplicate_count + 1, updated_at = ? WHERE id = ? AND business_id = ?", params: [t, existingLeadId, B] },
          { sql: "INSERT INTO lead_events (id, business_id, lead_id, type, detail, created_at) VALUES (?,?,?,?,?,?)", params: [newId("evt"), B, existingLeadId, "merged_duplicate", json({ conversationId, note: note ?? null }), t] },
          audit("lead_duplicate_merged", existingLeadId, { conversationId }),
        ]);
        if (res[0].changes !== 1) throw new DbError("not_found", "existing lead not found for this business");
        return { merged: true, id: existingLeadId };
      });
    },

    async get(id) {
      return guard(async () => {
        const r = await db.first("SELECT * FROM leads WHERE id = ? AND business_id = ?", [id, B]);
        return r && shapeLead(r);
      });
    },
    // The one lead of a conversation (UNIQUE(business_id, conversation_id) guarantees at most one).
    async getByConversation(conversationId) {
      return guard(async () => {
        const r = await db.first("SELECT * FROM leads WHERE business_id = ? AND conversation_id = ?", [B, conversationId]);
        return r && shapeLead(r);
      });
    },
    /**
     * Safely change a lead the engine already saved (an incomplete emergency lead that gets completed, or an
     * emergency reported on a lead that already existed). Rules:
     *  - tenant scoped; unknown/other-business lead => not_found, nothing written;
     *  - only the listed customer-detail fields can change; status/duplicate_count/ids/created_at never;
     *  - a field is written only when it differs; no change => no write, no event;
     *  - the problem text is never blanked; emergency can only be turned ON, categories are only added;
     *  - one transaction (update + lead_event + audit), then a read-back; mismatch => not_persisted.
     * Returns { changed: [...fields], contactAdded, emergencyAdded }.
     */
    async update(id, patch = {}) {
      return guard(async () => {
        const cur = await db.first("SELECT * FROM leads WHERE id = ? AND business_id = ?", [id, B]);
        if (!cur) throw new DbError("not_found", "lead not found for this business");
        const sets = [], params = [], changed = [];
        const setCol = (col, val) => { if (val !== cur[col]) { sets.push(`${col} = ?`); params.push(val); changed.push(col); } };
        for (const col of ["name", "phone", "email", "zip", "urgency"]) if (col in patch) setCol(col, patch[col] ?? null);
        if (typeof patch.issueText === "string" && patch.issueText.trim()) setCol("issue_text", patch.issueText);
        if (typeof patch.summary === "string") setCol("summary", patch.summary);
        if ("zipInVerifiedArea" in patch) setCol("zip_in_verified_area", patch.zipInVerifiedArea ? "yes" : "unconfirmed");
        if (patch.emergency) setCol("emergency", 1);
        if (Array.isArray(patch.emergencyCategories) && patch.emergencyCategories.length) {
          const before = parse(cur.emergency_categories, []);
          const merged = [...new Set([...before, ...patch.emergencyCategories])];
          if (merged.length !== before.length) { sets.push("emergency_categories = ?"); params.push(json(merged)); changed.push("emergency_categories"); }
        }
        const had = !!(cur.phone || cur.email);
        const willPhone = "phone" in patch ? patch.phone ?? null : cur.phone, willEmail = "email" in patch ? patch.email ?? null : cur.email;
        const result = { changed, contactAdded: !had && !!(willPhone || willEmail), emergencyAdded: !!patch.emergency && !cur.emergency };
        if (!changed.length) return result;
        const t = nowIso();
        await db.batch([
          { sql: `UPDATE leads SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND business_id = ?`, params: [...params, t, id, B] },
          { sql: "INSERT INTO lead_events (id, business_id, lead_id, type, detail, created_at) VALUES (?,?,?,?,?,?)", params: [newId("evt"), B, id, "updated", json({ fields: changed }), t] },
          audit("lead_updated", id, { fields: changed }),
        ]);
        const back = await db.first("SELECT phone, email, emergency FROM leads WHERE id = ? AND business_id = ?", [id, B]);
        if (!back || back.phone !== willPhone || back.email !== willEmail) throw new DbError("not_persisted", "lead readback did not match what was written");
        return result;
      });
    },
    async list({ limit = 50 } = {}) {
      return guard(async () => (await db.all(
        `SELECT id, name, phone, email, zip, issue_category, urgency, emergency, status, duplicate_count, created_at, ${CONTACT_MISSING} FROM leads WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        [B, Math.min(Math.max(1, limit | 0), 200)])).map((r) => ({ ...r, contact_missing: !!r.contact_missing })));
    },
    async count() {
      return guard(async () => (await db.first("SELECT COUNT(*) AS n FROM leads WHERE business_id = ?", [B])).n);
    },
  };

  const knowledge = {
    async get() {
      return guard(async () => {
        const r = await db.first("SELECT document, version FROM knowledge_bases WHERE business_id = ?", [B]);
        return r && { document: parse(r.document, null), version: r.version };
      });
    },
    async set(document) {
      return guard(async () => {
        const t = nowIso();
        await db.batch([
          { sql: `INSERT INTO knowledge_bases (business_id, document, version, updated_at) VALUES (?,?,1,?)
                  ON CONFLICT(business_id) DO UPDATE SET document = excluded.document, version = version + 1, updated_at = excluded.updated_at`, params: [B, json(document), t] },
          audit("knowledge_updated", B),
        ]);
      });
    },
  };

  const profile = async () => guard(async () => {
    const r = await db.first("SELECT id, name, industry FROM businesses WHERE id = ?", [B]);
    return r ?? null;
  });

  return Object.freeze({ businessId: B, profile, conversations: Object.freeze(conversations), leads: Object.freeze(leads), knowledge: Object.freeze(knowledge), notifications: notificationsRepo(db, B, leads), members: membersRepo(db, B), contactVerify: contactVerifyRepo(db, B), dashboard: dashboardRepo(db, B) });
}
