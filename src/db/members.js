// Business-scoped team data (memberships and invitations). Only reachable through
// forBusiness(db, id).members, after the caller has been authorized for that business.

import { DbError } from "./errors.js";
import { nowIso, newId, json, guard } from "./util.js";
import { ROLES } from "../auth/permissions.js";

export function membersRepo(db, B) {
  const audit = (actor, action, target, detail = {}) => ({
    sql: "INSERT INTO audit_log (id, business_id, actor, action, target, detail, created_at) VALUES (?,?,?,?,?,?,?)",
    params: [newId("aud"), B, actor, action, target ?? null, json(detail), nowIso()],
  });
  const ownerCount = async () => (await db.first("SELECT COUNT(*) n FROM memberships WHERE business_id = ? AND role = 'owner'", [B])).n;

  return Object.freeze({
    async list() {
      return guard(() => db.all(
        `SELECT m.user_id, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.business_id = ? ORDER BY m.created_at, m.rowid`, [B]));
    },
    async roleOf(userId) {
      return guard(async () => (await db.first("SELECT role FROM memberships WHERE user_id = ? AND business_id = ?", [userId, B]))?.role ?? null);
    },
    async setRole(actorId, userId, role) {
      if (!ROLES.includes(role)) throw new DbError("invalid_data", "unknown role");
      return guard(async () => {
        const cur = await db.first("SELECT role FROM memberships WHERE user_id = ? AND business_id = ?", [userId, B]);
        if (!cur) throw new DbError("not_found", "no such member in this business");
        if (cur.role === "owner" && role !== "owner" && (await ownerCount()) <= 1) throw new DbError("invalid_data", "cannot demote the last owner");
        await db.batch([
          { sql: "UPDATE memberships SET role = ? WHERE user_id = ? AND business_id = ?", params: [role, userId, B] },
          audit(actorId, "member_role_changed", userId, { from: cur.role, to: role }),
        ]);
      });
    },
    async remove(actorId, userId) {
      return guard(async () => {
        const cur = await db.first("SELECT role FROM memberships WHERE user_id = ? AND business_id = ?", [userId, B]);
        if (!cur) throw new DbError("not_found", "no such member in this business");
        if (cur.role === "owner" && (await ownerCount()) <= 1) throw new DbError("invalid_data", "cannot remove the last owner");
        await db.batch([
          { sql: "DELETE FROM memberships WHERE user_id = ? AND business_id = ?", params: [userId, B] },
          audit(actorId, "member_removed", userId),
        ]);
      });
    },

    async createInvitation({ actorId, email, role, tokenHash, expiresAt, now = nowIso() }) {
      if (!["manager", "staff", "viewer"].includes(role)) throw new DbError("invalid_data", "invitations cannot grant that role");
      return guard(async () => {
        const id = newId("inv");
        await db.batch([
          { sql: "UPDATE invitations SET revoked_at = ? WHERE business_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL", params: [now, B, email] },
          { sql: "INSERT INTO invitations (id, business_id, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)", params: [id, B, email, role, tokenHash, actorId, expiresAt, now] },
          audit(actorId, "member_invited", id, { role }),
        ]);
        return { id };
      });
    },
    async listInvitations() {
      return guard(() => db.all("SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at FROM invitations WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100", [B]));
    },
    async revokeInvitation(actorId, id, now = nowIso()) {
      return guard(async () => {
        const r = await db.batch([
          { sql: "UPDATE invitations SET revoked_at = ? WHERE id = ? AND business_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", params: [now, id, B] },
          audit(actorId, "invitation_revoked", id),
        ]);
        if (r[0].changes !== 1) throw new DbError("not_found", "no open invitation");
      });
    },
    async audit(limit = 100) {
      return guard(() => db.all("SELECT id, actor, action, target, detail, created_at FROM audit_log WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?", [B, Math.min(Math.max(1, limit | 0), 500)]));
    },
    async record(actorId, action, target, detail) {
      return guard(() => db.batch([audit(actorId, action, target, detail)]));
    },
  });
}
