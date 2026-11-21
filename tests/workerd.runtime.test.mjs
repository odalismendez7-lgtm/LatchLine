// THE REAL LOCAL CLOUDFLARE RUNTIME. The real Worker entry (src/index.js, bundled by wrangler) runs inside workerd
// with a real local D1 database whose schema was created by the real `wrangler d1 migrations apply --local`.
// Exercised over real HTTP, with restarts, a hard kill, and database faults. Free and local only: no account,
// no remote database, no deployment, mock AI, mock notifier, SIMULATED email.
//
// What this does NOT prove (docs/KNOWN_ISSUES.md KI-30, KI-40): local workerd enforces neither CPU nor memory
// limits, has no PBKDF2 iteration cap (production reportedly does), and is not Cloudflare's hosted D1.
// Skipped, with a visible reason, if wrangler is not installed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { workerdAvailable, applyMigrations, d1File, startWorkerd, freePort } from "../scripts/lib/workerd.mjs";
import { client } from "./helpers/proc.mjs";

const SKIP = workerdAvailable() ? false : "wrangler is not installed (run `npm install`); the real-runtime tests need it";
const CONFIG = "wrangler.local.example.toml"; // the checked-in LOCAL-ONLY config (accounts + simulated mailbox ON)
const PW = "correct horse battery staple";
const CUSTOMER_PHONE = "512-555-0142";
const CUSTOMER_NAME = "Rita Runtime";

const openDb = (path, readOnly = false) => { const d = new DatabaseSync(path, { readOnly }); return d; };
const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 150)); } };

describe("workerd + local D1: the product on the real local Cloudflare runtime", { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "latchline-workerd-"));
  const persist = join(dir, "state");
  const PORT = freePort(); // same port across restarts: the business origin is registered for it
  const secrets = [PW, "+15125550142", CUSTOMER_PHONE];
  const outputs = [];
  let s, c, A, B, file;

  const start = async () => { s = await startWorkerd({ config: CONFIG, persist, port: PORT, testScheduled: true }); c = client(s.base); };
  const sweep = () => fetch(`${s.base}/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*`).then((r) => r.status);
  const mailbox = async () => (await c.call("GET", "/dev/simulated-mail")).data.messages;
  const dbRead = (sql, p = []) => { const d = openDb(file, true); try { return d.prepare(sql).all(...p); } finally { d.close(); } };
  const dbExec = (sql, p = []) => { const d = openDb(file); try { d.exec("PRAGMA busy_timeout = 5000"); d.prepare(sql).run(...p); } finally { d.close(); } };
  async function login(email, password = PW) {
    const r = await c.call("POST", "/api/auth/login", { body: { email, password } });
    assert.equal(r.status, 200, r.text);
    const cookie = r.setCookie[0].split(";")[0];
    secrets.push(cookie.split("=")[1]);
    const me = (await c.call("GET", "/api/me", { cookie })).data;
    return { email, cookie, csrf: r.data.csrf, bizId: me.businesses[0].id };
  }
  async function signup(email, name) {
    assert.equal((await c.call("POST", "/api/auth/register", { body: { email, password: PW, businessName: name } })).status, 200);
    const mail = (await mailbox()).find((m) => m.template === "verify_email" && m.to === email);
    assert.ok(mail, "simulated verification mail exists");
    assert.equal((await c.call("POST", "/api/auth/verify-email", { body: { token: mail.data.token } })).status, 200);
    return login(email);
  }
  const biz = (u) => ({ get: (p) => c.call("GET", `/api/biz/${u.bizId}${p}`, { cookie: u.cookie }), send: (m, p, body) => c.call(m, `/api/biz/${u.bizId}${p}`, { cookie: u.cookie, csrf: u.csrf, body }) });
  async function chatLead(u, names = [CUSTOMER_NAME, CUSTOMER_PHONE], first = "my kitchen faucet keeps dripping all day") {
    const [{ site_key }] = dbRead("SELECT site_key FROM businesses WHERE id = ?", [u.bizId]);
    if (!dbRead("SELECT 1 FROM business_origins WHERE business_id = ?", [u.bizId]).length) dbExec("INSERT INTO business_origins (business_id, origin) VALUES (?,?)", [u.bizId, s.base]);
    let id;
    for (const message of [first, ...names, "62701", "it can wait"]) {
      const r = await c.call("POST", "/api/chat", { body: { message, siteKey: site_key, conversationId: id }, origin: s.base });
      assert.equal(r.status, 200, r.text); id = r.data.conversationId;
    }
    return id;
  }

  before(() => {
    const m = applyMigrations({ persist, config: CONFIG });
    assert.equal(m.status, 0, m.output);
    file = d1File(persist);
    assert.ok(file, "the local D1 database file exists after `wrangler d1 migrations apply --local`");
    return start();
  });
  after(async () => { try { await s?.stop("SIGKILL"); } catch { /* gone */ } rmSync(dir, { recursive: true, force: true }); });

  test("starts on workerd, serves the dashboard page with a strict CSP, and reports a connected D1 database", async () => {
    const page = await fetch(`${s.base}/app`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /script-src 'nonce-/);
    const h = await (await fetch(`${s.base}/health`)).json();
    assert.equal(h.ok, true); assert.equal(h.databaseConnected, true); assert.equal(h.realAIConnected, false);
    assert.match(s.output(), /env\.DB \(latchline-local\)\s+D1 Database\s+local/, "wrangler reports the D1 binding as LOCAL");
  });

  test("registration, simulated verification and login work; the password is stored only as a full-strength PBKDF2 hash", async () => {
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

  test("an unknown email and a wrong password get the same answer (no account enumeration) on workerd", async () => {
    const wrong = await c.call("POST", "/api/auth/login", { body: { email: "owner@acme.example", password: "wrong wrong wrong!" } });
    const ghost = await c.call("POST", "/api/auth/login", { body: { email: "nobody@acme.example", password: "wrong wrong wrong!" } });
    assert.equal(wrong.status, ghost.status); assert.deepEqual(wrong.data, ghost.data);
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

  test("a customer chat creates a lead; the (mock) notification is sent by the cron handler and labeled simulated", async () => {
    await chatLead(A);
    const leads = (await biz(A).get("/leads")).data.leads;
    assert.equal(leads.length, 1); assert.equal(leads[0].name, CUSTOMER_NAME);
    const n = await waitFor(async () => { await sweep(); return (await biz(A).get("/notifications")).data.notifications.find((x) => x.status === "sent"); });
    assert.equal(n.simulated, true); assert.match(n.description, /SIMULATED/);
    assert.equal((await biz(A).get("/notifications")).data.notifications.some((x) => x.status === "delivered"), false, "never claims delivery");
  });

  test("owner updates the lead status and the audit log records it", async () => {
    const id = (await biz(A).get("/leads")).data.leads[0].id;
    assert.equal((await biz(A).send("PATCH", `/leads/${id}`, { status: "contacted" })).status, 200);
    const audit = (await biz(A).get("/audit")).data.events.map((e) => e.action);
    for (const a of ["lead_created", "lead_status_changed", "contact_simulated_verified"]) assert.ok(audit.includes(a), a);
  });

  test("cross-tenant attacks over real HTTP on workerd: B cannot reach A's data; hostile ids are 404; forged requests are 403", async () => {
    const leadId = (await biz(A).get("/leads")).data.leads[0].id;
    for (const p of ["/overview", "/leads", "/leads/export.csv", `/leads/${leadId}`, "/conversations", "/handoffs", "/notifications", "/settings", "/contacts", "/team", "/audit"]) {
      const r = await c.call("GET", `/api/biz/${A.bizId}${p}`, { cookie: B.cookie });
      assert.equal(r.status, 404, p); assert.ok(!/Acme|Rita|alerts@acme/.test(r.text), p);
    }
    for (const [m, p, body] of [["PATCH", `/leads/${leadId}`, { status: "spam" }], ["DELETE", `/leads/${leadId}`], ["PUT", "/settings", { confirm: true, hours: "hacked" }], ["POST", "/contacts", { channel: "email", address: "evil@x.example" }]]) {
      assert.equal((await c.call(m, `/api/biz/${A.bizId}${p}`, { cookie: B.cookie, csrf: B.csrf, body })).status, 404, `${m} ${p}`);
    }
    for (const id of ["..", "%2e%2e%2f", "a'b", "x".repeat(300), "demo-plumbing"]) assert.equal((await c.call("GET", `/api/biz/${encodeURIComponent(id)}/leads`, { cookie: B.cookie })).status, 404, id);
    assert.equal((await c.call("PATCH", `/api/biz/${A.bizId}/leads/${leadId}`, { cookie: A.cookie, body: { status: "won" } })).status, 403, "no CSRF token");
    assert.equal((await c.call("PATCH", `/api/biz/${A.bizId}/leads/${leadId}`, { cookie: A.cookie, csrf: A.csrf, origin: "https://evil.example", body: { status: "won" } })).status, 403, "foreign origin");
    assert.equal(dbRead("SELECT status FROM leads")[0].status, "contacted");
  });

  test("concurrent requests on real D1: a single-use token is consumed exactly once, and the login throttle counts atomically", async () => {
    const email = "race@acme.example";
    assert.equal((await c.call("POST", "/api/auth/register", { body: { email, password: PW, businessName: "Race Plumbing" } })).status, 200);
    const token = (await mailbox()).find((m) => m.template === "verify_email" && m.to === email).data.token;
    const results = await Promise.all(Array.from({ length: 12 }, () => c.call("POST", "/api/auth/verify-email", { body: { token } })));
    assert.equal(results.filter((r) => r.status === 200).length, 1, `exactly one verification wins: ${results.map((r) => r.status)}`);
    // 14 at once (the per-email limit is 10; the per-IP limit is 30 per 15 minutes and every test here shares one IP, so stay well under it).
    const tries = await Promise.all(Array.from({ length: 14 }, () => c.call("POST", "/api/auth/login", { body: { email, password: "definitely wrong password" } })));
    const counted = tries.filter((r) => r.status === 401).length, limited = tries.filter((r) => r.status === 429).length;
    assert.equal(counted + limited, 14, `only 401/429 expected: ${tries.map((r) => r.status)}`);
    assert.equal(counted, 10, "the per-email limit of 10 is exact under concurrency, not approximate");
  });

  test("a database fault gives a clean 503, loses nothing, leaks nothing, and recovers (fault: the table the write needs is missing)", async () => {
    const leadId = (await biz(A).get("/leads")).data.leads[0].id;
    // Fault injection that works on D1/workerd: rename a table the lead-update transaction needs. D1 then returns a real D1_ERROR.
    dbExec("ALTER TABLE lead_events RENAME TO lead_events_offline");
    try {
      const r = await biz(A).send("PATCH", `/leads/${leadId}`, { status: "won" });
      assert.equal(r.status, 503, r.text);
      assert.equal(r.data.error, "temporarily_unavailable"); assert.ok(Number(r.headers.get("retry-after")) >= 1);
      assert.ok(!/sqlite|SQLITE|D1_ERROR|no such table|stack|at \w+ \(|\/home\//i.test(r.text), "no internals in the error");
      assert.equal((await biz(A).get("/leads")).status, 200, "reads still work");
    } finally { dbExec("ALTER TABLE lead_events_offline RENAME TO lead_events"); }
    assert.equal(dbRead("SELECT status FROM leads")[0].status, "contacted", "the failed change did not partially apply (batch rolled back)");
    assert.equal((await biz(A).send("PATCH", `/leads/${leadId}`, { status: "won" })).status, 200, "recovers by itself");
    assert.equal((await biz(A).send("PATCH", `/leads/${leadId}`, { status: "contacted" })).status, 200);
  });

  test("session expiry is enforced by the running Worker: idle, then absolute, then logout", async () => {
    const u = await login("owner@acme.example");
    assert.equal((await biz(u).get("/overview")).status, 200);
    dbExec("UPDATE sessions SET last_seen_at = ? WHERE token_hash != ''", [new Date(Date.now() - 31 * 60_000).toISOString()]);
    assert.equal((await biz(u).get("/overview")).status, 401, "idle for 31 minutes");
    const v = await login("owner@acme.example");
    dbExec("UPDATE sessions SET created_at = ?, expires_at = ?", [new Date(Date.now() - 13 * 3600_000).toISOString(), new Date(Date.now() - 3600_000).toISOString()]);
    assert.equal((await biz(v).get("/overview")).status, 401, "past the 12-hour limit");
    const w = await login("owner@acme.example");
    assert.equal((await c.call("POST", "/api/auth/logout", { cookie: w.cookie, csrf: w.csrf, body: {} })).status, 200);
    assert.equal((await biz(w).get("/overview")).status, 401, "logged out");
    A = await login("owner@acme.example"); B = await login("owner@bravo.example");
  });

  test("data, sessions, simulated mail, audit and the queue survive a clean restart of workerd (SIGTERM)", async () => {
    const snap = async () => ({ leads: (await biz(A).get("/leads")).data.leads, audit: (await biz(A).get("/audit")).data.events.length, contacts: (await biz(A).get("/contacts")).data.contacts, notifs: (await biz(A).get("/notifications")).data.notifications.length });
    const before = await snap();
    outputs.push(s.output());
    await s.stop("SIGTERM");
    await start();
    assert.equal((await c.call("GET", "/api/me", { cookie: A.cookie })).status, 200, "the same session cookie still works after restart");
    const after = await snap();
    assert.deepEqual(after.leads, before.leads);
    assert.ok(after.audit >= before.audit);
    assert.deepEqual(after.contacts, before.contacts); assert.equal(after.contacts[0].state, "simulated_verified");
    assert.equal(after.notifs, before.notifs);
    assert.ok((await mailbox()).some((m) => m.template === "verify_email"), "simulated mailbox survived");
    assert.equal((await c.call("POST", "/api/auth/login", { body: { email: "owner@bravo.example", password: PW } })).status, 200, "stored hash still verifies");
    assert.equal((await biz(B).get("/leads")).data.leads.length, 0, "isolation holds after restart");
  });

  test("a notification interrupted mid-send survives a hard kill (SIGKILL) and is re-sent after restart", async () => {
    await chatLead(A, ["Sam Second", "512-555-0177"], "my bathroom sink drains very slowly");
    const latest = () => dbRead("SELECT id, status FROM notifications WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [A.bizId])[0];
    const n = await waitFor(async () => { await sweep(); return latest().status === "sent" ? latest() : null; });
    dbExec("UPDATE notifications SET status = 'sending', attempts = 1, lease_until = ?, provider_id = NULL, provider_message_id = NULL, sent_at = NULL, simulated = 0 WHERE id = ?", [new Date(Date.now() - 60_000).toISOString(), n.id]);
    outputs.push(s.output());
    const ex = await s.stop("SIGKILL");
    assert.ok(ex.sig === "SIGKILL" || ex.code !== 0, `killed hard: ${JSON.stringify(ex)}`);
    assert.equal(latest().status, "sending", "still interrupted on disk while the runtime is down");
    await start();
    await waitFor(async () => { await sweep(); return latest().status === "sent"; });
    assert.equal(dbRead("SELECT COUNT(*) n FROM notifications WHERE business_id = ? AND lead_id = (SELECT lead_id FROM notifications WHERE id = ?)", [A.bizId, n.id])[0].n, 1, "recovered, not duplicated");
    assert.equal((await biz(A).get("/leads")).data.leads.length, 2);
  });

  test("owner can delete a lead; it stays gone after a restart (no resurrection)", async () => {
    const victim = (await biz(A).get("/leads")).data.leads.find((l) => l.name === "Sam Second");
    assert.equal((await biz(A).send("DELETE", `/leads/${victim.id}`)).status, 200);
    outputs.push(s.output()); await s.stop("SIGTERM"); await start();
    assert.equal((await biz(A).get("/leads")).data.leads.length, 1);
    assert.equal(dbRead("SELECT COUNT(*) n FROM messages WHERE content LIKE '%Sam Second%'")[0].n, 0);
  });

  test("workerd's own output never contains passwords, session tokens or customer phone numbers", async () => {
    outputs.push(s.output());
    const all = outputs.join("\n");
    for (const secret of secrets) assert.ok(!all.includes(secret), `output leaked a secret (${secret.slice(0, 4)}…)`);
  });
});

describe("workerd + local D1: accounts switched OFF (the default for any deployment of the checked-in wrangler.toml)", { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "latchline-workerd-off-"));
  const persist = join(dir, "state");
  let s, c;
  before(async () => {
    assert.equal(applyMigrations({ persist, config: CONFIG }).status, 0);
    s = await startWorkerd({ config: CONFIG, persist, vars: { LATCHLINE_ACCOUNTS: "", LATCHLINE_DEV_MAILBOX: "" } }); c = client(s.base);
  });
  after(async () => { await s?.stop("SIGKILL").catch(() => {}); rmSync(dir, { recursive: true, force: true }); });
  test("no dashboard, no account routes, no simulated mailbox; the health check still works", async () => {
    assert.equal((await c.call("GET", "/app")).status, 404);
    assert.equal((await c.call("POST", "/api/auth/register", { body: { email: "a@b.example", password: PW, businessName: "X" } })).status, 404);
    assert.equal((await c.call("GET", "/api/me")).status, 404);
    assert.equal((await c.call("GET", "/dev/simulated-mail")).status, 404);
    assert.equal((await c.call("GET", "/health")).status, 200);
  });
});

describe("workerd + local D1: password hashing fails CLOSED when the platform refuses the full-strength hash (cap EMULATED at 100,000)", { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "latchline-workerd-cap-"));
  const persist = join(dir, "state");
  const CAPPED = "scripts/probe/wrangler.capped.toml";
  let s, c, file;
  before(async () => {
    assert.equal(applyMigrations({ persist, config: CAPPED }).status, 0);
    file = d1File(persist);
    s = await startWorkerd({ config: CAPPED, persist }); c = client(s.base);
  });
  after(async () => { await s?.stop("SIGKILL").catch(() => {}); rmSync(dir, { recursive: true, force: true }); });
  const count = (t) => { const d = openDb(file, true); try { return d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } finally { d.close(); } };

  test("registration answers 503 auth_unavailable and stores nothing: no user, business, session, token or weaker hash; no internals", async () => {
    const r = await c.call("POST", "/api/auth/register", { body: { email: "a@acme.example", password: PW, businessName: "Acme" } });
    assert.equal(r.status, 503); assert.deepEqual(r.data, { error: "auth_unavailable" });
    assert.ok(!/iteration|NotSupported|PBKDF2|emulated/i.test(r.text));
    for (const t of ["users", "businesses", "memberships", "sessions", "auth_tokens"]) assert.equal(count(t), 0, t);
    assert.equal((await c.call("GET", "/dev/simulated-mail")).data.messages.length, 0, "no email was queued");
  });
  test("login answers 503 for a known-looking and an unknown email alike, with no cookie", async () => {
    for (const email of ["a@acme.example", "ghost@acme.example"]) {
      const r = await c.call("POST", "/api/auth/login", { body: { email, password: PW } });
      assert.equal(r.status, 503); assert.deepEqual(r.data, { error: "auth_unavailable" }); assert.equal(r.setCookie.length, 0);
    }
    assert.equal(count("sessions"), 0);
  });
  test("an existing 600,000-iteration hash cannot be verified under the cap, so sign-in is refused rather than weakened", async () => {
    const real = await startWorkerd({ config: "wrangler.local.example.toml", persist }); // same database, no cap
    try {
      const rc = client(real.base);
      assert.equal((await rc.call("POST", "/api/auth/register", { body: { email: "b@acme.example", password: PW, businessName: "Bravo" } })).status, 200, "full-strength registration works without the cap");
      const tok = (await rc.call("GET", "/dev/simulated-mail")).data.messages.find((m) => m.template === "verify_email").data.token;
      assert.equal((await rc.call("POST", "/api/auth/verify-email", { body: { token: tok } })).status, 200);
      assert.equal((await rc.call("POST", "/api/auth/login", { body: { email: "b@acme.example", password: PW } })).status, 200, "and so does sign-in");
    } finally { await real.stop("SIGTERM"); }
    const r = await c.call("POST", "/api/auth/login", { body: { email: "b@acme.example", password: PW } });
    assert.equal(r.status, 503); assert.equal(r.setCookie.length, 0);
    const d = openDb(file, true); try { assert.match(d.prepare("SELECT password_hash h FROM users").get().h, /^pbkdf2-sha256\$600000\$/, "the stored hash is untouched"); } finally { d.close(); }
  });
});
