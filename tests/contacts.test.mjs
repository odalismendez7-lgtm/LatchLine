import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { forBusiness, platformRepo } from "../src/db/tenant.js";
import { MockMailer } from "../src/auth/mailer.js";
import { MockNotifier } from "../src/notify/mock.js";
import { dispatchDue } from "../src/notify/dispatcher.js";
import { createContactService } from "../src/dashboard/contactService.js";

const T0 = Date.parse("2026-11-19T12:00:00Z");
async function world(mailer = new MockMailer()) {
  const db = new SqliteAdapter(":memory:"); migrate(db);
  const p = platformRepo(db);
  for (const id of ["acme-plumbing", "bravo-plumbing"]) await p.createBusiness({ id, name: id, industry: "plumbing", siteKey: `sk_${id}_00000`, origins: [] });
  const c = { t: T0, adv: (ms) => { c.t += ms; } };
  const A = forBusiness(db, "acme-plumbing"), B = forBusiness(db, "bravo-plumbing");
  const svc = (T, m = mailer) => createContactService({ T, mailer: m, now: () => c.t });
  return { db, A, B, c, mailer, sA: svc(A), sB: svc(B), svc };
}
const addEmail = async (s, addr = "owner@acme.example") => (await s.add("u1", { channel: "email", address: addr })).id;

describe("contact management", () => {
  test("new contacts start unverified; bad and duplicate addresses are rejected", async () => {
    const w = await world();
    const r = await w.sA.add("u1", { channel: "email", address: "Owner@Acme.Example" });
    assert.deepEqual([r.ok, r.state], [true, "unverified"]);
    assert.equal((await w.sA.list())[0].address, "owner@acme.example");
    assert.equal((await w.sA.add("u1", { channel: "email", address: "owner@acme.example" })).code, "duplicate");
    assert.equal((await w.sA.add("u1", { channel: "email", address: "nope" })).code, "invalid_contact");
    assert.equal((await w.sA.add("u1", { channel: "fax", address: "123" })).code, "invalid_contact");
  });
  test("an unverified contact is not a notification destination", async () => {
    const w = await world();
    await addEmail(w.sA);
    const cv = await w.A.conversations.create();
    const l = await w.A.leads.create(cv.id, { name: "J", phone: "+15125550142", zip: "62701", issueText: "leak", urgency: "can_wait" });
    const r = await w.A.notifications.enqueueForLead({ leadId: l.id, conversationId: cv.id, kind: "new_lead", priority: "normal" });
    assert.equal(r.undeliverable, true);
  });
  test("remove and enable/disable work, are audited, and cannot touch another business's contact", async () => {
    const w = await world();
    const a = await addEmail(w.sA), b = await addEmail(w.sB, "owner@bravo.example");
    assert.equal((await w.sB.remove("u2", a)).code, "not_found");
    assert.equal((await w.sB.setEnabled("u2", a, false)).code, "not_found");
    assert.equal((await w.sA.list()).length, 1);
    assert.equal((await w.sA.setEnabled("u1", a, false)).ok, true);
    assert.equal((await w.sA.remove("u1", a)).ok, true);
    assert.equal((await w.sA.list()).length, 0);
    assert.equal((await w.sB.list())[0].id, b);
    const acts = (await w.A.members.audit()).map((r) => r.action);
    assert.ok(["contact_added_by_user", "contact_disabled", "contact_removed_by_user"].every((x) => acts.includes(x)));
  });
});

describe("verification with the MOCK sender is labeled simulated and never counts as real", () => {
  test("code goes only to the mock outbox; result is 'simulated_verified', verified_at stays null", async () => {
    const w = await world();
    const id = await addEmail(w.sA);
    const s = await w.sA.sendCode("u1", id);
    assert.equal(s.ok, true); assert.equal(s.simulated, true); assert.match(s.notice, /SIMULATED/);
    const mail = w.mailer.last("contact_verification", "owner@acme.example");
    assert.equal(mail.simulated, true);
    const r = await w.sA.confirmCode("u1", id, mail.data.code);
    assert.deepEqual([r.ok, r.state, r.simulated], [true, "simulated_verified", true]);
    const c = (await w.sA.list())[0];
    assert.equal(c.verifiedAt, null);
    assert.ok(c.simulatedVerifiedAt);
    assert.equal(c.state, "simulated_verified");
  });
  test("the plaintext code is never stored", async () => {
    const w = await world();
    const id = await addEmail(w.sA);
    await w.sA.sendCode("u1", id);
    const code = w.mailer.last("contact_verification").data.code;
    const dump = JSON.stringify(await w.db.all("SELECT * FROM contact_verifications")) + JSON.stringify(await w.db.all("SELECT * FROM audit_log"));
    assert.ok(!dump.includes(`"${code}"`) && !dump.includes(code + '"'));
  });
  test("wrong code is rejected; five wrong guesses kill the code, even the right one afterwards", async () => {
    const w = await world();
    const id = await addEmail(w.sA);
    await w.sA.sendCode("u1", id);
    const good = w.mailer.last("contact_verification").data.code;
    const bad = good === "000000" ? "111111" : "000000";
    const res = [];
    for (let i = 0; i < 5; i++) res.push((await w.sA.confirmCode("u1", id, bad)).code);
    assert.deepEqual(res, ["wrong_code", "wrong_code", "wrong_code", "wrong_code", "too_many_attempts"]);
    assert.equal((await w.sA.confirmCode("u1", id, good)).code, "too_many_attempts");
    assert.equal((await w.sA.list())[0].state, "unverified");
  });
  test("parallel guesses cannot beat the attempt limit", async () => {
    const w = await world();
    const id = await addEmail(w.sA);
    await w.sA.sendCode("u1", id);
    const good = w.mailer.last("contact_verification").data.code;
    const bad = good === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 12 }, () => w.sA.confirmCode("u1", id, bad)));
    assert.equal((await w.db.first("SELECT attempts FROM contact_verifications")).attempts, 5);
    assert.equal((await w.sA.confirmCode("u1", id, good)).ok, false);
    assert.equal((await w.sA.list())[0].state, "unverified");
  });
  test("codes expire after 10 minutes; a code works once", async () => {
    const w = await world();
    const id = await addEmail(w.sA);
    await w.sA.sendCode("u1", id);
    const code = w.mailer.last("contact_verification").data.code;
    w.c.adv(11 * 60_000);
    assert.equal((await w.sA.confirmCode("u1", id, code)).code, "expired");
    w.c.adv(2 * 60_000);
    await w.sA.sendCode("u1", id);
    const c2 = w.mailer.last("contact_verification").data.code;
    assert.equal((await w.sA.confirmCode("u1", id, c2)).ok, true);
    assert.equal((await w.sA.confirmCode("u1", id, c2)).code, "no_open_code");
  });
  test("malformed codes and codes for nothing are rejected", async () => {
    const w = await world();
    const id = await addEmail(w.sA);
    for (const bad of [null, "", "12345", "1234567", "abcdef", 123456, "123 456"]) assert.equal((await w.sA.confirmCode("u1", id, bad)).ok, false);
    assert.equal((await w.sA.confirmCode("u1", id, "123456")).code, "no_open_code");
    assert.equal((await w.sA.confirmCode("u1", "ctc_nope", "123456")).code, "not_found");
  });
  test("resend cooldown (60 s), daily cap (5), and a new code cancels the old one", async () => {
    const w = await world();
    const id = await addEmail(w.sA);
    assert.equal((await w.sA.sendCode("u1", id)).ok, true);
    const first = w.mailer.last("contact_verification").data.code;
    const cool = await w.sA.sendCode("u1", id);
    assert.equal(cool.code, "cooldown"); assert.ok(cool.retryAfterSec >= 1);
    w.c.adv(61_000);
    assert.equal((await w.sA.sendCode("u1", id)).ok, true);
    const second = w.mailer.last("contact_verification").data.code;
    if (first !== second) assert.equal((await w.sA.confirmCode("u1", id, first)).ok, false);
    for (let i = 0; i < 3; i++) { w.c.adv(61_000); assert.equal((await w.sA.sendCode("u1", id)).ok, true); }
    w.c.adv(61_000);
    assert.equal((await w.sA.sendCode("u1", id)).code, "daily_limit");
    w.c.adv(24 * 3600_000);
    assert.equal((await w.sA.sendCode("u1", id)).ok, true);
  });
  test("a send failure is reported honestly", async () => {
    const m = new MockMailer(); m.send = async () => { throw new Error("down"); };
    const w = await world(m);
    const id = await addEmail(w.sA);
    assert.equal((await w.sA.sendCode("u1", id)).code, "send_failed");
  });
  test("one business cannot start or confirm verification of another business's contact", async () => {
    const w = await world();
    const id = await addEmail(w.sA);
    assert.equal((await w.sB.sendCode("u2", id)).code, "not_found");
    await w.sA.sendCode("u1", id);
    const code = w.mailer.last("contact_verification").data.code;
    assert.equal((await w.sB.confirmCode("u2", id, code)).code, "not_found");
    assert.equal((await w.sA.list())[0].state, "unverified");
  });
});

describe("real verification needs a real (non-simulated) sender", () => {
  const realMailer = () => ({ simulated: false, outbox: [], async send(m) { this.outbox.push(m); return { messageId: "x", simulated: false }; } }); // test double only
  test("a non-simulated sender yields verified_at", async () => {
    const m = realMailer(); const w = await world(m);
    const id = await addEmail(w.sA);
    const s = await w.sA.sendCode("u1", id);
    assert.equal(s.simulated, false);
    const r = await w.sA.confirmCode("u1", id, m.outbox[0].data.code);
    assert.deepEqual([r.ok, r.state], [true, "verified"]);
    assert.ok((await w.sA.list())[0].verifiedAt);
    assert.equal((await w.sA.sendCode("u1", id)).code, "already_verified");
  });
  test("a code issued by the mock cannot be upgraded to real verification later", async () => {
    const w = await world();
    const id = await addEmail(w.sA);
    await w.sA.sendCode("u1", id);
    const code = w.mailer.last("contact_verification").data.code;
    const real = w.svc(w.A, realMailer());
    const r = await real.confirmCode("u1", id, code);
    assert.equal(r.state, "simulated_verified");
    assert.equal((await w.sA.list())[0].verifiedAt, null);
  });
});

describe("simulated contacts only ever receive MOCK notifications", () => {
  async function leadFor(w) {
    const cv = await w.A.conversations.create();
    const l = await w.A.leads.create(cv.id, { name: "J", phone: "+15125550142", zip: "62701", issueText: "leak", urgency: "can_wait" });
    await w.A.notifications.enqueueForLead({ leadId: l.id, conversationId: cv.id, kind: "new_lead", priority: "normal", now: new Date(w.c.t).toISOString() });
    return l.id;
  }
  async function simVerified(w) {
    const id = await addEmail(w.sA);
    await w.sA.sendCode("u1", id);
    await w.sA.confirmCode("u1", id, w.mailer.last("contact_verification").data.code);
  }
  test("mock provider may notify a simulated-verified contact", async () => {
    const w = await world(); await simVerified(w); await leadFor(w);
    const mock = new MockNotifier();
    const s = await dispatchDue({ db: w.db, channels: { email: mock, sms: mock }, now: () => new Date(w.c.t).toISOString() });
    assert.equal(s.sent, 1);
    assert.equal(mock.outbox.length, 1);
  });
  test("a non-simulated provider REFUSES to send to a simulated-only contact", async () => {
    const w = await world(); await simVerified(w); await leadFor(w);
    const calls = [];
    const real = { id: "real", channels: ["email", "sms"], simulated: false, async send(r) { calls.push(r); return { providerId: "real", providerMessageId: "m1", simulated: false }; } }; // test double only
    const s = await dispatchDue({ db: w.db, channels: { email: real, sms: real }, now: () => new Date(w.c.t).toISOString() });
    assert.equal(calls.length, 0);
    assert.equal(s.sent, 0);
    const n = await w.db.first("SELECT status, last_error FROM notifications");
    assert.equal(n.status, "failed"); assert.equal(n.last_error, "contact_not_verified");
  });
  test("a really verified contact may be sent to by a non-simulated provider", async () => {
    const w = await world();
    const id = (await w.A.notifications.contacts.add({ channel: "email", address: "owner@acme.example", verified: true })).id;
    assert.ok(id);
    await leadFor(w);
    const calls = [];
    const real = { id: "real", channels: ["email"], simulated: false, async send(r) { calls.push(r); return { providerId: "real", providerMessageId: "m1", simulated: false }; } };
    const s = await dispatchDue({ db: w.db, channels: { email: real }, now: () => new Date(w.c.t).toISOString() });
    assert.equal(s.sent, 1); assert.equal(calls.length, 1);
  });
  test("disabling or removing a contact stops notifications to it", async () => {
    const w = await world(); await simVerified(w);
    const id = (await w.sA.list())[0].id;
    await w.sA.setEnabled("u1", id, false);
    await leadFor(w);
    assert.equal((await w.db.first("SELECT status FROM notifications")).status, "undeliverable");
  });
});
