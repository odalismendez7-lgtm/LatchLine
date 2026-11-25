// Stage 7: the server side of the widget: the script it serves, the config endpoint, tenant scoping and
// leakage. Real app on in-memory SQLite; mock AI. Nothing here proves behaviour on hosted Workers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { platformRepo, forBusiness } from "../src/db/tenant.js";
import { MemoryStore } from "../src/ratelimit/limiter.js";
import { createApp } from "../src/app.js";
import { WIDGET_JS, WIDGET_VERSION } from "../src/widget/widget.bundle.js";

const KEY_A = "sk_acme_000000001", KEY_B = "sk_bravo_00000001", ORIGIN_A = "https://acme-plumbing.example", ORIGIN_B = "https://bravo-plumbing.example";

async function world(opts = {}) {
  const db = new SqliteAdapter(":memory:"); migrate(db);
  const p = platformRepo(db);
  await p.createBusiness({ id: "acme", name: "Acme Plumbing", industry: "plumbing", siteKey: KEY_A, origins: [ORIGIN_A] });
  await p.createBusiness({ id: "bravo", name: "Bravo Pipes", industry: "plumbing", siteKey: KEY_B, origins: [ORIGIN_B] });
  const app = createApp({ db, store: new MemoryStore(), salt: "test-salt-123", ...opts });
  const get = (path, headers = {}) => app.fetch(new Request("http://api.local" + path, { headers }));
  const chat = (body, origin, extra = {}) => app.fetch(new Request("http://api.local/api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...extra }, body: JSON.stringify(body) }));
  return { db, app, get, chat };
}

describe("GET /widget.js", () => {
  test("serves the committed bundle with safe headers and a content-hash ETag", async () => {
    const { get } = await world();
    const r = await get("/widget.js");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /^text\/javascript/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("etag"), `"${WIDGET_VERSION}"`);
    assert.match(r.headers.get("cache-control"), /max-age=300/);
    assert.equal(await r.text(), WIDGET_JS);
    const r2 = await get("/widget.js", { "If-None-Match": `"${WIDGET_VERSION}"` });
    assert.equal(r2.status, 304);
  });
  test("HEAD works like GET without a body", async () => {
    const { app } = await world();
    const r = await app.fetch(new Request("http://api.local/widget.js", { method: "HEAD" }));
    assert.equal(r.status, 200); assert.equal(await r.text(), "");
  });
  test("the committed bundle is up to date with the source (run: node scripts/build-widget.mjs)", () => {
    execFileSync(process.execPath, ["scripts/build-widget.mjs", "--check"], { cwd: new URL("..", import.meta.url).pathname });
  });
  test("contains no secrets, no tenant ids, no server-only code paths", () => {
    for (const bad of [KEY_A, "sk_demo", "RATE_LIMIT_SALT", "salt", "password", "csrf", "sessionid", "set-cookie", "/api/biz/", "/api/auth", "business_id", "businessId", "audit_log", "notifications"]) {
      assert.ok(!WIDGET_JS.toLowerCase().includes(bad.toLowerCase()), `bundle must not contain "${bad}"`);
    }
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(WIDGET_JS), "no HTML-string injection sinks");
    assert.ok(!/localStorage/.test(WIDGET_JS), "per-tab sessionStorage only");
  });
  test("size budget (measured, not a scalability claim)", () => {
    const min = Buffer.byteLength(WIDGET_JS), gz = gzipSync(WIDGET_JS).length;
    assert.ok(min < 45_000, `minified ${min}`); assert.ok(gz < 18_000, `gzipped ${gz}`);
  });
  test("only talks to two endpoints of the API it was loaded from", () => {
    const paths = [...WIDGET_JS.matchAll(/\/api\/[a-z/]+/g)].map((m) => m[0]);
    assert.deepEqual([...new Set(paths)].sort(), ["/api/chat", "/api/widget/config"]);
  });
});

describe("GET /api/widget/config", () => {
  test("registered website gets only name, welcome, mode and limits", async () => {
    const { get } = await world();
    const r = await get(`/api/widget/config?siteKey=${KEY_A}`, { Origin: ORIGIN_A });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN_A);
    const body = await r.json();
    assert.deepEqual(Object.keys(body).sort(), ["apiVersion", "maxMessageChars", "mode", "name", "welcome"]);
    assert.equal(body.name, "Acme Plumbing");
    assert.match(body.welcome, /Acme Plumbing/);
    assert.equal(body.mode, "development");
    const text = JSON.stringify(body);
    for (const leak of [KEY_A, ORIGIN_A, "acme", "status", "origins", "bravo"]) assert.ok(!text.includes(leak), `leak: ${leak}`);
  });
  test("every failure is the SAME 404: unknown key, wrong website, no origin, inactive, malformed key (no probing)", async () => {
    const { get, db } = await world();
    await db.run("UPDATE businesses SET status='suspended' WHERE id='bravo'");
    const cases = [
      [`/api/widget/config?siteKey=sk_nobody_0000000`, ORIGIN_A],
      [`/api/widget/config?siteKey=${KEY_A}`, ORIGIN_B],           // real key, another business's website
      [`/api/widget/config?siteKey=${KEY_A}`, "https://evil.example"],
      [`/api/widget/config?siteKey=${KEY_A}`, null],               // no Origin at all
      [`/api/widget/config?siteKey=${KEY_B}`, ORIGIN_B],           // inactive business
      [`/api/widget/config?siteKey=x`, ORIGIN_A],
      [`/api/widget/config`, ORIGIN_A],
      [`/api/widget/config?siteKey=${"a".repeat(5000)}`, ORIGIN_A],
      [`/api/widget/config?siteKey[]=${KEY_A}&siteKey=${KEY_A}x`, ORIGIN_A],
    ];
    const bodies = new Set(), statuses = new Set();
    for (const [path, origin] of cases) {
      const r = await get(path, origin ? { Origin: origin } : {});
      statuses.add(r.status); bodies.add(await r.text());
      assert.notEqual(r.headers.get("access-control-allow-origin"), null);
    }
    assert.deepEqual([...statuses], [404]); assert.equal(bodies.size, 1, "identical body for every failure");
  });
  test("a website registered for business A cannot read business B's configuration", async () => {
    const { get } = await world();
    const r = await get(`/api/widget/config?siteKey=${KEY_B}`, { Origin: ORIGIN_A });
    assert.equal(r.status, 404);
    assert.ok(!(await r.text()).includes("Bravo"));
  });
  test("same-origin request without an Origin header is checked against the API's own origin, not trusted", async () => {
    const { get } = await world();
    assert.equal((await get(`/api/widget/config?siteKey=${KEY_A}`, { "Sec-Fetch-Site": "same-origin" })).status, 404, "api.local is not registered");
    assert.equal((await get(`/api/widget/config?siteKey=${KEY_A}`, { "Sec-Fetch-Site": "cross-site" })).status, 404);
  });
  test("has its own rate limit that does not spend the chat budget, and 429s are readable", async () => {
    const { get, chat } = await world({ clientLimit: { limit: 3, windowMs: 60_000 }, widgetConfigLimit: { limit: 2, windowMs: 60_000 } });
    for (let i = 0; i < 2; i++) assert.equal((await get(`/api/widget/config?siteKey=${KEY_A}`, { Origin: ORIGIN_A, "CF-Connecting-IP": "9.9.9.9" })).status, 200);
    const limited = await get(`/api/widget/config?siteKey=${KEY_A}`, { Origin: ORIGIN_A, "CF-Connecting-IP": "9.9.9.9" });
    assert.equal(limited.status, 429); assert.ok(limited.headers.get("retry-after"));
    for (let i = 0; i < 3; i++) assert.equal((await chat({ siteKey: KEY_A, message: "hello there" }, ORIGIN_A, { "CF-Connecting-IP": "9.9.9.9" })).status, 200, "chat budget untouched by config requests");
  });
  test("config requests create no conversation, lead or notification and are not written to any tenant table", async () => {
    const { get, db } = await world();
    const before = await db.all("SELECT (SELECT COUNT(*) FROM conversations) c, (SELECT COUNT(*) FROM leads) l, (SELECT COUNT(*) FROM notifications) n, (SELECT COUNT(*) FROM audit_log) a");
    await get(`/api/widget/config?siteKey=${KEY_A}`, { Origin: ORIGIN_A });
    await get(`/api/widget/config?siteKey=${KEY_A}`, { Origin: "https://evil.example" });
    assert.deepEqual(await db.all("SELECT (SELECT COUNT(*) FROM conversations) c, (SELECT COUNT(*) FROM leads) l, (SELECT COUNT(*) FROM notifications) n, (SELECT COUNT(*) FROM audit_log) a"), before);
  });
  test("database failure: 503 with no internals, and the widget treats it as an outage", async () => {
    const { get, db } = await world();
    const orig = db.first.bind(db); db.first = async () => { throw new Error("secret-internal-path /var/db"); };
    const r = await get(`/api/widget/config?siteKey=${KEY_A}`, { Origin: ORIGIN_A });
    db.first = orig;
    assert.equal(r.status, 503); const t = await r.text(); assert.ok(!/secret|var\/db|Error/.test(t));
  });
  test("a business name containing markup is returned as data (the widget renders it as text)", async () => {
    const { get, db } = await world();
    await db.run("UPDATE businesses SET name = ? WHERE id='acme'", ["<img src=x onerror=alert(1)> Plumbing"]);
    const body = await (await get(`/api/widget/config?siteKey=${KEY_A}`, { Origin: ORIGIN_A })).json();
    assert.equal(body.name, "<img src=x onerror=alert(1)> Plumbing");
  });
});

describe("chat endpoint as used by the widget: tenant scoping cannot be steered from the browser", () => {
  test("extra fields a tampered widget might send (businessId, tenant, business) are ignored; the site key + origin decide", async () => {
    const { chat, db } = await world();
    const r = await chat({ siteKey: KEY_A, message: "my sink is leaking", businessId: "bravo", tenant: "bravo", business: { id: "bravo" }, business_id: "bravo" }, ORIGIN_A);
    assert.equal(r.status, 200);
    const cid = (await r.json()).conversationId;
    assert.equal((await db.first("SELECT business_id b FROM conversations WHERE id = ?", [cid])).b, "acme");
    assert.equal((await db.first("SELECT COUNT(*) n FROM conversations WHERE business_id = 'bravo'")).n, 0);
  });
  test("site key of B from A's website is refused; and A's conversation id cannot be continued through B's key", async () => {
    const { chat, db } = await world();
    const a = await (await chat({ siteKey: KEY_A, message: "my sink is leaking" }, ORIGIN_A)).json();
    assert.equal((await chat({ siteKey: KEY_B, message: "hello there" }, ORIGIN_A)).status, 403);
    const b = await chat({ siteKey: KEY_B, message: "hello again", conversationId: a.conversationId }, ORIGIN_B);
    const bj = await b.json();
    assert.notEqual(bj.conversationId, a.conversationId, "a foreign conversation id starts a NEW conversation for B");
    const rows = await db.all("SELECT business_id, COUNT(*) n FROM messages GROUP BY business_id").catch(() => []);
    void rows;
    assert.equal((await db.first("SELECT business_id b FROM conversations WHERE id = ?", [a.conversationId])).b, "acme");
    assert.ok(!JSON.stringify(bj).includes("sink"), "nothing from A's conversation reaches B");
  });
  test("responses never contain tenant ids, other businesses' names, site keys or internal fields", async () => {
    const { chat } = await world();
    const r = await chat({ siteKey: KEY_A, message: "my sink is leaking" }, ORIGIN_A);
    const t = await r.text();
    for (const leak of ["Bravo", KEY_A, KEY_B, "business_id", "acme-plumbing", "stack", "SELECT"]) assert.ok(!t.includes(leak), `leak ${leak}`);
    assert.deepEqual(Object.keys(JSON.parse(t)).sort(), ["conversationId", "degraded", "leadStatus", "mode", "notice", "persisted", "reply", "urgent"]);
  });
  test("malformed bodies produce generic errors, never internals", async () => {
    const { app } = await world();
    const send = (raw, ct = "application/json") => app.fetch(new Request("http://api.local/api/chat", { method: "POST", headers: { "Content-Type": ct, Origin: ORIGIN_A }, body: raw }));
    for (const raw of ["{", "[]", "null", "\"x\"", "{\"siteKey\":1}", `{"siteKey":"${KEY_A}","message":{"a":1}}`, `{"siteKey":"${KEY_A}","message":"${"x".repeat(1300)}"}`]) {
      const r = await send(raw); const t = await r.text();
      assert.ok([400, 404, 413].includes(r.status), `${r.status} for ${raw.slice(0, 20)}`);
      assert.ok(!/Error|stack|at \w+ \(|sqlite|SELECT/.test(t), t);
    }
    assert.equal((await send("x".repeat(20_000))).status, 413);
  });
  test("every database table the widget path can write is business-scoped (no widget-created global state)", async () => {
    const { chat, db } = await world();
    await chat({ siteKey: KEY_A, message: "my sink is leaking" }, ORIGIN_A);
    const rows = await db.all("SELECT business_id FROM conversations UNION ALL SELECT business_id FROM messages");
    assert.ok(rows.length > 0 && rows.every((r) => r.business_id === "acme"));
  });
});

describe("repository hygiene for the widget", () => {
  test("the widget source never references browser storage other than per-tab sessionStorage, nor cookies", () => {
    const src = readFileSync(new URL("../src/widget/widget.src.js", import.meta.url), "utf8");
    assert.ok(!/document\.cookie|localStorage|indexedDB/.test(src));
    assert.ok(/credentials: "omit"/.test(src), "requests never carry the host site's cookies");
  });
  test("the widget directory holds exactly the source and its generated bundle (no config, keys or hosting files)", () => {
    assert.deepEqual(readdirSync(new URL("../src/widget/", import.meta.url)).sort(), ["widget.bundle.js", "widget.src.js"]);
  });
});
