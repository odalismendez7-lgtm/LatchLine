// Helpers for tests that run the app as a REAL child process over real HTTP (TCP), with a real SQLite file.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SERVERS = { "dev-server": "scripts/dev-server.mjs", "worker-sim": "scripts/worker-sim.mjs" };
export const freePort = () => 20000 + Math.floor(Math.random() * 20000);

export function tempDir() { const d = mkdtempSync(join(tmpdir(), "latchline-")); return { dir: d, db: join(d, "app.sqlite"), cleanup: () => rmSync(d, { recursive: true, force: true }) }; }

export async function startProc(kind, { db, port = freePort(), env = {} }) {
  const child = spawn(process.execPath, ["--no-warnings", SERVERS[kind]], { cwd: new URL("../../", import.meta.url).pathname, env: { ...process.env, PORT: String(port), DB_PATH: db, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d) => { output += d; }); child.stderr.on("data", (d) => { output += d; });
  const exited = new Promise((r) => child.on("exit", (code, sig) => r({ code, sig })));
  const start = Date.now();
  while (!/Dashboard: http/.test(output)) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${output.slice(0, 500)}`);
    if (Date.now() - start > 15000) { child.kill("SIGKILL"); throw new Error(`server did not start: ${output.slice(0, 500)}`); }
    await new Promise((r) => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${port}`;
  return { port, base, pid: child.pid, output: () => output, stop: async (sig = "SIGTERM") => { child.kill(sig); return exited; }, exited };
}

export function client(base) {
  async function call(method, path, { body, cookie, csrf, origin = base, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (origin !== null && method !== "GET") h.Origin = origin;
    if (cookie) h.Cookie = cookie;
    if (csrf) h["X-CSRF-Token"] = csrf;
    let payload;
    if (raw !== undefined) payload = raw; else if (body !== undefined) { h["Content-Type"] ??= "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(base + path, { method, headers: h, body: payload });
    const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* html/csv */ }
    return { status: res.status, data, text, headers: res.headers, setCookie: res.headers.getSetCookie?.() ?? [] };
  }
  return { call, base };
}

/** Direct access to the same database file, for inspection and for simulating faults. */
export function openDb(path) { const d = new DatabaseSync(path); d.exec("PRAGMA foreign_keys = ON;"); return d; }
