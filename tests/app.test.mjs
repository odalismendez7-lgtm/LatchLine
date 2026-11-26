import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { platformRepo, forBusiness } from "../src/db/tenant.js";
import { createApp } from "../src/app.js";
import { MemoryStore, DbStore } from "../src/ratelimit/limiter.js";
import { AIRouter } from "../src/ai/router.js";
import { MockProvider } from "../src/ai/mock.js";

const V = { verified: true, verifiedBy: "owner", verifiedAt: "2026-11-01" };
const kb = (id, name) => ({ schemaVersion: 1, businessId: id, businessName: name, industry: "plumbing", facts: { hours: { value: `${name} hours 8-5`, ...V } }, faqs: [] });
const A_ORIGIN = "https://acme.example", B_ORIGIN = "https://bravo.example";
const KEY_A = "sk_acme_000000001", KEY_B = "sk_bravo_00000001";

async function setup(appOpts = {}) {
  const db = new SqliteAdapter(":memory:");
  migrate(db);
  const p = platformRepo(db);
  await p.createBusiness({ id: "acme-plumbing", name: "Acme", industry: "plumbing", siteKey: KEY_A, origins: [A_ORIGIN] });
  await p.createBusiness({ id: "bravo-plumbing", name: "Bravo", industry: "plumbing", siteKey: KEY_B, origins: [B_ORIGIN] });
  await forBusiness(db, "acme-plumbing").knowledge.set(kb("acme-plumbing", "Acme"));
  await forBusiness(db, "bravo-plumbing").knowledge.set(kb("bravo-plumbing", "Bravo"));
  const app = createApp({ db, store: new MemoryStore(), salt: "test-salt-123", router: new AIRouter({ providers: [new MockProvider()], retries: 0 }), ...appOpts });
  return { db, app };
}
const post = (app, body, { origin = A_ORIGIN, ip = "203.0.113.5", raw, idempotencyKey } = {}) =>
  app.fetch(new Request("https://api.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), "CF-Connecting-IP": ip, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: raw ?? JSON.stringify(body),
  }));

describe("site key and origin", () => {
  test("valid key + registered origin works", async () => {
    const { app } = await setup();
    const res = await post(app, { message: "what are your hours?", siteKey: KEY_A });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.match(j.reply, /Acme hours/);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), A_ORIGIN);
  });
  test("missing, wrong, or hostile site keys are rejected", async () => {
    const { app } = await setup();
    for (const siteKey of [undefined, null, "", "short", "sk_nope_00000000", `${KEY_A}' OR '1'='1`, 12345, [KEY_A], { a: 1 }]) {
      const res = await post(app, { message: "hi", siteKey });
      assert.equal(res.status, 404, JSON.stringify(siteKey));
    }
  });
  test("business A's key from business B's origin gets the same generic response as an unknown key", async () => {
    const { app, db } = await setup();
    const res = await post(app, { message: "my sink is leaking badly here", siteKey: KEY_A }, { origin: B_ORIGIN });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Chat unavailable" });
    const unknown = await post(app, { message: "hi", siteKey: "sk_unknown_00000000" }, { origin: A_ORIGIN });
    assert.equal(unknown.status, res.status);
    assert.deepEqual(await unknown.json(), { error: "Chat unavailable" });
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "null");
    assert.equal((await db.first("SELECT COUNT(*) n FROM conversations")).n, 0);
  });
  test("no Origin header (non-browser caller) is refused", async () => {
    const { app } = await setup();
    assert.equal((await post(app, { message: "hi", siteKey: KEY_A }, { origin: "" })).status, 404);
  });
  test("a suspended business is refused", async () => {
    const { app, db } = await setup();
    await db.run("UPDATE businesses SET status = 'suspended' WHERE id = 'acme-plumbing'");
    assert.equal((await post(app, { message: "hi", siteKey: KEY_A })).status, 404);
  });
  test("business id in the body is ignored; the site key decides", async () => {
    const { app, db } = await setup();
    await post(app, { message: "my sink is leaking badly here", siteKey: KEY_A, businessId: "bravo-plumbing" });
    assert.equal((await db.first("SELECT COUNT(*) n FROM conversations WHERE business_id = 'bravo-plumbing'")).n, 0);
    assert.equal((await db.first("SELECT COUNT(*) n FROM conversations WHERE business_id = 'acme-plumbing'")).n, 1);
  });
  test("each business answers from its own knowledge", async () => {
    const { app } = await setup();
    const a = await (await post(app, { message: "what are your hours?", siteKey: KEY_A })).json();
    const b = await (await post(app, { message: "what are your hours?", siteKey: KEY_B }, { origin: B_ORIGIN })).json();
    assert.match(a.reply, /Acme/); assert.doesNotMatch(a.reply, /Bravo/);
    assert.match(b.reply, /Bravo/); assert.doesNotMatch(b.reply, /Acme/);
  });
  test("A's conversation id presented to B does not expose or continue A's conversation", async () => {
    const { app, db } = await setup();
    const a = await (await post(app, { message: "my sink is leaking badly here", siteKey: KEY_A })).json();
    const b = await (await post(app, { message: "hello there friend", siteKey: KEY_B, conversationId: a.conversationId }, { origin: B_ORIGIN })).json();
    assert.notEqual(b.conversationId, a.conversationId);
    assert.equal((await db.first("SELECT message_count n FROM conversations WHERE id = ?", [a.conversationId])).n, 2);
  });
});

describe("request validation", () => {
  test("rejects invalid JSON, non-objects, arrays", async () => {
    const { app } = await setup();
    for (const raw of ["{not json", "null", "[]", '"str"', "12"]) assert.equal((await post(app, null, { raw })).status, 400, raw);
  });
  test("rejects empty, whitespace, non-string and over-long messages", async () => {
    const { app } = await setup();
    for (const message of ["", "   ", null, 5, "x".repeat(1201), ["a"]]) assert.equal((await post(app, { message, siteKey: KEY_A })).status, 400, String(message).slice(0, 10));
  });
  test("rejects oversize bodies with 413", async () => {
    const { app } = await setup();
    assert.equal((await post(app, { message: "hi", siteKey: KEY_A, pad: "x".repeat(9000) })).status, 413);
  });
  test("unknown route is 404 and wrong method is not served", async () => {
    const { app } = await setup();
    assert.equal((await app.fetch(new Request("https://api.test/admin"))).status, 404);
    assert.equal((await app.fetch(new Request("https://api.test/api/chat", { method: "GET" }))).status, 404);
    assert.equal((await app.fetch(new Request("https://api.test/api/chat", { method: "DELETE" }))).status, 404);
  });
});

describe("rate limiting", () => {
  test("a burst from one client gets 429 with Retry-After; others are unaffected", async () => {
    const { app } = await setup({ clientLimit: { limit: 5, windowMs: 60_000 } });
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await post(app, { message: "what are your hours?", siteKey: KEY_A }, { ip: "198.51.100.1" })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429, 429]);
    const blocked = await post(app, { message: "hi", siteKey: KEY_A }, { ip: "198.51.100.1" });
    assert.ok(Number(blocked.headers.get("Retry-After")) >= 1);
    assert.equal((await post(app, { message: "what are your hours?", siteKey: KEY_A }, { ip: "198.51.100.2" })).status, 200);
  });
  test("rate-limited requests are not processed or stored", async () => {
    const { app, db } = await setup({ clientLimit: { limit: 1, windowMs: 60_000 } });
    await post(app, { message: "what are your hours?", siteKey: KEY_A });
    const r = await post(app, { message: "my kitchen faucet keeps dripping all day", siteKey: KEY_A });
    assert.equal(r.status, 429);
    assert.equal((await db.first("SELECT COUNT(*) n FROM conversations")).n, 1);
  });
  test("a business-wide limit protects one business from a flood across many clients", async () => {
    const { app } = await setup({ businessLimit: { limit: 3, windowMs: 60_000 } });
    const s = [];
    for (let i = 0; i < 5; i++) s.push((await post(app, { message: "what are your hours?", siteKey: KEY_A }, { ip: `192.0.2.${i}` })).status);
    assert.deepEqual(s, [200, 200, 200, 429, 429]);
    assert.equal((await post(app, { message: "what are your hours?", siteKey: KEY_B }, { origin: B_ORIGIN, ip: "192.0.2.9" })).status, 200);
  });
  test("a rate-limited client in an emergency still gets the safety guidance, flagged as not saved", async () => {
    const { app, db } = await setup({ clientLimit: { limit: 1, windowMs: 60_000 } });
    await post(app, { message: "hi there", siteKey: KEY_A });
    const r = await post(app, { message: "I smell gas", siteKey: KEY_A });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.urgent, true);
    assert.equal(j.rateLimited, true);
    assert.match(j.reply, /911|leave/i);
    assert.match(j.reply, /not saved/);
    assert.equal((await db.first("SELECT COUNT(*) n FROM messages")).n, 2); // only the first exchange was stored
  });
  test("a rate-limited client with a non-emergency message still gets 429", async () => {
    const { app } = await setup({ clientLimit: { limit: 1, windowMs: 60_000 } });
    await post(app, { message: "hi there", siteKey: KEY_A });
    for (const m of ["hello again", "how much does a drain cost?", "", "x".repeat(2000)]) assert.equal((await post(app, { message: m, siteKey: KEY_A })).status, 429, m.slice(0, 10));
  });
  test("works with the database-backed store", async () => {
    const { db } = await setup();
    const { DbStore: Db } = await import("../src/ratelimit/limiter.js");
    const app = createApp({ db, store: new Db(db), salt: "test-salt-123", clientLimit: { limit: 2, windowMs: 60_000 } });
    const s = [];
    for (let i = 0; i < 3; i++) s.push((await post(app, { message: "what are your hours?", siteKey: KEY_A })).status);
    assert.deepEqual(s, [200, 200, 429]);
  });
});

describe("health and failures", () => {
  test("health reports database connected only when the ping succeeds", async () => {
    const { app, db } = await setup();
    const ok = await (await app.fetch(new Request("https://api.test/health"))).json();
    assert.equal(ok.databaseConnected, true);
    assert.equal(ok.realAIConnected, false);
    db.ping = async () => { throw new Error("down"); };
    const res = await app.fetch(new Request("https://api.test/health"));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).databaseConnected, false);
  });
  test("database down: a normal chat returns 503, not a fake success", async () => {
    const { app, db } = await setup();
    db.first = db.all = db.run = db.batch = async () => { throw new Error("down"); };
    const res = await post(app, { message: "what are your hours?", siteKey: KEY_A });
    assert.ok([503, 404, 403].includes(res.status));
    assert.notEqual(res.status, 200);
  });
  // Changed deliberately in the Stage 6 readiness gate: this test used to send "I smell gas" and require a 503, i.e. it
  // pinned the defect that a person describing a gas smell got NO safety guidance when the database was down.
  test("database down: an emergency still gets the safety guidance, flagged as not saved (never a fake success)", async () => {
    const { app, db } = await setup();
    db.first = db.all = db.run = db.batch = async () => { throw new Error("down"); };
    const res = await post(app, { message: "I smell gas", siteKey: KEY_A });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.match(j.reply, /leave the building/i); assert.match(j.reply, /not saved/);
    assert.equal(j.persisted, false); assert.equal(j.leadStatus, "not_saved");
  });
  test("internal errors never leak details", async () => {
    const { db } = await setup();
    const app = createApp({ db, store: { increment: async () => 1 }, salt: "test-salt-123", router: { generate: () => { throw new Error("SECRET-STACK"); } } });
    const res = await post(app, { message: "hi", siteKey: KEY_A });
    const text = await res.text();
    assert.doesNotMatch(text, /SECRET-STACK|at .*\.js/);
  });
  test("requires a real salt", async () => {
    const { db } = await setup();
    for (const salt of [undefined, "", "short"]) assert.throws(() => createApp({ db, store: new MemoryStore(), salt }));
  });
});

describe("CORS", () => {
  test("preflight is granted only to registered origins", async () => {
    const { app } = await setup();
    const ok = await app.fetch(new Request("https://api.test/api/chat", { method: "OPTIONS", headers: { Origin: A_ORIGIN } }));
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("Access-Control-Allow-Origin"), A_ORIGIN);
    assert.match(ok.headers.get("Access-Control-Allow-Headers") || "", /Idempotency-Key/i);
    const bad = await app.fetch(new Request("https://api.test/api/chat", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
    assert.equal(bad.status, 403);
    assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
  });
  test("responses carry no-store and nosniff", async () => {
    const { app } = await setup();
    const res = await post(app, { message: "hi", siteKey: KEY_A });
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(res.headers.get("Access-Control-Allow-Headers") || "", /Idempotency-Key/i);
  });
});

describe("end-to-end through HTTP handler", () => {
  test("full lead capture over the API, saved and read back from the database", async () => {
    const { app, db } = await setup();
    let id = null;
    const say = async (message) => { const j = await (await post(app, { message, siteKey: KEY_A, conversationId: id })).json(); id = j.conversationId; return j; };
    await say("my kitchen faucet keeps dripping all day");
    await say("Jane Doe");
    await say("512-555-0142");
    await say("62701");
    const last = await say("it can wait");
    assert.equal(last.leadStatus, "saved");
    assert.equal(last.persisted, true);
    const row = await db.first("SELECT name, phone, zip FROM leads");
    assert.deepEqual({ ...row }, { name: "Jane Doe", phone: "+15125550142", zip: "62701" });
  });
});

describe("chat request idempotency", () => {
  test("completed retries replay the original response without creating another conversation", async () => {
    const { app, db } = await setup();
    const body = { message: "my kitchen faucet keeps dripping", siteKey: KEY_A };
    const first = await post(app, body, { idempotencyKey: "retry-key-0001" });
    assert.equal(first.status, 200);
    const original = await first.json();
    const retry = await post(app, body, { idempotencyKey: "retry-key-0001" });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), original);
    assert.equal((await db.first("SELECT COUNT(*) n FROM conversations")).n, 1);
    assert.equal((await db.first("SELECT COUNT(*) n FROM chat_request_dedup")).n, 1);
  });
  test("a key cannot replay a response for different message content", async () => {
    const { app, db } = await setup();
    const key = "same-key-different-payload";
    const first = await post(app, { message: "my kitchen faucet keeps dripping", siteKey: KEY_A }, { idempotencyKey: key });
    assert.equal(first.status, 200);
    const changed = await post(app, { message: "my toilet is overflowing", siteKey: KEY_A }, { idempotencyKey: key });
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).code, "idempotency_key_conflict");
    assert.equal((await db.first("SELECT COUNT(*) n FROM conversations")).n, 1);
  });
  test("keys are tenant-scoped", async () => {
    const { app, db } = await setup();
    await post(app, { message: "my sink is leaking", siteKey: KEY_A }, { idempotencyKey: "tenant-key-0001" });
    await post(app, { message: "my sink is leaking", siteKey: KEY_B }, { origin: B_ORIGIN, idempotencyKey: "tenant-key-0001" });
    assert.equal((await db.first("SELECT COUNT(*) n FROM chat_request_dedup")).n, 2);
    assert.equal((await db.first("SELECT COUNT(*) n FROM conversations")).n, 2);
  });
  test("invalid message does not reserve an idempotency key", async () => {
    const { app, db } = await setup();
    const key = "retry-after-validation-01";
    const invalid = await post(app, { message: "   ", siteKey: KEY_A }, { idempotencyKey: key });
    assert.equal(invalid.status, 400);
    assert.equal((await db.first("SELECT COUNT(*) n FROM chat_request_dedup")).n, 0);
    const corrected = await post(app, { message: "what are your hours?", siteKey: KEY_A }, { idempotencyKey: key });
    assert.equal(corrected.status, 200);
    assert.equal((await db.first("SELECT status FROM chat_request_dedup WHERE request_key = ?", [key])).status, "completed");
  });
  test("malformed idempotency keys are rejected", async () => {
    const { app } = await setup();
    for (const key of ["short", "contains spaces!", "x".repeat(129)]) {
      const res = await post(app, { message: "hi", siteKey: KEY_A }, { idempotencyKey: key });
      assert.equal(res.status, 400);
    }
  });
});
