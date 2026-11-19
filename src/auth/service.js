// Account service: registration, email verification, login, sessions, logout,
// password change, password reset. Transport-agnostic (the HTTP layer maps
// results to responses and cookies).
//
// Defenses, each covered by tests:
//   - passwords: PBKDF2 hashes, policy (length/common/email), never logged or returned
//   - sessions: random token, only its hash stored, rotated on login, idle + absolute
//     expiry, revoked on logout / password change / reset
//   - brute force: per-IP and per-email attempt limits (429), also on register/reset
//   - enumeration: register / forgot-password answer identically for known and unknown
//     emails; login errors are generic and cost the same time (dummy hash)
//   - one-time tokens: hashed, expiring, single-use, purpose-bound, newest wins
//   - email delivery is the MOCK mailer: SIMULATED, nothing is sent (KI-31)

import { authRepo } from "./repo.js";
import { randomToken, sha256Hex, hashPassword, verifyPassword, needsRehash, dummyHash, checkPasswordPolicy, PBKDF2_ITERATIONS } from "./crypto.js";
import { createLimiter, hashKey } from "../ratelimit/limiter.js";
import { normalizeEmail, sanitizeText } from "../validation/normalize.js";

const MIN = 60_000, HOUR = 3_600_000;
export const DEFAULTS = { idleMs: 30 * MIN, absoluteMs: 12 * HOUR, verifyTtlMs: 24 * HOUR, resetTtlMs: HOUR, touchEveryMs: MIN };

const iso = (ms) => new Date(ms).toISOString();
const slug = (name) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "business";

export function createAuthService({ db, mailer, store, salt, now = Date.now, iterations = PBKDF2_ITERATIONS, cfg = {} }) {
  if (typeof salt !== "string" || salt.length < 8) throw new Error("auth service needs a salt of at least 8 characters");
  const c = { ...DEFAULTS, ...cfg };
  const repo = authRepo(db);
  const lim = (limit, windowMs) => createLimiter({ store, limit, windowMs, now });
  const limits = {
    loginIp: lim(30, 15 * MIN), loginEmail: lim(10, 15 * MIN),
    registerIp: lim(10, HOUR), forgotIp: lim(10, HOUR), forgotEmail: lim(3, HOUR),
    verifyIp: lim(30, 15 * MIN), resetIp: lim(20, 15 * MIN),
  };
  const throttled = async (pairs) => {
    let worst = null;
    for (const [limiter, kind, value] of pairs) {
      const r = await limiter.check(await hashKey(salt, kind, value));
      if (!r.allowed && (!worst || r.retryAfterSec > worst.retryAfterSec)) worst = r;
    }
    return worst ? { ok: false, code: "rate_limited", retryAfterSec: worst.retryAfterSec } : null;
  };
  const send = async (m) => { try { await mailer.send(m); return true; } catch { return false; } };

  async function openSession(userId) {
    const token = randomToken(32), csrf = randomToken(24), t = now();
    await repo.createSession({ userId, tokenHash: await sha256Hex(token), csrf, now: iso(t), expiresAt: iso(t + c.absoluteMs) });
    return { token, csrf, expiresAt: iso(t + c.absoluteMs) };
  }

  return {
    config: c,

    async register({ email, password, businessName, ip = "unknown" }) {
      const t = await throttled([[limits.registerIp, "register-ip", ip]]);
      if (t) return t;
      const e = normalizeEmail(email);
      if (!e.ok) return { ok: false, code: "invalid_email" };
      const pol = checkPasswordPolicy(password, { email: e.value });
      if (!pol.ok) return { ok: false, code: "weak_password", reason: pol.reason };
      const name = sanitizeText(businessName, { maxLength: 120 });
      if (name.length < 2) return { ok: false, code: "invalid_business_name" };

      const existing = await repo.userByEmail(e.value);
      if (existing) {
        await hashPassword(password, iterations); // keep timing similar
        await send({ channel: "email", to: e.value, template: "already_registered", data: {} });
        return { ok: true }; // identical to a new registration
      }
      const passwordHash = await hashPassword(password, iterations);
      const { id: userId } = await repo.createUser({ email: e.value, passwordHash, now: iso(now()) });
      await repo.createBusinessWithOwner({ userId, id: `${slug(name)}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "x")}`, name, siteKey: `sk_${randomToken(18)}`, now: iso(now()) });
      await this.sendVerification(userId, e.value);
      return { ok: true };
    },

    async sendVerification(userId, email) {
      const token = randomToken(32);
      await repo.issueToken({ userId, purpose: "verify_email", tokenHash: await sha256Hex(token), expiresAt: iso(now() + c.verifyTtlMs), now: iso(now()) });
      await send({ channel: "email", to: email, template: "verify_email", data: { token } });
    },

    async resendVerification({ email, ip = "unknown" }) {
      const t = await throttled([[limits.forgotIp, "resend-ip", ip]]);
      if (t) return t;
      const e = normalizeEmail(email);
      if (e.ok) {
        const u = await repo.userByEmail(e.value);
        if (u && !u.email_verified_at && u.status === "active") await this.sendVerification(u.id, u.email);
      }
      return { ok: true };
    },

    async verifyEmail({ token, ip = "unknown" }) {
      const t = await throttled([[limits.verifyIp, "verify-ip", ip]]);
      if (t) return t;
      if (typeof token !== "string" || token.length < 20 || token.length > 100) return { ok: false, code: "invalid_token" };
      const userId = await repo.consumeToken("verify_email", await sha256Hex(token), iso(now()));
      if (!userId) return { ok: false, code: "invalid_token" };
      await repo.markEmailVerified(userId, iso(now()));
      return { ok: true };
    },

    async login({ email, password, ip = "unknown" }) {
      const e = normalizeEmail(email);
      const emailKey = e.ok ? e.value : `invalid:${String(email).slice(0, 80)}`;
      const t = await throttled([[limits.loginIp, "login-ip", ip], [limits.loginEmail, "login-email", emailKey]]);
      if (t) return t;
      const user = e.ok ? await repo.userByEmail(e.value) : null;
      const good = await verifyPassword(typeof password === "string" ? password : "", user?.password_hash ?? dummyHash(iterations));
      if (!user || !good || user.status !== "active") {
        if (user) await repo.audit(null, user.id, "login_failed", user.id, {});
        return { ok: false, code: "invalid_credentials" };
      }
      if (!user.email_verified_at) return { ok: false, code: "email_not_verified" };
      if (needsRehash(user.password_hash, iterations)) await repo.upgradeHash(user.id, await hashPassword(password, iterations));
      const s = await openSession(user.id);
      await repo.audit(null, user.id, "login_succeeded", user.id, {});
      return { ok: true, token: s.token, csrf: s.csrf, expiresAt: s.expiresAt, user: { id: user.id, email: user.email } };
    },

    /** Resolves a presented session token. Returns null for anything invalid, expired, or revoked. */
    async authenticate(token) {
      if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
      const s = await repo.sessionByTokenHash(await sha256Hex(token));
      if (!s) return null;
      const t = now();
      if (Date.parse(s.expires_at) <= t || t - Date.parse(s.last_seen_at) > c.idleMs || s.status !== "active" || !s.email_verified_at) {
        await repo.deleteSession(s.id);
        return null;
      }
      if (t - Date.parse(s.last_seen_at) > c.touchEveryMs) await repo.touchSession(s.id, iso(t));
      return { sessionId: s.id, userId: s.user_id, email: s.email, csrf: s.csrf_token };
    },

    async logout(sessionId) {
      await repo.deleteSession(sessionId);
    },
    async logoutEverywhere(userId) {
      const n = await repo.deleteSessionsForUser(userId);
      await repo.audit(null, userId, "sessions_revoked_all", userId, { count: n });
      return { ok: true, revoked: n };
    },

    async changePassword({ userId, sessionId, currentPassword, newPassword }) {
      const u = await repo.userById(userId);
      if (!u) return { ok: false, code: "invalid_credentials" };
      if (!(await verifyPassword(typeof currentPassword === "string" ? currentPassword : "", u.password_hash))) return { ok: false, code: "invalid_credentials" };
      const pol = checkPasswordPolicy(newPassword, { email: u.email });
      if (!pol.ok) return { ok: false, code: "weak_password", reason: pol.reason };
      await repo.setPassword(userId, await hashPassword(newPassword, iterations), { now: iso(now()) });
      const revoked = await repo.deleteSessionsForUser(userId, sessionId);
      return { ok: true, revoked };
    },

    async forgotPassword({ email, ip = "unknown" }) {
      const e = normalizeEmail(email);
      const t = await throttled([[limits.forgotIp, "forgot-ip", ip], [limits.forgotEmail, "forgot-email", e.ok ? e.value : "invalid"]]);
      if (t) return t;
      if (e.ok) {
        const u = await repo.userByEmail(e.value);
        if (u && u.status === "active" && u.email_verified_at) {
          const token = randomToken(32);
          await repo.issueToken({ userId: u.id, purpose: "reset_password", tokenHash: await sha256Hex(token), expiresAt: iso(now() + c.resetTtlMs), now: iso(now()) });
          await repo.audit(null, u.id, "password_reset_requested", u.id, {});
          await send({ channel: "email", to: u.email, template: "reset_password", data: { token } });
        }
      }
      return { ok: true }; // identical whether or not the account exists
    },

    async resetPassword({ token, newPassword, ip = "unknown" }) {
      const t = await throttled([[limits.resetIp, "reset-ip", ip]]);
      if (t) return t;
      if (typeof token !== "string" || token.length < 20 || token.length > 100) return { ok: false, code: "invalid_token" };
      const hash = await sha256Hex(token);
      // Check the new password BEFORE consuming the token so a typo does not burn the link.
      const peek = await db.first("SELECT u.email, u.id FROM auth_tokens a JOIN users u ON u.id = a.user_id WHERE a.token_hash = ? AND a.purpose = 'reset_password' AND a.used_at IS NULL AND a.expires_at > ?", [hash, iso(now())]);
      if (!peek) return { ok: false, code: "invalid_token" };
      const pol = checkPasswordPolicy(newPassword, { email: peek.email });
      if (!pol.ok) return { ok: false, code: "weak_password", reason: pol.reason };
      const userId = await repo.consumeToken("reset_password", hash, iso(now()));
      if (!userId) return { ok: false, code: "invalid_token" };
      await repo.setPassword(userId, await hashPassword(newPassword, iterations), { action: "password_reset_completed", now: iso(now()) });
      await repo.deleteSessionsForUser(userId); // every session dies
      return { ok: true };
    },

    async acceptInvitation({ userId, token }) {
      if (typeof token !== "string" || token.length < 20 || token.length > 100) return { ok: false, code: "invalid_token" };
      const inv = await repo.invitationByTokenHash(await sha256Hex(token));
      const u = await repo.userById(userId);
      const t = iso(now());
      // The signed-in, verified account must own the invited email address.
      if (!inv || !u || !u.email_verified_at || inv.email !== u.email || inv.accepted_at || inv.revoked_at || inv.expires_at <= t) return { ok: false, code: "invalid_token" };
      try { await repo.acceptInvitation({ invitationId: inv.id, businessId: inv.business_id, userId, role: inv.role, now: t }); } catch { return { ok: false, code: "invalid_token" }; }
      return { ok: true, businessId: inv.business_id, role: inv.role };
    },

    repo,
  };
}
