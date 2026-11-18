import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { forBusiness, platformRepo } from "../src/db/tenant.js";

const T0 = "2026-11-18T12:00:00.000Z";
const at = (ms) => new Date(new Date(T0).getTime() + ms).toISOString();

async function world() {
  const db = new SqliteAdapter(":memory:");
  migrate(db);
  const p = platformRepo(db);
  await p.createBusiness({ id: "acme-plumbing", name: "Acme", industry: "plumbing", siteKey: "sk_acme_000000001", origins: ["https://acme.example"] });
  await p.createBusiness({ id: "bravo-plumbing", name: "Bravo", industry: "plumbing", siteKey: "sk_bravo_00000001", origins: ["https://bravo.example"] });
  const A = forBusiness(db, "acme-plumbing"), B = forBusiness(db, "bravo-plumbing");
  const mkLead = async (T, phone = "+15125550142", extra = {}) => {
    const c = await T.conversations.create();
    const r = await T.leads.create(c.id, { name: "Jane Doe", phone, email: "jane@example.com", zip: "62701", issueText: "leak", urgency: "can_wait", ...extra });
    return { leadId: r.id, conversationId: c.id };
  };
  return { db, p, A, B, mkLead };
}

describe("contacts", () => {
  test("validated, normalized, and unverified by default", async () => {
    const { A } = await world();
    await A.notifications.contacts.add({ channel: "email", address: "Owner@Acme.Example" });
    await A.notifications.contacts.add({ channel: "sms", address: "(512) 555-0100" });
    const l = await A.notifications.contacts.list();
    assert.deepEqual(l.map((c) => [c.channel, c.address, c.verified_at]), [["email", "owner@acme.example", null], ["sms", "+15125550100", null]]);
  });
  test("rejects bad addresses and unknown channels", async () => {
    const { A } = await world();
    for (const c of [{ channel: "email", address: "nope" }, { channel: "email", address: "a@b.c\r\nBcc: x@y.z" }, { channel: "sms", address: "123" }, { channel: "fax", address: "x" }, { channel: "sms", address: "+44 20 7946 0958" }])
      await assert.rejects(A.notifications.contacts.add(c), (e) => e.code === "invalid_data", JSON.stringify(c));
  });
  test("a business cannot verify, enable, or see another business's contact", async () => {
    const { A, B } = await world();
    const { id } = await A.notifications.contacts.add({ channel: "email", address: "o@acme.example" });
    await assert.rejects(B.notifications.contacts.markVerified(id), (e) => e.code === "not_found");
    await assert.rejects(B.notifications.contacts.setEnabled(id, false), (e) => e.code === "not_found");
    assert.deepEqual(await B.notifications.contacts.list(), []);
    assert.equal((await A.notifications.contacts.list())[0].verified_at, null);
  });
});

describe("enqueue", () => {
  let w;
  beforeEach(async () => { w = await world(); });
  const setup = async (verified = true) => {
    const { A } = w;
    const e = await A.notifications.contacts.add({ channel: "email", address: "o@acme.example", verified });
    const s = await A.notifications.contacts.add({ channel: "sms", address: "512-555-0100", verified });
    return { e, s };
  };

  test("normal priority goes to email only; the row starts queued with 0 attempts", async () => {
    await setup();
    const { leadId, conversationId } = await w.mkLead(w.A);
    const r = await w.A.notifications.enqueueForLead({ leadId, conversationId, kind: "new_lead", priority: "normal", now: T0 });
    assert.deepEqual(r, { created: 1, existing: 0, undeliverable: false });
    const rows = await w.A.notifications.listForLead(leadId);
    assert.deepEqual(rows.map((x) => [x.channel, x.status, x.attempts]), [["email", "queued", 0]]);
  });
  test("an emergency goes to EVERY verified channel", async () => {
    await setup();
    const { leadId, conversationId } = await w.mkLead(w.A);
    const r = await w.A.notifications.enqueueForLead({ leadId, conversationId, kind: "new_lead", priority: "emergency", now: T0 });
    assert.equal(r.created, 2);
    assert.deepEqual((await w.A.notifications.listForLead(leadId)).map((x) => x.channel).sort(), ["email", "sms"]);
  });
  test("unverified and disabled contacts are never used; the lead is marked undeliverable", async () => {
    const { e } = await setup(false);
    const { leadId, conversationId } = await w.mkLead(w.A);
    let r = await w.A.notifications.enqueueForLead({ leadId, conversationId, kind: "new_lead", priority: "emergency", now: T0 });
    assert.equal(r.undeliverable, true);
    const row = (await w.A.notifications.listForLead(leadId))[0];
    assert.deepEqual([row.channel, row.status, row.last_error], ["none", "undeliverable", "no_verified_contact"]);
    await w.A.notifications.contacts.markVerified(e.id);
    await w.A.notifications.contacts.setEnabled(e.id, false);
    const l2 = await w.mkLead(w.A, "+15125550177");
    r = await w.A.notifications.enqueueForLead({ leadId: l2.leadId, conversationId: l2.conversationId, kind: "new_lead", priority: "normal", now: T0 });
    assert.equal(r.undeliverable, true);
  });
  test("no contacts at all: undeliverable, nothing queued to send", async () => {
    const { leadId, conversationId } = await w.mkLead(w.A);
    await w.A.notifications.enqueueForLead({ leadId, conversationId, kind: "new_lead", priority: "normal", now: T0 });
    assert.deepEqual(await w.A.notifications.claimDue({ now: at(1000) }), []);
    assert.deepEqual(await w.A.notifications.counts(), { undeliverable: 1 });
  });
  test("IDEMPOTENT: enqueueing the same thing again creates nothing", async () => {
    await setup();
    const { leadId, conversationId } = await w.mkLead(w.A);
    const args = { leadId, conversationId, kind: "new_lead", priority: "normal", now: T0 };
    await w.A.notifications.enqueueForLead(args);
    const again = await w.A.notifications.enqueueForLead(args);
    assert.deepEqual(again, { created: 0, existing: 1, undeliverable: false });
    assert.equal((await w.A.notifications.listForLead(leadId)).length, 1);
  });
  test("different kinds for one lead are separate notifications", async () => {
    await setup();
    const { leadId, conversationId } = await w.mkLead(w.A);
    await w.A.notifications.enqueueForLead({ leadId, conversationId, kind: "new_lead", priority: "normal", now: T0 });
    await w.A.notifications.enqueueForLead({ leadId, conversationId, kind: "human_requested", priority: "normal", now: T0 });
    assert.equal((await w.A.notifications.listForLead(leadId)).length, 2);
  });
  test("invalid kind or priority is rejected", async () => {
    const { leadId, conversationId } = await w.mkLead(w.A);
    await assert.rejects(w.A.notifications.enqueueForLead({ leadId, conversationId, kind: "spam", priority: "normal" }), (e) => e.code === "invalid_data");
    await assert.rejects(w.A.notifications.enqueueForLead({ leadId, conversationId, kind: "new_lead", priority: "whenever" }), (e) => e.code === "invalid_data");
  });
  test("another business cannot enqueue for this business's lead (composite FK)", async () => {
    await setup();
    const { leadId, conversationId } = await w.mkLead(w.A);
    await w.B.notifications.contacts.add({ channel: "email", address: "o@bravo.example", verified: true });
    await assert.rejects(w.B.notifications.enqueueForLead({ leadId, conversationId, kind: "new_lead", priority: "normal", now: T0 }), (e) => e.code === "constraint");
    assert.deepEqual(await w.B.notifications.counts(), {});
    assert.deepEqual(await w.A.notifications.counts(), {});
  });
});

describe("claiming, leases, priority", () => {
  let w, ids;
  beforeEach(async () => {
    w = await world();
    await w.A.notifications.contacts.add({ channel: "email", address: "o@acme.example", verified: true });
    ids = {};
    for (const [name, pr, phone, t] of [["normal", "normal", "+15125550101", 0], ["urgent", "urgent", "+15125550102", 1], ["emergency", "emergency", "+15125550103", 2]]) {
      const l = await w.mkLead(w.A, phone);
      await w.A.notifications.enqueueForLead({ leadId: l.leadId, conversationId: l.conversationId, kind: "new_lead", priority: pr, now: at(t) });
      ids[name] = l.leadId;
    }
  });
  test("emergencies are claimed first, then urgent, then normal, regardless of age", async () => {
    const got = await w.A.notifications.claimDue({ now: at(10_000), limit: 10 });
    assert.deepEqual(got.map((n) => n.priority), ["emergency", "urgent", "normal"]);
  });
  test("a row is claimed once; a second claim gets nothing; attempt number is recorded", async () => {
    const first = await w.A.notifications.claimDue({ now: at(10_000), limit: 1 });
    assert.equal(first.length, 1);
    assert.equal(first[0].attempts, 1);
    const rest = await w.A.notifications.claimDue({ now: at(10_000), limit: 10 });
    assert.equal(rest.length, 2);
    assert.deepEqual(await w.A.notifications.claimDue({ now: at(10_000), limit: 10 }), []);
    assert.deepEqual((await w.A.notifications.attempts(first[0].id)).map((a) => a.attempt_no), [1]);
  });
  test("rows not yet due are not claimed", async () => {
    assert.deepEqual(await w.A.notifications.claimDue({ now: at(-60_000) }), []);
  });
  test("a crashed dispatcher's row is reclaimed after the lease expires, and the dead attempt is recorded", async () => {
    const [n] = await w.A.notifications.claimDue({ now: at(10_000), limit: 1, leaseMs: 30_000 });
    assert.deepEqual(await w.A.notifications.claimDue({ now: at(20_000), limit: 1, leaseMs: 30_000 }).then((r) => r.filter((x) => x.id === n.id)), []);
    const again = await w.A.notifications.claimDue({ now: at(60_000), limit: 10, leaseMs: 30_000 });
    const re = again.find((x) => x.id === n.id);
    assert.equal(re.attempts, 2);
    assert.deepEqual((await w.A.notifications.attempts(n.id)).map((a) => a.outcome), ["lease_expired", null]);
  });
  test("lease-expiry cannot loop forever: after max attempts the row fails", async () => {
    const [n] = await w.A.notifications.claimDue({ now: at(10_000), limit: 1 });
    await w.db.run("UPDATE notifications SET attempts = max_attempts WHERE id = ?", [n.id]);
    const got = await w.A.notifications.claimDue({ now: at(10_000_000), limit: 10 });
    assert.ok(!got.some((x) => x.id === n.id));
    assert.equal((await w.A.notifications.get(n.id)).status, "failed");
    assert.equal((await w.A.notifications.get(n.id)).last_error, "lease_expired_exhausted");
  });
  test("business B can neither claim nor settle A's notifications", async () => {
    const [n] = await w.A.notifications.claimDue({ now: at(10_000), limit: 1 });
    await w.B.notifications.contacts.add({ channel: "email", address: "o@bravo.example", verified: true });
    assert.deepEqual(await w.B.notifications.claimDue({ now: at(10_000) }), []);
    await assert.rejects(w.B.notifications.recordAccepted(n.id, 1, { providerId: "mock", providerMessageId: "x", simulated: true }), (e) => e.code === "not_found");
    await assert.rejects(w.B.notifications.recordFailure(n.id, 1, { code: "x", retryable: false }), (e) => e.code === "not_found");
    assert.equal(await w.B.notifications.get(n.id), null);
    assert.equal((await w.A.notifications.get(n.id)).status, "sending");
  });
});

describe("status transitions are honest", () => {
  let w, n;
  beforeEach(async () => {
    w = await world();
    await w.A.notifications.contacts.add({ channel: "email", address: "o@acme.example", verified: true });
    const l = await w.mkLead(w.A);
    await w.A.notifications.enqueueForLead({ leadId: l.leadId, conversationId: l.conversationId, kind: "new_lead", priority: "normal", now: T0 });
    [n] = await w.A.notifications.claimDue({ now: at(1000) });
  });
  test("accepted means 'sent', never 'delivered'", async () => {
    await w.A.notifications.recordAccepted(n.id, 1, { providerId: "mock", providerMessageId: "m1", simulated: true, now: at(2000) });
    const row = await w.A.notifications.get(n.id);
    assert.equal(row.status, "sent");
    assert.equal(row.delivered_at, null);
    assert.equal(row.simulated, 1);
  });
  test("delivery can be recorded only from 'sent', and failure is recorded as such", async () => {
    await assert.rejects(w.A.notifications.recordDelivery(n.id, { delivered: true }), (e) => e.code === "not_found"); // still 'sending'
    await w.A.notifications.recordAccepted(n.id, 1, { providerId: "mock", providerMessageId: "m1", simulated: true });
    await w.A.notifications.recordDelivery(n.id, { delivered: false, code: "mailbox_full" });
    assert.equal((await w.A.notifications.get(n.id)).status, "delivery_failed");
    await assert.rejects(w.A.notifications.recordDelivery(n.id, { delivered: true }), (e) => e.code === "not_found");
  });
  test("a retryable failure requeues with a later time and keeps the attempt history", async () => {
    const r = await w.A.notifications.recordFailure(n.id, 1, { code: "provider_unavailable", retryable: true, retryAt: at(60_000), now: at(2000) });
    assert.equal(r.requeued, true);
    const row = await w.A.notifications.get(n.id);
    assert.deepEqual([row.status, row.next_attempt_at, row.last_error], ["queued", at(60_000), "provider_unavailable"]);
    assert.deepEqual(await w.A.notifications.claimDue({ now: at(30_000) }), []);
    assert.equal((await w.A.notifications.claimDue({ now: at(61_000) })).length, 1);
  });
  test("a permanent failure ends in 'failed' and is not retried", async () => {
    await w.A.notifications.recordFailure(n.id, 1, { code: "invalid_recipient", retryable: false });
    assert.equal((await w.A.notifications.get(n.id)).status, "failed");
    assert.deepEqual(await w.A.notifications.claimDue({ now: at(10_000_000) }), []);
  });
  test("retries stop at max_attempts", async () => {
    await w.db.run("UPDATE notifications SET attempts = max_attempts WHERE id = ?", [n.id]);
    const r = await w.A.notifications.recordFailure(n.id, 1, { code: "provider_unavailable", retryable: true, retryAt: at(5000) });
    assert.equal(r.requeued, false);
    assert.equal((await w.A.notifications.get(n.id)).status, "failed");
  });
  test("stored error codes are sanitized: free text or customer data can never be stored", async () => {
    await w.A.notifications.recordFailure(n.id, 1, { code: "Jane Doe 512-555-0142 rejected: <html>", retryable: false });
    assert.equal((await w.A.notifications.get(n.id)).last_error, "unknown_error");
  });
  test("needsAttention lists failed, undeliverable, delivery_failed, and stale 'sent' only", async () => {
    await w.A.notifications.recordAccepted(n.id, 1, { providerId: "mock", providerMessageId: "m1", simulated: true, now: at(2000) });
    assert.deepEqual(await w.A.notifications.needsAttention({ now: at(60_000) }), []);
    const stale = await w.A.notifications.needsAttention({ now: at(2000 + 16 * 60_000) });
    assert.equal(stale.length, 1);
    assert.equal(stale[0].status, "sent");
    assert.deepEqual(await w.B.notifications.needsAttention({ now: at(2000 + 16 * 60_000) }), []);
  });
});

describe("reconcile missing notifications", () => {
  test("a lead that was saved but never queued is found and queued exactly once", async () => {
    const w = await world();
    await w.A.notifications.contacts.add({ channel: "email", address: "o@acme.example", verified: true });
    const l1 = await w.mkLead(w.A, "+15125550101");
    const l2 = await w.mkLead(w.A, "+15125550102", { emergency: true });
    await w.A.notifications.enqueueForLead({ leadId: l1.leadId, conversationId: l1.conversationId, kind: "new_lead", priority: "normal" });
    const first = await w.A.notifications.reconcileMissing();
    assert.deepEqual(first, { checked: 1, enqueued: 1 });
    assert.equal((await w.A.notifications.listForLead(l2.leadId))[0].priority, "emergency");
    assert.deepEqual(await w.A.notifications.reconcileMissing(), { checked: 0, enqueued: 0 });
  });
  test("does not touch another business's leads", async () => {
    const w = await world();
    await w.mkLead(w.A);
    assert.deepEqual(await w.B.notifications.reconcileMissing(), { checked: 0, enqueued: 0 });
    assert.deepEqual(await w.B.notifications.counts(), {});
  });
});

describe("isolation and privacy of the outbox", () => {
  test("counts and lists are per business", async () => {
    const w = await world();
    for (const [T, addr] of [[w.A, "o@acme.example"], [w.B, "o@bravo.example"]]) await T.notifications.contacts.add({ channel: "email", address: addr, verified: true });
    const la = await w.mkLead(w.A);
    await w.A.notifications.enqueueForLead({ leadId: la.leadId, conversationId: la.conversationId, kind: "new_lead", priority: "normal", now: T0 });
    assert.deepEqual(await w.A.notifications.counts(), { queued: 1 });
    assert.deepEqual(await w.B.notifications.counts(), {});
    assert.deepEqual(await w.B.notifications.listForLead(la.leadId), []);
    assert.deepEqual(await w.B.notifications.attempts("anything"), []);
  });
  test("platform lookup returns business ids only, never customer or recipient data", async () => {
    const w = await world();
    await w.A.notifications.contacts.add({ channel: "email", address: "o@acme.example", verified: true });
    const l = await w.mkLead(w.A);
    await w.A.notifications.enqueueForLead({ leadId: l.leadId, conversationId: l.conversationId, kind: "new_lead", priority: "normal", now: T0 });
    assert.deepEqual(await w.p.businessesWithDueNotifications(at(1000)), ["acme-plumbing"]);
    assert.deepEqual(await w.p.businessesWithDueNotifications(at(-1000)), []);
  });
  test("audit log records notification events without addresses or customer values", async () => {
    const w = await world();
    await w.A.notifications.contacts.add({ channel: "email", address: "o@acme.example", verified: true });
    const l = await w.mkLead(w.A);
    await w.A.notifications.enqueueForLead({ leadId: l.leadId, conversationId: l.conversationId, kind: "new_lead", priority: "normal", now: T0 });
    const [n] = await w.A.notifications.claimDue({ now: at(1000) });
    await w.A.notifications.recordAccepted(n.id, 1, { providerId: "mock", providerMessageId: "m1", simulated: true });
    const blob = JSON.stringify(await w.db.all("SELECT * FROM audit_log"));
    assert.ok(blob.includes("notification_sent") && blob.includes("notifications_enqueued"));
    for (const s of ["o@acme.example", "Jane Doe", "+15125550142", "jane@example.com"]) assert.ok(!blob.includes(s), s);
  });
  test("every statement through the notifications repository binds the business id (SQL spy)", async () => {
    const w = await world();
    const seen = [];
    for (const m of ["all", "first", "run"]) { const o = w.db[m].bind(w.db); w.db[m] = (sql, p = []) => { seen.push({ sql, p }); return o(sql, p); }; }
    const ob = w.db.batch.bind(w.db);
    w.db.batch = (s) => { s.forEach((x) => seen.push({ sql: x.sql, p: x.params ?? [] })); return ob(s); };
    const N = w.A.notifications;
    const c = await N.contacts.add({ channel: "email", address: "o@acme.example", verified: true });
    await N.contacts.list(); await N.contacts.markVerified(c.id); await N.contacts.setEnabled(c.id, true);
    const l = await w.mkLead(w.A);
    seen.length = 0;
    await N.enqueueForLead({ leadId: l.leadId, conversationId: l.conversationId, kind: "new_lead", priority: "normal", now: T0 });
    const [n] = await N.claimDue({ now: at(1000) });
    await N.recordFailure(n.id, 1, { code: "x_y", retryable: true, retryAt: at(5000) });
    const [n2] = await N.claimDue({ now: at(6000) });
    await N.recordAccepted(n2.id, 2, { providerId: "mock", providerMessageId: "m", simulated: true });
    await N.awaitingConfirmation(); await N.recordDelivery(n2.id, { delivered: true });
    await N.get(n.id); await N.listForLead(l.leadId); await N.attempts(n.id); await N.counts(); await N.needsAttention(); await N.reconcileMissing();
    assert.ok(seen.length > 20);
    for (const s of seen) assert.ok(s.p.includes("acme-plumbing"), `unscoped: ${s.sql.slice(0, 70)}`);
  });
});
