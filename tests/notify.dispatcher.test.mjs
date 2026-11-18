import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { forBusiness, platformRepo } from "../src/db/tenant.js";
import { MockNotifier } from "../src/notify/mock.js";
import { NotifyError } from "../src/notify/provider.js";
import { dispatchDue, backoffMs } from "../src/notify/dispatcher.js";
import { describeStatus, isConfirmedDelivered } from "../src/notify/status.js";

const T0 = Date.parse("2026-11-18T12:00:00.000Z");
const clock = () => { const c = { t: T0, now: () => new Date(c.t).toISOString(), adv: (ms) => { c.t += ms; } }; return c; };

async function world({ emergency = false, urgency = "can_wait", contacts = ["email"] } = {}) {
  const db = new SqliteAdapter(":memory:");
  migrate(db);
  const p = platformRepo(db);
  const mk = async (id, name) => { await p.createBusiness({ id, name, industry: "plumbing", siteKey: `sk_${id}_0000000`, origins: [`https://${id}.example`] }); return forBusiness(db, id); };
  const A = await mk("acme-plumbing", "Acme"), B = await mk("bravo-plumbing", "Bravo");
  for (const [T, dom, ph] of [[A, "acme", "512-555-0100"], [B, "bravo", "512-555-0200"]]) {
    if (contacts.includes("email")) await T.notifications.contacts.add({ channel: "email", address: `owner@${dom}.example`, verified: true });
    if (contacts.includes("sms")) await T.notifications.contacts.add({ channel: "sms", address: ph, verified: true });
  }
  const c = clock();
  const lead = async (T, { name = "Jane Doe", phone = "+15125550142", priority = "normal", kind = "new_lead", issue = "kitchen leak" } = {}) => {
    const cv = await T.conversations.create();
    const l = await T.leads.create(cv.id, { name, phone, zip: "62701", issueText: issue, urgency, emergency: priority === "emergency", emergencyCategories: priority === "emergency" ? ["gas_leak"] : [] });
    await T.notifications.enqueueForLead({ leadId: l.id, conversationId: cv.id, kind, priority, now: c.now() });
    return l.id;
  };
  return { db, A, B, c, lead, p };
}
const run = (w, providers, o = {}) => {
  const channels = {}; for (const pr of providers) for (const ch of pr.channels) channels[ch] ??= pr;
  return dispatchDue({ db: w.db, channels, now: w.c.now, ...o });
};
const down = () => { throw new NotifyError("provider_unavailable", "down", { retryable: true }); };

describe("happy path", () => {
  test("sends once, records 'sent' (not delivered), flagged simulated, with the lead's details", async () => {
    const w = await world(); const m = new MockNotifier();
    const lid = await w.lead(w.A);
    const s = await run(w, [m]);
    assert.deepEqual([s.ok, s.sent, s.claimed], [true, 1, 1]);
    assert.equal(m.outbox.length, 1);
    assert.equal(m.outbox[0].to, "owner@acme.example");
    assert.match(m.outbox[0].text, /Jane Doe, \+15125550142/);
    const n = (await w.A.notifications.listForLead(lid))[0];
    assert.deepEqual([n.status, n.attempts, n.simulated], ["sent", 1, 1]);
    assert.equal(isConfirmedDelivered(n), false);
    assert.match(describeStatus(n), /SIMULATED.*Delivery is not confirmed/);
  });
  test("running again does not resend", async () => {
    const w = await world(); const m = new MockNotifier();
    await w.lead(w.A);
    await run(w, [m]); await run(w, [m]); await run(w, [m]);
    assert.equal(m.outbox.length, 1);
    assert.equal(m.calls, 1);
  });
  test("delivery is recorded only after the provider confirms it", async () => {
    const w = await world(); const m = new MockNotifier();
    const lid = await w.lead(w.A);
    await run(w, [m]);
    let n = (await w.A.notifications.listForLead(lid))[0];
    await run(w, [m]); // receipt still pending
    n = (await w.A.notifications.listForLead(lid))[0];
    assert.equal(n.status, "sent");
    m.confirm(m.outbox[0].id, "delivered");
    const s = await run(w, [m]);
    assert.equal(s.delivered, 1);
    n = (await w.A.notifications.listForLead(lid))[0];
    assert.equal(n.status, "delivered");
    assert.match(describeStatus(await w.A.notifications.get(n.id)), /Delivery confirmed by the mock provider \(simulated/);
  });
  test("a provider that cannot report delivery leaves the notification 'sent', never 'delivered'", async () => {
    const w = await world(); const m = new MockNotifier({ supportsDeliveryStatus: false });
    const lid = await w.lead(w.A);
    for (let i = 0; i < 3; i++) await run(w, [m]);
    assert.equal((await w.A.notifications.listForLead(lid))[0].status, "sent");
  });
  test("a delivery-failure receipt is recorded and surfaces for attention", async () => {
    const w = await world(); const m = new MockNotifier();
    const lid = await w.lead(w.A);
    await run(w, [m]);
    m.confirm(m.outbox[0].id, "failed", "mailbox_full");
    const s = await run(w, [m]);
    assert.equal(s.deliveryFailed, 1);
    assert.equal((await w.A.notifications.listForLead(lid))[0].status, "delivery_failed");
    assert.equal((await w.A.notifications.needsAttention({ now: w.c.now() })).length, 1);
  });
  test("a status check that throws leaves the status unchanged and is reported", async () => {
    const w = await world(); const m = new MockNotifier();
    const lid = await w.lead(w.A);
    await run(w, [m]);
    m.getDeliveryStatus = async () => { throw new Error("status api down"); };
    const s = await run(w, [m]);
    assert.ok(s.errors.includes("status_check_failed"));
    assert.equal((await w.A.notifications.listForLead(lid))[0].status, "sent");
  });
});

describe("provider outage and retries", () => {
  test("outage: requeued with backoff, honest status, then succeeds later with a single message", async () => {
    const w = await world();
    let fail = 2;
    const m = new MockNotifier({ behavior: () => { if (fail-- > 0) down(); } });
    const lid = await w.lead(w.A);
    let s = await run(w, [m]);
    assert.deepEqual([s.sent, s.retryScheduled], [0, 1]);
    let n = (await w.A.notifications.listForLead(lid))[0];
    assert.deepEqual([n.status, n.attempts, n.last_error], ["queued", 1, "provider_unavailable"]);
    assert.match(describeStatus(n), /Not sent yet. Retry scheduled/);
    assert.doesNotMatch(describeStatus(n), /delivered|sent to/i);
    assert.equal((await run(w, [m])).claimed, 0); // not due yet
    w.c.adv(backoffMs("normal", 1) + 1000);
    s = await run(w, [m]);
    assert.equal(s.retryScheduled, 1);
    w.c.adv(backoffMs("normal", 2) + 1000);
    s = await run(w, [m]);
    assert.equal(s.sent, 1);
    n = (await w.A.notifications.listForLead(lid))[0];
    assert.deepEqual([n.status, n.attempts], ["sent", 3]);
    assert.equal(m.outbox.length, 1);
    assert.deepEqual((await w.A.notifications.attempts(n.id)).map((a) => a.outcome), ["retryable_error", "retryable_error", "accepted"]);
  });
  test("a permanent outage ends in 'failed' after max attempts: never sent, never delivered, visible for attention", async () => {
    const w = await world(); const m = new MockNotifier({ behavior: down });
    const lid = await w.lead(w.A);
    for (let i = 0; i < 12; i++) { await run(w, [m]); w.c.adv(2 * 3600_000); }
    const n = (await w.A.notifications.listForLead(lid))[0];
    assert.deepEqual([n.status, n.attempts], ["failed", 5]);
    assert.equal(m.outbox.length, 0);
    assert.match(describeStatus(n), /NOT been notified/);
    assert.equal((await w.A.notifications.needsAttention({ now: w.c.now() })).length, 1);
    const before = m.calls; await run(w, [m]); assert.equal(m.calls, before);
  });
  test("a permanent error (invalid recipient) is not retried", async () => {
    const w = await world(); const m = new MockNotifier({ behavior: () => { throw new NotifyError("invalid_recipient", "bad", { retryable: false }); } });
    const lid = await w.lead(w.A);
    const s = await run(w, [m]);
    assert.equal(s.failed, 1);
    w.c.adv(86400_000); await run(w, [m]);
    assert.equal(m.calls, 1);
    assert.equal((await w.A.notifications.listForLead(lid))[0].status, "failed");
  });
  test("a malformed provider response is retried and never counted as sent", async () => {
    const w = await world(); const m = new MockNotifier();
    const real = m.send.bind(m); let first = true;
    m.send = async (r) => { if (first) { first = false; return { ok: true }; } return real(r); };
    const lid = await w.lead(w.A);
    let s = await run(w, [m]);
    assert.deepEqual([s.sent, s.retryScheduled], [0, 1]);
    w.c.adv(120_000);
    s = await run(w, [m]);
    assert.equal(s.sent, 1);
    assert.equal(m.outbox.length, 1);
    assert.equal((await w.A.notifications.listForLead(lid))[0].attempts, 2);
  });
  test("a provider that hangs is cut off by the timeout and retried", async () => {
    const w = await world(); const m = new MockNotifier({ behavior: () => new Promise(() => {}) });
    const lid = await w.lead(w.A);
    const s = await run(w, [m], { sendTimeoutMs: 20 });
    assert.deepEqual([s.sent, s.retryScheduled], [0, 1]);
    assert.equal((await w.A.notifications.listForLead(lid))[0].last_error, "timeout");
  });
  test("an unknown exception becomes a safe code; no message text is stored", async () => {
    const w = await world(); const m = new MockNotifier({ behavior: () => { throw new Error("key sk-SECRET bad for jane@example.com"); } });
    const lid = await w.lead(w.A);
    await run(w, [m]);
    const row = await w.A.notifications.get((await w.A.notifications.listForLead(lid))[0].id);
    assert.equal(row.last_error, "unknown_error");
    assert.ok(!JSON.stringify(await w.db.all("SELECT * FROM notification_attempts")).includes("SECRET"));
  });
  test("a channel with no provider fails permanently as no_provider", async () => {
    const w = await world({ contacts: ["sms"] }); const m = new MockNotifier(); m.channels = ["email"];
    const lid = await w.lead(w.A);
    await run(w, [m]);
    const n = (await w.A.notifications.listForLead(lid))[0];
    assert.deepEqual([n.status, n.last_error], ["failed", "no_provider"]);
    assert.equal(m.calls, 0);
  });
  test("backoff grows and emergencies retry faster than normal", () => {
    assert.ok(backoffMs("normal", 2) > backoffMs("normal", 1));
    for (let a = 1; a <= 5; a++) assert.ok(backoffMs("emergency", a) < backoffMs("normal", a), String(a));
    assert.equal(backoffMs("normal", 99), backoffMs("normal", 5));
  });
});

describe("priority and emergencies", () => {
  test("the provider is called for emergencies first, then urgent, then normal", async () => {
    const w = await world(); const m = new MockNotifier();
    await w.lead(w.A, { priority: "normal", phone: "+15125550101" });
    await w.lead(w.A, { priority: "urgent", phone: "+15125550102" });
    await w.lead(w.A, { priority: "emergency", phone: "+15125550103" });
    await run(w, [m]);
    assert.deepEqual(m.outbox.map((x) => x.priority), ["emergency", "urgent", "normal"]);
  });
  test("with limited capacity per run, the emergency is sent and a normal one waits", async () => {
    const w = await world(); const m = new MockNotifier();
    await w.lead(w.A, { priority: "normal", phone: "+15125550101" });
    await w.lead(w.A, { priority: "emergency", phone: "+15125550103" });
    await run(w, [m], { perBusinessLimit: 1 });
    assert.deepEqual(m.outbox.map((x) => x.priority), ["emergency"]);
  });
  test("an emergency goes to every verified channel; if SMS fails, email still goes out", async () => {
    const w = await world({ contacts: ["email", "sms"] });
    const email = new MockNotifier(); email.channels = ["email"];
    const sms = new MockNotifier({ behavior: down }); sms.channels = ["sms"];
    const lid = await w.lead(w.A, { priority: "emergency" });
    await run(w, [email, sms]);
    const rows = await w.A.notifications.listForLead(lid);
    assert.deepEqual(rows.map((r) => [r.channel, r.status]).sort(), [["email", "sent"], ["sms", "queued"]]);
    assert.match(email.outbox[0].subject, /EMERGENCY/);
  });
  test("emergency retries use the faster schedule and more attempts", async () => {
    const w = await world(); const m = new MockNotifier({ behavior: down });
    const lid = await w.lead(w.A, { priority: "emergency" });
    await run(w, [m]);
    const n = await w.A.notifications.get((await w.A.notifications.listForLead(lid))[0].id);
    assert.equal(new Date(n.next_attempt_at).getTime() - w.c.t, backoffMs("emergency", 1));
    assert.equal(n.max_attempts, 8);
  });
  test("an emergency nobody could be told about appears in needsAttention with emergency priority first", async () => {
    const w = await world({ contacts: [] }); const m = new MockNotifier();
    await w.lead(w.A, { priority: "normal", phone: "+15125550101" });
    await w.lead(w.A, { priority: "emergency", phone: "+15125550102" });
    await run(w, [m]);
    const a = await w.A.notifications.needsAttention({ now: w.c.now() });
    assert.deepEqual(a.map((x) => [x.priority, x.status]), [["emergency", "undeliverable"], ["normal", "undeliverable"]]);
    assert.equal(m.calls, 0);
  });
});

describe("database failures", () => {
  test("database down when listing work: reports not-ok, sends nothing", async () => {
    const w = await world(); const m = new MockNotifier();
    await w.lead(w.A);
    const real = w.db.all.bind(w.db);
    w.db.all = async () => { throw new Error("D1 down"); };
    const s = await run(w, [m]);
    w.db.all = real;
    assert.deepEqual([s.ok, m.calls], [false, 0]);
    assert.deepEqual(s.errors, ["database_unavailable"]);
  });
  test("claim fails: nothing is sent, row stays queued, next run succeeds", async () => {
    const w = await world(); const m = new MockNotifier();
    const lid = await w.lead(w.A);
    const real = w.db.run.bind(w.db);
    w.db.run = async (sql, p) => { if (/SET status = 'sending'/.test(sql)) throw new Error("D1 write failed"); return real(sql, p); };
    const s = await run(w, [m]);
    w.db.run = real;
    assert.deepEqual([s.ok, m.calls], [false, 0]);
    assert.equal((await w.A.notifications.listForLead(lid))[0].status, "queued");
    assert.equal((await run(w, [m])).sent, 1);
  });
  test("database fails AFTER the provider accepted: not reported as sent; the re-send is deduplicated by idempotency key", async () => {
    const w = await world(); const m = new MockNotifier();
    const lid = await w.lead(w.A);
    const real = w.db.batch.bind(w.db);
    w.db.batch = async (s) => { if (s.some((x) => /status = 'sent'/.test(x.sql))) throw new Error("D1 write failed"); return real(s); };
    let r = await run(w, [m], { leaseMs: 30_000 });
    w.db.batch = real;
    assert.deepEqual([r.ok, r.sent, r.unrecorded], [false, 0, 1]);
    assert.equal(m.outbox.length, 1);
    let n = (await w.A.notifications.listForLead(lid))[0];
    assert.equal(n.status, "sending");
    assert.doesNotMatch(describeStatus(n), /delivered|accepted/i);
    w.c.adv(31_000);
    r = await run(w, [m], { leaseMs: 30_000 });
    assert.equal(r.sent, 1);
    assert.equal(m.calls, 2);
    assert.equal(m.outbox.length, 1); // still ONE message
    n = (await w.A.notifications.listForLead(lid))[0];
    assert.deepEqual([n.status, n.attempts], ["sent", 2]);
    assert.deepEqual((await w.A.notifications.attempts(n.id)).map((a) => a.outcome), ["lease_expired", "accepted"]);
  });
  test("database fails when recording a provider error: row is not lost, retried after the lease", async () => {
    const w = await world(); const m = new MockNotifier({ behavior: down });
    const lid = await w.lead(w.A);
    const real = w.db.batch.bind(w.db);
    w.db.batch = async (s) => { if (s.some((x) => /notification_retry_scheduled|notification_failed/.test(JSON.stringify(x.params)))) throw new Error("D1 down"); return real(s); };
    const r = await run(w, [m], { leaseMs: 30_000 });
    w.db.batch = real;
    assert.equal(r.ok, false);
    assert.equal((await w.A.notifications.listForLead(lid))[0].status, "sending");
    w.c.adv(31_000);
    await run(w, [m], { leaseMs: 30_000 });
    assert.equal((await w.A.notifications.listForLead(lid))[0].attempts, 2);
  });
  test("two dispatchers running at the same time send one message", async () => {
    const w = await world(); const m = new MockNotifier();
    await w.lead(w.A);
    await Promise.all([run(w, [m]), run(w, [m]), run(w, [m])]);
    assert.equal(m.outbox.length, 1);
    assert.equal(m.calls, 1);
  });
});

describe("cross-business isolation", () => {
  test("each business's notifications go only to its own contact and contain only its own customer", async () => {
    const w = await world(); const m = new MockNotifier();
    await w.lead(w.A, { name: "Alice Acme", phone: "+15125550111", issue: "acme secret issue" });
    await w.lead(w.B, { name: "Bob Bravo", phone: "+15125550222", issue: "bravo secret issue" });
    await run(w, [m]);
    assert.equal(m.outbox.length, 2);
    const toA = m.outbox.find((x) => x.to === "owner@acme.example");
    const toB = m.outbox.find((x) => x.to === "owner@bravo.example");
    assert.ok(toA.text.includes("Alice Acme") && !/Bob|bravo/i.test(toA.subject + toA.text));
    assert.ok(toB.text.includes("Bob Bravo") && !/Alice|acme/i.test(toB.subject + toB.text));
    assert.match(toA.subject, /Acme/); assert.match(toB.subject, /Bravo/);
  });
  test("one business's failures do not block or alter another's", async () => {
    const w = await world();
    const m = new MockNotifier({ behavior: (req) => { if (req.to.includes("acme")) down(); } });
    const la = await w.lead(w.A); const lb = await w.lead(w.B);
    await run(w, [m]);
    assert.equal((await w.A.notifications.listForLead(la))[0].status, "queued");
    assert.equal((await w.B.notifications.listForLead(lb))[0].status, "sent");
    assert.deepEqual(await w.B.notifications.needsAttention({ now: w.c.now() }), []);
  });
  test("a business with no verified contact is undeliverable and never receives another business's contact", async () => {
    const w = await world({ contacts: [] }); const m = new MockNotifier();
    await w.A.notifications.contacts.add({ channel: "email", address: "owner@acme.example", verified: true });
    await w.lead(w.A); const lb = await w.lead(w.B);
    await run(w, [m]);
    assert.deepEqual(m.outbox.map((x) => x.to), ["owner@acme.example"]);
    assert.equal((await w.B.notifications.listForLead(lb))[0].status, "undeliverable");
  });
  test("idempotency keys are per business: the same lead pattern in two businesses is two messages", async () => {
    const w = await world(); const m = new MockNotifier();
    await w.lead(w.A); await w.lead(w.B);
    await run(w, [m]);
    assert.equal(new Set(m.outbox.map((x) => x.idempotencyKey)).size, 2);
  });
});

describe("hardening (found by mutation checks)", () => {
  test("a notification whose lead cannot be read fails permanently and calls no provider", async () => {
    const w = await world(); const m = new MockNotifier();
    const lid = await w.lead(w.A);
    const real = w.db.first.bind(w.db);
    w.db.first = async (sql, p) => (/FROM leads WHERE id/.test(sql) ? null : real(sql, p));
    await run(w, [m]);
    w.db.first = real;
    const n = (await w.A.notifications.listForLead(lid))[0];
    assert.deepEqual([n.status, n.last_error, m.calls], ["failed", "lead_missing", 0]);
  });
  test("a delivery receipt from a DIFFERENT provider than the one that accepted the message is ignored", async () => {
    const w = await world(); const m = new MockNotifier();
    const lid = await w.lead(w.A);
    await run(w, [m]);
    const other = new MockNotifier(); other.id = "other"; other.getDeliveryStatus = async () => ({ status: "delivered" });
    const s = await run(w, [other]);
    assert.equal(s.delivered, 0);
    assert.equal((await w.A.notifications.listForLead(lid))[0].status, "sent");
  });
  test("every status has wording that never overstates: 'delivered' only for confirmed delivery", () => {
    const base = { attempts: 2, last_error: "timeout", simulated: false };
    const said = (status, extra = {}) => describeStatus({ ...base, status, ...extra });
    assert.equal(said("sent"), "Handed to the provider. Delivery is NOT confirmed.");
    assert.equal(said("delivered"), "Delivery confirmed by the provider.");
    for (const st of ["queued", "sending", "delivery_failed", "failed", "undeliverable"]) assert.doesNotMatch(said(st), /confirmed by|has been delivered|was delivered/i, st);
    for (const st of ["delivery_failed", "failed", "undeliverable"]) assert.match(said(st), /NOT been notified/, st);
    assert.match(said("failed", { attempts: 1 }), /1 attempt\./);
    assert.match(said("failed"), /2 attempts\./);
    assert.equal(isConfirmedDelivered({ status: "delivered" }), true);
    for (const st of ["sent", "queued", "sending", "failed", "delivery_failed", "undeliverable"]) assert.equal(isConfirmedDelivered({ status: st }), false, st);
  });
});
