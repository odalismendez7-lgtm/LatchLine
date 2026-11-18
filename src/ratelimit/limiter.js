// Fixed-window rate limiting.
//
// Keys are hashed before storage so raw IPs are never written to the database.
// Two stores: MemoryStore (per Worker instance; good for tests and as a fallback)
// and DbStore (shared across instances, uses the rate_limits table).
//
// Failure policy: if the shared store errors, the limiter falls back to the
// in-memory store for that call (limits become per-instance, weaker but not
// absent) and reports degraded:true. It never fails open silently and never
// blocks customers just because the database is down.

export class MemoryStore {
  #m = new Map();
  #max;
  constructor({ maxKeys = 5000 } = {}) { this.#max = maxKeys; }
  async increment(key, windowStart) {
    const k = `${key}:${windowStart}`;
    const n = (this.#m.get(k) ?? 0) + 1;
    this.#m.set(k, n);
    if (this.#m.size > this.#max) this.#evict(windowStart);
    return n;
  }
  #evict(currentWindow) {
    for (const k of this.#m.keys()) {
      if (Number(k.slice(k.lastIndexOf(":") + 1)) < currentWindow) this.#m.delete(k);
    }
    // still too big (many distinct keys in one window): drop oldest entries
    while (this.#m.size > this.#max) this.#m.delete(this.#m.keys().next().value);
  }
  get size() { return this.#m.size; }
}

export class DbStore {
  #db;
  constructor(db) { this.#db = db; }
  async increment(key, windowStart) {
    const row = await this.#db.first(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`, [key, windowStart]);
    if (!row || typeof row.count !== "number") throw new Error("rate limit store returned no count");
    return row.count;
  }
  // Housekeeping: delete windows older than the given start. Call occasionally.
  async purgeBefore(windowStart) {
    return this.#db.run("DELETE FROM rate_limits WHERE window_start < ?", [windowStart]);
  }
}

export async function hashKey(secretSalt, ...parts) {
  const data = new TextEncoder().encode(`${secretSalt}|${parts.join("|")}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createLimiter({ store, limit, windowMs, now = () => Date.now(), fallback = new MemoryStore() }) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer");
  if (!Number.isInteger(windowMs) || windowMs < 1000) throw new RangeError("windowMs must be at least 1000");
  return {
    async check(key) {
      const t = now();
      const windowStart = Math.floor(t / windowMs) * windowMs;
      const retryAfterSec = Math.max(1, Math.ceil((windowStart + windowMs - t) / 1000));
      let count, degraded = false;
      try {
        count = await store.increment(key, windowStart);
      } catch {
        degraded = true;
        count = await fallback.increment(key, windowStart);
      }
      const allowed = count <= limit;
      return { allowed, limit, remaining: Math.max(0, limit - count), retryAfterSec: allowed ? 0 : retryAfterSec, degraded };
    },
  };
}
