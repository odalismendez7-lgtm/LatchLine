import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { forBusiness, platformRepo } from "../src/db/tenant.js";
import { KnowledgeStore } from "../src/knowledge/store.js";
import { handleMessage } from "../src/engine/engine.js";
import { wantsHuman } from "../src/engine/handoff.js";
import { MockNotifier } from "../src/notify/mock.js";
import { NotifyError } from "../src/notify/provider.js";
import { createChannelMap, createNotifier } from "../src/notify/registry.js";
import { createApp } from "../src/app.js";
import { MemoryStore } from "../src/ratelimit/limiter.js";
import { describeStatus } from "../src/notify/status.js";

const V = { verified: true, verifiedBy: "owner", verifiedAt: "2026-11-01" };
const kbDoc = (id, name) => ({ schemaVersion: 1, businessId: id, businessName: name, industry: "plumbing", facts: { hours: { value: `${name} hours 8-5`, ...V }, contact_phone: { value: "555-0100", ...V } }, faqs: [] });

async function world({ contacts = true } = {}) {
  const db = new SqliteAdapter(":memory:");
  migrate(db);
  const p = platformRepo(db);
  const store = new KnowledgeStore();
  const T = {};
  for (const [id, name, key] of [["acme-plumbing", "Acme", "sk_acme_000000001"], ["bravo-plumbing", "Bravo", "sk_bravo_00000001"]]) {
    await p.createBusiness({ id, name, industry: "plumbing", siteKey: key, origins: [`https://${id}.example`] });
    store.add(kbDoc(id, name));
    T[id] = forBusiness(db, id);
    if (contacts) {
      await T[id].notifications.contacts.add({ channel: "email", address: `owner@${id}.example`, verified: true });
      await T[id].notifications.contacts.add({ channel: "sms", address: id.startsWith("acme") ? "512-555-0100" : "512-555-0200", verified: true });
    }
  }
  const deps = (id) => ({ db, businessId: id, kb: store.forBusiness(id) });
  return { db, deps, A: T["acme-plumbing"], B: T["bravo-plumbing"], store };
}
const lead = async (d, { issue = "my kitchen faucet keeps dripping all day", name = "Jane Doe", phone = "512-555-0142", urgent = "it can wait" } = {}) => {
  let r = await handleMessage(d, { message: issue });
  const id = r.conversationId;
  for (const m of [name, phone, "62701", urgent]) r = await handleMessage(d, { message: m, conversationId: id });
  return { r, id };
};
const notes = (T, leadId) => T.notifications.listForLead(leadId);
const firstLead = async (T) => (await T.leads.list())[0].id;

describe("new-lead notifications", () => {
  test("a saved lead queues exactly one email notification; the customer reply claims nothing about it", async () => {
    const w = await world();
    const { r } = await lead(w.deps("acme-plumbing"));
    assert.equal(r.leadStatus, "saved");
    assert.equal(r.notificationsQueued, true);
    const n = await notes(w.A, await firstLead(w.A));
    assert.deepEqual(n.map((x) => [x.kind, x.priority, x.channel, x.status]), [["new_lead", "normal", "email", "queued"]]);
    assert.doesNotMatch(r.reply, /notif|emailed|texted|alerted|delivered|sent to|told the (team|business)/i);
  });
  test("urgency 'now' is queued as urgent", async () => {
    const w = await world();
    await lead(w.deps("acme-plumbing"), { urgent: "it is happening right now" });
    assert.equal((await notes(w.A, await firstLead(w.A)))[0].priority, "urgent");
  });
  test("a lead is not queued before the database confirms it saved", async () => {
    const w = await world();
    const d = w.deps("acme-plumbing");
    let r = await handleMessage(d, { message: "my kitchen faucet keeps dripping all day" });
    const id = r.conversationId;
    await handleMessage(d, { message: "Jane Doe", conversationId: id });
    await handleMessage(d, { message: "512-555-0142", conversationId: id });
    const real = w.db.batch.bind(w.db);
    w.db.batch = async (s) => { if (s.some((x) => /INSERT INTO leads/.test(x.sql))) throw new Error("down"); return real(s); };
    r = await handleMessage(d, { message: "62701 can wait", conversationId: id });
    w.db.batch = real;
    assert.equal(r.leadStatus, "not_saved");
    assert.equal(r.notificationsQueued, false);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM notifications")).n, 0);
  });
  test("a duplicate caller produces a 'repeat_contact' notification, not a second 'new_lead'", async () => {
    const w = await world();
    await lead(w.deps("acme-plumbing"));
    await lead(w.deps("acme-plumbing"), { issue: "now the sink is clogged badly" });
    const id = await firstLead(w.A);
    assert.deepEqual((await notes(w.A, id)).map((x) => x.kind).sort(), ["new_lead", "repeat_contact"]);
  });
  test("a lead whose notification could not be queued is retried on the next message, and recovered by the sweep", async () => {
    const w = await world();
    const d = w.deps("acme-plumbing");
    let r = await handleMessage(d, { message: "my kitchen faucet keeps dripping all day" });
    const id = r.conversationId;
    await handleMessage(d, { message: "Jane Doe", conversationId: id });
    await handleMessage(d, { message: "512-555-0142", conversationId: id });
    await handleMessage(d, { message: "62701", conversationId: id });
    const real = w.db.batch.bind(w.db);
    w.db.batch = async (s) => { if (s.some((x) => /INSERT INTO notifications/.test(x.sql))) throw new Error("down"); return real(s); };
    r = await handleMessage(d, { message: "it can wait", conversationId: id });
    w.db.batch = real;
    assert.equal(r.leadStatus, "saved");              // the lead itself is saved and the reply is unchanged
    assert.equal(r.degraded.notifications, true);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM notifications")).n, 0);
    r = await handleMessage(d, { message: "hello?", conversationId: id });
    assert.equal(r.notificationsQueued, false);       // flushed before this turn's own work
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM notifications")).n, 1);
    await w.db.run("DELETE FROM notifications");      // simulate a lost queue, then the sweep recovers it
    assert.equal((await w.A.notifications.reconcileMissing()).enqueued, 1);
  });
});

describe("emergency escalation", () => {
  test("an emergency lead is queued as emergency to every verified channel and sent before normal ones", async () => {
    const w = await world();
    const m = new MockNotifier();
    await lead(w.deps("acme-plumbing"), { phone: "512-555-0101" });
    const d = w.deps("acme-plumbing");
    let r = await handleMessage(d, { message: "I smell gas in my kitchen" });
    const id = r.conversationId;
    for (const msg of ["Pat Lee", "512-555-0177", "62701"]) r = await handleMessage(d, { message: msg, conversationId: id });
    assert.equal(r.leadStatus, "saved");
    const emergencyLead = (await w.A.leads.list()).find((l) => l.emergency)?.id;
    const rows = await notes(w.A, emergencyLead);
    assert.deepEqual(rows.map((x) => [x.priority, x.channel]).sort(), [["emergency", "email"], ["emergency", "sms"]]);
    const { dispatchDue } = await import("../src/notify/dispatcher.js");
    await dispatchDue({ db: w.db, channels: createChannelMap([m]) });
    assert.equal(m.outbox[0].priority, "emergency");
    assert.equal(m.outbox.filter((x) => x.priority === "emergency").length, 2);
    const em = m.outbox.find((x) => x.channel === "email" && x.priority === "emergency");
    assert.match(em.subject, /EMERGENCY.*gas smell/);
    assert.match(em.text, /Pat Lee/);
    assert.match(em.text, /cannot dispatch/);
  });
  test("the customer is told the truth about an emergency: no dispatch, no 'we notified'", async () => {
    const w = await world();
    const d = w.deps("acme-plumbing");
    let r = await handleMessage(d, { message: "I smell gas in my kitchen" });
    const id = r.conversationId;
    for (const msg of ["Pat Lee", "512-555-0177", "62701"]) r = await handleMessage(d, { message: msg, conversationId: id });
    assert.match(r.reply, /can't dispatch anyone/);
    assert.doesNotMatch(r.reply, /notified|alerted|emailed|texted|on (its|their) way|help is coming/i);
  });
  test("an emergency with no verified business contact is 'undeliverable' and shows up for attention first", async () => {
    const w = await world({ contacts: false });
    const d = w.deps("acme-plumbing");
    let r = await handleMessage(d, { message: "I smell gas in my kitchen" });
    const id = r.conversationId;
    for (const msg of ["Pat Lee", "512-555-0177", "62701"]) r = await handleMessage(d, { message: msg, conversationId: id });
    const a = await w.A.notifications.needsAttention();
    assert.deepEqual(a.map((x) => [x.priority, x.status]), [["emergency", "undeliverable"]]);
    assert.match(describeStatus(a[0]), /NOT been notified/);
  });
  test("emergency notifications survive a provider outage on one channel and keep retrying on the other", async () => {
    const w = await world();
    const email = new MockNotifier(); email.channels = ["email"];
    const sms = new MockNotifier({ behavior: () => { throw new NotifyError("provider_unavailable", "x", { retryable: true }); } }); sms.channels = ["sms"];
    const d = w.deps("acme-plumbing");
    let r = await handleMessage(d, { message: "carbon monoxide alarm is going off" });
    const id = r.conversationId;
    for (const msg of ["Pat Lee", "512-555-0177", "62701"]) r = await handleMessage(d, { message: msg, conversationId: id });
    const { dispatchDue } = await import("../src/notify/dispatcher.js");
    await dispatchDue({ db: w.db, channels: createChannelMap([email, sms]) });
    const rows = await notes(w.A, (await w.A.leads.list())[0].id);
    assert.deepEqual(rows.map((x) => [x.channel, x.status]).sort(), [["email", "sent"], ["sms", "queued"]]);
  });
});

describe("human handoff", () => {
  test("phrase detection: requests fire; unrelated questions and denials do not", () => {
    for (const yes of ["I want to talk to a person", "can I speak with a human please", "let me talk to someone", "get me a real person", "I need a representative", "hablar con una persona", "agent please", "can I speak to the owner"]) assert.equal(wantsHuman(yes), true, yes);
    for (const no of ["what are your hours?", "my kitchen faucet keeps dripping", "are you a real person?", "I don't want to talk right now", "the person who installed it left", "this is not a person problem", "", null, 5, "x".repeat(2000)]) assert.equal(wantsHuman(no), false, String(no).slice(0, 30));
  });
  test("before a lead exists: honest 'cannot connect live', details are collected, then a handoff notification is queued with the lead", async () => {
    const w = await world();
    const d = w.deps("acme-plumbing");
    let r = await handleMessage(d, { message: "I want to talk to a person" });
    assert.match(r.reply, /can't connect you to a person live/);
    assert.match(r.reply, /What is the plumbing problem\?|first and last name|problem/i);
    assert.equal(r.handoff, true);
    const id = r.conversationId;
    r = await handleMessage(d, { message: "my toilet keeps running all night long", conversationId: id });
    for (const m of ["Sam Rivera", "512-555-0188", "62701", "it can wait"]) r = await handleMessage(d, { message: m, conversationId: id });
    assert.equal(r.leadStatus, "saved");
    assert.match(r.reply, /request to speak with a person is included, but I can't promise/);
    const kinds = (await notes(w.A, await firstLead(w.A))).map((x) => x.kind).sort();
    assert.deepEqual(kinds, ["human_requested", "new_lead"]);
    assert.equal((await w.A.conversations.get(id)) && (await w.db.first("SELECT status FROM conversations WHERE id = ?", [id])).status, "needs_human");
  });
  test("the request text itself is not stored as the plumbing issue", async () => {
    const w = await world();
    const d = w.deps("acme-plumbing");
    const r = await handleMessage(d, { message: "I want to talk to a person" });
    const state = (await w.A.conversations.get(r.conversationId)).state;
    assert.equal(state.slots.issue, undefined);
  });
  test("after the lead exists: the request is recorded once; repeating it does not create duplicates", async () => {
    const w = await world();
    const d = w.deps("acme-plumbing");
    const { id } = await lead(d);
    let r = await handleMessage(d, { message: "let me speak to a human", conversationId: id });
    assert.match(r.reply, /has been recorded for the business team/);
    assert.match(r.reply, /can't promise when/);
    assert.equal(r.notificationsQueued, true);
    await handleMessage(d, { message: "let me speak to a human", conversationId: id });
    await handleMessage(d, { message: "I need a real person", conversationId: id });
    const kinds = (await notes(w.A, await firstLead(w.A))).map((x) => x.kind).sort();
    assert.deepEqual(kinds, ["human_requested", "new_lead"]);
  });
  test("if the handoff cannot be recorded, the customer is told it was NOT received", async () => {
    const w = await world();
    const d = w.deps("acme-plumbing");
    const { id } = await lead(d);
    const real = w.db.batch.bind(w.db);
    w.db.batch = async (s) => { if (s.some((x) => /INSERT INTO notifications/.test(x.sql))) throw new Error("down"); return real(s); };
    const r = await handleMessage(d, { message: "let me speak to a human", conversationId: id });
    w.db.batch = real;
    assert.match(r.reply, /NOT received/);
    assert.doesNotMatch(r.reply, /has been recorded/);
    assert.match(r.reply, /555-0100/);
  });
  test("a handoff is prioritized by context: emergency conversations escalate at emergency priority", async () => {
    const w = await world();
    const d = w.deps("acme-plumbing");
    let r = await handleMessage(d, { message: "I smell gas, let me talk to a person" });
    const id = r.conversationId;
    for (const m of ["Pat Lee", "512-555-0177", "62701"]) r = await handleMessage(d, { message: m, conversationId: id });
    const rows = await notes(w.A, await firstLead(w.A));
    assert.ok(rows.length >= 2 && rows.every((x) => x.priority === "emergency"));
    assert.ok(rows.some((x) => x.kind === "human_requested"));
  });
});

describe("tenant isolation end to end", () => {
  test("two businesses at once: each notification goes only to its own contacts with only its own customer", async () => {
    const w = await world();
    const m = new MockNotifier();
    await lead(w.deps("acme-plumbing"), { name: "Alice Acme", issue: "acme kitchen sink drips constantly" });
    await lead(w.deps("bravo-plumbing"), { name: "Bob Bravo", issue: "bravo bathroom tap leaks constantly" });
    const { dispatchDue } = await import("../src/notify/dispatcher.js");
    await dispatchDue({ db: w.db, channels: createChannelMap([m]) });
    assert.equal(m.outbox.length, 2);
    for (const msg of m.outbox) {
      const mine = msg.to.includes("acme") ? "acme" : "bravo";
      const other = mine === "acme" ? /bravo|Bob/i : /acme|Alice/i;
      assert.doesNotMatch(msg.subject + msg.text, other);
      assert.ok(msg.to.includes(mine));
    }
    assert.deepEqual(await w.B.notifications.counts(), { sent: 1 });
  });
  test("a conversation id from business A cannot trigger notifications for business B", async () => {
    const w = await world();
    const { id } = await lead(w.deps("acme-plumbing"));
    await handleMessage(w.deps("bravo-plumbing"), { message: "let me speak to a human", conversationId: id });
    assert.deepEqual(await w.B.notifications.counts(), {});
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM notifications WHERE business_id = 'acme-plumbing'")).n, 1);
  });
});

describe("through the HTTP app", () => {
  async function appWorld(opts = {}) {
    const w = await world();
    const mock = new MockNotifier(opts.behavior ? { behavior: opts.behavior } : {});
    let off = 0;
    const app = createApp({ db: w.db, store: new MemoryStore(), salt: "test-salt-123", channels: createChannelMap([mock]), now: () => Date.now() + off, ...opts.app });
    const post = (body) => app.fetch(new Request("https://api.test/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://acme-plumbing.example", "CF-Connecting-IP": "203.0.113.9" }, body: JSON.stringify({ siteKey: "sk_acme_000000001", ...body }) }), { waitUntil() {} });
    const say = async (conv, message) => (await post({ message, conversationId: conv })).json();
    return { ...w, app, mock, say, adv: (ms) => { off += ms; } };
  }
  const full = async (x, first = "my kitchen faucet keeps dripping all day") => {
    let j = await x.say(null, first); const id = j.conversationId;
    for (const m of ["Jane Doe", "512-555-0142", "62701", "it can wait"]) j = await x.say(id, m);
    return { j, id };
  };

  test("saving a lead triggers a dispatch; the API response never mentions notifications", async () => {
    const x = await appWorld();
    const { j } = await full(x);
    await x.app.idle();
    assert.equal(j.leadStatus, "saved");
    assert.equal(x.mock.outbox.length, 1);
    assert.ok(!("notificationsQueued" in j) && !JSON.stringify(j).match(/notif|outbox|owner@/i));
    assert.equal((await x.A.notifications.listForLead(await firstLead(x.A)))[0].status, "sent");
  });
  test("provider outage does not change the customer's reply; the scheduled run retries until it works", async () => {
    let fail = 2;
    const x = await appWorld({ behavior: () => { if (fail-- > 0) throw new NotifyError("provider_unavailable", "x", { retryable: true }); } });
    const { j } = await full(x);
    await x.app.idle();
    assert.equal(j.leadStatus, "saved");
    assert.match(j.reply, /has been recorded/);
    let n = (await x.A.notifications.listForLead(await firstLead(x.A)))[0];
    assert.deepEqual([n.status, n.attempts], ["queued", 1]);
    x.adv(2 * 60_000);
    let s = await x.app.runScheduled();
    assert.equal(s.dispatch.retryScheduled, 1);
    x.adv(10 * 60_000);
    s = await x.app.runScheduled();
    assert.equal(s.dispatch.sent, 1);
    n = (await x.A.notifications.listForLead(await firstLead(x.A)))[0];
    assert.deepEqual([n.status, n.attempts], ["sent", 3]);
    assert.equal(x.mock.outbox.length, 1);
  });
  test("a notification database failure never breaks the chat reply", async () => {
    const x = await appWorld();
    const real = x.db.batch.bind(x.db);
    x.db.batch = async (s) => { if (s.some((q) => /notification_attempts|UPDATE notifications SET status = 'sent'/.test(q.sql))) throw new Error("down"); return real(s); };
    const { j } = await full(x);
    await x.app.idle();
    assert.equal(j.leadStatus, "saved");
    assert.equal(x.mock.outbox.length <= 1, true);
  });
  test("the scheduled run recovers a saved lead whose notification was never queued", async () => {
    const x = await appWorld();
    await full(x); await x.app.idle();
    await x.db.run("DELETE FROM notifications");
    const s = await x.app.runScheduled();
    assert.equal(s.reconciled, 1);
    assert.equal(x.mock.outbox.length, 1 + 0 || 1);
    assert.equal((await x.db.first("SELECT COUNT(*) n FROM notifications")).n, 1);
  });
  test("scheduled run with the database down reports errors and sends nothing", async () => {
    const x = await appWorld();
    const real = x.db.all.bind(x.db);
    x.db.all = async () => { throw new Error("down"); };
    const s = await x.app.runScheduled();
    x.db.all = real;
    assert.ok(s.errors.includes("database_unavailable"));
    assert.equal(s.dispatch.ok, false);
    assert.equal(x.mock.calls, 0);
  });
  test("without a notifier configured the chat still works and nothing is dispatched", async () => {
    const x = await appWorld({ app: { channels: null } });
    const { j } = await full(x);
    assert.equal(j.leadStatus, "saved");
    assert.equal(x.mock.calls, 0);
    assert.equal((await x.A.notifications.counts()).queued, 1);
  });
});

describe("real providers stay disabled", () => {
  test("the registry refuses them", () => {
    for (const type of ["twilio", "sendgrid", "smtp", "ses"]) assert.throws(() => createNotifier({ type }), (e) => e.code === "disabled");
  });
});
