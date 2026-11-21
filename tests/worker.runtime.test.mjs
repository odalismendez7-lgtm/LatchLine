// The REAL Worker entry (src/index.js: fetch + scheduled) with the REAL D1Adapter, running on Node against a
// D1-SHAPED shim over SQLite (scripts/lib/d1-shim.mjs). Not workerd, not real D1 (KI-15, KI-40).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { openShim } from "../scripts/lib/d1-shim.mjs";
import { platformRepo, forBusiness } from "../src/db/tenant.js";
import { DbMockMailer } from "../src/auth/mailer.js";

const BASE = "http://localhost";
const PW = "correct horse battery staple";
const SALT = "worker-test-salt-123";
const ctx = () => { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.allSettled(p) }; };

function boot(extra = {}) {
  const shim = openShim(":memory:");
  const env = { DB: shim.d1, RATE_LIMIT_SALT: SALT, LATCHLINE_ACCOUNTS: "mock-local", LATCHLINE_DEV_MAILBOX: "1", ...extra };
  const call = async (method, path, { body, cookie, csrf, origin = BASE, host = BASE, headers = {} } = {}) => {
    const h = { ...headers };
    if (method !== "GET" && origin) h.Origin = origin;
    if (cookie) h.Cookie = cookie; if (csrf) h["X-CSRF-Token"] = csrf;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const c = ctx();
    const res = await worker.fetch(new Request(host + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, c);
    await c.done();
    const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, data, text, headers: res.headers, setCookie: res.headers.getSetCookie?.() ?? [] };
  };
  const mail = async () => (await call("GET", "/dev/simulated-mail")).data.messages;
  async function signup(email, name) {
    assert.equal((await call("POST", "/api/auth/register", { body: { email, password: PW, businessName: name } })).status, 200);
    const m = (await mail()).find((x) => x.template === "verify_email" && x.to === email);
    assert.equal((await call("POST", "/api/auth/verify-email", { body: { token: m.data.token } })).status, 200);
    const r = await call("POST", "/api/auth/login", { body: { email, password: PW } });
    assert.equal(r.status, 200, r.text);
    const cookie = r.setCookie[0].split(";")[0];
    const me = (await call("GET", "/api/me", { cookie })).data;
    return { email, cookie, csrf: r.data.csrf, bizId: me.businesses[0].id };
  }
  return { shim, env, call, mail, signup };
}

describe("Worker entry: accounts are OFF unless explicitly switched on (KI-32)", () => {
  test("with no flag there is no dashboard, no account API, no simulated mailbox", async () => {
    const w = boot({ LATCHLINE_ACCOUNTS: undefined, LATCHLINE_DEV_MAILBOX: undefined });
    for (const [m, p] of [["GET", "/app"], ["GET", "/api/me"], ["POST", "/api/auth/login"], ["POST", "/api/auth/register"], ["GET", "/dev/simulated-mail"], ["GET", "/api/biz/x/leads"]]) assert.equal((await w.call(m, p, { body: m === "POST" ? {} : undefined })).status, 404, `${m} ${p}`);
    assert.equal((await w.call("GET", "/health")).status, 200);
  });
  test("any other flag value (including a plausible 'true') does not enable them", async () => {
    for (const v of ["true", "1", "on", "MOCK-LOCAL", "mock", ""]) assert.equal((await boot({ LATCHLINE_ACCOUNTS: v }).call("GET", "/app")).status, 404, v);
  });
  test("the checked-in wrangler.toml does not enable accounts or the dev mailbox", async () => {
    const { readFileSync } = await import("node:fs");
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assert.ok(!/LATCHLINE_ACCOUNTS|LATCHLINE_DEV_MAILBOX/.test(toml));
  });
  test("the simulated mailbox needs its own flag AND a localhost request", async () => {
    const noFlag = boot({ LATCHLINE_DEV_MAILBOX: undefined });
    assert.equal((await noFlag.call("GET", "/dev/simulated-mail")).status, 404);
    const w = boot();
    assert.equal((await w.call("GET", "/dev/simulated-mail")).status, 200);
    assert.equal((await w.call("GET", "/dev/simulated-mail", { host: "https://latchline.example" })).status, 404);
  });
});

describe("Worker entry: configuration failures are honest", () => {
  test("missing or weak RATE_LIMIT_SALT gives 503 'not configured' and touches nothing", async () => {
    for (const salt of [undefined, "", "short"]) {
      const w = boot({ RATE_LIMIT_SALT: salt });
      const r = await w.call("GET", "/app");
      assert.equal(r.status, 503); assert.match(r.data.error, /not configured/);
      assert.equal((await w.shim.sqlite.first("SELECT COUNT(*) n FROM users")).n, 0);
    }
  });
});

describe("Worker entry + D1 adapter: accounts and dashboard", () => {
  test("register, verify (simulated), login, dashboard; password stored as a full-strength hash; no plaintext anywhere", async () => {
    const w = boot();
    const u = await w.signup("owner@acme.example", "Acme Plumbing");
    assert.match((await w.shim.sqlite.first("SELECT password_hash h FROM users")).h, /^pbkdf2-sha256\$600000\$/);
    const dump = JSON.stringify([await w.shim.sqlite.all("SELECT * FROM users"), await w.shim.sqlite.all("SELECT * FROM sessions"), await w.shim.sqlite.all("SELECT * FROM audit_log")]);
    assert.ok(!dump.includes(PW) && !dump.includes(u.cookie.split("=")[1]));
    assert.equal((await w.call("GET", `/api/biz/${u.bizId}/overview`, { cookie: u.cookie })).status, 200);
    assert.equal((await w.call("GET", "/app")).status, 200);
  });
  test("cross-business access through the Worker path is denied and changes nothing", async () => {
    const w = boot();
    const a = await w.signup("a@acme.example", "Acme"), b = await w.signup("b@bravo.example", "Bravo");
    const T = forBusiness(w.shim.sqlite, b.bizId);
    const cv = await T.conversations.create();
    const lead = await T.leads.create(cv.id, { name: "Bravo Customer", phone: "+15125550142", zip: "62701", issueText: "leak", urgency: "can_wait" });
    for (const p of ["/overview", "/leads", "/leads/export.csv", `/leads/${lead.id}`, "/settings", "/contacts", "/team", "/audit"]) assert.equal((await w.call("GET", `/api/biz/${b.bizId}${p}`, { cookie: a.cookie })).status, 404, p);
    assert.equal((await w.call("PATCH", `/api/biz/${b.bizId}/leads/${lead.id}`, { cookie: a.cookie, csrf: a.csrf, body: { status: "spam" } })).status, 404);
    assert.equal((await w.call("DELETE", `/api/biz/${a.bizId}/leads/${lead.id}`, { cookie: a.cookie, csrf: a.csrf })).status, 404);
    assert.equal((await T.leads.get(lead.id)).status, "new");
  });
  test("every simulated mail row is labeled simulated, and rows older than 2 hours are purged", async () => {
    const w = boot();
    await w.signup("a@acme.example", "Acme");
    assert.ok((await w.mail()).every((m) => m.simulated === true));
    let now = Date.now();
    const mailer = new DbMockMailer(w.shim.sqlite, { now: () => now });
    await mailer.send({ channel: "email", to: "old@acme.example", template: "verify_email", data: { token: "t" } });
    now += 3 * 3600_000;
    await mailer.send({ channel: "email", to: "new@acme.example", template: "verify_email", data: { token: "t" } });
    const rows = await w.shim.sqlite.all("SELECT to_addr FROM simulated_mail");
    assert.ok(!rows.some((r) => r.to_addr === "old@acme.example") && rows.some((r) => r.to_addr === "new@acme.example"));
  });
});

describe("Worker entry: database failures (injected into the D1 binding)", () => {
  const outage = () => new Error("D1_ERROR: Network connection lost (secret-internal-detail /srv/x.js)");
  test("an outage gives 503 without internals, never a session cookie, and the Worker recovers by itself", async () => {
    const w = boot();
    const u = await w.signup("a@acme.example", "Acme");
    w.shim.failWith(outage());
    const dash = await w.call("GET", `/api/biz/${u.bizId}/overview`, { cookie: u.cookie });
    assert.ok([500, 503].includes(dash.status)); assert.ok(!/D1_ERROR|secret-internal|\/srv\//.test(dash.text));
    const login = await w.call("POST", "/api/auth/login", { body: { email: "a@acme.example", password: PW } });
    assert.equal(login.status, 503); assert.deepEqual(login.setCookie, []); assert.ok(!/D1_ERROR|secret-internal/.test(login.text));
    const chat = await w.call("POST", "/api/chat", { body: { message: "what are your hours?", siteKey: "sk_demo_local_0001" }, origin: "http://localhost" });
    assert.ok(!/D1_ERROR|secret-internal/.test(chat.text));
    w.shim.heal();
    assert.equal((await w.call("GET", `/api/biz/${u.bizId}/overview`, { cookie: u.cookie })).status, 200);
    assert.equal((await w.call("POST", "/api/auth/login", { body: { email: "a@acme.example", password: PW } })).status, 200);
  });
  test("an outage never reveals whether an account exists (same answer for known and unknown emails)", async () => {
    const w = boot();
    await w.signup("a@acme.example", "Acme");
    w.shim.failWith(outage());
    const known = await w.call("POST", "/api/auth/login", { body: { email: "a@acme.example", password: PW } });
    const unknown = await w.call("POST", "/api/auth/login", { body: { email: "ghost@acme.example", password: PW } });
    assert.deepEqual([known.status, known.text], [unknown.status, unknown.text]);
  });
  test("a failed dashboard write during an outage changes nothing", async () => {
    const w = boot();
    const u = await w.signup("a@acme.example", "Acme");
    const T = forBusiness(w.shim.sqlite, u.bizId);
    const cv = await T.conversations.create();
    const lead = await T.leads.create(cv.id, { name: "N", phone: "+15125550142", zip: "62701", issueText: "leak", urgency: "can_wait" });
    w.shim.failWith(outage());
    const r = await w.call("PATCH", `/api/biz/${u.bizId}/leads/${lead.id}`, { cookie: u.cookie, csrf: u.csrf, body: { status: "won" } });
    assert.ok([500, 503].includes(r.status));
    w.shim.heal();
    assert.equal((await T.leads.get(lead.id)).status, "new");
  });
});

describe("Worker entry: scheduled recovery", () => {
  test("scheduled() sends due mock notifications through the Worker's own mock channel; without config it does nothing", async () => {
    const w = boot();
    const p = platformRepo(w.shim.sqlite);
    await p.createBusiness({ id: "acme-plumbing", name: "Acme", industry: "plumbing", siteKey: "sk_acme_000000001", origins: [] });
    const T = forBusiness(w.shim.sqlite, "acme-plumbing");
    const c = await T.notifications.contacts.add({ channel: "email", address: "owner@acme.example" });
    await T.notifications.contacts.markSimulatedVerified(c.id);
    const cv = await T.conversations.create();
    const lead = await T.leads.create(cv.id, { name: "N", phone: "+15125550142", zip: "62701", issueText: "leak", urgency: "can_wait" });
    await T.notifications.enqueueForLead({ leadId: lead.id, conversationId: cv.id, kind: "new_lead", priority: "normal" });
    await worker.scheduled({}, { ...w.env, RATE_LIMIT_SALT: undefined }, ctx());
    assert.equal((await w.shim.sqlite.first("SELECT status FROM notifications")).status, "queued", "unconfigured: no-op");
    const c2 = ctx(); await worker.scheduled({}, w.env, c2); await c2.done();
    const n = await w.shim.sqlite.first("SELECT status, simulated FROM notifications");
    assert.deepEqual([n.status, n.simulated], ["sent", 1]);
  });
});
