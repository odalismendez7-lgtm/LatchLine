import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { D1Adapter } from "../src/db/d1-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { forBusiness, platformRepo } from "../src/db/tenant.js";
import { DbError } from "../src/db/errors.js";

function fresh() {
  const db = new SqliteAdapter(":memory:");
  migrate(db);
  return db;
}
async function seed(db) {
  const p = platformRepo(db);
  await p.createBusiness({ id: "acme-plumbing", name: "Acme", industry: "plumbing", siteKey: "sk_acme_000000001", origins: ["https://acme.example"] });
  await p.createBusiness({ id: "bravo-plumbing", name: "Bravo", industry: "plumbing", siteKey: "sk_bravo_00000001", origins: ["https://bravo.example"] });
  return { A: forBusiness(db, "acme-plumbing"), B: forBusiness(db, "bravo-plumbing"), p };
}
const lead = (o = {}) => ({ name: "Jane Doe", phone: "+15125550142", email: "jane@example.com", zip: "78701", issueCategory: "leak", issueText: "kitchen leak", urgency: "can_wait", preferredContact: "phone", ...o });

describe("migrations", () => {
  test("apply once and are idempotent", () => {
    const db = new SqliteAdapter(":memory:");
    assert.deepEqual(migrate(db), ["0001_init.sql", "0002_notifications.sql", "0003_accounts.sql", "0004_simulated_mail.sql", "0005_notification_variant.sql", "0006_chat_request_dedup.sql", "0007_chat_request_payload_hash.sql", "0008_structured_service_address.sql"]);
    assert.deepEqual(migrate(db), []);
  });
});

describe("platform repo", () => {
  test("resolves a site key to its business and origins", async () => {
    const { p } = await seed(fresh());
    const b = await p.businessBySiteKey("sk_acme_000000001");
    assert.equal(b.id, "acme-plumbing");
    assert.deepEqual(b.origins, ["https://acme.example"]);
  });
  test("unknown, short, or non-string keys resolve to null", async () => {
    const { p } = await seed(fresh());
    for (const k of ["nope", "", null, undefined, 5, "x".repeat(200), "sk_acme_000000001' OR '1'='1"]) assert.equal(await p.businessBySiteKey(k), null);
  });
  test("duplicate site key is rejected by the database", async () => {
    const { p } = await seed(fresh());
    await assert.rejects(p.createBusiness({ id: "charlie", name: "C", industry: "plumbing", siteKey: "sk_acme_000000001" }), (e) => e.code === "constraint");
  });
});

describe("forBusiness", () => {
  test("requires a business id", () => {
    const db = fresh();
    for (const bad of [undefined, null, "", "a", 5]) assert.throws(() => forBusiness(db, bad), (e) => e.code === "unknown_business");
  });
  test("handle is frozen", async () => {
    const { A } = await seed(fresh());
    assert.ok(Object.isFrozen(A) && Object.isFrozen(A.leads) && Object.isFrozen(A.conversations));
    assert.throws(() => { "use strict"; A.businessId = "bravo-plumbing"; });
  });
});

describe("lead save is confirmed by readback", () => {
  test("saved lead can be read back with every normalized field", async () => {
    const { A } = await seed(fresh());
    const c = await A.conversations.create();
    const r = await A.leads.create(c.id, lead());
    assert.equal(r.saved, true);
    const row = await A.leads.get(r.id);
    assert.equal(row.phone, "+15125550142");
    assert.equal(row.zip, "78701");
    assert.equal((await A.conversations.get(c.id)).leadId, r.id);
  });
  test("a database that fails writes yields a thrown DbError, never saved:true", async () => {
    const db = fresh();
    const { A } = await seed(db);
    const c = await A.conversations.create();
    db.batch = async () => { throw new Error("D1_ERROR: database unavailable"); };
    await assert.rejects(A.leads.create(c.id, lead()), (e) => e instanceof DbError && e.code === "db_unavailable");
  });
  test("a database that silently drops the write is detected (not_persisted)", async () => {
    const db = fresh();
    const { A } = await seed(db);
    const c = await A.conversations.create();
    db.batch = async (s) => s.map(() => ({ changes: 1 })); // lies: reports success, writes nothing
    await assert.rejects(A.leads.create(c.id, lead()), (e) => e.code === "not_persisted");
  });
  test("a database that stores a different phone or email than written is detected", async () => {
    for (const col of ["phone", "email"]) {
      const db = fresh();
      const { A } = await seed(db);
      const c = await A.conversations.create();
      const real = db.batch.bind(db);
      db.batch = async (s) => { const r = await real(s); await db.run(`UPDATE leads SET ${col} = ${col === "phone" ? "'+15125559999'" : "'other@example.com'"}`); return r; };
      await assert.rejects(A.leads.create(c.id, lead()), (e) => e.code === "not_persisted", col);
    }
  });
  test("failed batch rolls back: no partial lead, event, or conversation link", async () => {
    const db = fresh();
    const { A } = await seed(db);
    const c = await A.conversations.create();
    await assert.rejects(A.leads.create(c.id, lead({ phone: "5125550142" }))); // CHECK on phone format
    assert.equal(await A.leads.count(), 0);
    assert.equal((await A.conversations.get(c.id)).leadId, null);
    assert.equal((await db.first("SELECT COUNT(*) n FROM lead_events")).n, 0);
  });
  test("one lead per conversation (UNIQUE)", async () => {
    const { A } = await seed(fresh());
    const c = await A.conversations.create();
    await A.leads.create(c.id, lead());
    await assert.rejects(A.leads.create(c.id, lead({ phone: "+15125550143", email: "x@example.com" })), (e) => e.code === "constraint");
  });
  test("CHECK constraints reject bad data the app should never send", async () => {
    const { A } = await seed(fresh());
    for (const bad of [{ zip: "123" }, { phone: "+4412345" }, { urgency: "whenever" }, { issueText: "x".repeat(501) }, { preferredContact: "carrier pigeon" }]) {
      const c = await A.conversations.create();
      await assert.rejects(A.leads.create(c.id, lead(bad)), (e) => e.code === "constraint", JSON.stringify(bad));
    }
  });
});

describe("cross-tenant isolation", () => {
  let A, B, db;
  beforeEach(async () => { db = fresh(); ({ A, B } = await seed(db)); });

  test("business B cannot read A's conversation, messages, or lead by id", async () => {
    const c = await A.conversations.create();
    await A.conversations.addMessage(c.id, { role: "customer", content: "secret" });
    const l = await A.leads.create(c.id, lead());
    assert.equal(await B.conversations.get(c.id), null);
    assert.deepEqual(await B.conversations.messages(c.id), []);
    assert.equal(await B.leads.get(l.id), null);
  });
  test("B's lead list and count never include A's leads", async () => {
    const c = await A.conversations.create();
    await A.leads.create(c.id, lead());
    assert.equal(await B.leads.count(), 0);
    assert.deepEqual(await B.leads.list(), []);
    assert.equal(await A.leads.count(), 1);
  });
  test("duplicate detection does not cross tenants", async () => {
    const c = await A.conversations.create();
    await A.leads.create(c.id, lead());
    assert.equal(await B.leads.findDuplicate({ phone: "+15125550142" }), null);
    assert.equal(await B.leads.findDuplicate({ email: "jane@example.com" }), null);
    assert.ok(await A.leads.findDuplicate({ phone: "+15125550142" }));
  });
  test("B cannot write into A's conversation (update, message, lead)", async () => {
    const c = await A.conversations.create();
    await assert.rejects(B.conversations.save(c.id, { state: { hacked: 1 }, status: "open", urgent: false }), (e) => e.code === "not_found");
    await assert.rejects(B.conversations.addMessage(c.id, { role: "customer", content: "x" }), (e) => e.code === "constraint");
    await assert.rejects(B.leads.create(c.id, lead()), (e) => e.code === "constraint");
    assert.equal((await A.conversations.get(c.id)).messageCount, 0);
    assert.equal(await A.leads.count(), 0);
  });
  test("B cannot merge a duplicate into A's lead", async () => {
    const ca = await A.conversations.create();
    const l = await A.leads.create(ca.id, lead());
    const cb = await B.conversations.create();
    // Blocked by the composite foreign key on lead_events (second layer), and the
    // whole batch rolls back, so nothing changes in either tenant.
    await assert.rejects(B.leads.mergeDuplicate(l.id, cb.id), (e) => e.code === "constraint" || e.code === "not_found");
    assert.equal((await A.leads.get(l.id)).duplicate_count, 0);
    assert.equal((await db.first("SELECT COUNT(*) n FROM lead_events WHERE type='merged_duplicate'")).n, 0);
  });
  test("knowledge bases are per business", async () => {
    await A.knowledge.set({ hours: "9-5" });
    assert.equal(await B.knowledge.get(), null);
    assert.deepEqual((await A.knowledge.get()).document, { hours: "9-5" });
    await A.knowledge.set({ hours: "10-6" });
    assert.equal((await A.knowledge.get()).version, 2);
  });
  test("database composite foreign keys reject cross-tenant rows even with raw SQL", async () => {
    const c = await A.conversations.create();
    await assert.rejects(db.run("INSERT INTO messages (id,business_id,conversation_id,role,content,created_at) VALUES ('m','bravo-plumbing',?,'customer','x','t')", [c.id]), /FOREIGN KEY/);
    await assert.rejects(db.run("INSERT INTO leads (id,business_id,conversation_id,created_at,updated_at) VALUES ('l','bravo-plumbing',?,'t','t')", [c.id]), /FOREIGN KEY/);
  });
  test("deleting a business removes its data and no other business's", async () => {
    const ca = await A.conversations.create(); await A.leads.create(ca.id, lead());
    const cb = await B.conversations.create(); await B.leads.create(cb.id, lead({ phone: "+15125550199", email: "b@example.com" }));
    await db.run("DELETE FROM businesses WHERE id = 'acme-plumbing'");
    assert.equal(await A.leads.count(), 0);
    assert.equal(await B.leads.count(), 1);
  });
});

describe("every tenant statement is scoped (SQL spy)", () => {
  test("each SQL statement issued through a tenant handle binds the business id", async () => {
    const db = fresh();
    const { A } = await seed(db);
    const seen = [];
    for (const m of ["all", "first", "run"]) { const o = db[m].bind(db); db[m] = (sql, p = []) => { seen.push({ sql, p }); return o(sql, p); }; }
    const ob = db.batch.bind(db);
    db.batch = (s) => { s.forEach((x) => seen.push({ sql: x.sql, p: x.params ?? [] })); return ob(s); };

    const c = await A.conversations.create();
    await A.conversations.get(c.id);
    await A.conversations.addMessage(c.id, { role: "customer", content: "hi" });
    await A.conversations.messages(c.id);
    await A.conversations.save(c.id, { state: {}, status: "open", urgent: false });
    await A.leads.findDuplicate({ phone: "+15125550142" });
    const l = await A.leads.create(c.id, lead());
    await A.leads.get(l.id); await A.leads.list(); await A.leads.count();
    await A.knowledge.set({ a: 1 }); await A.knowledge.get();

    assert.ok(seen.length > 15);
    for (const s of seen) {
      assert.ok(s.p.includes("acme-plumbing"), `statement missing business id binding: ${s.sql.slice(0, 80)}`);
      assert.ok(!/\$\{|'acme/.test(s.sql), "business id must be bound, never interpolated");
    }
  });
  test("hostile ids are bound as data and cannot alter the query", async () => {
    const { A } = await seed(fresh());
    const evil = "x' OR '1'='1";
    assert.equal(await A.conversations.get(evil), null);
    assert.equal(await A.leads.get(evil), null);
    assert.deepEqual(await A.conversations.messages(evil), []);
  });
});

describe("audit log", () => {
  test("records events without customer values and cannot be edited or deleted", async () => {
    const db = fresh();
    const { A } = await seed(db);
    const c = await A.conversations.create();
    await A.leads.create(c.id, lead());
    const rows = await db.all("SELECT * FROM audit_log WHERE business_id = 'acme-plumbing'");
    assert.ok(rows.some((r) => r.action === "lead_created"));
    const blob = JSON.stringify(rows);
    for (const secret of ["+15125550142", "jane@example.com", "Jane Doe", "78701"]) assert.ok(!blob.includes(secret), `audit log leaked ${secret}`);
    await assert.rejects(db.run("UPDATE audit_log SET action = 'x'"), /append-only/);
    await assert.rejects(db.run("DELETE FROM audit_log"), /append-only/);
  });
  test("audit rows survive business deletion", async () => {
    const db = fresh();
    await seed(db);
    await db.run("DELETE FROM businesses WHERE id = 'acme-plumbing'");
    assert.ok((await db.first("SELECT COUNT(*) n FROM audit_log WHERE business_id = 'acme-plumbing'")).n >= 1);
  });
});

describe("duplicate lookup", () => {
  test("matches by phone or email, respects the time window", async () => {
    const db = fresh();
    const { A } = await seed(db);
    const c = await A.conversations.create();
    const l = await A.leads.create(c.id, lead());
    assert.equal((await A.leads.findDuplicate({ phone: "+15125550142" })).id, l.id);
    assert.equal((await A.leads.findDuplicate({ email: "jane@example.com" })).id, l.id);
    assert.equal(await A.leads.findDuplicate({ phone: "+15125550999" }), null);
    assert.equal(await A.leads.findDuplicate({}), null);
    await db.run("UPDATE leads SET created_at = '2020-01-01T00:00:00.000Z'");
    assert.equal(await A.leads.findDuplicate({ phone: "+15125550142" }), null);
  });
  test("mergeDuplicate increments the counter and logs an event", async () => {
    const db = fresh();
    const { A } = await seed(db);
    const c = await A.conversations.create();
    const l = await A.leads.create(c.id, lead());
    const c2 = await A.conversations.create();
    await A.leads.mergeDuplicate(l.id, c2.id);
    assert.equal((await A.leads.get(l.id)).duplicate_count, 1);
    assert.equal((await db.first("SELECT COUNT(*) n FROM lead_events WHERE type='merged_duplicate'")).n, 1);
  });
});

describe("D1 adapter (against a fake D1 built on SQLite; real D1 untested)", () => {
  function fakeD1(sqlite) {
    const stmt = (sql) => ({
      sql, params: [],
      bind(...p) { this.params = p; return this; },
      async all() { return { results: await sqlite.all(this.sql, this.params) }; },
      async first() { return sqlite.first(this.sql, this.params); },
      async run() { return { meta: await sqlite.run(this.sql, this.params) }; },
    });
    return {
      prepare: stmt,
      async batch(stmts) { const r = await sqlite.batch(stmts.map((s) => ({ sql: s.sql, params: s.params }))); return r.map((m) => ({ meta: m })); },
    };
  }
  test("repositories behave the same through the D1 adapter", async () => {
    const sqlite = fresh();
    const d1 = new D1Adapter(fakeD1(sqlite));
    const { A } = await seed(d1);
    const c = await A.conversations.create();
    const r = await A.leads.create(c.id, lead());
    assert.equal(r.saved, true);
    assert.equal((await A.leads.get(r.id)).zip, "78701");
  });
  test("rejects a non-D1 binding", () => {
    for (const bad of [null, {}, "x"]) assert.throws(() => new D1Adapter(bad), TypeError);
  });
});
