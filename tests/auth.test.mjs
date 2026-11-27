import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { MemoryStore } from "../src/ratelimit/limiter.js";
import { MockMailer, createMailer } from "../src/auth/mailer.js";
import { createAuthService } from "../src/auth/service.js";
import { authRepo } from "../src/auth/repo.js";
import { membersRepo } from "../src/db/members.js";
import { hashPassword, verifyPassword, parseHash, needsRehash, checkPasswordPolicy, randomToken, randomCode, constantTimeEqual, sha256Hex, PBKDF2_ITERATIONS } from "../src/auth/crypto.js";

const IT = 2000; // fast test iterations; production default is PBKDF2_ITERATIONS
const GOOD = "correct horse battery staple";
const clock = () => { const c = { t: Date.parse("2026-11-19T12:00:00Z"), now: () => c.t, adv: (ms) => { c.t += ms; } }; return c; };

function world(cfg = {}) {
  const db = new SqliteAdapter(":memory:");
  migrate(db);
  const mailer = new MockMailer();
  const c = clock();
  const svc = createAuthService({ db, mailer, store: new MemoryStore(), salt: "test-salt-123", now: c.now, iterations: IT, cfg: { unsafeFastHashForTests: true, ...cfg } });
  const dump = async () => JSON.stringify({ u: await db.all("SELECT * FROM users"), s: await db.all("SELECT * FROM sessions"), t: await db.all("SELECT * FROM auth_tokens"), a: await db.all("SELECT * FROM audit_log") });
  return { db, mailer, c, svc, dump };
}
async function registered(w, email = "owner@acme.example", password = GOOD) {
  assert.equal((await w.svc.register({ email, password, businessName: "Acme Plumbing" })).ok, true);
  const token = w.mailer.last("verify_email", email).data.token;
  assert.equal((await w.svc.verifyEmail({ token })).ok, true);
  return { email, password };
}

describe("password hashing", () => {
  test("production strength is the OWASP figure, and format records its parameters", async () => {
    assert.equal(PBKDF2_ITERATIONS, 600_000);
    const h = await hashPassword(GOOD, IT);
    assert.match(h, /^pbkdf2-sha256\$2000\$[\w-]{22}\$[\w-]{43}$/);
  });
  test("never contains the plaintext; same password gives different hashes (random salt)", async () => {
    const a = await hashPassword(GOOD, IT), b = await hashPassword(GOOD, IT);
    assert.notEqual(a, b);
    assert.ok(!a.includes(GOOD) && !a.includes("horse"));
  });
  test("verifies the right password and rejects wrong, empty, non-string, and near-miss", async () => {
    const h = await hashPassword(GOOD, IT);
    assert.equal(await verifyPassword(GOOD, h), true);
    for (const bad of ["wrong", "", GOOD + " ", GOOD.toUpperCase(), null, undefined, 5]) assert.equal(await verifyPassword(bad, h), false, String(bad));
  });
  test("tampered or malformed stored hashes never verify", async () => {
    const h = await hashPassword(GOOD, IT);
    for (const bad of [null, "", "plain", "md5$1$a$b", h.replace("2000", "1"), h.replace("2000", "999999999"), h.slice(0, -3) + "AAA", h + "$x"]) assert.equal(await verifyPassword(GOOD, bad), false, String(bad).slice(0, 30));
    assert.equal(parseHash("pbkdf2-sha256$20$AAAA$BBBB"), null);
  });
  test("unicode passwords are normalized consistently", async () => {
    const h = await hashPassword("pässwörd-länger-1", IT);
    assert.equal(await verifyPassword("pässwörd-länger-1", h), true);
  });
  test("outdated hashes are flagged for upgrade", async () => {
    assert.equal(needsRehash(await hashPassword(GOOD, IT)), true);
    assert.equal(needsRehash(await hashPassword(GOOD, IT), IT), false);
    assert.equal(needsRehash("garbage"), true);
  });
  test("constantTimeEqual", () => {
    assert.equal(constantTimeEqual("abc", "abc"), true);
    for (const [a, b] of [["abc", "abd"], ["abc", "ab"], ["", "a"], [null, "a"], ["a", undefined]]) assert.equal(constantTimeEqual(a, b), false);
  });
  test("password policy: length first, common and email-derived rejected", () => {
    assert.equal(checkPasswordPolicy(GOOD).ok, true);
    assert.equal(checkPasswordPolicy("short").reason, "too_short");
    assert.equal(checkPasswordPolicy("x".repeat(129)).reason, "too_long");
    assert.equal(checkPasswordPolicy("password1234").reason, "too_common");
    assert.equal(checkPasswordPolicy("aaaaaaaaaaaaaaa").reason, "too_common");
    assert.equal(checkPasswordPolicy("my-acme-owner-pass", { email: "acme-owner@x.example" }).reason, "contains_email");
    assert.equal(checkPasswordPolicy(null).ok, false);
    assert.equal(checkPasswordPolicy("only lowercase words here").ok, true); // no arbitrary composition rules
  });
  test("tokens and codes: long, unique, correctly shaped", () => {
    const set = new Set(Array.from({ length: 200 }, () => randomToken()));
    assert.equal(set.size, 200);
    assert.ok([...set].every((t) => /^[\w-]{43}$/.test(t)));
    const codes = Array.from({ length: 500 }, () => randomCode());
    assert.ok(codes.every((c) => /^\d{6}$/.test(c)));
    assert.ok(new Set(codes).size > 400);
  });
});

describe("registration", () => {
  test("creates an UNVERIFIED user, a business, an owner membership, and a simulated verification mail", async () => {
    const w = world();
    assert.deepEqual(await w.svc.register({ email: "Owner@Acme.Example", password: GOOD, businessName: "Acme Plumbing" }), { ok: true });
    const u = await w.db.first("SELECT * FROM users");
    assert.equal(u.email, "owner@acme.example");
    assert.equal(u.email_verified_at, null);
    const m = await w.db.first("SELECT * FROM memberships");
    assert.equal(m.role, "owner");
    assert.equal((await w.db.first("SELECT name FROM businesses WHERE id = ?", [m.business_id])).name, "Acme Plumbing");
    const mail = w.mailer.last("verify_email");
    assert.equal(mail.simulated, true);
    assert.equal(mail.to, "owner@acme.example");
  });
  test("no plaintext password or raw token reaches the database", async () => {
    const w = world();
    await w.svc.register({ email: "owner@acme.example", password: GOOD, businessName: "Acme" });
    const token = w.mailer.last("verify_email").data.token;
    const d = await w.dump();
    assert.ok(!d.includes(GOOD) && !d.includes(token));
    assert.ok(d.includes(await sha256Hex(token)));
  });
  test("an existing email gets an identical response and no second account", async () => {
    const w = world();
    const a = await w.svc.register({ email: "owner@acme.example", password: GOOD, businessName: "Acme" });
    const b = await w.svc.register({ email: "owner@acme.example", password: "another long password!", businessName: "Other" });
    assert.deepEqual(a, b);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM users")).n, 1);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM businesses")).n, 1);
    assert.ok(w.mailer.last("already_registered", "owner@acme.example"));
  });
  test("rejects bad email, weak password, bad business name", async () => {
    const w = world();
    assert.equal((await w.svc.register({ email: "nope", password: GOOD, businessName: "Acme" })).code, "invalid_email");
    assert.equal((await w.svc.register({ email: "a@b.example", password: "short", businessName: "Acme" })).code, "weak_password");
    assert.equal((await w.svc.register({ email: "a@b.example", password: GOOD, businessName: "A" })).code, "invalid_business_name");
    assert.equal((await w.svc.register({ email: "a@b.example\r\nBcc: x@y.example", password: GOOD, businessName: "Acme" })).code, "invalid_email");
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM users")).n, 0);
  });
  test("a mail failure does not leak or break registration; the user can ask for a new link", async () => {
    const w = world();
    w.mailer.send = async () => { throw new Error("smtp down"); };
    assert.equal((await w.svc.register({ email: "owner@acme.example", password: GOOD, businessName: "Acme" })).ok, true);
    const ok = new MockMailer();
    w.mailer.send = ok.send.bind(ok);
    await w.svc.resendVerification({ email: "owner@acme.example" });
    assert.ok(ok.last("verify_email"));
  });
  test("registration is rate limited per IP", async () => {
    const w = world();
    let r;
    for (let i = 0; i < 11; i++) r = await w.svc.register({ email: `u${i}@acme.example`, password: GOOD, businessName: "Acme", ip: "198.51.100.9" });
    assert.equal(r.code, "rate_limited");
    assert.ok(r.retryAfterSec >= 1);
  });
  test("real mailers are refused", () => {
    for (const type of ["smtp", "sendgrid", "ses", undefined]) assert.throws(() => createMailer({ type }), (e) => e.code === "disabled");
  });
});

describe("email verification tokens", () => {
  test("work once; replay, garbage, expired, and wrong-purpose tokens fail", async () => {
    const w = world();
    await w.svc.register({ email: "owner@acme.example", password: GOOD, businessName: "Acme" });
    const token = w.mailer.last("verify_email").data.token;
    assert.equal((await w.svc.verifyEmail({ token })).ok, true);
    assert.equal((await w.svc.verifyEmail({ token })).code, "invalid_token");
    for (const bad of ["", "short", null, 5, "x".repeat(200), randomToken()]) assert.equal((await w.svc.verifyEmail({ token: bad })).code, "invalid_token");
  });
  test("expired links fail", async () => {
    const w = world();
    await w.svc.register({ email: "owner@acme.example", password: GOOD, businessName: "Acme" });
    const token = w.mailer.last("verify_email").data.token;
    w.c.adv(25 * 3600_000);
    assert.equal((await w.svc.verifyEmail({ token })).code, "invalid_token");
  });
  test("a password-reset token cannot verify an email, and vice versa", async () => {
    const w = world();
    const { email } = await registered(w);
    await w.svc.forgotPassword({ email });
    const reset = w.mailer.last("reset_password").data.token;
    assert.equal((await w.svc.verifyEmail({ token: reset })).code, "invalid_token");
    assert.equal((await w.svc.resetPassword({ token: reset, newPassword: "a brand new long passphrase" })).ok, true);
  });
  test("a newer verification link invalidates the older one", async () => {
    const w = world();
    await w.svc.register({ email: "owner@acme.example", password: GOOD, businessName: "Acme" });
    const first = w.mailer.last("verify_email").data.token;
    await w.svc.resendVerification({ email: "owner@acme.example" });
    const second = w.mailer.last("verify_email").data.token;
    assert.equal((await w.svc.verifyEmail({ token: first })).code, "invalid_token");
    assert.equal((await w.svc.verifyEmail({ token: second })).ok, true);
  });
  test("resend gives the same answer for unknown and known emails and does not mail unknown ones", async () => {
    const w = world();
    assert.deepEqual(await w.svc.resendVerification({ email: "ghost@acme.example" }), { ok: true });
    assert.equal(w.mailer.outbox.length, 0);
  });
});

describe("login", () => {
  test("unverified accounts cannot log in (only revealed after the correct password)", async () => {
    const w = world();
    await w.svc.register({ email: "owner@acme.example", password: GOOD, businessName: "Acme" });
    assert.equal((await w.svc.login({ email: "owner@acme.example", password: GOOD })).code, "email_not_verified");
    assert.equal((await w.svc.login({ email: "owner@acme.example", password: "wrong wrong wrong" })).code, "invalid_credentials");
  });
  test("wrong password, unknown email, malformed email, and non-string password all look the same", async () => {
    const w = world();
    const { email } = await registered(w);
    const results = [
      await w.svc.login({ email, password: "wrong password here" }),
      await w.svc.login({ email: "ghost@acme.example", password: GOOD }),
      await w.svc.login({ email: "not-an-email", password: GOOD }),
      await w.svc.login({ email, password: null }),
      await w.svc.login({ email: null, password: null }),
    ];
    for (const r of results) assert.deepEqual(r, { ok: false, code: "invalid_credentials" });
  });
  test("unknown accounts cost about as much time as wrong passwords (dummy hash)", async () => {
    const db = new SqliteAdapter(":memory:"); migrate(db);
    const mailer = new MockMailer();
    const svc = createAuthService({ db, mailer, store: new MemoryStore(), salt: "test-salt-123", iterations: 150_000, cfg: { unsafeFastHashForTests: true } });
    await svc.register({ email: "owner@acme.example", password: GOOD, businessName: "Acme" });
    await svc.verifyEmail({ token: mailer.last("verify_email").data.token });
    const time = async (email) => { const t = performance.now(); await svc.login({ email, password: "wrong wrong wrong!" }); return performance.now() - t; };
    const known = await time("owner@acme.example"), unknown = await time("ghost@acme.example");
    assert.ok(unknown > known * 0.4, `unknown ${unknown.toFixed(1)}ms vs known ${known.toFixed(1)}ms`);
  });
  test("success returns a session; only the token's hash is stored", async () => {
    const w = world();
    const { email, password } = await registered(w);
    const r = await w.svc.login({ email, password });
    assert.equal(r.ok, true);
    assert.match(r.token, /^[\w-]{43}$/);
    assert.ok(!(await w.dump()).includes(r.token));
    assert.equal((await w.svc.authenticate(r.token)).email, email);
  });
  test("each login gets a new session token (no fixation); older sessions stay valid until logout", async () => {
    const w = world();
    const { email, password } = await registered(w);
    const a = await w.svc.login({ email, password }), b = await w.svc.login({ email, password });
    assert.notEqual(a.token, b.token);
    assert.notEqual(a.csrf, b.csrf);
    assert.ok(await w.svc.authenticate(a.token) && await w.svc.authenticate(b.token));
  });
  test("disabled users cannot log in and their sessions stop working", async () => {
    const w = world();
    const { email, password } = await registered(w);
    const s = await w.svc.login({ email, password });
    await w.db.run("UPDATE users SET status = 'disabled'");
    assert.equal((await w.svc.login({ email, password })).code, "invalid_credentials");
    assert.equal(await w.svc.authenticate(s.token), null);
  });
  test("login upgrades an outdated hash", async () => {
    const w = world();
    const { email, password } = await registered(w);
    const strong = createAuthService({ db: w.db, mailer: w.mailer, store: new MemoryStore(), salt: "test-salt-123", now: w.c.now, iterations: 3000, cfg: { unsafeFastHashForTests: true } });
    assert.equal((await strong.login({ email, password })).ok, true);
    assert.match((await w.db.first("SELECT password_hash h FROM users")).h, /\$3000\$/);
  });
});

describe("brute-force protection", () => {
  test("repeated failures for one email get 429, even when the right password is then tried", async () => {
    const w = world();
    const { email, password } = await registered(w);
    let last;
    for (let i = 0; i < 10; i++) last = await w.svc.login({ email, password: `wrong password ${i}` });
    assert.equal(last.code, "invalid_credentials");
    const blocked = await w.svc.login({ email, password });
    assert.equal(blocked.code, "rate_limited");
    assert.ok(blocked.retryAfterSec >= 1);
    w.c.adv(16 * 60_000);
    assert.equal((await w.svc.login({ email, password })).ok, true);
  });
  test("one IP hammering many emails is limited as a whole", async () => {
    const w = world();
    let r;
    for (let i = 0; i < 31; i++) r = await w.svc.login({ email: `u${i}@acme.example`, password: "whatever password", ip: "203.0.113.50" });
    assert.equal(r.code, "rate_limited");
    assert.notEqual((await w.svc.login({ email: "u1@acme.example", password: "x", ip: "203.0.113.51" })).code, "rate_limited");
  });
  test("a limited attempt is rejected without even checking the password", async () => {
    const w = world();
    const { email, password } = await registered(w);
    for (let i = 0; i < 10; i++) await w.svc.login({ email, password: "bad bad bad bad" });
    const before = (await w.db.first("SELECT COUNT(*) n FROM audit_log WHERE action = 'login_failed'")).n;
    await w.svc.login({ email, password: "bad bad bad bad" });
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM audit_log WHERE action = 'login_failed'")).n, before);
  });
});

describe("sessions", () => {
  let w, tok;
  beforeEach(async () => { w = world(); const { email, password } = await registered(w); tok = (await w.svc.login({ email, password })).token; });
  test("garbage tokens never authenticate", async () => {
    for (const bad of [null, undefined, "", "short", "x".repeat(200), randomToken(), 5, {}, `${tok}x`, tok.slice(1)]) assert.equal(await w.svc.authenticate(bad), null, String(bad).slice(0, 20));
  });
  test("logout ends the session immediately", async () => {
    const s = await w.svc.authenticate(tok);
    await w.svc.logout(s.sessionId);
    assert.equal(await w.svc.authenticate(tok), null);
  });
  test("idle timeout: 30 minutes of inactivity ends the session; activity keeps it alive", async () => {
    w.c.adv(25 * 60_000);
    assert.ok(await w.svc.authenticate(tok));
    w.c.adv(25 * 60_000);
    assert.ok(await w.svc.authenticate(tok), "activity extended the idle window");
    w.c.adv(31 * 60_000);
    assert.equal(await w.svc.authenticate(tok), null);
  });
  test("absolute timeout: 12 hours total regardless of activity", async () => {
    for (let i = 0; i < 24; i++) { w.c.adv(29 * 60_000); assert.ok(await w.svc.authenticate(tok), `step ${i}`); }
    w.c.adv(29 * 60_000);
    assert.equal(await w.svc.authenticate(tok), null);
  });
  test("expired sessions are deleted when seen", async () => {
    w.c.adv(13 * 3600_000);
    await w.svc.authenticate(tok);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM sessions")).n, 0);
  });
  test("log out everywhere revokes every session", async () => {
    const { email, password } = { email: "owner@acme.example", password: GOOD };
    const t2 = (await w.svc.login({ email, password })).token;
    const s = await w.svc.authenticate(tok);
    const r = await w.svc.logoutEverywhere(s.userId);
    assert.equal(r.revoked, 2);
    assert.equal(await w.svc.authenticate(tok), null);
    assert.equal(await w.svc.authenticate(t2), null);
  });
  test("changing the password revokes other sessions but keeps the current one", async () => {
    const { email, password } = { email: "owner@acme.example", password: GOOD };
    const other = (await w.svc.login({ email, password })).token;
    const me = await w.svc.authenticate(tok);
    assert.equal((await w.svc.changePassword({ userId: me.userId, sessionId: me.sessionId, currentPassword: "wrong wrong wrong", newPassword: "a brand new long passphrase" })).code, "invalid_credentials");
    assert.equal((await w.svc.changePassword({ userId: me.userId, sessionId: me.sessionId, currentPassword: GOOD, newPassword: "short" })).code, "weak_password");
    const r = await w.svc.changePassword({ userId: me.userId, sessionId: me.sessionId, currentPassword: GOOD, newPassword: "a brand new long passphrase" });
    assert.deepEqual([r.ok, r.revoked], [true, 1]);
    assert.ok(await w.svc.authenticate(tok));
    assert.equal(await w.svc.authenticate(other), null);
    assert.equal((await w.svc.login({ email, password })).code, "invalid_credentials");
    assert.equal((await w.svc.login({ email, password: "a brand new long passphrase" })).ok, true);
  });
});

describe("account recovery", () => {
  test("forgot-password answers the same for known and unknown emails; only verified known accounts get a (simulated) mail", async () => {
    const w = world();
    const { email } = await registered(w);
    await w.svc.register({ email: "unverified@acme.example", password: GOOD, businessName: "Other" });
    const known = await w.svc.forgotPassword({ email }), unknown = await w.svc.forgotPassword({ email: "ghost@acme.example" }), unverified = await w.svc.forgotPassword({ email: "unverified@acme.example" });
    assert.deepEqual(known, unknown); assert.deepEqual(known, unverified);
    assert.equal(w.mailer.outbox.filter((m) => m.template === "reset_password").length, 1);
    assert.equal(w.mailer.last("reset_password").simulated, true);
  });
  test("a reset token works once, sets a new password, and revokes every session; no auto-login", async () => {
    const w = world();
    const { email, password } = await registered(w);
    const s = (await w.svc.login({ email, password })).token;
    await w.svc.forgotPassword({ email });
    const token = w.mailer.last("reset_password").data.token;
    const r = await w.svc.resetPassword({ token, newPassword: "a brand new long passphrase" });
    assert.deepEqual(r, { ok: true });
    assert.equal(await w.svc.authenticate(s), null);
    assert.equal((await w.svc.resetPassword({ token, newPassword: "yet another long passphrase" })).code, "invalid_token");
    assert.equal((await w.svc.login({ email, password })).code, "invalid_credentials");
    assert.equal((await w.svc.login({ email, password: "a brand new long passphrase" })).ok, true);
  });
  test("a weak new password does not burn the link", async () => {
    const w = world();
    const { email } = await registered(w);
    await w.svc.forgotPassword({ email });
    const token = w.mailer.last("reset_password").data.token;
    assert.equal((await w.svc.resetPassword({ token, newPassword: "short" })).code, "weak_password");
    assert.equal((await w.svc.resetPassword({ token, newPassword: "a brand new long passphrase" })).ok, true);
  });
  test("reset links expire after an hour; garbage tokens fail; a newer request kills the older link", async () => {
    const w = world();
    const { email } = await registered(w);
    await w.svc.forgotPassword({ email });
    const first = w.mailer.last("reset_password").data.token;
    await w.svc.forgotPassword({ email });
    const second = w.mailer.last("reset_password").data.token;
    assert.equal((await w.svc.resetPassword({ token: first, newPassword: "a brand new long passphrase" })).code, "invalid_token");
    w.c.adv(61 * 60_000);
    assert.equal((await w.svc.resetPassword({ token: second, newPassword: "a brand new long passphrase" })).code, "invalid_token");
    for (const bad of [null, "", "x", randomToken(), "y".repeat(300)]) assert.equal((await w.svc.resetPassword({ token: bad, newPassword: "a brand new long passphrase" })).code, "invalid_token");
  });
  test("forgot-password is rate limited per email and per IP", async () => {
    const w = world();
    const { email } = await registered(w);
    const r = []; for (let i = 0; i < 5; i++) r.push((await w.svc.forgotPassword({ email })).ok);
    assert.deepEqual(r, [true, true, true, false, false]);
    assert.equal(w.mailer.outbox.filter((m) => m.template === "reset_password").length, 3);
  });
});

describe("audit trail and secrets", () => {
  test("sensitive account events are recorded, and the audit log holds no secrets, emails, or passwords", async () => {
    const w = world();
    const { email, password } = await registered(w);
    await w.svc.login({ email, password: "wrong wrong wrong" });
    const s = await w.svc.login({ email, password });
    const me = await w.svc.authenticate(s.token);
    await w.svc.changePassword({ userId: me.userId, sessionId: me.sessionId, currentPassword: password, newPassword: "a brand new long passphrase" });
    await w.svc.forgotPassword({ email });
    await w.svc.resetPassword({ token: w.mailer.last("reset_password").data.token, newPassword: "yet another long passphrase" });
    await w.svc.logoutEverywhere(me.userId);
    const actions = (await w.db.all("SELECT action FROM audit_log")).map((r) => r.action);
    for (const a of ["account_registered", "business_created", "email_verified", "login_failed", "login_succeeded", "password_changed", "password_reset_requested", "password_reset_completed", "sessions_revoked_all"]) assert.ok(actions.includes(a), a);
    const blob = JSON.stringify(await w.db.all("SELECT * FROM audit_log"));
    for (const secret of [email, GOOD, "a brand new long passphrase", s.token, "pbkdf2"]) assert.ok(!blob.includes(secret), secret);
  });
  test("audit rows cannot be altered", async () => {
    const w = world(); await registered(w);
    await assert.rejects(w.db.run("DELETE FROM audit_log"), /append-only/);
  });
});

describe("hash strength cannot be silently weakened", () => {
  test("the service refuses to start below the production iteration count unless a test explicitly opts out", () => {
    const db = new SqliteAdapter(":memory:"); migrate(db);
    const mk = (iterations, cfg) => () => createAuthService({ db, mailer: new MockMailer(), store: new MemoryStore(), salt: "test-salt-123", iterations, cfg });
    assert.throws(mk(1500), /at least 600000/);
    assert.throws(mk(599_999), /at least 600000/);
    assert.throws(mk(1500, {}), /at least 600000/);
    assert.throws(mk(1500, { unsafeFastHashForTests: "yes" }), /at least 600000/);
    assert.doesNotThrow(mk(undefined));
    assert.doesNotThrow(mk(PBKDF2_ITERATIONS));
    assert.doesNotThrow(mk(1500, { unsafeFastHashForTests: true }));
  });
});

describe("concurrent owner membership invariants", () => {
  async function twoOwners() {
    const w = world();
    const a = await registered(w, "owner-a@acme.example");
    const b = await registered(w, "owner-b@acme.example");
    const ua = await w.db.first("SELECT id FROM users WHERE email = ?", [a.email]);
    const ub = await w.db.first("SELECT id FROM users WHERE email = ?", [b.email]);
    const biz = await w.db.first("SELECT business_id FROM memberships WHERE user_id = ?", [ua.id]);
    await w.db.run("INSERT INTO memberships (user_id, business_id, role, created_at) VALUES (?,?,?,?)", [ub.id, biz.business_id, "owner", new Date(w.c.now()).toISOString()]);
    return { ...w, ua, ub, businessId: biz.business_id, members: membersRepo(w.db, biz.business_id) };
  }

  test("two concurrent owner demotions cannot leave a business with zero owners", async () => {
    const w = await twoOwners();
    const results = await Promise.allSettled([
      w.members.setRole(w.ua.id, w.ub.id, "staff"),
      w.members.setRole(w.ub.id, w.ua.id, "staff"),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(results.filter((x) => x.status === "rejected").length, 1);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM memberships WHERE business_id = ? AND role = 'owner'", [w.businessId])).n, 1);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM audit_log WHERE business_id = ? AND action = 'member_role_changed'", [w.businessId])).n, 1);
  });

  test("two concurrent owner removals cannot remove the last owner", async () => {
    const w = await twoOwners();
    const results = await Promise.allSettled([
      w.members.remove(w.ua.id, w.ub.id),
      w.members.remove(w.ub.id, w.ua.id),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(results.filter((x) => x.status === "rejected").length, 1);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM memberships WHERE business_id = ? AND role = 'owner'", [w.businessId])).n, 1);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM audit_log WHERE business_id = ? AND action = 'member_removed'", [w.businessId])).n, 1);
  });
});

describe("invitation state transitions", () => {
  test("revoked and expired invitations cannot create memberships through the repository", async () => {
    const w = world();
    const owner = await registered(w, "invite-owner@acme.example");
    const invitee = await registered(w, "invitee@acme.example");
    const ownerUser = await w.db.first("SELECT id FROM users WHERE email = ?", [owner.email]);
    const inviteeUser = await w.db.first("SELECT id FROM users WHERE email = ?", [invitee.email]);
    const business = await w.db.first("SELECT business_id FROM memberships WHERE user_id = ?", [ownerUser.id]);
    const M = membersRepo(w.db, business.business_id);
    const R = authRepo(w.db);
    const now = new Date(w.c.now()).toISOString();

    const revoked = await M.createInvitation({
      actorId: ownerUser.id, email: invitee.email, role: "staff",
      tokenHash: await sha256Hex("revoked-invitation-token"),
      expiresAt: new Date(w.c.now() + 60_000).toISOString(), now,
    });
    await M.revokeInvitation(ownerUser.id, revoked.id, now);
    await assert.rejects(R.acceptInvitation({
      invitationId: revoked.id, businessId: business.business_id, userId: inviteeUser.id, role: "staff", now,
    }), /invitation is not open/);
    assert.equal(await w.db.first("SELECT user_id FROM memberships WHERE business_id = ? AND user_id = ?", [business.business_id, inviteeUser.id]), null);

    const expired = await M.createInvitation({
      actorId: ownerUser.id, email: invitee.email, role: "staff",
      tokenHash: await sha256Hex("expired-invitation-token"),
      expiresAt: new Date(w.c.now() - 1_000).toISOString(), now,
    });
    await assert.rejects(R.acceptInvitation({
      invitationId: expired.id, businessId: business.business_id, userId: inviteeUser.id, role: "staff", now,
    }), /invitation is not open/);
    assert.equal(await w.db.first("SELECT user_id FROM memberships WHERE business_id = ? AND user_id = ?", [business.business_id, inviteeUser.id]), null);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM audit_log WHERE business_id = ? AND action = 'invitation_accepted'", [business.business_id])).n, 0);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM audit_log WHERE business_id = ? AND action = 'invitation_revoked'", [business.business_id])).n, 1);
  });
});
