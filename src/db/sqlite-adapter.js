// SQLite adapter for LOCAL DEVELOPMENT AND TESTS (Node's built-in node:sqlite).
// Not used in the Cloudflare Worker, which uses d1-adapter.js. Do not import
// this file from Worker code: node:sqlite does not exist there.
//
// Adapter interface (async, so SQLite and D1 look identical to the rest of the code):
//   all(sql, params)   -> rows
//   first(sql, params) -> row | null
//   run(sql, params)   -> { changes }
//   batch([{sql, params}]) -> [{ changes }]   all-or-nothing
//   ping()             -> true or throws

import { DatabaseSync } from "node:sqlite";

const plain = (row) => (row ? { ...row } : row);

export class SqliteAdapter {
  #db;
  constructor(path = ":memory:") {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  }

  exec(sql) { this.#db.exec(sql); } // migrations only
  allSync(sql, params = []) { return this.#db.prepare(sql).all(...params).map(plain); } // migrations only

  async all(sql, params = []) { return this.#db.prepare(sql).all(...params).map(plain); }
  async first(sql, params = []) { return plain(this.#db.prepare(sql).get(...params)) ?? null; }
  async run(sql, params = []) { return { changes: Number(this.#db.prepare(sql).run(...params).changes) }; }

  async batch(statements) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const out = statements.map((s) => ({ changes: Number(this.#db.prepare(s.sql).run(...(s.params ?? [])).changes) }));
      this.#db.exec("COMMIT");
      return out;
    } catch (e) {
      try { this.#db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw e;
    }
  }

  async ping() { this.#db.prepare("SELECT 1").get(); return true; }
  close() { this.#db.close(); }
}
