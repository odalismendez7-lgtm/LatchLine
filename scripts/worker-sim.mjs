// WORKER-SHAPED local server. Runs the REAL Worker entry (src/index.js: fetch + scheduled) on Node,
// with env.DB = a D1-shaped shim over a local SQLite file. It is NOT the Cloudflare Workers runtime
// (no workerd, no 10 ms CPU limit, no real D1): it proves our Worker code path, D1Adapter and
// migrations behave end to end over real HTTP. Binds to 127.0.0.1 only. Not a deployment.
//
//   npm run dev:worker                      (port 8788, file .data/worker-sim.sqlite)
//   PORT=9000 DB_PATH=/tmp/x.sqlite npm run dev:worker
import { createServer } from "node:http";
import { resolve } from "node:path";
import { openShim } from "./lib/d1-shim.mjs";
import worker from "../src/index.js";
import { platformRepo, forBusiness } from "../src/db/tenant.js";
import { demoAquaflowKb } from "../src/knowledge/demo-aquaflow.js";

export const SIM_SITE_KEY = "sk_demo_local_0001";

export async function startWorkerSim({ port = 8788, dbPath = ".data/worker-sim.sqlite", host = "127.0.0.1", env: extraEnv = {}, cronMs = 5000 } = {}) {
  const abs = dbPath === ":memory:" ? dbPath : resolve(dbPath);
  const shim = openShim(abs);
  const env = { DB: shim.d1, RATE_LIMIT_SALT: "worker-sim-salt-local", LATCHLINE_ACCOUNTS: "mock-local", LATCHLINE_DEV_MAILBOX: "1", ...extraEnv };
  // Seed the demo business once (the Worker itself has no seeding code, as in a real deployment).
  const platformDb = { // minimal adapter over the shim for seeding only
    all: (s, p = []) => shim.sqlite.all(s, p), first: (s, p = []) => shim.sqlite.first(s, p), run: (s, p = []) => shim.sqlite.run(s, p), batch: (b) => shim.sqlite.batch(b), ping: () => shim.sqlite.ping(),
  };
  const platform = platformRepo(platformDb);
  if (!(await platform.businessBySiteKey(SIM_SITE_KEY))) {
    const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    await platform.createBusiness({ id: "demo-plumbing", name: "AquaFlow Plumbing (demo)", industry: "plumbing", siteKey: SIM_SITE_KEY, origins });
    await forBusiness(platformDb, "demo-plumbing").knowledge.set(demoAquaflowKb);
  }
  const pending = new Set();
  const ctx = { waitUntil(p) { const q = Promise.resolve(p).catch(() => {}).finally(() => pending.delete(q)); pending.add(q); } };

  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) { chunks.push(c); if (chunks.reduce((n, x) => n + x.length, 0) > 65536) break; }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env, ctx);
      const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
      const sc = r.headers.getSetCookie?.(); if (sc?.length) headers["set-cookie"] = sc;
      res.writeHead(r.status, headers);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end('{"error":"Something went wrong."}');
    }
  });
  await new Promise((r) => server.listen(port, host, r));
  const timer = cronMs ? setInterval(() => { worker.scheduled({}, env, ctx).catch(() => {}); }, cronMs) : null; timer?.unref();
  return { server, shim, env, port: server.address().port, close: async () => { if (timer) clearInterval(timer); await new Promise((r) => server.close(r)); await Promise.allSettled([...pending]); shim.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sim = await startWorkerSim({ port: Number(process.env.PORT || 8788), dbPath: process.env.DB_PATH || ".data/worker-sim.sqlite", cronMs: Number(process.env.SCHEDULE_MS || 5000), ...(process.env.WORKER_SIM_ACCOUNTS === "off" ? { env: { LATCHLINE_ACCOUNTS: undefined, LATCHLINE_DEV_MAILBOX: undefined } } : {}) });
  console.log(`LATCHLINE Worker-shaped server: http://127.0.0.1:${sim.port}  (real src/index.js on a D1-shaped shim; NOT the Workers runtime)`);
  console.log(`Dashboard: http://127.0.0.1:${sim.port}/app  (DEMO authentication; emails SIMULATED, see /app#dev)`);
  const stop = async () => { await sim.close(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
