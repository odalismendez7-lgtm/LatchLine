// Platform-level account data. Users are not owned by one business, so this is
// NOT tenant-scoped; business data is only reached afterwards through
// forBusiness(db, id) once membership has been checked (src/dashboard/authz.js).

import { DbError } from "../db/errors.js";
import { nowIso, newId, json, guard } from "../db/util.js";

const auditStmt = (businessId, actor, action, target, detail = {}, now = nowIso()) => ({
  sql: "INSERT INTO audit_log (id, business_id, actor, action, target, detail, created_at) VALUES (?,?,?,?,?,?,?)",
  params: [newId("aud"), businessId ?? null, actor, action, target ?? null, json(detail), now],
});

export function authRepo(db) {
  return Object.freeze({
    audit: (businessId, actor, action, target, detail) => guard(() => db.batch([auditStmt(businessId, actor, action, target, detail)])),

    async createUser({ email, passwordHash, now = nowIso() }) {
      return guard(async () => {
        const id = newId("usr");
        await db.batch([
          { sql: "INSERT INTO users (id, email, password_hash, created_at, updated_at, password_changed_at) VALUES (?,?,?,?,?,?)", params: [id, email, passwordHash, now, now, now] },
          auditStmt(null, id, "account_registered", id, {}, now),
        ]);
        return { id };
      });
    },
    async userByEmail(email) { return guard(() => db.first("SELECT * FROM users WHERE email = ?", [email])); },
    async userById(id) { return guard(() => db.first("SELECT * FROM users WHERE id = ?", [id])); },
    async markEmailVerified(userId, now = nowIso()) {
      return guard(async () => { await db.batch([{ sql: "UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?", params: [now, now, userId] }, auditStmt(null, userId, "email_verified", userId, {}, now)]); });
    },
    async setPassword(userId, passwordHash, { action = "password_changed", now = nowIso() } = {}) {
      return guard(async () => {
        const r = await db.batch([
          { sql: "UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?", params: [passwordHash, now, now, userId] },
          auditStmt(null, userId, action, userId, {}, now),
        ]);
        if (r[0].changes !== 1) throw new DbError("not_found", "no such user");
      });
    },
    async upgradeHash(userId, passwordHash) {
      return guard(() => db.run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, userId]));
    },

    // ----- sessions (token itself never stored) -----
    async createSession({ userId, tokenHash, csrf, now, expiresAt }) {
      return guard(async () => {
        const id = newId("ses");
        await db.run("INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?)", [id, userId, tokenHash, csrf, now, now, expiresAt]);
        return { id };
      });
    },
    async sessionByTokenHash(tokenHash) {
      return guard(() => db.first(
        `SELECT s.id, s.user_id, s.csrf_token, s.created_at, s.last_seen_at, s.expires_at, u.email, u.status, u.email_verified_at
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, [tokenHash]));
    },
    async touchSession(id, now) { return guard(() => db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [now, id])); },
    async deleteSession(id) { return guard(() => db.run("DELETE FROM sessions WHERE id = ?", [id])); },
    async deleteSessionsForUser(userId, exceptId = null) {
      return guard(async () => (await db.run("DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?", [userId, exceptId])).changes);
    },
    async purgeExpiredSessions(now) { return guard(() => db.run("DELETE FROM sessions WHERE expires_at <= ?", [now])); },

    // ----- one-time tokens (email verification, password reset) -----
    async issueToken({ userId, purpose, tokenHash, expiresAt, now = nowIso() }) {
      return guard(() => db.batch([
        { sql: "UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL", params: [now, userId, purpose] }, // older unused tokens die
        { sql: "INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)", params: [newId("tok"), userId, purpose, tokenHash, expiresAt, now] },
      ]));
    },
    /** Atomically marks a valid, unused, unexpired token used and returns its user id (or null). */
    async consumeToken(purpose, tokenHash, now) {
      return guard(async () => (await db.first(
        "UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id",
        [now, tokenHash, purpose, now]))?.user_id ?? null);
    },

    // ----- memberships and businesses -----
    async membershipsForUser(userId) {
      return guard(() => db.all(
        `SELECT m.business_id, m.role, b.name FROM memberships m JOIN businesses b ON b.id = m.business_id
          WHERE m.user_id = ? AND b.status = 'active' ORDER BY b.name, m.business_id`, [userId]));
    },
    async roleFor(userId, businessId) {
      return guard(async () => (await db.first(
        "SELECT m.role FROM memberships m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ? AND m.business_id = ? AND b.status = 'active'",
        [userId, businessId]))?.role ?? null);
    },
    async createBusinessWithOwner({ userId, id, name, industry = "plumbing", siteKey, now = nowIso() }) {
      return guard(() => db.batch([
        { sql: "INSERT INTO businesses (id, name, industry, site_key, created_at) VALUES (?,?,?,?,?)", params: [id, name, industry, siteKey, now] },
        { sql: "INSERT INTO memberships (user_id, business_id, role, created_at) VALUES (?,?,?,?)", params: [userId, id, "owner", now] },
        auditStmt(id, userId, "business_created", id, {}, now),
      ]));
    },
    async invitationByTokenHash(tokenHash) {
      return guard(() => db.first("SELECT i.*, b.name AS business_name FROM invitations i JOIN businesses b ON b.id = i.business_id WHERE i.token_hash = ?", [tokenHash]));
    },
    async acceptInvitation({ invitationId, businessId, userId, role, now }) {
      return guard(async () => {
        const r = await db.batch([
          { sql: "UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", params: [now, invitationId, now] },
          { sql: "INSERT OR IGNORE INTO memberships (user_id, business_id, role, created_at) VALUES (?,?,?,?)", params: [userId, businessId, role, now] },
          auditStmt(businessId, userId, "invitation_accepted", invitationId, { role }, now),
        ]);
        if (r[0].changes !== 1) throw new DbError("not_found", "invitation is not open");
      });
    },
  });
}
