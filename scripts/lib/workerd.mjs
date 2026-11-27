// Helpers to run the REAL local Cloudflare runtime (workerd, through `wrangler dev --local`) and the REAL
// `wrangler d1 migrations apply --local`. Free and local only: it never logs in, never contacts a Cloudflare
// account, never creates a remote database, never deploys. (Wrangler may try to fetch placeholder `Request.cf`
// data at start-up; that is a read-only lookup, and it falls back to a default if the network refuses it.)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const WRANGLER = join(ROOT, "node_modules/wrangler/bin/wrangler.js");
export const workerdAvailable = () => existsSync(WRANGLER);
export const freePort = () => 20000 + Math.floor(Math.random() * 20000);

const baseEnv = () => {
  const e = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1" };
  delete e.CLOUDFLARE_API_TOKEN; delete e.CLOUDFLARE_ACCOUNT_ID; delete e.CF_API_TOKEN;
  return e;
};

/** `wrangler d1 migrations apply latchline-local --local`: the real migration tool on a local D1. */
export function applyMigrations({ persist, config }) {
  const r = spawnSync(process.execPath, [WRANGLER, "d1", "migrations", "apply", "latchline-local", "--local", "--persist-to", persist, "-c", config], { cwd: ROOT, env: baseEnv(), encoding: "utf8", timeout: 120000 });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

/** Path of the SQLite file that holds the local D1 database (for read-only inspection and fault injection). */
export function d1File(persist) {
  const dir = join(persist, "v3/d1/miniflare-D1DatabaseObject");
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sqlite"))) {
    const p = join(dir, f);
    try { const d = new DatabaseSync(p, { readOnly: true }); const has = d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'd1_migrations'").get(); d.close(); if (has) return p; } catch { /* not ours */ }
  }
  return null;
}

/** Start `wrangler dev --local`. Resolves when it says it is ready. */
export async function startWorkerd({ config, persist, port = freePort(), vars = {}, timeoutMs = 60000, testScheduled = false, retries = 3 }) {
  const args = [WRANGLER, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persist, "-c", config, "--inspector-port", String(port + 1)];
  if (testScheduled) args.push("--test-scheduled"); // exposes GET /cdn-cgi/handler/scheduled to run the cron handler by hand
  for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
  const child = spawn(process.execPath, args, { cwd: ROOT, env: baseEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  child.stdout.on("data", (d) => { output += d; }); child.stderr.on("data", (d) => { output += d; });
  const exited = new Promise((r) => child.on("exit", (code, sig) => r({ code, sig })));
  const start = Date.now();
  while (!/Ready on http/.test(output)) {
    if (child.exitCode !== null) {\n      const failure = output.slice(-1500);\n      if (/Address already in use|EADDRINUSE/i.test(failure) && retries > 0) return startWorkerd({ config, persist, port: freePort(), vars, timeoutMs, testScheduled, retries: retries - 1 });\n      throw new Error(`wrangler exited early:\n${failure}`);\n    }
    if (Date.now() - start > timeoutMs) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } throw new Error(`wrangler did not become ready:\n${output.slice(-1500)}`); }
    await new Promise((r) => setTimeout(r, 100));
  }
  const stop = async (sig = "SIGTERM") => {
    try { process.kill(-child.pid, sig); } catch { /* already gone */ }
    const r = await Promise.race([exited, new Promise((res) => setTimeout(() => res({ code: null, sig: "TIMEOUT" }), 15000))]);
    if (r.sig === "TIMEOUT") { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }
    return r;
  };
  return { port, base: `http://127.0.0.1:${port}`, pid: child.pid, output: () => output, stop, exited, readyMs: Date.now() - start };
}
