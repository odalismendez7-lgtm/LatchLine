// RUNTIME FACTS from the real local Cloudflare runtime (workerd via `wrangler dev --local`) and real local D1,
// asked through an isolated probe Worker (scripts/probe/worker.js). Several of these tests deliberately pin a
// LIMITATION of the local runtime (for example "it does not enforce a CPU limit"): if wrangler ever changes that, the
// test fails on purpose so the documentation (KNOWN_ISSUES KI-30/KI-40, RUNTIME_VALIDATION.md) gets updated.
// Free and local only. Skipped, with a visible reason, if wrangler is not installed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { workerdAvailable, applyMigrations, d1File, startWorkerd } from "../scripts/lib/workerd.mjs";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";

const SKIP = workerdAvailable() ? false : "wrangler is not installed (run `npm install`); the real-runtime tests need it";
const PROBE = "scripts/probe/wrangler.probe.toml";
const PROBE_LIMIT = "scripts/probe/wrangler.probe-limit.toml";
const schemaOf = (path) => { const d = new DatabaseSync(path, { readOnly: true }); try { return d.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('d1_migrations', 'schema_migrations') ORDER BY type, name").all().map((r) => ({ ...r, sql: (r.sql ?? "").replace(/\s+/g, " ").trim() })); } finally { d.close(); } };

describe("wrangler d1 migrations apply --local (the real migration tool)", { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "latchline-mig-"));
  const persist = join(dir, "state");
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("applies all seven migrations to an empty local D1, and a second run is a clean no-op", () => {
    const first = applyMigrations({ persist, config: PROBE });
    assert.equal(first.status, 0, first.output);
    for (const f of ["0001_init.sql", "0002_notifications.sql", "0003_accounts.sql", "0004_simulated_mail.sql", "0005_notification_variant.sql", "0006_chat_request_dedup.sql", "0007_chat_request_payload_hash.sql"]) assert.match(first.output, new RegExp(f.replace(".", "\\.")));
    const second = applyMigrations({ persist, config: PROBE });
    assert.equal(second.status, 0, second.output);
    assert.match(second.output, /No migrations to apply/i);
    const d = new DatabaseSync(d1File(persist), { readOnly: true });
    try { assert.equal(d.prepare("SELECT COUNT(*) n FROM d1_migrations").get().n, 7, "each migration recorded exactly once"); } finally { d.close(); }
  });

  test("the schema wrangler/D1 produces is identical to the schema the Node test path (migrate-node.js) produces", () => {
    const node = new SqliteAdapter(join(dir, "node.sqlite")); migrate(node); node.close();
    const a = schemaOf(d1File(persist)), b = schemaOf(join(dir, "node.sqlite"));
    assert.ok(a.length > 15, `expected the full schema, got ${a.length} objects`);
    assert.deepEqual(a, b);
  });
});

describe("local D1 semantics the app relies on (probe Worker on workerd)", { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "latchline-probe-"));
  let w; const get = async (p) => { const r = await fetch(w.base + p); return { status: r.status, body: await r.json() }; };
  before(async () => { const persist = join(dir, "state"); assert.equal(applyMigrations({ persist, config: PROBE }).status, 0); w = await startWorkerd({ config: PROBE, persist }); });
  after(async () => { await w?.stop("SIGKILL").catch(() => {}); rmSync(dir, { recursive: true, force: true }); });

  test("db.batch() is all-or-nothing: a failing second statement rolls back the first", async () => {
    const { body: b } = await get("/d1");
    assert.equal(b.batchFailureThrew, true); assert.match(b.batchFailureMessage, /UNIQUE constraint failed/);
    assert.equal(b.rowsAfterFailedBatch, 0, "nothing from the failed batch was kept");
    assert.deepEqual(b.goodBatchChanges, [1, 1, 1]); assert.equal(b.rowsAfterGoodBatch, 2);
  });
  test("compare-and-set inside a batch: an INSERT guarded by changes() runs only when the UPDATE before it changed a row (leads.update relies on this)", async () => {
    const { body: b } = await get("/d1");
    assert.deepEqual(b.casLostChanges, [0, 0], "lost the race: nothing updated, guarded insert skipped");
    assert.deepEqual(b.casWonChanges, [1, 1], "won: update applied, guarded insert ran");
    assert.deepEqual(b.casChildIds, [102]);
  });
  test("foreign keys are enforced by D1 even though the app never sets PRAGMA foreign_keys", async () => {
    const { body: b } = await get("/d1");
    assert.equal(b.foreignKeysPragma.foreign_keys, 1); assert.equal(b.fkViolationRejected, true);
  });
  test("UPDATE ... RETURNING works and a second claim of the same row returns nothing (single-use tokens)", async () => {
    const { body: b } = await get("/d1");
    assert.deepEqual(b.returningFirst, { id: 1 }); assert.equal(b.returningSecondClaim, null);
  });
  test("a raw BEGIN statement is not a usable transaction on D1 (the app uses batch(), never BEGIN, on D1)", async () => {
    const { body: b } = await get("/d1");
    assert.equal(typeof b.rawBeginAccepted, "boolean"); // recorded either way; the value is documented in RUNTIME_VALIDATION.md
    console.log(`    [record] raw BEGIN accepted by local D1: ${b.rawBeginAccepted}${b.rawBeginMessage ? " (" + b.rawBeginMessage + ")" : ""}`);
  });
});

describe("what the real local runtime offers for password hashing (probe Worker on workerd)", { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "latchline-hash-"));
  let w; const get = async (p) => { const r = await fetch(w.base + p); return { status: r.status, body: await r.json() }; };
  before(async () => { const persist = join(dir, "state"); applyMigrations({ persist, config: PROBE }); w = await startWorkerd({ config: PROBE, persist }); });
  after(async () => { await w?.stop("SIGKILL").catch(() => {}); rmSync(dir, { recursive: true, force: true }); });

  test("Web Crypto PBKDF2-SHA256 at 600,000 iterations RUNS on local workerd (local workerd has no iteration cap; production reportedly does, KI-30)", async () => {
    const r = await get("/pbkdf2?iter=600000"); assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  });
  test("node:crypto scrypt is available with nodejs_compat and runs at OWASP-class parameters; argon2 is NOT available", async () => {
    const f = (await get("/features")).body;
    assert.equal(f.scrypt, "function"); assert.equal(f.argon2, "undefined"); assert.equal(f.argon2Sync, "undefined");
    for (const [N, r, p] of [[131072, 8, 1], [65536, 8, 2], [32768, 8, 3], [16384, 8, 5], [8192, 8, 10]]) {
      const res = await get(`/scrypt?N=${N}&r=${r}&p=${p}`); assert.equal(res.status, 200, `scrypt N=${N} r=${r} p=${p}: ${JSON.stringify(res.body)}`);
    }
  });
  test("WebAssembly cannot be compiled from bytes at run time (rules out WASM hashing libraries that embed base64)", async () => {
    const r = (await get("/wasm-runtime-compile")).body;
    assert.equal(r.allowed, false); assert.match(r.message, /disallowed by embedder/i);
  });
});

describe("LIMITATIONS of the local runtime, pinned so a change is noticed (KI-30, KI-40)", { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "latchline-lim-"));
  let w; const get = async (p) => { const r = await fetch(w.base + p); return { status: r.status, body: await r.json() }; };
  before(async () => { const persist = join(dir, "state"); applyMigrations({ persist, config: PROBE_LIMIT }); w = await startWorkerd({ config: PROBE_LIMIT, persist }); });
  after(async () => { await w?.stop("SIGKILL").catch(() => {}); rmSync(dir, { recursive: true, force: true }); });

  test("a configured [limits] cpu_ms = 10 is NOT enforced locally: a ~1 s compute loop and a 600k PBKDF2 both complete", async () => {
    const spin = await get("/spin?n=100000000"); assert.equal(spin.status, 200);
    const hash = await get("/pbkdf2?iter=600000"); assert.equal(hash.status, 200);
  });
  test("local workerd reports cpu_time_ms = 0 even for heavy work, so CPU cost cannot be read from it", async () => {
    await get("/pbkdf2?iter=600000");
    const r = await fetch(`${w.base}/cdn-cgi/local/explorer/api/local/observability/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: "SELECT json_extract(attributes,'$.cpu_time_ms') cpu FROM spans WHERE parent_id IS NULL AND json_extract(attributes,'$.\"url.full\"') LIKE '%pbkdf2%' ORDER BY rowid DESC LIMIT 1" }) });
    const rows = (await r.json()).result.rows;
    assert.equal(rows[0][0], 0);
  });
  test("the documented 128 MB memory limit is NOT enforced locally: a 200 MB allocation succeeds", async () => {
    const r = await get("/mem?mb=200"); assert.equal(r.status, 200);
  });
});
