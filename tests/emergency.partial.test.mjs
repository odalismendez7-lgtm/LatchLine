// Stage 6d (KI-23/KI-47): incomplete emergency leads. An emergency reported in chat is saved at once with ONLY what
// the customer typed (no phone/email needed), the business is alerted through the existing outbox, and the SAME lead
// is updated and completed later. Mock AI, mock notifier, in-memory SQLite: nothing is sent anywhere.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { world, chat, script, stateOf } from "./helpers/convo.mjs";
import { handleMessage } from "../src/engine/engine.js";
import { DbError } from "../src/db/errors.js";
import { forBusiness } from "../src/db/tenant.js";
import { renderNotification } from "../src/notify/render.js";
import { dispatchDue } from "../src/notify/dispatcher.js";
import { MockNotifier } from "../src/notify/mock.js";
import { NotifyError } from "../src/notify/provider.js";
import { createChannelMap } from "../src/notify/registry.js";
import { AIRouter } from "../src/ai/router.js";
import { MockProvider } from "../src/ai/mock.js";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { MemoryStore } from "../src/ratelimit/limiter.js";
import { MockMailer } from "../src/auth/mailer.js";
import { createApp } from "../src/app.js";

const GAS = "I smell gas in my kitchen";
const NOT_CLAIMS = /\b(?:notified|alerted|emailed|texted|someone (?:is|will)|on (?:the|its|their) way|help is coming|dispatched|will arrive|appointment|booked)\b/i;

async function withContacts(w, ids = ["acme-plumbing", "bravo-plumbing"]) {
  for (const id of ids) {
    const T = forBusiness(w.db, id);
    await T.notifications.contacts.add({ channel: "email", address: `owner@${id}.example`, verified: true });
    await T.notifications.contacts.add({ channel: "sms", address: id.startsWith("acme") ? "512-555-0100" : "512-555-0200", verified: true });
  }
}
const notes = (T, leadId) => T.notifications.listForLead(leadId);
const only = async (T) => { const l = await T.leads.list(); assert.equal(l.length, 1, `expected 1 lead, got ${l.length}`); return T.leads.get(l[0].id); };
const brokenBatch = (w, re, times = Infinity) => { const real = w.db.batch.bind(w.db); let n = 0; w.db.batch = async (s) => { if (n < times && s.some((x) => re.test(x.sql))) { n++; throw new Error("down"); } return real(s); }; return () => { w.db.batch = real; }; };

describe("repository: leads.update, getByConversation, variants", () => {
  async function seeded() {
    const w = await world();
    const cv = await w.A.conversations.create();
    const l = await w.A.leads.create(cv.id, { issueText: "I smell gas", urgency: "now", emergency: true, emergencyCategories: ["gas_leak"], summary: "I smell gas" });
    return { w, cv, id: l.id };
  }
  test("a lead with no phone and no email is stored and flagged contact_missing (derived, not stored)", async () => {
    const { w, id } = await seeded();
    const l = await w.A.leads.get(id);
    assert.equal(l.contact_missing, true); assert.equal(l.phone, null); assert.equal(l.email, null);
    assert.equal((await w.A.leads.list())[0].contact_missing, true);
  });
  test("update fills contact details, reports contactAdded once, and records an event + audit entry", async () => {
    const { w, id } = await seeded();
    const u = await w.A.leads.update(id, { phone: "+15125550142", name: "Pat Lee" });
    assert.deepEqual(u.changed.sort(), ["name", "phone"]); assert.equal(u.contactAdded, true);
    const l = await w.A.leads.get(id);
    assert.equal(l.contact_missing, false); assert.equal(l.phone, "+15125550142");
    const again = await w.A.leads.update(id, { phone: "+15125550142", name: "Pat Lee" });
    assert.deepEqual(again.changed, []); assert.equal(again.contactAdded, false);
    const ev = await w.db.all("SELECT type, detail FROM lead_events WHERE lead_id = ? ORDER BY rowid", [id]);
    assert.deepEqual(ev.map((e) => e.type), ["created", "updated"]);
    assert.doesNotMatch(ev[1].detail, /0142|Pat/, "events record field names, not customer data");
    assert.equal((await w.db.all("SELECT 1 FROM audit_log WHERE action = 'lead_updated' AND target = ?", [id])).length, 1);
  });
  test("update can clear a wrong phone, but never blanks the problem text or turns emergency off", async () => {
    const { w, id } = await seeded();
    await w.A.leads.update(id, { phone: "+15125550142" });
    await w.A.leads.update(id, { phone: null, issueText: "   ", emergency: false });
    const l = await w.A.leads.get(id);
    assert.equal(l.phone, null); assert.equal(l.issue_text, "I smell gas"); assert.equal(l.emergency, true);
  });
  test("emergency categories are only added, never removed", async () => {
    const { w, id } = await seeded();
    await w.A.leads.update(id, { emergencyCategories: ["flooding"] });
    await w.A.leads.update(id, { emergencyCategories: ["gas_leak"] });
    assert.deepEqual((await w.A.leads.get(id)).emergency_categories.sort(), ["flooding", "gas_leak"]);
  });
  test("update cannot touch status, ids, counters or timestamps, even if passed", async () => {
    const { w, id } = await seeded();
    await w.A.leads.update(id, { status: "won", duplicate_count: 9, id: "x", created_at: "2000-01-01", business_id: "bravo-plumbing", phone: "+15125550142" });
    const l = await w.A.leads.get(id);
    assert.equal(l.status, "new"); assert.equal(l.duplicate_count, 0); assert.equal(l.id, id); assert.equal(l.business_id, "acme-plumbing"); assert.notEqual(l.created_at, "2000-01-01");
  });
  test("an invalid phone is rejected by the database and nothing changes", async () => {
    const { w, id } = await seeded();
    await assert.rejects(() => w.A.leads.update(id, { phone: "555-0142", name: "Pat" }), DbError);
    const l = await w.A.leads.get(id);
    assert.equal(l.phone, null); assert.equal(l.name, null);
  });
  test("tenant isolation: another business cannot update or read the lead", async () => {
    const { w, id, cv } = await seeded();
    await assert.rejects(() => w.B.leads.update(id, { phone: "+15125550142" }), (e) => e.code === "not_found");
    assert.equal((await w.A.leads.get(id)).phone, null);
    assert.equal(await w.B.leads.get(id), null);
    assert.equal(await w.B.leads.getByConversation(cv.id), null);
    assert.equal((await w.A.leads.getByConversation(cv.id)).id, id);
  });
  test("a lead creation database failure leaves no half-written row", async () => {
    const w = await world();
    const cv = await w.A.conversations.create();
    const restore = brokenBatch(w, /INSERT INTO leads/);
    await assert.rejects(() => w.A.leads.create(cv.id, { issueText: "gas", emergency: true }));
    restore();
    assert.equal(await w.A.leads.count(), 0);
  });
  test("outbox variants: each variant is queued once; unknown variants are refused; the column exists", async () => {
    const w = await world(); await withContacts(w);
    const { id, cv } = await (async () => { const cv = await w.A.conversations.create(); const l = await w.A.leads.create(cv.id, { issueText: "gas", emergency: true }); return { id: l.id, cv }; })();
    const q = (variant) => w.A.notifications.enqueueForLead({ leadId: id, conversationId: cv.id, kind: "new_lead", priority: "emergency", variant });
    assert.equal((await q(null)).created, 2); assert.equal((await q(null)).created, 0);
    assert.equal((await q("contact_added")).created, 2); assert.equal((await q("contact_added")).created, 0);
    await assert.rejects(() => q("bogus"), DbError);
    assert.equal((await notes(w.A, id)).length, 4);
  });
});

describe("an emergency is saved at once, as an incomplete lead", () => {
  test("first message: lead exists with ONLY the customer's words; nothing is invented", async () => {
    const w = await world(); await withContacts(w);
    const c = chat(w.deps());
    const r = await c.say(GAS);
    const l = await only(w.A);
    assert.equal(l.issue_text, GAS);
    for (const f of ["name", "phone", "email", "zip"]) assert.equal(l[f], null, f);
    assert.equal(l.emergency, true); assert.equal(l.urgency, "now"); assert.ok(l.emergency_categories.includes("gas_leak"));
    assert.equal(l.contact_missing, true); assert.equal(l.zip_in_verified_area, "unconfirmed");
    assert.equal(r.leadStatus, "partial");
    assert.equal((await w.A.conversations.get(c.id)).leadId, l.id);
  });
  test("the customer still gets the full safety steps first, then an honest note; no claim anyone was told or is coming", async () => {
    const w = await world(); await withContacts(w);
    const r = await chat(w.deps()).say(GAS);
    assert.match(r.reply, /^[\s\S]*Leave the building/);
    assert.ok(r.reply.indexOf("Leave the building") < r.reply.indexOf("recorded your emergency message"));
    assert.match(r.reply, /no way to reach you yet/); assert.match(r.reply, /can't promise/);
    assert.match(r.reply, /phone number/i, "the next question is the phone");
    assert.doesNotMatch(r.reply.replace(/can't dispatch anyone/gi, ""), NOT_CLAIMS);
  });
  test("one emergency alert per verified channel is queued; it is 'queued', not 'delivered'", async () => {
    const w = await world(); await withContacts(w);
    await chat(w.deps()).say(GAS);
    const l = await only(w.A);
    const n = await notes(w.A, l.id);
    assert.deepEqual(n.map((x) => [x.kind, x.variant, x.priority, x.channel, x.status]).sort(), [["new_lead", null, "emergency", "email", "queued"], ["new_lead", null, "emergency", "sms", "queued"]]);
  });
  test("the alert text for a lead with no contact says so plainly and promises nothing", async () => {
    const w = await world(); await withContacts(w);
    await chat(w.deps()).say(GAS);
    const m = new MockNotifier();
    await dispatchDue({ db: w.db, channels: createChannelMap([m]) });
    const em = m.outbox.find((x) => x.channel === "email");
    assert.match(em.subject, /EMERGENCY.*NO CONTACT DETAILS.*gas smell/);
    assert.match(em.text, /has NOT given a phone number or email/); assert.match(em.text, /cannot dispatch/);
    assert.doesNotMatch(em.text, /\bnull\b|undefined|Contact the customer now/);
  });
  test("abandoned emergency (customer vanishes after the first message): the lead and alert still exist (KI-23 fixed)", async () => {
    const w = await world(); await withContacts(w);
    await chat(w.deps()).say("there is a burst pipe flooding my basement");
    const l = await only(w.A);
    assert.equal(l.contact_missing, true);
    assert.equal((await notes(w.A, l.id)).length, 2);
    assert.equal((await w.A.notifications.needsAttention()).length, 0);
  });
  test("an emergency with no verified business contact is 'undeliverable' and needs attention, honestly", async () => {
    const w = await world();
    await chat(w.deps()).say(GAS);
    const a = await w.A.notifications.needsAttention();
    assert.deepEqual(a.map((x) => [x.priority, x.status]), [["emergency", "undeliverable"]]);
  });
  test("non-emergency chats are unchanged: no lead until the request is complete", async () => {
    const w = await world();
    const c = await script(w.deps(), ["my kitchen sink drain is clogged", "Jane Doe"]);
    assert.equal(await w.A.leads.count(), 0);
    const g = await chat(w.deps()).say("hello");
    assert.equal(await w.A.leads.count(), 0);
    assert.equal(g.leadStatus, "collecting");
    void c;
  });
  test("emergency questions are asked phone first, then ZIP, then name", async () => {
    const w = await world();
    const c = chat(w.deps());
    const r1 = await c.say(GAS); assert.match(r1.reply, /phone number/i);
    const r2 = await c.say("512-555-0142"); assert.match(r2.reply, /ZIP/);
    const r3 = await c.say("62701"); assert.match(r3.reply, /first and last name/i);
  });
});

describe("incomplete details, later completion, and updates to the SAME lead", () => {
  test("a garbage 'phone' leaves the lead incomplete and stores nothing invented", async () => {
    const w = await world(); await withContacts(w);
    const c = await script(w.deps(), [GAS, "call me maybe", "123"]);
    const l = await only(w.A);
    assert.equal(l.phone, null); assert.equal(l.contact_missing, true);
    assert.equal((await notes(w.A, l.id)).length, 2, "no follow-up alert without contact details");
    void c;
  });
  test("contact arrives later: same lead is updated, contact_missing clears, exactly one follow-up alert per channel", async () => {
    const w = await world(); await withContacts(w);
    const c = await script(w.deps(), [GAS, "call me maybe", "512-555-0142"]);
    const l = await only(w.A);
    assert.equal(l.phone, "+15125550142"); assert.equal(l.contact_missing, false);
    const n = await notes(w.A, l.id);
    assert.deepEqual(n.map((x) => `${x.variant}:${x.channel}`).sort(), ["contact_added:email", "contact_added:sms", "null:email", "null:sms"]);
    await c.say("hello?"); await c.say("512-555-0142");
    assert.equal((await notes(w.A, l.id)).length, 4, "no further alerts");
  });
  test("the follow-up alert carries the contact details and says it updates an earlier alert", async () => {
    const w = await world(); await withContacts(w);
    await script(w.deps(), [GAS, "512-555-0142", "62701", "Pat Lee"]);
    const m = new MockNotifier();
    await dispatchDue({ db: w.db, channels: createChannelMap([m]) });
    const up = m.outbox.find((x) => x.channel === "email" && /UPDATE/.test(x.subject));
    assert.ok(up);
    assert.match(up.text, /Pat Lee, \+15125550142, ZIP 62701/); assert.match(up.text, /cannot dispatch/);
    assert.doesNotMatch(up.text, /\bnull\b|undefined/);
  });
  test("full flow: the same lead gets phone, ZIP and name, the chat then says recorded, and there is still one lead", async () => {
    const w = await world(); await withContacts(w);
    const c = chat(w.deps());
    for (const m of [GAS, "512-555-0142", "62701"]) await c.say(m);
    let l = await only(w.A);
    assert.equal(l.zip, "62701"); assert.equal(l.name, null);
    assert.equal((await stateOf(w.A, c.id)).stage, "collecting");
    const r = await c.say("Pat Lee");
    l = await only(w.A);
    assert.equal(l.name, "Pat Lee"); assert.equal(r.leadStatus, "saved"); assert.match(r.reply, /Your details have been recorded/); assert.match(r.reply, /can't dispatch anyone/);
    assert.equal((await stateOf(w.A, c.id)).stage, "done");
    assert.doesNotMatch(r.reply, /\bnotified|alerted|on (?:the|its|their) way|help is coming|will arrive\b/i);
  });
  test("skipping ZIP and name after giving a phone still completes the same lead", async () => {
    const w = await world();
    await script(w.deps(), [GAS, "512-555-0142", "skip", "skip"]);
    const l = await only(w.A);
    assert.equal(l.phone, "+15125550142"); assert.equal(l.zip, null); assert.equal(l.name, null);
  });
  test("email works as the contact", async () => {
    const w = await world(); await withContacts(w);
    await script(w.deps(), [GAS, "sam@customer.example"]);
    const l = await only(w.A);
    assert.equal(l.email, "sam@customer.example"); assert.equal(l.contact_missing, false);
  });
  test("contact given in the very first message: one lead, one ordinary alert, no 'contact added' follow-up", async () => {
    const w = await world(); await withContacts(w);
    await chat(w.deps()).say("I smell gas, my number is 512-555-0142");
    const l = await only(w.A);
    assert.equal(l.contact_missing, false);
    assert.deepEqual((await notes(w.A, l.id)).map((x) => x.variant), [null, null]);
  });
  test("'that's not my number' removes the wrong phone from the lead again", async () => {
    const w = await world();
    const c = await script(w.deps(), [GAS, "512-555-0142"]);
    assert.equal((await only(w.A)).phone, "+15125550142");
    await c.say("that's not my phone number");
    const l = await only(w.A);
    assert.equal(l.phone, null); assert.equal(l.contact_missing, true);
  });
  test("a correction of the phone updates the same lead", async () => {
    const w = await world();
    const c = await script(w.deps(), [GAS, "512-555-0142"]);
    await c.say("sorry, it's 512-555-0199");
    assert.equal((await only(w.A)).phone, "+15125550199");
  });
  test("a second hazard in the same chat adds its category to the same lead (no second lead, no second alert)", async () => {
    const w = await world(); await withContacts(w);
    const c = await script(w.deps(), [GAS, "also water is pouring out of a burst pipe"]);
    const l = await only(w.A);
    assert.ok(l.emergency_categories.includes("gas_leak") && l.emergency_categories.length >= 2);
    assert.equal((await notes(w.A, l.id)).length, 2);
    void c;
  });
  test("emergency + a request for a person before any contact: one human_requested alert, no duplicates on repeat", async () => {
    const w = await world(); await withContacts(w);
    const c = await script(w.deps(), [GAS, "I want a real person", "I want a real person"]);
    const l = await only(w.A);
    const n = (await notes(w.A, l.id)).filter((x) => x.kind === "human_requested");
    assert.equal(n.length, 2, "one per channel, once");
    void c;
  });
});

describe("an emergency reported AFTER a normal request was recorded", () => {
  async function recorded() {
    const w = await world(); await withContacts(w);
    const c = chat(w.deps());
    for (const m of ["my kitchen sink drain is clogged", "Jane Doe", "512-555-0142", "62701", "it can wait"]) await c.say(m);
    return { w, c };
  }
  test("the existing lead is marked emergency and the business gets one 'emergency reported' alert", async () => {
    const { w, c } = await recorded();
    const r = await c.say(GAS);
    assert.match(r.reply, /Leave the building/);
    const l = await only(w.A);
    assert.equal(l.emergency, true); assert.ok(l.emergency_categories.includes("gas_leak"));
    const n = await notes(w.A, l.id);
    assert.equal(n.filter((x) => x.variant === "emergency_added").length, 2);
    await c.say("I smell gas still");
    assert.equal((await notes(w.A, l.id)).filter((x) => x.variant === "emergency_added").length, 2, "repeat does not alert again");
  });
  test("its alert text says it concerns an existing inquiry and still promises nothing", async () => {
    const { w, c } = await recorded();
    await c.say(GAS);
    const m = new MockNotifier();
    await dispatchDue({ db: w.db, channels: createChannelMap([m]) });
    const e = m.outbox.find((x) => /EMERGENCY reported on an existing inquiry/.test(x.subject ?? x.text));
    assert.ok(e); assert.match(e.text ?? "", /cannot dispatch|dispatch/);
  });
});

describe("duplicates and retries cannot create duplicate leads or alerts", () => {
  test("the same emergency message sent 5 times: one lead, one alert per channel", async () => {
    const w = await world(); await withContacts(w);
    const c = chat(w.deps());
    for (let i = 0; i < 5; i++) await c.say(GAS);
    const l = await only(w.A);
    assert.equal((await notes(w.A, l.id)).length, 2);
  });
  test("a client retry that starts a brand-new conversation is a separate conversation (own lead), never a corrupted one", async () => {
    const w = await world(); await withContacts(w);
    await chat(w.deps()).say(GAS); await chat(w.deps()).say(GAS);
    assert.equal(await w.A.leads.count(), 2);
    const rows = await w.db.all("SELECT conversation_id, COUNT(*) n FROM leads GROUP BY conversation_id");
    assert.ok(rows.every((r) => r.n === 1));
  });
  test("parallel requests on the same conversation (a double-click): still one lead and no duplicate alerts", async () => {
    const w = await world(); await withContacts(w);
    const first = await handleMessage(w.deps(), { message: "hello" });
    const id = first.conversationId;
    const rs = await Promise.all([1, 2, 3, 4].map(() => handleMessage(w.deps(), { message: GAS, conversationId: id })));
    assert.ok(rs.every((r) => r.ok && /Leave the building/.test(r.reply)), "safety text on every response");
    const l = await only(w.A);
    const n = await notes(w.A, l.id);
    assert.equal(new Set(n.map((x) => `${x.kind}:${x.variant}:${x.channel}`)).size, n.length);
    assert.equal(n.length, 2);
    const keys = await w.db.all("SELECT idempotency_key FROM notifications");
    assert.equal(new Set(keys.map((k) => k.idempotency_key)).size, keys.length);
  });
  test("parallel contact updates (same phone twice at once): one follow-up alert per channel", async () => {
    const w = await world(); await withContacts(w);
    const c = chat(w.deps()); await c.say(GAS);
    await Promise.all([1, 2, 3].map(() => handleMessage(w.deps(), { message: "512-555-0142", conversationId: c.id })));
    const l = await only(w.A);
    assert.equal(l.phone, "+15125550142");
    assert.equal((await notes(w.A, l.id)).filter((x) => x.variant === "contact_added").length, 2);
  });
  test("a customer who re-sends details after the lead is complete gets no new lead or alert", async () => {
    const w = await world(); await withContacts(w);
    const c = await script(w.deps(), [GAS, "512-555-0142", "62701", "Pat Lee"]);
    const l = await only(w.A); const before = (await notes(w.A, l.id)).length;
    for (const m of ["512-555-0142", GAS, "Pat Lee", "thanks"]) await c.say(m);
    assert.equal(await w.A.leads.count(), 1); assert.equal((await notes(w.A, l.id)).length, before);
  });
});

describe("failures: the safety text always works, nothing is faked, and everything recovers", () => {
  test("lead save fails: safety text still shown; customer told NOT received; no lead; the next message saves it", async () => {
    const w = await world(); await withContacts(w);
    const restore = brokenBatch(w, /INSERT INTO leads/);
    const c = chat(w.deps());
    let r = await c.say(GAS);
    assert.match(r.reply, /Leave the building/); assert.match(r.reply, /NOT received/);
    assert.doesNotMatch(r.reply, /recorded your emergency message/);
    assert.equal(await w.A.leads.count(), 0); assert.equal(r.degraded.database, true); assert.equal(r.leadStatus, "collecting");
    restore();
    r = await c.say("it is still leaking, hurry");
    const l = await only(w.A);
    assert.equal(l.issue_text, GAS, "the original words are what is stored");
    assert.equal((await notes(w.A, l.id)).length, 2);
    assert.match(r.reply, /recorded your emergency message/);
  });
  test("the 'NOT received' notice is not repeated on every failing turn", async () => {
    const w = await world();
    brokenBatch(w, /INSERT INTO leads/);
    const c = chat(w.deps());
    const a = await c.say(GAS), b = await c.say("hello?"), d = await c.say("512-555-0142");
    assert.match(a.reply, /NOT received/); assert.doesNotMatch(b.reply, /NOT received/); assert.doesNotMatch(d.reply, /NOT received/);
    assert.doesNotMatch(d.reply, /has been recorded/);
  });
  test("lead update fails after contact arrives: not claimed as recorded; retried on the next message; no duplicates", async () => {
    const w = await world(); await withContacts(w);
    const c = await script(w.deps(), [GAS]);
    const restore = brokenBatch(w, /UPDATE leads SET/);
    let r = await c.say("512-555-0142");
    assert.equal(r.degraded.database, true);
    assert.equal((await only(w.A)).phone, null);
    assert.doesNotMatch(r.reply, /Your details have been recorded/);
    restore();
    r = await c.say("62701");
    const l = await only(w.A);
    assert.equal(l.phone, "+15125550142"); assert.equal(l.zip, "62701");
    assert.equal((await notes(w.A, l.id)).filter((x) => x.variant === "contact_added").length, 2);
  });
  test("the final 'recorded' is never said while the last update is failing", async () => {
    const w = await world();
    const c = await script(w.deps(), [GAS, "512-555-0142", "62701"]);
    const restore = brokenBatch(w, /UPDATE leads SET/);
    const r = await c.say("Pat Lee");
    assert.doesNotMatch(r.reply, /Your details have been recorded/); assert.match(r.reply, /NOT received/);
    assert.equal((await stateOf(w.A, c.id)).stage, "collecting");
    restore();
    const r2 = await c.say("Pat Lee");
    assert.match(r2.reply, /Your details have been recorded/);
    assert.equal((await only(w.A)).name, "Pat Lee");
  });
  test("outbox failure: the lead is saved, the alert is retried on the next message, and ends up queued exactly once", async () => {
    const w = await world(); await withContacts(w);
    const restore = brokenBatch(w, /INSERT INTO notifications/, 1);
    const c = chat(w.deps());
    const r = await c.say(GAS);
    assert.equal(r.degraded.notifications, true); assert.match(r.reply, /recorded your emergency message/);
    const l = await only(w.A);
    assert.equal((await notes(w.A, l.id)).length, 0);
    await c.say("hello?");
    restore();
    assert.equal((await notes(w.A, l.id)).length, 2);
    await c.say("hello again");
    assert.equal((await notes(w.A, l.id)).length, 2);
  });
  test("a lead saved but never queued (crash between the two) is repaired by the existing reconcile job", async () => {
    const w = await world(); await withContacts(w);
    const cv = await w.A.conversations.create();
    const lead = await w.A.leads.create(cv.id, { issueText: GAS, urgency: "now", emergency: true, emergencyCategories: ["gas_leak"], summary: GAS });
    assert.equal((await notes(w.A, lead.id)).length, 0);
    const r = await w.A.notifications.reconcileMissing();
    assert.equal(r.enqueued, 2);
    assert.ok((await notes(w.A, lead.id)).every((x) => x.priority === "emergency"));
    assert.equal((await w.A.notifications.reconcileMissing()).enqueued, 0);
  });
  test("a delivery that fails shows up as needing attention (the customer is never told anyone was notified)", async () => {
    const w = await world(); await withContacts(w);
    const r = await chat(w.deps()).say(GAS);
    const bad = new MockNotifier({ behavior: () => { throw new NotifyError("provider_rejected", "rejected", { retryable: false }); } });
    bad.channels = ["email", "sms"];
    await dispatchDue({ db: w.db, channels: createChannelMap([bad]) });
    assert.ok((await w.A.notifications.needsAttention()).length >= 1);
    assert.doesNotMatch(r.reply.replace(/can't dispatch anyone/gi, ""), NOT_CLAIMS);
  });
  test("AI down and database down: the emergency reply is still the full safety text", async () => {
    const w = await world();
    const router = new AIRouter({ providers: [new MockProvider({ handler: () => { throw new Error("outage"); } })], retries: 0 });
    const dead = { first: async () => { throw new Error("down"); }, all: async () => { throw new Error("down"); }, run: async () => { throw new Error("down"); }, batch: async () => { throw new Error("down"); } };
    const r = await handleMessage({ ...w.deps("acme-plumbing", { router }), db: dead }, { message: GAS });
    assert.match(r.reply, /Leave the building/); assert.equal(r.persisted, false); assert.equal(r.leadStatus, "not_saved");
  });
  test("every dependency failing at once during an emergency (lead save, outbox, conversation write): safety text and honesty hold", async () => {
    const w = await world();
    brokenBatch(w, /INSERT INTO (leads|notifications)|UPDATE conversations|INSERT INTO messages/);
    const r = await chat(w.deps()).say(GAS);
    assert.match(r.reply, /Leave the building/); assert.doesNotMatch(r.reply, /recorded your emergency message|Your details have been recorded/);
  });
});

describe("tenant isolation", () => {
  test("interleaved emergencies in two businesses: separate leads, alerts and contact updates; nothing crosses", async () => {
    const w = await world(); await withContacts(w);
    const a = chat(w.deps("acme-plumbing")), b = chat(w.deps("bravo-plumbing"));
    await a.say("I smell gas at my acme shop"); await b.say("carbon monoxide alarm is going off at bravo");
    await a.say("512-555-0111"); await b.say("512-555-0222");
    const la = await only(w.A), lb = await only(w.B);
    assert.equal(la.phone, "+15125550111"); assert.equal(lb.phone, "+15125550222");
    assert.match(la.issue_text, /acme/); assert.match(lb.issue_text, /bravo/);
    for (const [T, l, mail] of [[w.A, la, "owner@acme-plumbing.example"], [w.B, lb, "owner@bravo-plumbing.example"]]) {
      const n = await w.db.all("SELECT business_id, recipient FROM notifications WHERE lead_id = ?", [l.id]);
      assert.ok(n.length >= 2); assert.ok(n.every((x) => x.business_id === T.businessId));
      assert.ok(n.filter((x) => x.recipient?.includes("@")).every((x) => x.recipient === mail));
    }
  });
  test("a conversation id from business A used on business B creates a new, empty conversation (no lead update, no leak)", async () => {
    const w = await world(); await withContacts(w);
    const a = await script(w.deps("acme-plumbing"), [GAS]);
    const r = await handleMessage(w.deps("bravo-plumbing"), { message: "512-555-0999", conversationId: a.id });
    assert.notEqual(r.conversationId, a.id);
    assert.equal((await only(w.A)).phone, null, "A's lead untouched");
    assert.equal(await w.B.leads.count(), 0);
  });
  test("alerts rendered for a lead use only that business's name and lead", async () => {
    const w = await world(); await withContacts(w);
    await chat(w.deps("acme-plumbing")).say(GAS); await chat(w.deps("bravo-plumbing")).say("carbon monoxide alarm is going off");
    const m = new MockNotifier();
    await dispatchDue({ db: w.db, channels: createChannelMap([m]) });
    for (const x of m.outbox) { const isA = /acme/i.test(x.to ?? "") || /0100$/.test(x.to ?? ""); if (isA) assert.doesNotMatch(`${x.subject ?? ""}${x.text}`, /Bravo|carbon monoxide/i); else assert.doesNotMatch(`${x.subject ?? ""}${x.text}`, /Acme|gas smell/i); }
  });
});

describe("rendering", () => {
  const biz = { name: "Acme" };
  const incomplete = { name: null, phone: null, email: null, zip: null, issue_text: "gas smell", emergency_categories: ["gas_leak"] };
  test("no variant renders 'null'/'undefined' for any combination of missing details", () => {
    for (const variant of [null, "contact_added", "emergency_added"]) for (const channel of ["email", "sms"]) for (const lead of [incomplete, { ...incomplete, phone: "+15125550142" }, { ...incomplete, email: "a@b.example", name: "Pat" }]) {
      const m = renderNotification({ kind: "new_lead", priority: "emergency", variant, channel, business: biz, lead });
      assert.doesNotMatch(`${m.subject ?? ""} ${m.text}`, /\bnull\b|undefined/, `${variant}/${channel}`);
      assert.doesNotMatch(`${m.subject ?? ""} ${m.text}`, /dispatched|on the way|help is coming|we (have )?(sent|called)|will arrive/i);
    }
  });
  test("customer text is flattened to one line in the incomplete-lead alert too", () => {
    const m = renderNotification({ kind: "new_lead", priority: "emergency", channel: "email", business: biz, lead: { ...incomplete, issue_text: "gas\r\nBcc: evil@x.example" } });
    assert.doesNotMatch(m.subject, /[\r\n]/);
  });
});

describe("dashboard and CSV distinguish incomplete leads", () => {
  async function dash() {
    const db = new SqliteAdapter(":memory:"); migrate(db);
    const mailer = new MockMailer();
    const app = createApp({ db, store: new MemoryStore(), salt: "s-123456", accounts: { mailer, iterations: 1500, cfg: { unsafeFastHashForTests: true } } });
    const call = async (method, path, { body, cookie, csrf } = {}) => {
      const h = { Origin: "http://localhost" }; if (cookie) h.Cookie = cookie; if (csrf) h["X-CSRF-Token"] = csrf; if (body) h["Content-Type"] = "application/json";
      const res = await app.fetch(new Request("http://localhost" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }));
      const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* csv */ }
      return { status: res.status, data, text };
    };
    const PW = "correct horse battery staple";
    await call("POST", "/api/auth/register", { body: { email: "o@acme.example", password: PW, businessName: "Acme Plumbing" } });
    await call("POST", "/api/auth/verify-email", { body: { token: mailer.last("verify_email", "o@acme.example").data.token } });
    const raw = await app.fetch(new Request("http://localhost/api/auth/login", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ email: "o@acme.example", password: PW }) }));
    const cookie = raw.headers.get("Set-Cookie").split(";")[0]; const csrf = (await raw.json()).csrf;
    const me = (await call("GET", "/api/me", { cookie })).data; const biz = me.businesses[0].id;
    return { db, biz, get: (p) => call("GET", `/api/biz/${biz}${p}`, { cookie }), T: forBusiness(db, biz), csrf };
  }
  async function seed(d) {
    const e = await d.T.conversations.create(); const el = await d.T.leads.create(e.id, { issueText: GAS, urgency: "now", emergency: true, emergencyCategories: ["gas_leak"], summary: GAS });
    const n = await d.T.conversations.create(); const nl = await d.T.leads.create(n.id, { name: "Jane", phone: "+15125550142", issueText: "drip", urgency: "can_wait", summary: "x" });
    return { el: el.id, nl: nl.id };
  }
  test("lead list, detail, overview, filter and CSV all say which leads have no contact details", async () => {
    const d = await dash(); const s = await seed(d);
    const list = (await d.get("/leads")).data.leads;
    assert.equal(list.find((l) => l.id === s.el).contact_missing, true); assert.equal(list.find((l) => l.id === s.nl).contact_missing, false);
    assert.equal((await d.get(`/leads/${s.el}`)).data.lead.contact_missing, true);
    assert.deepEqual((await d.get("/leads?incomplete=1")).data.leads.map((l) => l.id), [s.el]);
    assert.equal((await d.get("/overview")).data.overview.incompleteEmergency, 1);
    const csv = (await d.get("/leads/export.csv")).text.split("\r\n");
    const col = csv[0].split(",").indexOf('"contact_missing"');
    assert.ok(col > 0);
    assert.match(csv.find((r) => r.includes(s.el)) ?? "", /"1"|"true"|"1"/);
  });
  test("the dashboard page and script contain the incomplete label and filter (no real browser run here)", async () => {
    const { clientJs } = await import("../src/dashboard/client.js").then((m) => ({ clientJs: m.default ?? m.CLIENT_JS ?? Object.values(m).find((v) => typeof v === "string") }));
    const src = String(clientJs ?? "");
    assert.match(src, /INCOMPLETE: no phone or email/); assert.match(src, /No contact details only/); assert.match(src, /Emergencies with no contact details/);
  });
  test("completing the lead from the chat clears the flag in the dashboard", async () => {
    const d = await dash();
    const w = { db: d.db, deps: () => ({ db: d.db, businessId: d.biz, kb: null }) };
    const c = chat(w.deps()); await c.say(GAS);
    assert.equal((await d.get("/leads")).data.leads[0].contact_missing, true);
    await c.say("512-555-0142");
    const l = (await d.get("/leads")).data.leads;
    assert.equal(l.length, 1); assert.equal(l[0].contact_missing, false);
  });
});

describe("random emergency conversations (seeded): invariants", () => {
  const MSGS = [GAS, "I smell gas", "512-555-0142", "62701", "Pat Lee", "skip", "no", "hello?", "that's not my phone number", "sorry, it's 512-555-0199", "pat@x.example", "carbon monoxide alarm is going off", "burst pipe flooding", "false alarm", "never mind", "start over", "this is useless", "I want a real person", "???", "when will someone arrive?", "ok"];
  const rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; };
  for (const seed of [3, 17, 99, 512, 2027, 4242]) test(`seed ${seed}`, async () => {
    const w = await world(); await withContacts(w);
    const r = rng(seed);
    const cs = [chat(w.deps("acme-plumbing")), chat(w.deps("acme-plumbing")), chat(w.deps("bravo-plumbing"))];
    for (let i = 0; i < 70; i++) {
      const c = cs[Math.floor(r() * 3)]; const out = await c.say(MSGS[Math.floor(r() * MSGS.length)]);
      if (!out.ok) continue;
      assert.ok(out.reply.trim().length > 0);
      assert.doesNotMatch(out.reply.replace(/can't dispatch anyone/gi, ""), /\bnotified\b|alerted|emailed|texted|someone (?:is|will)|on (?:the|its|their) way|help is coming|will arrive/i);
      if (/Your details have been recorded|recorded your emergency message/i.test(out.reply)) assert.ok((await w.db.first("SELECT lead_id FROM conversations WHERE id = ?", [out.conversationId])).lead_id, "claimed recorded without a lead");
    }
    // database invariants
    assert.equal((await w.db.all("SELECT conversation_id FROM leads GROUP BY business_id, conversation_id HAVING COUNT(*) > 1")).length, 0, "one lead per conversation");
    const keys = await w.db.all("SELECT idempotency_key FROM notifications"); assert.equal(new Set(keys.map((k) => k.idempotency_key)).size, keys.length);
    assert.equal((await w.db.all("SELECT 1 FROM notifications n JOIN leads l ON l.id = n.lead_id WHERE l.business_id != n.business_id")).length, 0);
    for (const l of await w.db.all("SELECT * FROM leads")) {
      assert.equal(!!l.emergency, JSON.parse(l.emergency_categories).length > 0 || !!l.emergency);
      if (l.phone) assert.match(l.phone, /^\+1\d{10}$/);
      assert.ok(!/\bnull\b|undefined/.test(l.summary));
    }
    // every emergency lead has emergency-priority alerts queued for both verified channels (no faults are injected here)
    for (const l of await w.db.all("SELECT id FROM leads WHERE emergency = 1")) assert.ok((await w.db.all("SELECT 1 FROM notifications WHERE lead_id = ? AND priority = 'emergency'", [l.id])).length >= 2);
  });
});

describe("regressions from the independent review (each was a real bug)", () => {
  test("'start over' after an emergency lead exists is refused honestly and the lead keeps its details", async () => {
    const w = await world(); await withContacts(w);
    const c = await script(w.deps(), ["I smell gas", "512-555-0123"]);
    const r = await c.say("start over");
    assert.doesNotMatch(r.reply, /Nothing has been recorded/); assert.match(r.reply, /already recorded/);
    const r2 = await c.say("I smell gas again in the garage");
    const l = await only(w.A);
    assert.equal(l.phone, "+15125550123"); assert.equal(l.contact_missing, false);
    assert.match(l.issue_text, /^I smell gas$/);
    assert.match(r2.reply, /Leave the building|safety steps/i);
  });
  test("'never mind' after an emergency lead exists does not say nothing was recorded", async () => {
    const w = await world();
    const c = await script(w.deps(), ["I smell gas", "512-555-0123"]);
    const r = await c.say("never mind, the gas stopped");
    assert.doesNotMatch(r.reply, /Nothing has been recorded/); assert.match(r.reply, /stays on file/);
    assert.equal(await w.A.leads.count(), 1);
  });
  test("declining contact after the emergency message was recorded does not say 'I can't record a request'", async () => {
    const w = await world();
    const c = await script(w.deps(), ["I smell gas", "I don't want to give a number"]);
    const r = await c.say("skip");
    assert.doesNotMatch(r.reply, /can't record a request/); assert.match(r.reply, /already recorded/);
  });
  test("an emergency after a request that was MERGED into another conversation's lead gets its own lead and alert; the other lead is untouched", async () => {
    const w = await world(); await withContacts(w);
    const a = chat(w.deps()), b = chat(w.deps());
    for (const m of ["my toilet is clogged", "Jane Doe", "512-555-0142", "62701", "it can wait"]) await a.say(m);
    for (const m of ["my sink drips all day", "Jane Doe", "512-555-0142", "62701", "it can wait"]) await b.say(m);
    assert.equal(await w.A.leads.count(), 1, "second request merged into the first lead");
    const r = await b.say("wait I smell gas now");
    assert.match(r.reply, /Leave the building/);
    const leads = await w.A.leads.list();
    assert.equal(leads.length, 2);
    const orig = leads.find((l) => !l.emergency), em = leads.find((l) => l.emergency);
    assert.ok(orig && em);
    assert.equal((await w.A.leads.get(orig.id)).issue_text, "my toilet is clogged");
    assert.match((await w.A.leads.get(em.id)).issue_text, /smell gas/);
    assert.ok((await notes(w.A, em.id)).every((x) => x.priority === "emergency"));
  });
  test("an emergency after an ordinary recorded request keeps the original text AND stores the emergency text", async () => {
    const w = await world();
    const c = chat(w.deps());
    for (const m of ["my kitchen sink drain is clogged", "Jane Doe", "512-555-0142", "62701", "it can wait"]) await c.say(m);
    await c.say("I smell gas");
    const l = await only(w.A);
    assert.match(l.issue_text, /clogged/); assert.match(l.issue_text, /Emergency reported: I smell gas/);
  });
  test("a sewage emergency is labelled 'sewage backup' in the alert", () => {
    const m = renderNotification({ kind: "new_lead", priority: "emergency", channel: "email", business: { name: "Acme" }, lead: { issue_text: "sewage", emergency_categories: ["sewage"], phone: "+15125550142" } });
    assert.match(m.subject, /sewage backup/);
  });
  test("DECISION: an emergency never merges into an earlier lead for the same phone (it always alerts on its own)", async () => {
    const w = await world(); await withContacts(w);
    const a = chat(w.deps()), b = chat(w.deps());
    for (const m of ["my toilet is clogged", "Jane Doe", "512-555-0142", "62701", "it can wait"]) await a.say(m);
    await b.say("I smell gas, call me at 512-555-0142");
    assert.equal(await w.A.leads.count(), 2);
    assert.equal((await w.A.leads.list()).filter((l) => l.emergency).length, 1);
  });
});
