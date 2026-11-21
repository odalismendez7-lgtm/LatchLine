// Local development server. Binds to 127.0.0.1 ONLY (not reachable from other
// machines), uses a local SQLite file under .data/, the labeled mock AI, and
// the all-unverified demo knowledge base. It is not a deployment.
//
//   node scripts/dev-server.mjs            (port 8787, file DB .data/dev.sqlite)
//   PORT=9000 DB_PATH=:memory: node scripts/dev-server.mjs

import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";
import { platformRepo, forBusiness } from "../src/db/tenant.js";
import { createApp } from "../src/app.js";
import { MemoryStore, DbStore } from "../src/ratelimit/limiter.js";
import { AIRouter } from "../src/ai/router.js";
import { createProvider } from "../src/ai/registry.js";
import { createNotifier, createChannelMap } from "../src/notify/registry.js";
import { DbMockMailer } from "../src/auth/mailer.js";
import { demoAquaflowKb } from "../src/knowledge/demo-aquaflow.js";

export const DEV_SITE_KEY = "sk_demo_local_0001";

export async function startDevServer({ port = 8787, dbPath = ":memory:", host = "127.0.0.1", clientLimit, iterations, scheduleMs = 5000 } = {}) {
  if (dbPath !== ":memory:") { dbPath = resolve(dbPath); mkdirSync(dirname(dbPath), { recursive: true }); }
  const db = new SqliteAdapter(dbPath);
  migrate(db);
  const platform = platformRepo(db);
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  if (!(await platform.businessBySiteKey(DEV_SITE_KEY))) {
    await platform.createBusiness({ id: "demo-plumbing", name: "AquaFlow Plumbing (demo)", industry: "plumbing", siteKey: DEV_SITE_KEY, origins });
    await forBusiness(db, "demo-plumbing").knowledge.set(demoAquaflowKb);
    // A SIMULATED-verified contact so the notification flow can be exercised. The mock never sends anything,
    // and a simulated-verified contact can never receive anything from a real provider.
    const demo = forBusiness(db, "demo-plumbing");
    const c = await demo.notifications.contacts.add({ channel: "email", address: "owner@demo.invalid" });
    await demo.notifications.contacts.markSimulatedVerified(c.id);
  }
  const notifier = createNotifier({ type: "mock" });
  const mailer = new DbMockMailer(db); // SIMULATED account emails (kept in the local DB so they survive restarts): shown at /app#dev, never sent
  const app = createApp({
    db, accounts: { mailer, devMode: true, ...(iterations ? { iterations, cfg: { unsafeFastHashForTests: true } } : {}) }, channels: createChannelMap([notifier]), store: new DbStore(db), salt: "dev-only-salt",
    router: new AIRouter({ providers: [createProvider({ type: "mock" })] }),
    ...(clientLimit ? { clientLimit } : {}),
  });
  const html = readFileSync(new URL("../index.html", import.meta.url));

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(html);
      }
      const chunks = [];
      for await (const c of req) { chunks.push(c); if (chunks.reduce((n, x) => n + x.length, 0) > 16384) break; }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await app.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end('{"error":"Something went wrong."}');
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const timer = setInterval(() => { app.runScheduled().catch(() => {}); }, scheduleMs);
  timer.unref();
  return { server, db, app, notifier, mailer, port: server.address().port, close: () => { clearInterval(timer); return new Promise((r) => server.close(r)); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  const { port: p, close } = await startDevServer({ port, dbPath: process.env.DB_PATH || ".data/dev.sqlite", scheduleMs: Number(process.env.SCHEDULE_MS || 5000) });
  console.log(`LATCHLINE dev server: http://127.0.0.1:${p}  (mock AI, local database, not a deployment)`);
  const stop = async () => { await close(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  console.log(`Dashboard: http://127.0.0.1:${p}/app  (DEMO authentication; emails are simulated, see /app#dev)`);
}
