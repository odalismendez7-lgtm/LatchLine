import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { forBusiness } from "../src/db/tenant.js";
import { MemoryStore } from "../src/ratelimit/limiter.js";
import { MockMailer } from "../src/auth/mailer.js";
import { MockNotifier } from "../src/notify/mock.js";
import { dispatchDue } from "../src/notify/dispatcher.js";
import { createApp } from "../src/app.js";
import { maskLead, maskMessages } from "../src/dashboard/authz.js";

const ORIGIN = "http://localhost";
const PW = "correct horse battery staple";

test("property addresses are hidden from viewers in structured fields and free text", () => {
  const lead = {
    address_line1: "123 Main St", address_line2: "Apt 4", city: "Bronx", state: "NY", zip: "10467",
    issue_text: "Kitchen faucet leaking at 123 Main St, Apt 4, Bronx, NY 10467",
    summary: "123 Main St, Apt 4, Bronx, NY 10467: kitchen faucet leaking",
  };
  const viewer = maskLead(lead, "viewer");
  for (const field of ["address_line1", "address_line2", "city", "state"]) assert.equal(viewer[field], "[hidden]");
  assert.equal(viewer.zip, "10467");
  assert.doesNotMatch(viewer.issue_text, /123 Main|Bronx|Apt 4/i);
  assert.doesNotMatch(viewer.summary, /123 Main|Bronx|Apt 4/i);
  const owner = maskLead(lead, "owner");
  assert.equal(owner.address_line1, "123 Main St");
  assert.match(owner.issue_text, /123 Main St/);
  const messages = maskMessages([{ role: "customer", content: "Please come to 55 West 42nd Avenue, New York, NY 10036." }], "viewer");
  assert.doesNotMatch(messages[0].content, /55 West 42nd|New York/i);
});

export async function makeWorld({ devMode = false } = {}) {
  const db = new SqliteAdapter(":memory:"); migrate(db);
  const mailer = new MockMailer();
  const app = createApp({ db, store: new MemoryStore(), salt: "test-salt-123", accounts: { mailer, iterations: 1500, cfg: { unsafeFastHashForTests: true }, devMode } });
  const call = async (method, path, { body, cookie, csrf, origin = ORIGIN, headers = {}, raw } = {}) => {
    const h = { ...headers };
    if (origin !== null && method !== "GET") h.Origin = origin;
    if (cookie) h.Cookie = cookie;
    if (csrf) h["X-CSRF-Token"] = csrf;
    let payload;
    if (raw !== undefined) payload = raw; else if (body !== undefined) { h["Content-Type"] ??= "application/json"; payload = JSON.stringify(body); }
    const res = await app.fetch(new Request(ORIGIN + path, { method, headers: h, body: payload }));
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { /* csv / html */ }
    return { status: res.status, data, text, headers: res.headers };
  };
  async function signup(email, businessName = "Acme Plumbing") {
    assert.equal((await call("POST", "/api/auth/register", { body: { email, password: PW, businessName } })).status, 200);
    const tok = mailer.last("verify_email", email).data.token;
    assert.equal((await call("POST", "/api/auth/verify-email", { body: { token: tok } })).status, 200);
    return login(email);
  }
  async function login(email, password = PW) {
    const r = await call("POST", "/api/auth/login", { body: { email, password } });
    assert.equal(r.status, 200, r.text);
    const cookie = r.headers.get("Set-Cookie").split(";")[0];
    const me = await call("GET", "/api/me", { cookie });
    return { email, cookie, csrf: r.data.csrf, bizId: me.data.businesses[0]?.id, me: me.data };
  }
  const api = (u) => ({
    get: (p) => call("GET", `/api/biz/${u.bizId}${p}`, { cookie: u.cookie }),
    send: (m, p, body) => call(m, `/api/biz/${u.bizId}${p}`, { cookie: u.cookie, csrf: u.csrf, body }),
  });
  async function seedLead(bizId, { name = "Jane Doe", phone = "+15125550142", email = "jane@customer.example", issue = "kitchen leak", emergency = false, handoff = false } = {}) {
    const T = forBusiness(db, bizId);
    const cv = await T.conversations.create();
    await T.conversations.addMessage(cv.id, { role: "customer", content: `Hi, call me on 512-555-0142 or ${email}. ${issue}`, meta: {} });
    await T.conversations.addMessage(cv.id, { role: "assistant", content: "Thanks, we have your details.", meta: {} });
    const l = await T.leads.create(cv.id, { name, phone, email, zip: "62701", issueText: `${issue} (${email})`, urgency: emergency ? "now" : "can_wait", emergency, emergencyCategories: emergency ? ["gas_leak"] : [], summary: `Call ${phone}` });
    await T.conversations.save(cv.id, { state: {}, status: handoff ? "needs_human" : "open", urgent: emergency });
    return { leadId: l.id, convId: cv.id };
  }
  return { db, mailer, app, call, signup, login, api, seedLead };
}

describe("website widget onboarding", () => {
  test("owner can read the public site key and manage only that business's HTTPS origins", async () => {
    const w = await makeWorld(); const u = await w.signup("widget-owner@acme.example"); const A = w.api(u);
    const initial = await A.get("/widget");
    assert.equal(initial.status, 200);
    assert.match(initial.data.siteKey, /^sk_[A-Za-z0-9_-]{20,}$/);
    assert.deepEqual(initial.data.origins, []);
    assert.equal((await A.send("POST", "/widget/origins", { origin: "https://example.com/path" })).status, 400);
    assert.equal((await A.send("POST", "/widget/origins", { origin: "http://example.com" })).status, 400);
    assert.equal((await A.send("POST", "/widget/origins", { origin: "https://user:pass@example.com" })).status, 400);
    const added = await A.send("POST", "/widget/origins", { origin: "https://www.example.com/" });
    assert.equal(added.status, 201);
    assert.deepEqual(added.data.origins, ["https://www.example.com"]);
    const publicConfig = await w.app.fetch(new Request("https://latchline.example/api/widget/config?siteKey=" + encodeURIComponent(initial.data.siteKey), { headers: { Origin: "https://www.example.com" } }));
    assert.equal(publicConfig.status, 200);
    assert.equal(publicConfig.headers.get("Access-Control-Allow-Origin"), "https://www.example.com");
    const duplicate = await A.send("POST", "/widget/origins", { origin: "https://www.example.com" });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.data.added, false);
    const removed = await A.send("DELETE", "/widget/origins?origin=" + encodeURIComponent("https://www.example.com"));
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.data.origins, []);
    assert.equal((await A.send("DELETE", "/widget/origins?origin=" + encodeURIComponent("https://www.example.com"))).status, 404);
    const deniedConfig = await w.app.fetch(new Request("https://latchline.example/api/widget/config?siteKey=" + encodeURIComponent(initial.data.siteKey), { headers: { Origin: "https://www.example.com" } }));
    assert.equal(deniedConfig.status, 404);
    const events = (await A.get("/audit")).data.events;
    assert.ok(events.some((e) => e.action === "website_origin_added" && e.detail.origin === "https://www.example.com"));
    assert.ok(events.some((e) => e.action === "website_origin_removed" && e.detail.origin === "https://www.example.com"));
  });
  test("website widget configuration is not exposed to roles without settings permission", async () => {
    const w = await makeWorld(); const u = await w.signup("widget-viewer@acme.example");
    await w.db.run("UPDATE memberships SET role = 'viewer' WHERE business_id = ?", [u.bizId]);
    assert.equal((await w.api(u).get("/widget")).status, 403);
    assert.equal((await w.api(u).send("POST", "/widget/origins", { origin: "https://example.com" })).status, 403);
  });
});

describe("authentication over HTTP", () => {
  test("login sets an HttpOnly SameSite=Strict cookie and never puts the token in the body", async () => {
    const w = await makeWorld();
    await w.signup("a@acme.example");
    const r = await w.call("POST", "/api/auth/login", { body: { email: "a@acme.example", password: PW } });
    const sc = r.headers.get("Set-Cookie");
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\//); assert.match(sc, /Max-Age=43200/);
    const token = sc.split(";")[0].split("=")[1];
    assert.ok(!r.text.includes(token));
    assert.ok(r.headers.get("Cache-Control").includes("no-store"));
  });
  test("over https the cookie is __Host- prefixed and Secure", async () => {
    const w = await makeWorld();
    await w.signup("a@acme.example");
    const res = await w.app.fetch(new Request("https://latchline.example/api/auth/login", { method: "POST", headers: { Origin: "https://latchline.example", "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@acme.example", password: PW }) }));
    const sc = res.headers.get("Set-Cookie");
    assert.match(sc, /^__Host-ll_session=/); assert.match(sc, /; Secure/);
  });
  test("generic failures: wrong password / unknown email are both 401 with the same body", async () => {
    const w = await makeWorld();
    await w.signup("a@acme.example");
    const a = await w.call("POST", "/api/auth/login", { body: { email: "a@acme.example", password: "wrong wrong wrong" } });
    const b = await w.call("POST", "/api/auth/login", { body: { email: "ghost@acme.example", password: "wrong wrong wrong" } });
    assert.deepEqual([a.status, a.data], [401, { error: "invalid_credentials" }]);
    assert.deepEqual([b.status, b.data], [401, { error: "invalid_credentials" }]);
    assert.equal(a.headers.get("Set-Cookie"), null);
  });
  test("brute force gets 429 with Retry-After", async () => {
    const w = await makeWorld();
    await w.signup("a@acme.example");
    let r; for (let i = 0; i < 11; i++) r = await w.call("POST", "/api/auth/login", { body: { email: "a@acme.example", password: `wrong password ${i}` } });
    assert.equal(r.status, 429); assert.ok(Number(r.headers.get("Retry-After")) >= 1);
  });
  test("logout kills the session server-side; the old cookie no longer works; cookie is cleared", async () => {
    const w = await makeWorld();
    const u = await w.signup("a@acme.example");
    const r = await w.call("POST", "/api/auth/logout", { cookie: u.cookie, csrf: u.csrf, body: {} });
    assert.equal(r.status, 200); assert.match(r.headers.get("Set-Cookie"), /Max-Age=0/);
    assert.equal((await w.call("GET", "/api/me", { cookie: u.cookie })).status, 401);
    assert.equal((await w.api(u).get("/overview")).status, 401);
  });
  test("logout requires the CSRF token", async () => {
    const w = await makeWorld();
    const u = await w.signup("a@acme.example");
    assert.equal((await w.call("POST", "/api/auth/logout", { cookie: u.cookie, body: {} })).status, 403);
    assert.equal((await w.call("GET", "/api/me", { cookie: u.cookie })).status, 200);
  });
  test("forged, tampered and empty cookies never authenticate", async () => {
    const w = await makeWorld();
    const u = await w.signup("a@acme.example");
    for (const c of ["ll_session=", "ll_session=abc", `ll_session=${u.cookie.split("=")[1]}x`, "ll_session=" + "A".repeat(43), "other=" + u.cookie.split("=")[1], ""]) assert.equal((await w.call("GET", "/api/me", { cookie: c || undefined })).status, 401, c);
  });
  test("a __Host- cookie is not accepted over plain http (and vice versa)", async () => {
    const w = await makeWorld();
    const u = await w.signup("a@acme.example");
    const tok = u.cookie.split("=")[1];
    assert.equal((await w.call("GET", "/api/me", { cookie: `__Host-ll_session=${tok}` })).status, 401);
  });
  test("password change over HTTP revokes other sessions", async () => {
    const w = await makeWorld();
    const u1 = await w.signup("a@acme.example"); const u2 = await w.login("a@acme.example");
    const r = await w.call("POST", "/api/auth/change-password", { cookie: u1.cookie, csrf: u1.csrf, body: { currentPassword: PW, newPassword: "a brand new long passphrase" } });
    assert.equal(r.status, 200);
    assert.equal((await w.call("GET", "/api/me", { cookie: u1.cookie })).status, 200);
    assert.equal((await w.call("GET", "/api/me", { cookie: u2.cookie })).status, 401);
  });
  test("recovery over HTTP: identical answers, reset works once", async () => {
    const w = await makeWorld();
    await w.signup("a@acme.example");
    const known = await w.call("POST", "/api/auth/forgot-password", { body: { email: "a@acme.example" } });
    const unknown = await w.call("POST", "/api/auth/forgot-password", { body: { email: "ghost@acme.example" } });
    assert.deepEqual([known.status, known.data], [unknown.status, unknown.data]);
    const tok = w.mailer.last("reset_password").data.token;
    assert.equal((await w.call("POST", "/api/auth/reset-password", { body: { token: tok, newPassword: "a brand new long passphrase" } })).status, 200);
    assert.equal((await w.call("POST", "/api/auth/reset-password", { body: { token: tok, newPassword: "another long passphrase!!" } })).status, 400);
  });
  test("register answers identically for an existing email", async () => {
    const w = await makeWorld();
    await w.signup("a@acme.example");
    const r = await w.call("POST", "/api/auth/register", { body: { email: "a@acme.example", password: PW, businessName: "Other" } });
    const n = await w.call("POST", "/api/auth/register", { body: { email: "new@acme.example", password: PW, businessName: "Other" } });
    assert.deepEqual([r.status, r.data], [n.status, n.data]);
  });
});

describe("request hardening", () => {
  test("cross-origin, missing-Origin and wrong-CSRF state changes are refused", async () => {
    const w = await makeWorld();
    const u = await w.signup("a@acme.example");
    const { leadId } = await w.seedLead(u.bizId);
    const p = `/api/biz/${u.bizId}/leads/${leadId}`;
    assert.equal((await w.call("PATCH", p, { cookie: u.cookie, csrf: u.csrf, origin: "https://evil.example", body: { status: "won" } })).status, 403);
    assert.equal((await w.call("PATCH", p, { cookie: u.cookie, csrf: u.csrf, origin: null, body: { status: "won" } })).status, 403);
    assert.equal((await w.call("PATCH", p, { cookie: u.cookie, body: { status: "won" } })).status, 403);
    assert.equal((await w.call("PATCH", p, { cookie: u.cookie, csrf: "wrong", body: { status: "won" } })).status, 403);
    assert.equal((await w.call("POST", "/api/auth/login", { origin: "https://evil.example", body: { email: "a@acme.example", password: PW } })).status, 403);
    assert.equal((await w.api(u).get(`/leads/${leadId}`)).data.lead.status, "new");
  });
  test("non-JSON, oversized and malformed bodies are rejected", async () => {
    const w = await makeWorld();
    const u = await w.signup("a@acme.example");
    const base = { cookie: u.cookie, csrf: u.csrf };
    assert.equal((await w.call("PUT", `/api/biz/${u.bizId}/settings`, { ...base, raw: "x=1", headers: { "Content-Type": "text/plain" } })).status, 415);
    assert.equal((await w.call("PUT", `/api/biz/${u.bizId}/settings`, { ...base, raw: "{not json" , headers: { "Content-Type": "application/json" } })).status, 400);
    assert.equal((await w.call("PUT", `/api/biz/${u.bizId}/settings`, { ...base, raw: "[1]" , headers: { "Content-Type": "application/json" } })).status, 400);
    assert.equal((await w.call("PUT", `/api/biz/${u.bizId}/settings`, { ...base, raw: JSON.stringify({ confirm: true, hours: "x".repeat(20000) }), headers: { "Content-Type": "application/json" } })).status, 413);
  });
  test("responses carry hardening headers", async () => {
    const w = await makeWorld();
    const u = await w.signup("a@acme.example");
    const r = await w.api(u).get("/overview");
    assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff"); assert.equal(r.headers.get("X-Frame-Options"), "DENY");
    assert.equal(r.headers.get("Referrer-Policy"), "no-referrer"); assert.match(r.headers.get("Cache-Control"), /no-store/);
  });
  test("unauthenticated access to every business route is 401", async () => {
    const w = await makeWorld();
    const u = await w.signup("a@acme.example");
    const { leadId, convId } = await w.seedLead(u.bizId);
    const routes = [["GET", "/overview"], ["GET", "/leads"], ["GET", "/leads/export.csv"], ["GET", `/leads/${leadId}`], ["GET", "/conversations"], ["GET", `/conversations/${convId}`], ["GET", "/handoffs"], ["GET", "/notifications"], ["GET", "/settings"], ["GET", "/contacts"], ["GET", "/team"], ["GET", "/audit"], ["PATCH", `/leads/${leadId}`], ["DELETE", `/leads/${leadId}`], ["PUT", "/settings"], ["POST", "/contacts"]];
    for (const [m, p] of routes) assert.equal((await w.call(m, `/api/biz/${u.bizId}${p}`, { body: m === "GET" || m === "DELETE" ? undefined : {} })).status, 401, `${m} ${p}`);
    for (const [m, p] of routes.filter((r) => r[0] === "GET")) assert.equal((await w.call(m, `/api/biz/${u.bizId}${p}`)).status, 401, p);
  });
});

describe("CROSS-BUSINESS access attempts (tenant isolation)", () => {
  async function two() {
    const w = await makeWorld();
    const a = await w.signup("owner@acme.example", "Acme Plumbing"), b = await w.signup("owner@bravo.example", "Bravo Plumbing");
    const la = await w.seedLead(a.bizId, { name: "Acme Customer", issue: "acme-secret-leak", handoff: true });
    const lb = await w.seedLead(b.bizId, { name: "Bravo Customer", phone: "+15125550999", email: "bob@bravo-customer.example", issue: "bravo-secret-leak", handoff: true });
    const TB = forBusiness(w.db, b.bizId);
    await TB.notifications.contacts.add({ channel: "email", address: "owner@bravo.example", verified: true });
    return { w, a, b, la, lb, TB };
  }
  test("A cannot read ANY of B's data through B's business id: every route is 404, identical to a nonexistent business", async () => {
    const { w, a, b, lb } = await two();
    const ghost = "ghost-business-id";
    const paths = ["/overview", "/leads", "/leads/export.csv", `/leads/${lb.leadId}`, "/conversations", `/conversations/${lb.convId}`, "/handoffs", "/notifications", "/settings", "/contacts", "/team", "/audit"];
    for (const p of paths) {
      const real = await w.call("GET", `/api/biz/${b.bizId}${p}`, { cookie: a.cookie });
      const none = await w.call("GET", `/api/biz/${ghost}${p.replace(lb.leadId, "x").replace(lb.convId, "x")}`, { cookie: a.cookie });
      assert.equal(real.status, 404, p);
      assert.equal(real.status, none.status, p);
      assert.equal(real.text, none.text, `no existence leak: ${p}`);
      assert.ok(!real.text.includes("bravo") && !real.text.includes("Bravo"), p);
    }
  });
  test("A cannot read B's lead or conversation by id through A's OWN business route", async () => {
    const { w, a, lb } = await two();
    assert.equal((await w.api(a).get(`/leads/${lb.leadId}`)).status, 404);
    assert.equal((await w.api(a).get(`/conversations/${lb.convId}`)).status, 404);
  });
  test("A cannot edit, delete or verify B's data (by B's id, or B's object ids under A's business)", async () => {
    const { w, a, b, lb, TB } = await two();
    const bc = (await TB.notifications.contacts.list())[0].id;
    const attempts = [
      ["PATCH", `/api/biz/${b.bizId}/leads/${lb.leadId}`, { status: "spam" }],
      ["DELETE", `/api/biz/${b.bizId}/leads/${lb.leadId}`],
      ["PUT", `/api/biz/${b.bizId}/settings`, { confirm: true, companyName: "Hacked", hours: "never" }],
      ["POST", `/api/biz/${b.bizId}/contacts`, { channel: "email", address: "attacker@evil.example" }],
      ["DELETE", `/api/biz/${b.bizId}/contacts/${bc}`],
      ["PATCH", `/api/biz/${b.bizId}/contacts/${bc}`, { enabled: false }],
      ["POST", `/api/biz/${b.bizId}/contacts/${bc}/send-code`, {}],
      ["POST", `/api/biz/${b.bizId}/team/invitations`, { email: "attacker@evil.example", role: "manager" }],
      ["PATCH", `/api/biz/${b.bizId}/team/members/${(await TB.members.list())[0].user_id}`, { role: "viewer" }],
      ["DELETE", `/api/biz/${b.bizId}/team/members/${(await TB.members.list())[0].user_id}`],
      ["PATCH", `/api/biz/${a.bizId}/leads/${lb.leadId}`, { status: "spam" }],
      ["DELETE", `/api/biz/${a.bizId}/leads/${lb.leadId}`],
      ["DELETE", `/api/biz/${a.bizId}/contacts/${bc}`],
      ["PATCH", `/api/biz/${a.bizId}/contacts/${bc}`, { enabled: false }],
      ["POST", `/api/biz/${a.bizId}/contacts/${bc}/send-code`, {}],
      ["POST", `/api/biz/${a.bizId}/contacts/${bc}/confirm`, { code: "123456" }],
    ];
    for (const [m, p, body] of attempts) assert.equal((await w.call(m, p, { cookie: a.cookie, csrf: a.csrf, body })).status, 404, `${m} ${p}`);
    // B is untouched.
    assert.equal((await TB.dashboard.leadDetail(lb.leadId)).status, "new");
    assert.equal((await TB.profile()).name, "Bravo Plumbing");
    assert.equal((await TB.notifications.contacts.list()).length, 1);
    assert.equal((await TB.notifications.contacts.list())[0].enabled, 1);
    assert.equal((await TB.members.listInvitations()).length, 0);
    assert.equal((await TB.members.list()).length, 1);
    assert.equal((await TB.knowledge.get()), null);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM contact_verifications")).n, 0);
  });
  test("exports contain only the caller's business", async () => {
    const { w, a } = await two();
    const r = await w.api(a).get("/leads/export.csv");
    assert.equal(r.status, 200);
    assert.ok(r.text.includes("Acme Customer")); assert.ok(!r.text.includes("Bravo") && !r.text.includes("bravo") && !r.text.includes("5125550999"));
  });
  test("lists, search, handoffs, overview and audit never include another business's rows", async () => {
    const { w, a } = await two();
    const blobs = [
      (await w.api(a).get("/leads?limit=100")).text, (await w.api(a).get("/leads?q=bravo")).text, (await w.api(a).get("/leads?q=%25")).text,
      (await w.api(a).get("/conversations?limit=100")).text, (await w.api(a).get("/handoffs")).text, (await w.api(a).get("/notifications")).text, (await w.api(a).get("/audit")).text, (await w.api(a).get("/overview")).text,
    ];
    for (const t of blobs) assert.ok(!/bravo|Bravo|5125550999/.test(t), t.slice(0, 120));
    assert.equal((await w.api(a).get("/overview")).data.overview.leadsTotal, 1);
  });
  test("search wildcards and SQL-looking input cannot widen the tenant filter", async () => {
    const { w, a } = await two();
    for (const q of ["%", "_", "' OR 1=1 --", "\\", "bravo-secret-leak"]) {
      const r = await w.api(a).get(`/leads?q=${encodeURIComponent(q)}`);
      assert.equal(r.status, 200); assert.ok(r.data.leads.every((l) => l.name === "Acme Customer"), q);
    }
    assert.equal((await w.api(a).get("/leads?q=bravo-secret-leak")).data.total, 0);
  });
  test("malformed or hostile business ids are 404, not errors", async () => {
    const { w, a } = await two();
    for (const id of ["", "..", "../etc", "%2e%2e", "a b", "x'--", "%00", "A".repeat(200), "*", "demo-plumbing"]) {
      const r = await w.call("GET", `/api/biz/${encodeURIComponent(id)}/overview`, { cookie: a.cookie });
      assert.ok([404].includes(r.status), `${id} -> ${r.status}`);
    }
  });
  test("a client-supplied business id in the body or query cannot override the URL's authorized business", async () => {
    const { w, a, b } = await two();
    const r = await w.call("PUT", `/api/biz/${a.bizId}/settings`, { cookie: a.cookie, csrf: a.csrf, body: { confirm: true, hours: "9-5", businessId: b.bizId, business_id: b.bizId } });
    assert.equal(r.status, 200);
    assert.equal((await forBusiness(w.db, b.bizId).knowledge.get()), null);
    assert.equal((await w.api(a).get(`/leads?businessId=${b.bizId}&business_id=${b.bizId}`)).data.leads.length, 1);
  });
  test("removed members lose access immediately even with a live session", async () => {
    const { w, a } = await two();
    const outsider = await w.signup("extra@acme.example", "Extra Co");
    await w.api(a).send("POST", "/team/invitations", { email: "extra@acme.example", role: "staff" });
    const tok = w.mailer.last("invitation", "extra@acme.example").data.token;
    assert.equal((await w.call("POST", "/api/auth/accept-invite", { cookie: outsider.cookie, csrf: outsider.csrf, body: { token: tok } })).status, 200);
    assert.equal((await w.call("GET", `/api/biz/${a.bizId}/leads`, { cookie: outsider.cookie })).status, 200);
    const uid = (await w.api(a).get("/team")).data.members.find((m) => m.email === "extra@acme.example").user_id;
    assert.equal((await w.api(a).send("DELETE", `/team/members/${uid}`)).status, 200);
    assert.equal((await w.call("GET", `/api/biz/${a.bizId}/leads`, { cookie: outsider.cookie })).status, 404);
  });
  test("every cross-business attempt left B's audit log free of A's actions", async () => {
    const { w, a, b, lb } = await two();
    await w.call("PATCH", `/api/biz/${b.bizId}/leads/${lb.leadId}`, { cookie: a.cookie, csrf: a.csrf, body: { status: "spam" } });
    const actions = (await forBusiness(w.db, b.bizId).members.audit()).map((e) => e.action);
    assert.ok(!actions.includes("lead_status_changed"));
  });
});

describe("roles and permissions over HTTP", () => {
  async function team() {
    const w = await makeWorld();
    const owner = await w.signup("owner@acme.example", "Acme Plumbing");
    const lead = await w.seedLead(owner.bizId, { emergency: true });
    const members = {};
    for (const role of ["manager", "staff", "viewer"]) {
      const email = `${role}@acme.example`;
      const u = await w.signup(email, `${role} personal co`);
      assert.equal((await w.api(owner).send("POST", "/team/invitations", { email, role })).status, 201);
      const tok = w.mailer.last("invitation", email).data.token;
      assert.equal((await w.call("POST", "/api/auth/accept-invite", { cookie: u.cookie, csrf: u.csrf, body: { token: tok } })).status, 200);
      members[role] = { ...u, bizId: owner.bizId };
    }
    return { w, owner, lead, ...members };
  }
  const allow = { owner: [200, 200, 200, 200, 200, 200, 200], manager: [200, 200, 200, 200, 403, 403, 200], staff: [200, 200, 200, 403, 403, 403, 403], viewer: [200, 200, 403, 403, 403, 403, 403] };
  test("permission matrix is enforced by the server for each role", async () => {
    const t = await team();
    for (const role of ["owner", "manager", "staff", "viewer"]) {
      const u = t[role]; const A = t.w.api(u);
      const got = [(await A.get("/leads")).status, (await A.get("/conversations")).status, (await A.get("/handoffs")).status, (await A.get("/notifications")).status, (await A.get("/team")).status, (await A.get("/audit")).status, (await A.get("/leads/export.csv")).status];
      const want = { owner: [200, 200, 200, 200, 200, 200, 200], manager: [200, 200, 200, 200, 403, 403, 200], staff: [200, 200, 200, 403, 403, 403, 403], viewer: [200, 200, 403, 403, 403, 403, 403] }[role];
      assert.deepEqual(got, want, role);
    }
    void allow;
  });
  test("viewer sees masked phone/email everywhere, including free text and conversation messages", async () => {
    const t = await team();
    const V = t.w.api(t.viewer);
    const list = (await V.get("/leads")).text, detail = (await V.get(`/leads/${t.lead.leadId}`)).text, conv = (await V.get(`/conversations/${t.lead.convId}`)).text;
    for (const blob of [list, detail, conv]) { assert.ok(!blob.includes("5125550142") && !blob.includes("512-555-0142") && !blob.includes("jane@customer.example"), blob.slice(0, 200)); }
    assert.equal((await V.get(`/leads/${t.lead.leadId}`)).data.lead.contactMasked, true);
    const S = t.w.api(t.staff);
    assert.ok((await S.get(`/leads/${t.lead.leadId}`)).text.includes("+15125550142"));
  });
  test("viewer cannot change anything; staff can change status but not delete", async () => {
    const t = await team();
    const { leadId } = t.lead;
    assert.equal((await t.w.api(t.viewer).send("PATCH", `/leads/${leadId}`, { status: "won" })).status, 403);
    assert.equal((await t.w.api(t.staff).send("PATCH", `/leads/${leadId}`, { status: "contacted" })).status, 200);
    assert.equal((await t.w.api(t.staff).send("DELETE", `/leads/${leadId}`)).status, 403);
    assert.equal((await t.w.api(t.manager).send("DELETE", `/leads/${leadId}`)).status, 403);
    assert.equal((await t.w.api(t.owner).get(`/leads/${leadId}`)).data.lead.status, "contacted");
  });
  test("only owners manage team, contacts; managers and staff are refused", async () => {
    const t = await team();
    for (const role of ["manager", "staff", "viewer"]) {
      const A = t.w.api(t[role]);
      assert.equal((await A.send("POST", "/team/invitations", { email: "x@y.example", role: "viewer" })).status, 403, role);
      assert.equal((await A.send("POST", "/contacts", { channel: "email", address: "x@y.example" })).status, 403, role);
    }
    assert.equal((await t.w.api(t.manager).get("/contacts")).status, 200);
    assert.equal((await t.w.api(t.staff).get("/contacts")).status, 403);
  });
  test("settings: manager may edit, staff/viewer may not", async () => {
    const t = await team();
    assert.equal((await t.w.api(t.manager).send("PUT", "/settings", { confirm: true, hours: "Mon–Fri 8–5" })).status, 200);
    for (const r of ["staff", "viewer"]) { assert.equal((await t.w.api(t[r]).get("/settings")).status, 403); assert.equal((await t.w.api(t[r]).send("PUT", "/settings", { confirm: true, hours: "x" })).status, 403); }
  });
  test("a user's role in one business gives nothing in another", async () => {
    const t = await team();
    const other = await t.w.signup("owner@other.example", "Other Co");
    assert.equal((await t.w.call("GET", `/api/biz/${other.bizId}/leads`, { cookie: t.manager.cookie })).status, 404);
    assert.equal((await t.w.call("GET", `/api/biz/${t.owner.bizId}/leads`, { cookie: other.cookie })).status, 404);
  });
  test("last owner cannot be demoted or removed; invitations cannot grant owner", async () => {
    const t = await team();
    const uid = (await t.w.api(t.owner).get("/team")).data.members.find((m) => m.role === "owner").user_id;
    assert.equal((await t.w.api(t.owner).send("PATCH", `/team/members/${uid}`, { role: "viewer" })).status, 409);
    assert.equal((await t.w.api(t.owner).send("DELETE", `/team/members/${uid}`)).status, 409);
    assert.equal((await t.w.api(t.owner).send("POST", "/team/invitations", { email: "x@y.example", role: "owner" })).status, 400);
    assert.equal((await t.w.api(t.owner).send("PATCH", `/team/members/${uid}`, { role: "superuser" })).status, 409);
  });
  test("an invitation only works for the invited verified email, once", async () => {
    const t = await team();
    await t.w.api(t.owner).send("POST", "/team/invitations", { email: "new@acme.example", role: "staff" });
    const tok = t.w.mailer.last("invitation", "new@acme.example").data.token;
    const wrong = await t.w.signup("wrong@acme.example", "Wrong Co");
    assert.equal((await t.w.call("POST", "/api/auth/accept-invite", { cookie: wrong.cookie, csrf: wrong.csrf, body: { token: tok } })).status, 400);
    const right = await t.w.signup("new@acme.example", "New Co");
    assert.equal((await t.w.call("POST", "/api/auth/accept-invite", { cookie: right.cookie, csrf: right.csrf, body: { token: tok } })).status, 200);
    assert.equal((await t.w.call("POST", "/api/auth/accept-invite", { cookie: right.cookie, csrf: right.csrf, body: { token: tok } })).status, 400);
    assert.equal((await t.w.call("POST", "/api/auth/accept-invite", { cookie: right.cookie, csrf: right.csrf, body: { token: "garbage" } })).status, 400);
  });
  test("/api/me lists only the user's own businesses and permissions", async () => {
    const t = await team();
    const me = (await t.w.call("GET", "/api/me", { cookie: t.viewer.cookie })).data;
    assert.equal(me.businesses.length, 2);
    const acme = me.businesses.find((b) => b.id === t.owner.bizId);
    assert.equal(acme.role, "viewer"); assert.ok(!acme.permissions.includes("leads.export"));
    assert.ok(!JSON.stringify(me).includes("password") && !JSON.stringify(me).includes("token_hash"));
  });
});

describe("dashboard features", () => {
  test("overview, filters (status, urgent, search), detail with timeline", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example"); const A = w.api(u);
    const e = await w.seedLead(u.bizId, { name: "Urgent Una", emergency: true, issue: "gas smell" });
    await w.seedLead(u.bizId, { name: "Calm Cal", issue: "slow drain" });
    const ov = (await A.get("/overview")).data.overview;
    assert.deepEqual([ov.leadsTotal, ov.leadsNew, ov.urgentOpen, ov.conversationsTotal], [2, 2, 1, 2]);
    assert.deepEqual((await A.get("/leads?urgent=1")).data.leads.map((l) => l.name), ["Urgent Una"]);
    assert.deepEqual((await A.get("/leads")).data.leads.map((l) => l.name), ["Urgent Una", "Calm Cal"]);
    assert.deepEqual((await A.get("/leads?q=drain")).data.leads.map((l) => l.name), ["Calm Cal"]);
    assert.equal((await A.get("/leads?status=bogus")).status, 400);
    assert.equal((await A.get("/leads?limit=1&offset=1")).data.leads.length, 1);
    const d = (await A.get(`/leads/${e.leadId}`)).data.lead;
    assert.equal(d.emergency, true); assert.ok(d.events.some((x) => x.type === "created"));
  });
  test("status update persists, writes a timeline event and an audit event; bad status rejected", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example"); const A = w.api(u);
    const { leadId } = await w.seedLead(u.bizId);
    assert.equal((await A.send("PATCH", `/leads/${leadId}`, { status: "contacted" })).status, 200);
    assert.equal((await A.send("PATCH", `/leads/${leadId}`, { status: "hacked" })).status, 400);
    assert.equal((await A.send("PATCH", `/leads/${leadId}`, {})).status, 400);
    assert.equal((await A.send("PATCH", `/leads/nope`, { status: "won" })).status, 404);
    const d = (await A.get(`/leads/${leadId}`)).data.lead;
    assert.equal(d.status, "contacted"); assert.ok(d.events.some((x) => x.type === "status_changed" && x.detail.to === "contacted"));
    assert.ok((await A.get("/audit")).data.events.some((e) => e.action === "lead_status_changed" && e.detail.to === "contacted"));
  });
  test("owner delete erases the lead, its conversation and messages; audit keeps ids only", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example"); const A = w.api(u);
    const { leadId, convId } = await w.seedLead(u.bizId);
    assert.equal((await A.send("DELETE", `/leads/${leadId}`)).status, 200);
    assert.equal((await A.get(`/leads/${leadId}`)).status, 404); assert.equal((await A.get(`/conversations/${convId}`)).status, 404);
    assert.equal((await w.db.first("SELECT COUNT(*) n FROM messages")).n, 0);
    const audit = JSON.stringify((await A.get("/audit")).data.events);
    assert.ok(audit.includes("lead_deleted")); assert.ok(!audit.includes("jane@customer.example") && !audit.includes("5125550142"));
    assert.equal((await A.send("DELETE", `/leads/${leadId}`)).status, 404);
  });
  test("CSV export escapes formula injection and quotes, is audited, and is an attachment", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example");
    await w.seedLead(u.bizId, { name: '=HYPERLINK("http://evil.example","x")', issue: '+cmd|" /C calc"!A0, "quoted"' });
    const r = await w.api(u).get("/leads/export.csv");
    assert.match(r.headers.get("Content-Type"), /text\/csv/); assert.match(r.headers.get("Content-Disposition"), /attachment/);
    assert.ok(r.text.includes(`"'=HYPERLINK(`)); assert.ok(r.text.includes(`"'+cmd`));
    assert.ok(!/(^|,)"[=+\-@]/m.test(r.text.split("\r\n")[1]));
    assert.ok((await w.api(u).get("/audit")).data.events.some((e) => e.action === "leads_exported" && e.detail.count === 1));
  });
  test("conversations list/filter/detail and handoffs", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example"); const A = w.api(u);
    const h = await w.seedLead(u.bizId, { handoff: true, emergency: true }); await w.seedLead(u.bizId);
    assert.equal((await A.get("/conversations?status=needs_human")).data.conversations.length, 1);
    assert.equal((await A.get("/conversations?urgent=1")).data.conversations.length, 1);
    assert.equal((await A.get("/conversations?status=bogus")).status, 400);
    const c = (await A.get(`/conversations/${h.convId}`)).data.conversation;
    assert.deepEqual(c.messages.map((m) => m.role), ["customer", "assistant"]);
    const ho = (await A.get("/handoffs")).data.handoffs;
    assert.equal(ho.length, 1); assert.equal(ho[0].conversation_id, h.convId); assert.equal(ho[0].urgent, true);
  });
  test("notification history is honest: simulated sends are labeled, undeliverable says business NOT notified, never 'delivered'", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example"); const A = w.api(u);
    const { leadId, convId } = await w.seedLead(u.bizId);
    const T = forBusiness(w.db, u.bizId);
    await T.notifications.enqueueForLead({ leadId, conversationId: convId, kind: "new_lead", priority: "normal" });
    let n = (await A.get("/notifications")).data;
    assert.equal(n.notifications[0].status, "undeliverable"); assert.match(n.notifications[0].description, /NOT been notified/);
    assert.ok(n.needsAttention.length >= 1);
    await T.notifications.contacts.add({ channel: "email", address: "o@acme.example", verified: true });
    const l2 = await w.seedLead(u.bizId, { name: "Second" });
    await T.notifications.enqueueForLead({ leadId: l2.leadId, conversationId: l2.convId, kind: "new_lead", priority: "normal" });
    const mock = new MockNotifier();
    await dispatchDue({ db: w.db, channels: { email: mock, sms: mock } });
    n = (await A.get("/notifications")).data;
    const sent = n.notifications.find((x) => x.status === "sent");
    assert.ok(sent); assert.equal(sent.simulated, true); assert.match(sent.description, /SIMULATED/); assert.match(sent.description, /not confirmed/i);
    assert.ok(!n.notifications.some((x) => x.status === "delivered"));
  });
  test("settings: require explicit confirmation, store owner-verified facts, validate, and show who confirmed", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example"); const A = w.api(u);
    assert.equal((await A.send("PUT", "/settings", { hours: "Mon–Fri 8–5" })).status, 400);
    assert.equal((await A.get("/settings")).data.settings.hours, "");
    const r = await A.send("PUT", "/settings", { confirm: true, companyName: "Acme Pro Plumbing", hours: "Mon–Fri 8–5", services: ["Drain cleaning", "Water heaters"], serviceAreaText: "Springfield area", serviceZips: ["62701", "62702"], afterHoursPolicy: "Emergencies only after 6pm", pricing: "Quoted after inspection" });
    assert.equal(r.status, 200, r.text);
    const s = (await A.get("/settings")).data.settings;
    assert.equal(s.companyName, "Acme Pro Plumbing"); assert.deepEqual(s.services, ["Drain cleaning", "Water heaters"]); assert.deepEqual(s.serviceZips, ["62701", "62702"]);
    assert.ok(s.confirmedBy.hours.by.startsWith("user:")); assert.ok(s.confirmedBy.hours.at);
    const kb = (await forBusiness(w.db, u.bizId).knowledge.get()).document;
    assert.equal(kb.facts.hours.verified, true); assert.equal(kb.facts.hours.verifiedBy, s.confirmedBy.hours.by);
    assert.equal(kb.facts.diagnostic_fee, undefined);
    for (const bad of [{ services: "x" }, { services: [1] }, { serviceZips: ["1234"] }, { hours: 5 }, { companyName: "A" }, { hours: "x".repeat(601) }, {}]) assert.equal((await A.send("PUT", "/settings", { confirm: true, ...bad })).status, 400, JSON.stringify(bad).slice(0, 40));
    assert.equal((await A.send("PUT", "/settings", { confirm: true, hours: "" })).status, 200);
    assert.equal((await A.get("/settings")).data.settings.hours, "");
    assert.ok((await A.get("/audit")).data.events.some((e) => e.action === "settings_updated"));
  });
  test("settings never alter another business's settings", async () => {
    const w = await makeWorld(); const a = await w.signup("o@acme.example"); const b = await w.signup("o@bravo.example", "Bravo");
    await w.api(a).send("PUT", "/settings", { confirm: true, hours: "A hours" });
    await w.api(b).send("PUT", "/settings", { confirm: true, hours: "B hours" });
    assert.equal((await w.api(a).get("/settings")).data.settings.hours, "A hours");
    assert.equal((await w.api(b).get("/settings")).data.settings.hours, "B hours");
  });
  test("contacts over HTTP: add → unverified; code is simulated, never in any response; confirm → simulated_verified, not verified", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example"); const A = w.api(u);
    const add = await A.send("POST", "/contacts", { channel: "email", address: "alerts@acme.example" });
    assert.equal(add.status, 201); const id = add.data.id;
    assert.equal((await A.send("POST", "/contacts", { channel: "email", address: "alerts@acme.example" })).status, 409);
    assert.equal((await A.send("POST", "/contacts", { channel: "email", address: "bad" })).status, 400);
    const send = await A.send("POST", `/contacts/${id}/send-code`, {});
    assert.equal(send.status, 200); assert.equal(send.data.simulated, true); assert.match(send.data.notice, /SIMULATED/);
    const code = w.mailer.last("contact_verification").data.code;
    assert.ok(!send.text.includes(code));
    assert.equal((await A.send("POST", `/contacts/${id}/send-code`, {})).status, 429);
    assert.equal((await A.send("POST", `/contacts/${id}/confirm`, { code: code === "000000" ? "111111" : "000000" })).data.error, "wrong_code");
    const ok = await A.send("POST", `/contacts/${id}/confirm`, { code });
    assert.equal(ok.data.state, "simulated_verified");
    const list = (await A.get("/contacts")).data;
    assert.equal(list.mode, "simulated"); assert.equal(list.contacts[0].state, "simulated_verified"); assert.equal(list.contacts[0].verifiedAt, null);
    assert.equal((await A.send("PATCH", `/contacts/${id}`, { enabled: false })).status, 200);
    assert.equal((await A.send("DELETE", `/contacts/${id}`)).status, 200);
  });
  test("unknown routes and methods are 404/405, not 500", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example");
    assert.equal((await w.api(u).get("/nope")).status, 404);
    assert.equal((await w.api(u).send("DELETE", "/overview")).status, 404);
    assert.equal((await w.call("GET", "/api/auth/login")).status, 405);
    assert.equal((await w.call("POST", "/api/auth/nope", { origin: ORIGIN, body: {} })).status, 404);
  });
  test("simulated mailbox exists only in dev mode and is clearly labeled", async () => {
    const off = await makeWorld(); assert.equal((await off.call("GET", "/dev/simulated-mail")).status, 404);
    const on = await makeWorld({ devMode: true }); await on.signup("o@acme.example");
    const r = await on.call("GET", "/dev/simulated-mail");
    assert.equal(r.status, 200); assert.match(r.data.banner, /SIMULATED/); assert.ok(r.data.messages.length >= 1);
  });
  test("no response or audit row ever contains a password, password hash, or session token", async () => {
    const w = await makeWorld(); const u = await w.signup("o@acme.example"); const A = w.api(u);
    const tok = u.cookie.split("=")[1];
    for (const p of ["/overview", "/leads", "/team", "/audit", "/contacts", "/settings", "/notifications"]) {
      const t = (await A.get(p)).text;
      assert.ok(!t.includes(PW) && !t.includes(tok) && !t.includes("pbkdf2") && !t.includes("password_hash") && !t.includes("token_hash"), p);
    }
    assert.ok(!(await w.call("GET", "/api/me", { cookie: u.cookie })).text.includes(tok));
  });
});

describe("Stage 5 repositories are tenant-scoped (SQL spy)", () => {
  test("every statement from the dashboard, members, contact-verification and contact repos binds the business id", async () => {
    const w = await makeWorld();
    const u = await w.signup("o@acme.example"); const other = await w.signup("o@bravo.example", "Bravo");
    const { leadId } = await w.seedLead(u.bizId);
    const T = forBusiness(w.db, u.bizId);
    const seen = [];
    for (const m of ["all", "first", "run"]) { const o = w.db[m].bind(w.db); w.db[m] = (sql, p = []) => { seen.push({ sql, p }); return o(sql, p); }; }
    const ob = w.db.batch.bind(w.db); w.db.batch = (s) => { s.forEach((x) => seen.push({ sql: x.sql, p: x.params ?? [] })); return ob(s); };
    const D = T.dashboard;
    await D.overview(); await D.searchLeads({ q: "x", status: "new", urgent: true }); await D.exportLeads(); await D.leadDetail(leadId); await D.setLeadStatus("u", leadId, "won");
    await D.listConversations({ urgent: true }); await D.conversationDetail("x"); await D.handoffs(); await D.notificationHistory(); await D.updateBusinessName("u", "New Name"); await D.recordExport("u", 1);
    await T.members.list(); await T.members.roleOf("x"); await T.members.listInvitations(); await T.members.audit(); await T.members.record("u", "a", null, {});
    const uid = (await T.members.list())[0].user_id;
    await T.members.createInvitation({ actorId: uid, email: "a@b.example", role: "staff", tokenHash: "h", expiresAt: "2099-01-01T00:00:00Z" });
    const c = await T.notifications.contacts.add({ channel: "email", address: "x@acme.example" });
    await T.notifications.contacts.get(c.id); await T.notifications.contacts.isRealVerified("email", "x@acme.example"); await T.notifications.contacts.markSimulatedVerified(c.id);
    await T.contactVerify.start({ actorId: "u", contactId: c.id, codeHash: "h", expiresAt: "2099-01-01T00:00:00Z", simulated: true, now: new Date().toISOString(), cooldownMs: 0, dailyCap: 9 });
    await T.contactVerify.check({ actorId: "u", contactId: c.id, codeHash: "h", now: new Date().toISOString() });
    await T.notifications.contacts.remove(c.id);
    await D.deleteLead("u", leadId);
    assert.ok(seen.length > 30);
    for (const s of seen) {
      assert.ok(s.p.includes(u.bizId), `statement missing business id binding: ${s.sql.slice(0, 90)}`);
      assert.ok(!s.p.includes(other.bizId));
      assert.ok(!/\$\{/.test(s.sql));
    }
  });
});


describe("Stage 6 deletion behavior", () => {
  test("deleting a lead removes its conversation, messages, lead events and notifications but keeps a minimal audit record", async () => {
    const w = await makeWorld();
    const u = await w.signup("privacy@acme.example");
    const { leadId } = await w.seedLead(u.bizId);
    const lead = await w.db.first("SELECT conversation_id FROM leads WHERE id = ? AND business_id = ?", [leadId, u.bizId]);
    assert.ok(lead);
    const conversationId = lead.conversation_id;
    // Seed a message and a lead event so cascade behavior is checked, not assumed.
    await w.db.run("INSERT INTO messages (id, business_id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?,?)", ["privacy-msg", u.bizId, conversationId, "customer", "Private customer text", new Date().toISOString()]);
    await w.db.run("INSERT INTO lead_events (id, business_id, lead_id, type, detail, created_at) VALUES (?,?,?,?,?,?)", ["privacy-evt", u.bizId, leadId, "updated", JSON.stringify({ fields: ["phone"] }), new Date().toISOString()]);
    await w.db.run("INSERT INTO notifications (id, business_id, lead_id, kind, variant, priority, priority_rank, channel, idempotency_key, status, attempts, max_attempts, simulated, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ["privacy-notif", u.bizId, leadId, "new_lead", "initial", "normal", 2, "email", "privacy-test-key", "queued", 0, 3, 1, new Date().toISOString(), new Date().toISOString()]);
    await w.db.run("INSERT INTO notification_attempts (id, business_id, notification_id, attempt_no, started_at, finished_at, outcome, error_code) VALUES (?,?,?,?,?,?,?,?)", ["privacy-attempt", u.bizId, "privacy-notif", 1, new Date().toISOString(), new Date().toISOString(), "accepted", null]);
    const T = forBusiness(w.db, u.bizId);
    await T.dashboard.deleteLead(u.userId, leadId);
    for (const [table, column, value] of [["leads","id",leadId],["conversations","id",conversationId],["messages","id","privacy-msg"],["lead_events","id","privacy-evt"],["notifications","id","privacy-notif"],["notification_attempts","id","privacy-attempt"]]) {
      const row = await w.db.first(`SELECT 1 AS found FROM ${table} WHERE ${column} = ? AND business_id = ?`, [value, u.bizId]);
      assert.equal(row, null, `${table} should be removed`);
    }
    const audit = await w.db.first("SELECT action, target, detail FROM audit_log WHERE business_id = ? AND action = 'lead_deleted' ORDER BY created_at DESC LIMIT 1", [u.bizId]);
    assert.ok(audit);
    assert.equal(audit.target, leadId);
    assert.doesNotMatch(audit.detail, /Private customer text|@|\\+1/);
    await assert.rejects(() => T.dashboard.deleteLead(u.userId, leadId), (e) => e.code === "not_found");
  });
});
