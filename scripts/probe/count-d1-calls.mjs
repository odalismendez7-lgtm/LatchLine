// Counts how many D1 "queries" each request makes, for comparison with the D1 per-invocation limit
// (Workers Free: 50; Paid: 1,000; a db.batch() counts as ONE query: developers.cloudflare.com/d1/platform/limits).
// Runs the REAL Worker entry (src/index.js) on Node with the D1-shaped shim, wrapping the shim to count calls.
// Call counts come from our code, not from the runtime, so Node is a fair place to count them.
//   node --no-warnings scripts/probe/count-d1-calls.mjs
import worker from "../../src/index.js";
import { openShim } from "../lib/d1-shim.mjs";
import { platformRepo, forBusiness } from "../../src/db/tenant.js";
import { demoAquaflowKb } from "../../src/knowledge/demo-aquaflow.js";

const shim = openShim(":memory:");
let queries = 0, batches = 0;
const realPrepare = shim.d1.prepare, realBatch = shim.d1.batch;
const counted = {
  prepare(sql) { const s = realPrepare(sql); for (const m of ["all", "first", "run"]) { const f = s[m].bind(s); s[m] = (...a) => { queries++; return f(...a); }; } return s; },
  async batch(stmts) { batches++; queries++; return realBatch(stmts); }, // a batch counts as ONE query against the D1 limit
};
const env = { DB: counted, RATE_LIMIT_SALT: "count-salt-12345", LATCHLINE_ACCOUNTS: "mock-local", LATCHLINE_DEV_MAILBOX: "1" };
const BASE = "http://localhost";
const PW = "correct horse battery staple";
const ctx = () => { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.allSettled(p) }; };
const rows = [];
async function call(label, method, path, { body, cookie, csrf, origin = BASE } = {}) {
  const h = {}; if (method !== "GET" && origin) h.Origin = origin; if (cookie) h.Cookie = cookie; if (csrf) h["X-CSRF-Token"] = csrf; if (body !== undefined) h["Content-Type"] = "application/json";
  queries = 0; batches = 0; const c = ctx();
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, c);
  await c.done();
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* html */ }
  rows.push({ label, status: res.status, queries, batches });
  return { status: res.status, data, setCookie: res.headers.getSetCookie?.() ?? [] };
}

// seed: business via the platform repo (only the shim file, never the counted path)
await call("GET /health", "GET", "/health");
const reg = await call("POST /api/auth/register", "POST", "/api/auth/register", { body: { email: "o@acme.example", password: PW, businessName: "Acme" } });
const mail = (await (await worker.fetch(new Request(BASE + "/dev/simulated-mail"), env, ctx())).json()).messages.find((m) => m.template === "verify_email");
await call("POST /api/auth/verify-email", "POST", "/api/auth/verify-email", { body: { token: mail.data.token } });
const login = await call("POST /api/auth/login", "POST", "/api/auth/login", { body: { email: "o@acme.example", password: PW } });
const cookie = login.setCookie[0].split(";")[0], csrf = login.data.csrf;
const me = await call("GET /api/me", "GET", "/api/me", { cookie });
const bizId = me.data.businesses[0].id;
const [{ site_key }] = await shim.sqlite.all("SELECT site_key FROM businesses WHERE id = ?", [bizId]);
await shim.sqlite.run("INSERT INTO business_origins (business_id, origin) VALUES (?,?)", [bizId, BASE]);
let id; let n = 0;
for (const message of ["my kitchen faucet keeps dripping all day", "Rita Runtime", "512-555-0142", "62701", "it can wait"]) { const r = await call(`POST /api/chat (message ${++n} of 5${n === 5 ? ", creates the lead" : ""})`, "POST", "/api/chat", { body: { message, siteKey: site_key, conversationId: id } }); id = r.data.conversationId; }
await call("GET /api/biz/:id/overview", "GET", `/api/biz/${bizId}/overview`, { cookie });
const leads = await call("GET /api/biz/:id/leads", "GET", `/api/biz/${bizId}/leads`, { cookie });
await call("PATCH /api/biz/:id/leads/:lead", "PATCH", `/api/biz/${bizId}/leads/${leads.data.leads[0].id}`, { cookie, csrf, body: { status: "contacted" } });
queries = 0; batches = 0; { const c = ctx(); await worker.scheduled({}, env, c); await c.done(); rows.push({ label: "scheduled (cron) sweep", status: "-", queries, batches }); }

console.log("| Request | HTTP | D1 queries (batch = 1) | of which batches |\n|---|---|---|---|");
for (const r of rows) console.log(`| ${r.label} | ${r.status} | ${r.queries} | ${r.batches} |`);
const max = Math.max(...rows.map((r) => r.queries));
console.log(`\nMost D1 queries in one request/invocation: ${max} (Free-plan D1 limit: 50, Paid: 1,000)`);
shim.close();
