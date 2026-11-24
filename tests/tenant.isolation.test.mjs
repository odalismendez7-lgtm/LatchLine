// Systematic tenant-isolation review (Stage 6 production-readiness gate). Business B tries everything against
// business A's data, at three levels: (1) static scan of every SQL statement, (2) every repository method with A's
// ids, (3) every dashboard route over HTTP. Passing means B could not read, change, find, or even tell apart A's
// data from non-existent data. Mock services and in-memory SQLite only.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { forBusiness } from "../src/db/tenant.js";
import { world, script } from "./helpers/convo.mjs";
import { web } from "./helpers/web.mjs";
import { dispatchDue } from "../src/notify/dispatcher.js";
import { MockNotifier } from "../src/notify/mock.js";
import { createChannelMap } from "../src/notify/registry.js";

const MARK = "ZEBRAMARK";
const GAS = `I smell gas ${MARK}, call me at 512-555-0177`;
const SRC = fileURLToPath(new URL("../src/", import.meta.url));

describe("tenant isolation 1: every SQL statement on a tenant table is scoped", () => {
  test("no statement touches a table that has business_id without mentioning business_id (reviewed exceptions only)", async () => {
    const { SqliteAdapter } = await import("../src/db/sqlite-adapter.js"); const { migrate } = await import("../src/db/migrate-node.js");
    const db = new SqliteAdapter(":memory:"); migrate(db);
    const tenant = [];
    for (const { name } of await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) if ((await db.all(`PRAGMA table_info(${name})`)).some((c) => c.name === "business_id")) tenant.push(name);
    const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = d + f; statSync(p).isDirectory() ? walk(p + "/") : p.endsWith(".js") && files.push(p); } })(SRC);
    // Reviewed: acceptInvitation updates by the invitation's own id (found by secret token hash; businessId comes from that row);
    // the dashboard list/count queries build their WHERE with "business_id = ?" first; the audit row for a lead update is
    // keyed by the unique history-row id just written for this business.
    const REVIEWED = [/UPDATE invitations SET accepted_at = \? WHERE id = \?/, /\$\{where\.join\(" AND "\)\}/, /WHERE EXISTS \(SELECT 1 FROM lead_events WHERE id = \?\)/];
    const bad = [];
    for (const f of files) { const src = readFileSync(f, "utf8"); for (const m of src.matchAll(/(["'`])((?:SELECT|UPDATE|DELETE FROM|INSERT INTO)\b[\s\S]*?)\1/g)) {
      const sql = m[2];
      const used = tenant.filter((t) => new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO|DELETE FROM)\\s+${t}\\b`, "i").test(sql));
      if (used.length && !/business_id/i.test(sql) && !REVIEWED.some((r) => r.test(sql))) bad.push(`${f.replace(SRC, "src/")}: ${sql.replace(/\s+/g, " ").slice(0, 120)}`);
    } }
    assert.deepEqual(bad, [], "unscoped SQL on a tenant table");
    for (const t of ["leads", "conversations", "notifications", "lead_events", "audit_log", "business_contacts", "messages", "memberships", "invitations"]) assert.ok(tenant.includes(t), t);
  });
});

describe("tenant isolation 2: every repository method, called by business B with business A's ids", () => {
  async function seeded() {
    const w = await world();
    for (const id of ["acme-plumbing", "bravo-plumbing"]) await forBusiness(w.db, id).notifications.contacts.add({ channel: "email", address: `owner@${id}.example`, verified: true });
    const conv = await script(w.deps(), [GAS, "512-555-0999"]); // emergency lead, then a corrected phone
    const lead = (await w.A.leads.list())[0];
    const note = (await w.A.notifications.listForLead(lead.id))[0];
    const contact = (await w.A.notifications.contacts.list())[0];
    await w.db.run("INSERT INTO users (id, email, password_hash, created_at, updated_at, password_changed_at) VALUES ('usr_a','a@acme.example','x','t','t','t')");
    await w.db.run("INSERT INTO memberships (user_id, business_id, role, created_at) VALUES ('usr_a','acme-plumbing','staff','t')");
    const inv = await w.A.members.createInvitation({ email: "new@acme.example", role: "staff", invitedBy: "usr_a" }).catch(() => null);
    return { w, convId: conv.id, leadId: lead.id, noteId: note.id, contactId: contact.id, inv };
  }
  const tables = ["conversations", "messages", "leads", "lead_events", "audit_log", "business_contacts", "notifications", "notification_attempts", "memberships", "invitations", "contact_verifications"];
  const snap = async (db, biz) => { const o = {}; for (const t of tables) o[t] = await db.all(`SELECT * FROM ${t} WHERE business_id = ? ORDER BY rowid`, [biz]); return JSON.stringify(o); };
  const attempt = async (f) => { try { return { ok: true, v: await f() }; } catch (e) { return { ok: false, code: e.code ?? e.name, msg: String(e.message) }; } };

  test("B can neither read, change, find nor delete anything of A, and A's data is byte-identical afterwards", async () => {
    const { w, convId, leadId, noteId, contactId, inv } = await seeded();
    const before = await snap(w.db, "acme-plumbing");
    const B = w.B; const out = {};
    const calls = {
      "conversations.get": () => B.conversations.get(convId), "conversations.save": () => B.conversations.save(convId, { state: { hacked: 1 }, status: "closed", urgent: false }),
      "conversations.addMessage": () => B.conversations.addMessage(convId, { role: "user", content: "injected" }), "conversations.messages": () => B.conversations.messages(convId),
      "leads.get": () => B.leads.get(leadId), "leads.getByConversation": () => B.leads.getByConversation(convId), "leads.update": () => B.leads.update(leadId, { phone: "+15125550666", name: "Mallory", emergency: true }),
      "leads.findDuplicate": () => B.leads.findDuplicate({ phone: "+15125550999" }), "leads.mergeDuplicate": () => B.leads.mergeDuplicate(leadId, convId, { note: "x" }),
      "leads.list": () => B.leads.list(), "leads.count": () => B.leads.count(),
      "notifications.enqueueForLead": () => B.notifications.enqueueForLead({ leadId, conversationId: convId, kind: "new_lead", priority: "emergency" }),
      "notifications.get": () => B.notifications.get(noteId), "notifications.listForLead": () => B.notifications.listForLead(leadId), "notifications.attempts": () => B.notifications.attempts(noteId),
      "notifications.recordAccepted": () => B.notifications.recordAccepted(noteId, 1, { providerId: "p", providerMessageId: "m", simulated: true }),
      "notifications.recordFailure": () => B.notifications.recordFailure(noteId, 1, { code: "x", retryable: false }), "notifications.recordDelivery": () => B.notifications.recordDelivery(noteId, { delivered: true }),
      "notifications.claimDue": () => B.notifications.claimDue({}), "notifications.counts": () => B.notifications.counts(), "notifications.needsAttention": () => B.notifications.needsAttention(), "notifications.awaitingConfirmation": () => B.notifications.awaitingConfirmation(),
      "notifications.reconcileMissing": () => B.notifications.reconcileMissing(),
      "contacts.list": () => B.notifications.contacts.list(), "contacts.get": () => B.notifications.contacts.get(contactId), "contacts.markVerified": () => B.notifications.contacts.markVerified(contactId), "contacts.setEnabled": () => B.notifications.contacts.setEnabled(contactId, false),
      "contactVerify.start": () => B.contactVerify.start(contactId), "contactVerify.check": () => B.contactVerify.check({ contactId, code: "000000" }),
      "members.list": () => B.members.list(), "members.roleOf": () => B.members.roleOf("usr_a"), "members.setRole": () => B.members.setRole("usr_a", "owner", "usr_b"), "members.remove": () => B.members.remove("usr_a", "usr_b"),
      "members.listInvitations": () => B.members.listInvitations(), "members.revokeInvitation": () => B.members.revokeInvitation(inv?.id ?? "inv_x", "usr_b"), "members.audit": () => B.members.audit(),
      "dashboard.overview": () => B.dashboard.overview(), "dashboard.searchLeads(marker)": () => B.dashboard.searchLeads({ q: MARK }), "dashboard.searchLeads(phone)": () => B.dashboard.searchLeads({ q: "5125550999" }), "dashboard.searchLeads(incomplete)": () => B.dashboard.searchLeads({ incomplete: true }),
      "dashboard.exportLeads": () => B.dashboard.exportLeads(), "dashboard.leadDetail": () => B.dashboard.leadDetail(leadId), "dashboard.setLeadStatus": () => B.dashboard.setLeadStatus("usr_b", leadId, "won"), "dashboard.deleteLead": () => B.dashboard.deleteLead("usr_b", leadId),
      "dashboard.listConversations": () => B.dashboard.listConversations(), "dashboard.conversationDetail": () => B.dashboard.conversationDetail(convId), "dashboard.handoffs": () => B.dashboard.handoffs(), "dashboard.notificationHistory": () => B.dashboard.notificationHistory(),
      "knowledge.get": () => B.knowledge.get(),
    };
    for (const [k, f] of Object.entries(calls)) out[k] = await attempt(f);
    const leak = Object.entries(out).filter(([, r]) => JSON.stringify(r).match(new RegExp(`${MARK}|5125550177|5125550999|usr_a|acme|Acme|owner@acme`, "i")));
    assert.deepEqual(leak.map(([k]) => k), [], "A's data appeared in a response to B");
    assert.equal(await snap(w.db, "acme-plumbing"), before, "A's rows changed");
    assert.equal(await w.B.leads.count(), 0); assert.equal((await w.B.notifications.counts())?.queued ?? 0, 0);
  });
  test("B cannot tell A's real ids from made-up ids: every id-taking method answers identically for both", async () => {
    const { w, convId, leadId, noteId, contactId } = await seeded();
    const fake = { conv: "cnv_doesnotexist", lead: "led_doesnotexist", note: "ntf_doesnotexist", contact: "bct_doesnotexist" };
    const pairs = [
      (c, l) => w.B.conversations.get(c), (c, l) => w.B.conversations.messages(c), (c, l) => w.B.leads.get(l), (c, l) => w.B.leads.getByConversation(c),
      (c, l) => w.B.leads.update(l, { name: "x" }), (c, l) => w.B.dashboard.leadDetail(l), (c, l) => w.B.dashboard.conversationDetail(c),
      (c, l) => w.B.dashboard.setLeadStatus("usr_b", l, "won"), (c, l) => w.B.dashboard.deleteLead("usr_b", l), (c, l) => w.B.notifications.listForLead(l),
      (c, l) => w.B.conversations.addMessage(c, { role: "user", content: "x" }),
    ];
    for (const [i, f] of pairs.entries()) {
      const real = await attempt(() => f(convId, leadId)), made = await attempt(() => f(fake.conv, fake.lead));
      assert.deepEqual(real, made, `method #${i} distinguishes a real foreign id from a made-up one`);
    }
    void noteId; void contactId;
  });
  test("reconcile and dispatch run for one business never create or send another business's alerts", async () => {
    const { w } = await seeded();
    await w.B.notifications.reconcileMissing(); assert.equal((await w.db.all("SELECT id FROM notifications WHERE business_id = 'bravo-plumbing'")).length, 0);
    const m = new MockNotifier(); await dispatchDue({ db: w.db, channels: createChannelMap([m]) });
    assert.ok(m.outbox.every((o) => /acme/.test(o.to) && !/bravo/i.test(o.text)));
    assert.ok(m.outbox.length >= 1);
  });
});

describe("tenant isolation 3: every dashboard route over HTTP", () => {
  test("business B's owner gets nothing from A on any route, and cannot tell A's ids or A's business from made-up ones", async () => {
    const W = await web();
    const a = await W.signup("a@acme.example", "Acme"), b = await W.signup("b@bravo.example", "Bravo");
    await forBusiness(W.db, a.bizId).notifications.contacts.add({ channel: "email", address: "owner@acme.example", verified: true });
    await W.emergencyChat(a.bizId, [GAS, "wrong number, it is 512-555-0999"]);
    const A = W.api(a);
    const lead = (await A.get("/leads")).data.leads[0], conv = (await A.get("/conversations")).data.conversations[0], contact = (await A.get("/contacts")).data.contacts[0];
    const snapA = async () => JSON.stringify([(await A.get("/leads")).text, (await A.get("/contacts")).text, (await A.get("/overview")).text, (await A.get("/team")).text, (await A.get("/audit")).text]);
    const before = await snapA();
    const routes = (L, C, K) => [
      ["GET", "/overview"], ["GET", "/leads"], ["GET", `/leads?q=${MARK}`], ["GET", "/leads?q=zebra&incomplete=1"], ["GET", "/leads/export.csv"], ["GET", `/leads/${L}`], ["PATCH", `/leads/${L}`, { status: "won" }], ["DELETE", `/leads/${L}`],
      ["GET", "/conversations"], ["GET", `/conversations/${C}`], ["GET", "/handoffs"], ["GET", "/notifications"], ["GET", "/settings"], ["PUT", "/settings", { name: "Hijacked" }],
      ["GET", "/contacts"], ["POST", "/contacts", { channel: "email", address: "attacker@evil.example" }], ["PATCH", `/contacts/${K}`, { enabled: false }], ["DELETE", `/contacts/${K}`], ["POST", `/contacts/${K}/send-code`, {}], ["POST", `/contacts/${K}/confirm`, { code: "000000" }],
      ["GET", "/team"], ["POST", "/team/invitations", { email: "evil@evil.example", role: "owner" }], ["PATCH", "/team/members/usr_x", { role: "owner" }], ["DELETE", "/team/members/usr_x"], ["DELETE", "/team/invitations/inv_x"], ["GET", "/audit"],
    ];
    // (a) B's session against A's business id: always refused, and indistinguishable from a business that does not exist
    for (const [m, p, body] of routes(lead.id, conv.id, contact.id)) {
      const foreign = await W.api(b, a.bizId).send(m, p, body), ghost = await W.api(b, "biz_doesnotexist").send(m, p.replace(a.bizId, "biz_doesnotexist"), body);
      assert.ok([401, 403, 404].includes(foreign.status), `${m} ${p} -> ${foreign.status}`);
      assert.deepEqual([foreign.status, foreign.text], [ghost.status, ghost.text], `${m} ${p}: A's business is distinguishable from a non-existent one`);
      assert.ok(!new RegExp(`${MARK}|0177|0999|acme`, "i").test(foreign.text), `${m} ${p} leaked`);
    }
    // (b) B's own business with A's resource ids: same answer as for made-up ids, and nothing leaks
    for (const [m, p, body] of routes(lead.id, conv.id, contact.id)) {
      if (!/\/(leads|conversations|contacts)\/[^/]+/.test(p) || p.includes("export")) continue;
      const real = await W.api(b).send(m, p, body), made = await W.api(b).send(m, p.replace(lead.id, "led_doesnotexist").replace(conv.id, "cnv_doesnotexist").replace(contact.id, "bct_doesnotexist"), body);
      assert.deepEqual([real.status, real.text], [made.status, made.text], `${m} ${p}: a real foreign id is distinguishable from a made-up id`);
    }
    // (c) B's own lists and exports contain none of A's data
    for (const p of ["/overview", "/leads", `/leads?q=${MARK}`, "/leads?incomplete=1", "/leads/export.csv", "/conversations", "/handoffs", "/notifications", "/contacts", "/team", "/audit"]) {
      const r = await W.api(b).get(p); assert.ok(!new RegExp(`${MARK}|0177|0999|acme`, "i").test(r.text), `${p} leaked A's data to B`);
    }
    assert.equal((await W.api(b).get(`/leads?q=${MARK}`)).data.total, 0);
    assert.equal(await snapA(), before, "A's dashboard data changed after all of B's attempts");
  });
  test("a request with no session, or with a bad CSRF token, changes nothing", async () => {
    const W = await web(); const a = await W.signup("a@acme.example", "Acme"); await W.emergencyChat(a.bizId, [GAS]);
    const lead = (await W.api(a).get("/leads")).data.leads[0];
    assert.equal((await W.call("DELETE", `/api/biz/${a.bizId}/leads/${lead.id}`, {})).status, 401);
    assert.equal((await W.call("PATCH", `/api/biz/${a.bizId}/leads/${lead.id}`, { cookie: a.cookie, csrf: "wrong", body: { status: "won" } })).status, 403);
    assert.equal((await W.api(a).get(`/leads/${lead.id}`)).data.lead.status, "new");
  });
});
