// End-to-end emergency workflow through the real HTTP entry point (Stage 6 readiness gate). Every test here either
// reproduces a defect found while tracing the workflow (marked REPRO) or pins a behaviour the workflow depends on.
// Mock AI, mock notifier, in-memory SQLite only.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { platformRepo, forBusiness } from "../src/db/tenant.js";
import { createApp } from "../src/app.js";
import { MemoryStore } from "../src/ratelimit/limiter.js";
import { AIRouter } from "../src/ai/router.js";
import { MockProvider } from "../src/ai/mock.js";
import { MockNotifier } from "../src/notify/mock.js";
import { createChannelMap } from "../src/notify/registry.js";

const ORIGIN = "https://acme.example", KEY = "sk_acme_000000001";
const GAS = "I smell gas in my kitchen";
const SAFETY = /Leave the building/i;
const NOT_CLAIMS = /\b(?:notified|alerted|someone (?:is|will)|on (?:the|its|their) way|dispatched|will arrive|booked)\b/i;

async function setup(opts = {}) {
  const db = new SqliteAdapter(":memory:"); migrate(db);
  await platformRepo(db).createBusiness({ id: "acme-plumbing", name: "Acme", industry: "plumbing", siteKey: KEY, origins: [ORIGIN] });
  const notifier = new MockNotifier();
  const app = createApp({ db, store: new MemoryStore(), salt: "test-salt-123", router: new AIRouter({ providers: [new MockProvider()], retries: 0 }), channels: createChannelMap([notifier]), ...opts });
  await forBusiness(db, "acme-plumbing").notifications.contacts.add({ channel: "email", address: "owner@acme.example", verified: true });
  return { db, app, notifier, T: forBusiness(db, "acme-plumbing") };
}
const post = (app, body, { ip = "203.0.113.5", origin = ORIGIN } = {}) => app.fetch(new Request("https://api.test/api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), "CF-Connecting-IP": ip }, body: JSON.stringify(body) }));
const say = async (app, message, conversationId = null, o) => { const r = await post(app, { siteKey: KEY, message, conversationId }, o); return { status: r.status, cors: r.headers.get("Access-Control-Allow-Origin"), body: await r.json().catch(() => null) }; };

describe("REPRO: the safety text must reach a person in danger even when the service around the chat fails", () => {
  const expectSafety = (r, why) => {
    assert.equal(r.status, 200, `${why}: status ${r.status}`);
    assert.match(r.body?.reply ?? "", SAFETY, `${why}: no safety text`);
    assert.doesNotMatch(r.body.reply, NOT_CLAIMS);
    assert.equal(r.body.persisted, false); assert.equal(r.body.leadStatus, "not_saved");
    assert.match(r.body.reply, /not saved|nothing was sent|has NOT/i, `${why}: must say honestly that nothing reached the business`);
    assert.ok(r.cors, `${why}: the browser could not read the answer (no CORS header)`);
  };
  test("the business's own request limit is exhausted (e.g. during an alert flood)", async () => {
    const { app } = await setup({ businessLimit: { limit: 2, windowMs: 60_000 } });
    for (let i = 0; i < 2; i++) await say(app, "what are your hours?", null, { ip: `203.0.113.${10 + i}` });
    expectSafety(await say(app, GAS, null, { ip: "203.0.113.50" }), "business limit");
    const calm = await say(app, "what are your hours?", null, { ip: "203.0.113.51" });
    assert.equal(calm.status, 429, "non-emergency messages are still limited");
  });
  test("the database cannot be read when looking up the site key", async () => {
    const { app, db } = await setup();
    const real = db.first.bind(db); db.first = async () => { throw new Error("D1 down"); }; db.all = async () => { throw new Error("D1 down"); };
    const r = await say(app, GAS); db.first = real;
    expectSafety(r, "database down at business lookup");
    const calm = await say(app, "what are your hours?"); assert.ok([503, 500].includes(calm.status));
  });
  test("the rate-limit store fails: the limiter degrades to per-instance memory and the emergency is still saved (not a defect; pinned)", async () => {
    const { app, T } = await setup({ store: { async increment() { throw new Error("store down"); } } });
    const r = await say(app, GAS);
    assert.equal(r.status, 200); assert.match(r.body.reply, SAFETY); assert.equal(r.body.persisted, true);
    assert.equal(await T.leads.count(), 1);
  });
  test("an unexpected exception inside the engine", async () => {
    const { app, db } = await setup();
    const real = db.batch.bind(db); db.batch = async () => { throw new Error("boom"); };
    const r = await say(app, GAS); db.batch = real;
    assert.equal(r.status, 200); assert.match(r.body.reply, SAFETY); assert.notEqual(r.body.persisted, true);
  });
  test("a message that is NOT an emergency gets no safety text from any fallback", async () => {
    const { app, db } = await setup();
    db.first = async () => { throw new Error("D1 down"); };
    const r = await say(app, "my sink drips a little"); assert.ok(!/Leave the building/.test(JSON.stringify(r.body)));
  });
});

// ---------------- full workflow ----------------
import { NotifyError } from "../src/notify/provider.js";

const leads = (db) => db.all("SELECT id, emergency, phone, email, issue_text FROM leads ORDER BY rowid");
const alerts = (db) => db.all("SELECT kind, variant, priority, status, channel FROM notifications ORDER BY rowid");
const brokenBatch = (db, re, times = Infinity) => { const real = db.batch.bind(db); let n = 0; db.batch = async (s) => { if (n < times && s.some((x) => re.test(x.sql))) { n++; throw new Error("down"); } return real(s); }; return () => { db.batch = real; }; };

describe("emergency workflow end to end (HTTP entry point to dashboard data)", () => {
  test("message -> partial lead -> one alert -> contact -> one follow-up alert; replays and duplicate POSTs add nothing; statuses are honest", async () => {
    const { app, db, notifier, T } = await setup();
    const r1 = await say(app, GAS); await app.idle();
    assert.equal(r1.body.leadStatus, "partial"); assert.match(r1.body.reply, SAFETY); assert.doesNotMatch(r1.body.reply, NOT_CLAIMS);
    assert.deepEqual((await leads(db)).map((l) => [l.emergency, l.phone]), [[1, null]]);
    assert.equal(notifier.outbox.length, 1); assert.equal(notifier.outbox[0].priority, "emergency"); assert.match(notifier.outbox[0].text, /NOT given a phone number or email/);
    assert.deepEqual((await alerts(db)).map((a) => a.status), ["sent"], "accepted by the provider, never 'delivered' without a receipt");
    const cid = r1.body.conversationId;
    const r2 = await say(app, "512-555-0123", cid); await app.idle();
    assert.equal(r2.body.leadStatus, "saved"); assert.doesNotMatch(r2.body.reply, NOT_CLAIMS);
    for (let i = 0; i < 3; i++) { await say(app, "512-555-0123", cid); await app.idle(); }   // duplicate / retried POSTs
    assert.equal((await leads(db)).length, 1);
    assert.deepEqual((await alerts(db)).map((a) => a.variant), [null, "contact_added"]);
    assert.equal(notifier.outbox.length, 2);
    const dash = await T.dashboard.searchLeads({ incomplete: true }); assert.equal(dash.total, 0, "no longer incomplete once contact arrived");
    assert.equal((await T.dashboard.overview()).incompleteEmergency, 0);
  });
  test("the outbox write fails at the first message and the customer leaves: the scheduled run recovers the alert", async () => {
    const { app, db, notifier } = await setup();
    const restore = brokenBatch(db, /INSERT INTO notifications/);
    const r = await say(app, GAS); restore(); await app.idle();
    assert.equal(r.body.leadStatus, "partial"); assert.doesNotMatch(r.body.reply, NOT_CLAIMS);
    assert.equal((await alerts(db)).length, 0); assert.equal(notifier.outbox.length, 0);
    const out = await app.runScheduled();
    assert.ok(out.reconciled >= 1); assert.equal(notifier.outbox.length, 1);
    assert.equal((await app.runScheduled()).reconciled, 0); assert.equal(notifier.outbox.length, 1, "no duplicate on the next cron run");
  });
  test("provider outage then recovery: retries with the same idempotency key, one message in the end; a permanent failure is surfaced, not hidden", async () => {
    let failing = true;
    const notifier = new MockNotifier({ behavior: async () => { if (failing) throw new NotifyError("provider_unavailable", "down", { retryable: true }); } });
    const { app, db } = await setup({ channels: createChannelMap([notifier]) });
    const r = await say(app, GAS); await app.idle();
    assert.doesNotMatch(r.body.reply, NOT_CLAIMS);
    assert.equal(notifier.outbox.length, 0); assert.match((await alerts(db))[0].status, /queued|retry|failed|pending/i);
    failing = false;
    await app.runScheduled();
    // the retry is scheduled in the future; jump past it by running the dispatcher with a later clock
    const { dispatchDue } = await import("../src/notify/dispatcher.js");
    await dispatchDue({ db, channels: createChannelMap([notifier]), now: () => new Date(Date.now() + 3600_000).toISOString() });
    assert.equal(notifier.outbox.length, 1); assert.equal(new Set(notifier.outbox.map((o) => o.idempotencyKey)).size, 1);
    assert.equal((await alerts(db))[0].status, "sent");
  });
  test("a permanently rejected alert shows up for the owner instead of vanishing", async () => {
    const notifier = new MockNotifier({ behavior: async () => { throw new NotifyError("provider_rejected", "bad", { retryable: false }); } });
    const { app, T } = await setup({ channels: createChannelMap([notifier]) });
    await say(app, GAS); await app.idle();
    const attention = await T.notifications.needsAttention();
    assert.equal(attention.length, 1);
    const hist = await T.dashboard.notificationHistory(); assert.ok(JSON.stringify(hist).match(/fail|not sent|rejected/i));
  });
  test("fault injection at every write point of a three-message emergency: a lead claimed as recorded always exists; a lead claimed as not saved is told so", async () => {
    const SCRIPT = [GAS, "512-555-0123", "my name is Pat Doe"];
    for (let breakAt = 1; breakAt <= 8; breakAt++) {
      const { app, db } = await setup();
      const real = db.batch.bind(db); let n = 0;
      db.batch = async (s) => { n += 1; if (n === breakAt) throw new Error("down"); return real(s); };
      let cid = null;
      for (const m of SCRIPT) {
        const r = await say(app, m, cid); await app.idle(); cid = r.body?.conversationId ?? cid;
        const ls = await leads(db);
        if (/recorded your emergency message|already recorded|recorded for the business/i.test(r.body.reply) && r.body.leadStatus !== "not_saved") assert.ok(ls.length >= 1, `break@${breakAt}: reply says recorded but no lead exists`);
        if (r.body.leadStatus === "not_saved") assert.match(r.body.reply, /NOT|not saved|wasn't able/i, `break@${breakAt}: not_saved status without an honest sentence`);
        assert.doesNotMatch(r.body.reply, NOT_CLAIMS, `break@${breakAt}`);
        assert.match(r.body.reply, m === GAS ? SAFETY : /./);
      }
      db.batch = real;
      assert.ok((await leads(db)).length <= 1, `break@${breakAt}: duplicate leads`);
    }
  });
  test("a lead that was recorded and then the customer's correction fails to save: the old details stay, the reply says the change was NOT saved", async () => {
    const { app, db } = await setup();
    const r1 = await say(app, GAS); await say(app, "512-555-0123", r1.body.conversationId);
    const restore = brokenBatch(db, /INSERT INTO lead_events/);
    const r3 = await say(app, "sorry, wrong number, it is 512-555-0999", r1.body.conversationId); restore();
    assert.match(r3.body.reply, /NOT|wasn't able/i);
    assert.equal((await leads(db))[0].phone, "+15125550123");
  });
});

describe("KI-52 deletion: what happens when a lead is deleted and the customer keeps writing", () => {
  test("REPRO/PIN: deleting a lead removes its conversation, history and still-unsent alerts, and the audit row records what was lost (no customer details)", async () => {
    const { app, db, T } = await setup({ channels: createChannelMap([new MockNotifier({ behavior: async () => { throw new NotifyError("provider_unavailable", "down", { retryable: true }); } })]) });
    const r = await say(app, GAS); await app.idle();
    const lead = (await leads(db))[0];
    assert.equal((await alerts(db)).length, 1);
    await T.dashboard.deleteLead("usr_owner", lead.id);
    assert.equal((await leads(db)).length, 0); assert.equal((await alerts(db)).length, 0, "the unsent alert went with the lead (documented)");
    assert.equal((await db.all("SELECT id FROM messages")).length, 0); assert.equal((await db.all("SELECT id FROM conversations")).length, 0);
    const a = (await db.all("SELECT detail FROM audit_log WHERE action = 'lead_deleted'")).map((x) => JSON.parse(x.detail));
    assert.equal(a.length, 1);
    assert.deepEqual([a[0].emergency, a[0].hadContact, a[0].alertsNotYetSent], [true, false, 1], "before the fix the audit row said nothing about an emergency or an unsent alert");
    assert.doesNotMatch(JSON.stringify(a), /gas|kitchen|512/);
    void r;
  });
  test("PIN: the customer's next message after deletion starts a NEW conversation with a new id; a repeated hazard creates a fresh emergency lead and alert", async () => {
    const { app, db, notifier } = await setup();
    const r1 = await say(app, GAS); await app.idle();
    await forBusiness(db, "acme-plumbing").dashboard.deleteLead("usr_owner", (await leads(db))[0].id);
    const r2 = await say(app, "the gas smell is getting worse", r1.body.conversationId); await app.idle();
    assert.notEqual(r2.body.conversationId, r1.body.conversationId); assert.match(r2.body.reply, SAFETY);
    assert.equal((await leads(db)).length, 1); assert.equal((await leads(db))[0].emergency, 1);
    assert.equal(notifier.outbox.length, 2, "one alert per emergency lead, including the new one");
  });
  test("PIN (the gap): a follow-up with no hazard words after deletion gets ordinary lead-capture questions, with no mention of the earlier emergency", async () => {
    const { app, db } = await setup();
    const r1 = await say(app, GAS); await app.idle();
    await forBusiness(db, "acme-plumbing").dashboard.deleteLead("usr_owner", (await leads(db))[0].id);
    const r2 = await say(app, "ok my number is 512-555-0123", r1.body.conversationId);
    assert.equal((await leads(db)).length, 0, "a bare phone number creates nothing");
    assert.doesNotMatch(r2.body.reply, SAFETY); assert.doesNotMatch(r2.body.reply, /recorded/i);
  });
  test("PIN: an unknown or foreign conversation id behaves exactly like a deleted one (nothing is revealed about which it was)", async () => {
    const { app } = await setup();
    const a = await say(app, "ok my number is 512-555-0123", "cnv_doesnotexist"), b = await say(app, "ok my number is 512-555-0123", "cnv_alsonotreal");
    assert.deepEqual({ ...a.body, conversationId: 0 }, { ...b.body, conversationId: 0 });
  });
});

describe("KI-55 flood: what the current protection does (measured; the proposed mechanism is in docs/ALERT_FLOOD_PROTECTION.md)", () => {
  test("many anonymous clients: saved leads and queued alerts are bounded by the business limit x recipients; the rest are told honestly that nothing was saved", async () => {
    const { app, db, T } = await setup({ businessLimit: { limit: 20, windowMs: 60_000 } });
    await T.notifications.contacts.add({ channel: "sms", address: "+15125550100", verified: true });
    const results = [];
    for (let i = 0; i < 50; i++) results.push(await say(app, `${GAS} number ${i}`, null, { ip: `198.51.100.${i + 1}` }));
    const saved = results.filter((r) => r.body.leadStatus === "partial"), refused = results.filter((r) => r.body.leadStatus === "not_saved");
    assert.equal(saved.length, 20); assert.equal(refused.length, 30);
    assert.ok(refused.every((r) => SAFETY.test(r.body.reply) && /not saved/.test(r.body.reply)));
    assert.equal((await leads(db)).length, 20); assert.equal((await alerts(db)).length, 40, "20 leads x 2 verified channels");
  });
  test("one client repeating itself is stopped by the per-client limit and its excess is not saved or alerted", async () => {
    const { app, db } = await setup({ clientLimit: { limit: 5, windowMs: 60_000 } });
    for (let i = 0; i < 12; i++) await say(app, GAS, null, { ip: "198.51.100.9" });
    assert.equal((await leads(db)).length, 5);
  });
});
