// A D1-SHAPED object (prepare/bind/all/first/run/batch) backed by a local SQLite file.
// It lets the real Worker entry (src/index.js) and the real D1Adapter run on Node.
// IT IS NOT CLOUDFLARE D1 and NOT the Workers runtime. See docs/KNOWN_ISSUES.md KI-15 / KI-40.
import { SqliteAdapter } from "../../src/db/sqlite-adapter.js";
import { migrate } from "../../src/db/migrate-node.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openShim(dbPath, { applyMigrations = true } = {}) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new SqliteAdapter(dbPath);
  if (applyMigrations) migrate(sqlite);
  let failure = null; // tests can make the "database" fail: shim.failWith(new Error("D1_ERROR: ..."))
  const guardFail = () => { if (failure) throw failure; };
  const stmt = (sql) => ({
    sql, params: [],
    bind(...p) { this.params = p; return this; },
    async all() { guardFail(); return { results: await sqlite.all(this.sql, this.params) }; },
    async first() { guardFail(); return sqlite.first(this.sql, this.params); },
    async run() { guardFail(); return { meta: await sqlite.run(this.sql, this.params) }; },
  });
  const d1 = {
    prepare: stmt,
    async batch(stmts) { guardFail(); const r = await sqlite.batch(stmts.map((s) => ({ sql: s.sql, params: s.params }))); return r.map((m) => ({ meta: m })); },
  };
  return { d1, sqlite, failWith(e) { failure = e; }, heal() { failure = null; }, close() { sqlite.close(); } };
}
