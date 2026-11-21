// What happens when the PLATFORM cannot run our password hash (e.g. a runtime that caps PBKDF2 iterations).
// Required behavior: fail closed. Never create a weaker hash, never log someone in without a verified password.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { MemoryStore } from "../src/ratelimit/limiter.js";
import { MockMailer } from "../src/auth/mailer.js";
import { createApp } from "../src/app.js";
import { createAuthService } from "../src/auth/service.js";
import { hashPassword, verifyPassword, HashUnavailableError, PBKDF2_ITERATIONS } from "../src/auth/crypto.js";

const PW = "correct horse battery staple";
const realDerive = crypto.subtle.deriveBits.bind(crypto.subtle);
let calls;
const capAt = (max) => { calls = []; crypto.subtle.deriveBits = async (alg, ...r) => { calls.push(alg.iterations); if (alg.iterations > max) throw new Error("OperationError: iteration counts above " + max + " are not supported"); return realDerive(alg, ...r); }; };
afterEach(() => { crypto.subtle.deriveBits = realDerive; });

const mk = () => { const db = new SqliteAdapter(":memory:"); migrate(db); const mailer = new MockMailer(); const app = createApp({ db, store: new MemoryStore(), salt: "test-salt-123", accounts: { mailer } }); return { db, mailer, app }; };
const post = (app, path, body) => app.fetch(new Request("http://localhost" + path, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) }));

describe("a platform that cannot run the full-strength hash", () => {
  test("hashing and verifying throw HashUnavailableError (never silently weaker), with no password in the message", async () => {
    capAt(100_000);
    await assert.rejects(hashPassword(PW), (e) => e instanceof HashUnavailableError && !e.message.includes(PW) && e.message.includes(String(PBKDF2_ITERATIONS)));
    const strong = await (async () => { crypto.subtle.deriveBits = realDerive; return hashPassword(PW, 2000); })();
    capAt(1000);
    await assert.rejects(verifyPassword(PW, strong), HashUnavailableError);
  });
  test("registration fails closed (503): no user, no business, no mail, no weaker hash, no internals", async () => {
    const w = mk(); capAt(100_000);
    const r = await post(w.app, "/api/auth/register", { email: "a@acme.example", password: PW, businessName: "Acme" });
    assert.equal(r.status, 503); const t = await r.text(); assert.deepEqual(JSON.parse(t), { error: "auth_unavailable" });
    assert.ok(!/iteration|OperationError|PBKDF2/i.test(t));
    for (const tbl of ["users", "businesses", "memberships", "sessions", "auth_tokens"]) assert.equal((await w.db.first(`SELECT COUNT(*) n FROM ${tbl}`)).n, 0, tbl);
    assert.equal(w.mailer.outbox.length, 0);
    assert.ok(calls.every((n) => n === PBKDF2_ITERATIONS), "only the full-strength cost was ever attempted");
  });
  test("login fails closed for known and unknown emails alike (no enumeration, no cookie, no session)", async () => {
    const w = mk();
    crypto.subtle.deriveBits = async (a, ...r) => realDerive({ ...a, iterations: 1000 }, ...r); // setup only: make an account quickly
    const svc = createAuthService({ db: w.db, mailer: w.mailer, store: new MemoryStore(), salt: "test-salt-123" });
    await svc.register({ email: "a@acme.example", password: PW, businessName: "Acme" });
    await svc.verifyEmail({ token: w.mailer.last("verify_email").data.token });
    capAt(100_000);
    const known = await post(w.app, "/api/auth/login", { email: "a@acme.example", password: PW });
    const unknown = await post(w.app, "/api/auth/login", { email: "ghost@acme.example", password: PW });
    for (const r of [known, unknown]) { assert.equal(r.status, 503); assert.equal(r.headers.get("Set-Cookie"), null); assert.deepEqual(await r.json(), { error: "auth_unavailable" }); }
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM sessions")).n, 0);
  });
  test("an old, weaker stored hash still verifies on login but is NOT upgraded when the platform cannot; the user is not locked out", async () => {
    const w = mk(); capAt(100_000);
    const svc = createAuthService({ db: w.db, mailer: w.mailer, store: new MemoryStore(), salt: "test-salt-123", iterations: 2000, cfg: { unsafeFastHashForTests: true } });
    await svc.register({ email: "a@acme.example", password: PW, businessName: "Acme" });
    await svc.verifyEmail({ token: w.mailer.last("verify_email").data.token });
    const strict = createAuthService({ db: w.db, mailer: w.mailer, store: new MemoryStore(), salt: "test-salt-123" }); // default full strength
    const before = (await w.db.first("SELECT password_hash h FROM users")).h;
    const r = await strict.login({ email: "a@acme.example", password: PW });
    assert.equal(r.ok, true);
    assert.equal((await w.db.first("SELECT password_hash h FROM users")).h, before, "hash unchanged, and never replaced by anything weaker");
    assert.equal((await strict.login({ email: "a@acme.example", password: "wrong wrong wrong" })).code, "invalid_credentials");
  });
  test("the service refuses to start below the full-strength setting unless a test opts out explicitly", () => {
    const db = new SqliteAdapter(":memory:"); migrate(db);
    assert.throws(() => createAuthService({ db, mailer: new MockMailer(), store: new MemoryStore(), salt: "test-salt-123", iterations: 100_000 }), /at least 600000/);
    assert.throws(() => createAuthService({ db, mailer: new MockMailer(), store: new MemoryStore(), salt: "test-salt-123", iterations: 100_000, cfg: { unsafeFastHashForTests: "yes" } }), /at least 600000/);
  });
});
