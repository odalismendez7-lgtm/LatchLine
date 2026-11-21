// RUNTIME INTEGRATION TESTS. Each target is started as a separate OS process and exercised over real HTTP
// against a real SQLite file, including restarts, a hard kill, and a database fault.
//   dev-server  = scripts/dev-server.mjs (createApp on Node)
//   worker-sim  = scripts/worker-sim.mjs (the REAL src/index.js Worker entry + D1Adapter on a D1-shaped shim)
// Neither is the Cloudflare Workers runtime or real D1 (KI-15, KI-40). Password hashing runs at FULL production strength.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { SERVERS, startProc, client, tempDir, openDb, freePort } from "./helpers/proc.mjs";

const PW = "correct horse battery staple";
const CUSTOMER_PHONE = "512-555-0142";
const CUSTOMER_NAME = "Rita Runtime";

for (const kind of Object.keys(SERVERS)) {
  describe(`runtime: ${kind} (real process, real HTTP, real SQLite file)`, () => {
    const t = tempDir(); const PORT = freePort(); // same port across restarts: the business origin is registered for it
    const secrets = [PW, "+15125550142", CUSTOMER_PHONE];
    let s, c, A, B;
    const outputs = [];

    const mailbox = async () => (await c.call("GET", "/dev/simulated-mail")).data.messages;
    async function signup(email, name) {
      assert.equal((await c.call("POST", "/api/auth/register", { body: { email, password: PW, businessName: name } })).status, 200);
      const mail = (await mailbox()).find((m) => m.template === "verify_email" && m.to === email);
      assert.ok(mail, "simulated verification mail exists");
      assert.equal((await c.call("POST", "/api/auth/verify-email", { body: { token: mail.data.token } })).status, 200);
      return login(email);
    }
    async function login(email, password = PW) {
      const r = await c.call("POST", "/api/auth/login", { body: { email, password } });
      assert.equal(r.status, 200, r.text);
      const cookie = r.setCookie[0].split(";")[0];
      secrets.push(cookie.split("=")[1]);
      const me = (await c.call("GET", "/api/me", { cookie })).data;
      return { email, cookie, csrf: r.data.csrf, bizId: me.businesses[0].id };
    }
    const biz = (u) => ({ get: (p) => c.call("GET", `/api/biz/${u.bizId}${p}`, { cookie: u.cookie }), send: (m, p, body) => c.call(m, `/api/biz/${u.bizId}${p}`, { cookie: u.cookie, csrf: u.csrf, body }) });
    const dbRead = (sql, p = []) => { const d = openDb(t.db); try { return d.prepare(sql).all(...p); } finally { d.close(); } };
    const dbExec = (sql, p = []) => { const d = openDb(t.db); try { d.prepare(sql).run(...p); } finally { d.close(); } };

    async function customerLead(u, { scheduleOrigin }) {
      const [{ site_key }] = dbRead("SELECT site_key FROM businesses WHERE id = ?", [u.bizId]);
      if (!dbRead("SELECT 1 FROM business_origins WHERE business_id = ?", [u.bizId]).length) dbExec("INSERT INTO business_origins (business_id, origin) VALUES (?,?)", [u.bizId, scheduleOrigin]);
      let id;
      for (const message of ["my kitchen faucet keeps dripping all day", CUSTOMER_NAME, CUSTOMER_PHONE, "62701", "it can wait"]) {
        const r = await c.call("POST", "/api/chat", { body: { message, siteKey: site_key, conversationId: id }, origin: scheduleOrigin });
        assert.equal(r.status, 200, r.text); id = r.data.conversationId;
      }
      return id;
    }
    const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 150)); } };

    before(async () => {
      s = await startProc(kind, { db: t.db, port: PORT, env: { SCHEDULE_MS: "400" } });
      c = client(s.base);
    });
    after(async () => { try { await s?.stop("SIGKILL"); } catch { /* already stopped */ } t.cleanup(); });

    test("starts, serves the dashboard page with strict CSP, and reports a connected database", async () => {
      const page = await fetch(`${s.base}/app`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-security-policy"), /script-src 'nonce-/);
      const h = await (await fetch(`${s.base}/health`)).json();
      assert.equal(h.ok, true); assert.equal(h.databaseConnected, true); assert.equal(h.realAIConnected, false);
    });

    test("registration, simulated verification, and login work; the password is stored only as a full-strength PBKDF2 hash", async () => {
      A = await signup("owner@acme.example", "Acme Plumbing");
      B = await signup("owner@bravo.example", "Bravo Plumbing");
      const rows = dbRead("SELECT password_hash FROM users ORDER BY email");
      assert.equal(rows.length, 2);
      for (const r of rows) assert.match(r.password_hash, /^pbkdf2-sha256\$600000\$/);
      const everything = JSON.stringify(["users", "sessions", "auth_tokens", "audit_log", "memberships"].flatMap((tb) => dbRead(`SELECT * FROM ${tb}`)));
      assert.ok(!everything.includes(PW));
      assert.ok(!everything.includes(A.cookie.split("=")[1]), "raw session token is not in the database");
      assert.equal((await c.call("POST", "/api/auth/login", { body: { email: "owner@acme.example", password: "wrong wrong wrong!" } })).status, 401);
    });

    test("contact verification is SIMULATED end to end and persists as simulated-verified only", async () => {
      const a = biz(A);
      const add = await a.send("POST", "/contacts", { channel: "email", address: "alerts@acme.example" });
      assert.equal(add.status, 201);
      const send = await a.send("POST", `/contacts/${add.data.id}/send-code`, {});
      assert.equal(send.data.simulated, true);
      const mail = (await mailbox()).find((m) => m.template === "contact_verification");
      const ok = await a.send("POST", `/contacts/${add.data.id}/confirm`, { code: mail.data.code });
      assert.equal(ok.data.state, "simulated_verified");
      const row = dbRead("SELECT verified_at, simulated_verified_at FROM business_contacts")[0];
      assert.equal(row.verified_at, null); assert.ok(row.simulated_verified_at);
    });

    test("a customer chat creates a lead; the notification is sent by the (mock) dispatcher and labeled simulated", async () => {
      await customerLead(A, { scheduleOrigin: s.base });
      const leads = (await biz(A).get("/leads")).data.leads;
      assert.equal(leads.length, 1); assert.equal(leads[0].name, CUSTOMER_NAME);
      const n = await waitFor(async () => (await biz(A).get("/notifications")).data.notifications.find((x) => x.status === "sent"));
      assert.equal(n.simulated, true); assert.match(n.description, /SIMULATED/);
      assert.equal((await biz(A).get("/notifications")).data.notifications.some((x) => x.status === "delivered"), false);
      assert.equal(dbRead("SELECT COUNT(*) n FROM leads")[0].n, 1);
    });

    test("owner updates the lead status and the audit log records it", async () => {
      const id = (await biz(A).get("/leads")).data.leads[0].id;
      assert.equal((await biz(A).send("PATCH", `/leads/${id}`, { status: "contacted" })).status, 200);
      const audit = (await biz(A).get("/audit")).data.events.map((e) => e.action);
      for (const a of ["lead_created", "lead_status_changed", "contact_simulated_verified"]) assert.ok(audit.includes(a), a);
    });

    test("cross-tenant attacks over real HTTP: B's owner cannot reach A's data; hostile ids are 404; forged requests are 403", async () => {
      const leadId = (await biz(A).get("/leads")).data.leads[0].id;
      for (const p of ["/overview", "/leads", "/leads/export.csv", `/leads/${leadId}`, "/conversations", "/handoffs", "/notifications", "/settings", "/contacts", "/team", "/audit"]) {
        const r = await c.call("GET", `/api/biz/${A.bizId}${p}`, { cookie: B.cookie });
        assert.equal(r.status, 404, p); assert.ok(!/Acme|Rita|alerts@acme/.test(r.text), p);
      }
      for (const [m, p, body] of [["PATCH", `/leads/${leadId}`, { status: "spam" }], ["DELETE", `/leads/${leadId}`], ["PUT", "/settings", { confirm: true, hours: "hacked" }], ["POST", "/contacts", { channel: "email", address: "evil@x.example" }]]) {
        assert.equal((await c.call(m, `/api/biz/${A.bizId}${p}`, { cookie: B.cookie, csrf: B.csrf, body })).status, 404, `${m} ${p}`);
      }
      assert.equal((await biz(B).get(`/leads/${leadId}`)).status, 404);
      for (const id of ["..", "%2e%2e%2f", "a'b", "x".repeat(300), "demo-plumbing"]) assert.equal((await c.call("GET", `/api/biz/${encodeURIComponent(id)}/leads`, { cookie: B.cookie })).status, 404, id);
      assert.equal((await c.call("PATCH", `/api/biz/${A.bizId}/leads/${leadId}`, { cookie: A.cookie, body: { status: "won" } })).status, 403, "no CSRF token");
      assert.equal((await c.call("PATCH", `/api/biz/${A.bizId}/leads/${leadId}`, { cookie: A.cookie, csrf: A.csrf, origin: "https://evil.example", body: { status: "won" } })).status, 403, "foreign origin");
      assert.equal(dbRead("SELECT status FROM leads")[0].status, "contacted");
      assert.equal(dbRead("SELECT COUNT(*) n FROM business_contacts WHERE business_id = ?", [A.bizId])[0].n, 1);
    });

    test("a database fault (write lock) gives a clean 503, loses nothing, leaks nothing, and recovers", async () => {
      const leadId = (await biz(A).get("/leads")).data.leads[0].id;
      const locker = openDb(t.db); locker.exec("BEGIN IMMEDIATE");
      try {
        const r = await biz(A).send("PATCH", `/leads/${leadId}`, { status: "won" });
        assert.equal(r.status, 503, r.text);
        assert.equal(r.data.error, "temporarily_unavailable"); assert.ok(Number(r.headers.get("retry-after")) >= 1);
        assert.ok(!/sqlite|SQLITE|locked|stack|at \w+ \(|\/home\//i.test(r.text), "no internals in the error");
        assert.equal((await biz(A).get("/leads")).status, 200, "reads still work");
        const login503 = await c.call("POST", "/api/auth/login", { body: { email: "owner@acme.example", password: PW } });
        assert.ok([503].includes(login503.status), `login during outage -> ${login503.status}`);
        assert.ok(!login503.setCookie.length, "no session cookie issued without a stored session");
        const chat = await c.call("POST", "/api/chat", { body: { message: "my sink drips", siteKey: dbRead("SELECT site_key FROM businesses WHERE id = ?", [A.bizId])[0].site_key }, origin: s.base });
        assert.ok(chat.status === 200 || chat.status === 503);
      } finally { locker.exec("ROLLBACK"); locker.close(); }
      assert.equal(dbRead("SELECT status FROM leads")[0].status, "contacted", "the failed change did not partially apply");
      assert.equal((await biz(A).send("PATCH", `/leads/${leadId}`, { status: "won" })).status, 200, "recovers by itself");
    });

    test("session expiry is enforced by the running server: idle, then absolute, then logout", async () => {
      const u = await login("owner@acme.example");
      assert.equal((await biz(u).get("/overview")).status, 200);
      dbExec("UPDATE sessions SET last_seen_at = ? WHERE token_hash != ''", [new Date(Date.now() - 31 * 60_000).toISOString()]);
      assert.equal((await biz(u).get("/overview")).status, 401, "idle for 31 minutes");
      assert.equal((await c.call("GET", "/api/me", { cookie: u.cookie })).status, 401);
      const v = await login("owner@acme.example");
      dbExec("UPDATE sessions SET created_at = ?, expires_at = ?", [new Date(Date.now() - 13 * 3600_000).toISOString(), new Date(Date.now() - 3600_000).toISOString()]);
      assert.equal((await biz(v).get("/overview")).status, 401, "past the 12-hour limit");
      const w = await login("owner@acme.example");
      assert.equal((await c.call("POST", "/api/auth/logout", { cookie: w.cookie, csrf: w.csrf, body: {} })).status, 200);
      assert.equal((await biz(w).get("/overview")).status, 401, "logged out");
      A = await login("owner@acme.example"); B = await login("owner@bravo.example");
    });

    test("data, sessions, simulated mail, audit and queue survive a clean restart (SIGTERM)", async () => {
      const before = { leads: (await biz(A).get("/leads")).data.leads, audit: (await biz(A).get("/audit")).data.events.length, contacts: (await biz(A).get("/contacts")).data.contacts, notifs: (await biz(A).get("/notifications")).data.notifications.length };
      outputs.push(s.output());
      const ex = await s.stop("SIGTERM");
      assert.equal(ex.code, 0, "clean shutdown");
      s = await startProc(kind, { db: t.db, port: PORT, env: { SCHEDULE_MS: "400" } }); c = client(s.base);
      assert.equal((await c.call("GET", "/api/me", { cookie: A.cookie })).status, 200, "the same session cookie still works after restart");
      const after = { leads: (await biz(A).get("/leads")).data.leads, audit: (await biz(A).get("/audit")).data.events.length, contacts: (await biz(A).get("/contacts")).data.contacts, notifs: (await biz(A).get("/notifications")).data.notifications.length };
      assert.deepEqual(after.leads, before.leads);
      assert.ok(after.audit >= before.audit);
      assert.deepEqual(after.contacts, before.contacts); assert.equal(after.contacts[0].state, "simulated_verified");
      assert.equal(after.notifs, before.notifs);
      assert.ok((await mailbox()).some((m) => m.template === "verify_email"), "simulated mailbox survived");
      assert.equal((await c.call("POST", "/api/auth/login", { body: { email: "owner@bravo.example", password: PW } })).status, 200, "stored hash still verifies");
      assert.equal((await biz(B).get("/leads")).data.leads.length, 0, "isolation holds after restart");
    });

    test("a notification interrupted mid-send survives a hard kill (SIGKILL) and is re-sent after restart", async () => {
      outputs.push(s.output());
      await s.stop("SIGTERM");
      s = await startProc(kind, { db: t.db, port: PORT, env: { SCHEDULE_MS: "400" } }); c = client(s.base);
      const [{ site_key }] = dbRead("SELECT site_key FROM businesses WHERE id = ?", [A.bizId]);
      let id; for (const message of ["my bathroom sink drains very slowly", "Sam Second", "512-555-0177", "62701", "it can wait"]) { const r = await c.call("POST", "/api/chat", { body: { message, siteKey: site_key, conversationId: id }, origin: s.base }); assert.equal(r.status, 200, r.text); id = r.data.conversationId; }
      const latest = () => dbRead("SELECT id, status FROM notifications WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [A.bizId])[0];
      const n = await waitFor(() => (latest().status === "sent" ? latest() : null));
      // Put the row into the state a crash mid-send leaves behind: claimed with a lease that has since expired.
      dbExec("UPDATE notifications SET status = 'sending', attempts = 1, lease_until = ?, provider_id = NULL, provider_message_id = NULL, sent_at = NULL, simulated = 0 WHERE id = ?", [new Date(Date.now() - 60_000).toISOString(), n.id]);
      outputs.push(s.output());
      const ex = await s.stop("SIGKILL");
      assert.equal(ex.sig, "SIGKILL");
      assert.equal(latest().status, "sending", "still interrupted on disk while the server is down");
      s = await startProc(kind, { db: t.db, port: PORT, env: { SCHEDULE_MS: "300" } }); c = client(s.base);
      await waitFor(() => latest().status === "sent");
      assert.equal(dbRead("SELECT COUNT(*) n FROM notifications WHERE business_id = ? AND lead_id = (SELECT lead_id FROM notifications WHERE id = ?)", [A.bizId, n.id])[0].n, 1, "recovered, not duplicated");
      assert.equal((await biz(A).get("/leads")).data.leads.length, 2);
    });

    test("owner can delete a lead; it is gone after a restart too (no resurrection)", async () => {
      const leads = (await biz(A).get("/leads")).data.leads;
      const victim = leads.find((l) => l.name === "Sam Second");
      assert.equal((await biz(A).send("DELETE", `/leads/${victim.id}`)).status, 200);
      outputs.push(s.output()); await s.stop("SIGTERM");
      s = await startProc(kind, { db: t.db, port: PORT, env: { SCHEDULE_MS: "400" } }); c = client(s.base);
      assert.equal((await biz(A).get("/leads")).data.leads.length, 1);
      assert.equal(dbRead("SELECT COUNT(*) n FROM messages WHERE content LIKE '%Sam Second%'")[0].n, 0);
    });

    test("process output never contains passwords, session tokens or customer phone numbers", async () => {
      outputs.push(s.output());
      const all = outputs.join("\n");
      for (const secret of secrets) assert.ok(!all.includes(secret), `output leaked a secret (${secret.slice(0, 4)}…)`);
    });
  });
}

describe("runtime: worker entry with accounts switched OFF (the default for any deployment of src/index.js)", () => {
  const t = tempDir(); let s, c;
  before(async () => { s = await startProc("worker-sim", { db: t.db, env: { WORKER_SIM_ACCOUNTS: "off" } }); c = client(s.base); });
  after(async () => { await s?.stop("SIGKILL").catch(() => {}); t.cleanup(); });
  test("no dashboard, no account routes, no simulated mailbox; chat still works", async () => {
    assert.equal((await c.call("GET", "/app")).status, 404);
    assert.equal((await c.call("POST", "/api/auth/register", { body: { email: "a@b.example", password: PW, businessName: "X" } })).status, 404);
    assert.equal((await c.call("GET", "/api/me")).status, 404);
    assert.equal((await c.call("GET", "/dev/simulated-mail")).status, 404);
    const r = await c.call("POST", "/api/chat", { body: { message: "what are your hours?", siteKey: "sk_demo_local_0001" }, origin: s.base });
    assert.equal(r.status, 200);
  });
});
