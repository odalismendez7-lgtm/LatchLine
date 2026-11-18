// Applies migrations/*.sql in order to a SqliteAdapter (local dev and tests).
// Already-applied files are skipped, so running twice is safe.
// On Cloudflare D1 the same files are applied with `wrangler d1 migrations apply`,
// which needs an account and has NOT been run (docs/KNOWN_ISSUES.md KI-15).

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

export function migrate(adapter) {
  adapter.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const already = new Set(adapter.allSync("SELECT name FROM schema_migrations").map((r) => r.name));
  const files = readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (already.has(f)) continue;
    adapter.exec("BEGIN");
    try {
      adapter.exec(readFileSync(join(DIR, f), "utf8"));
      adapter.exec(`INSERT INTO schema_migrations (name, applied_at) VALUES ('${f}', '${new Date().toISOString()}')`);
      adapter.exec("COMMIT");
      applied.push(f);
    } catch (e) {
      adapter.exec("ROLLBACK");
      throw e;
    }
  }
  return applied;
}
