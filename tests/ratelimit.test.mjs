import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createLimiter, MemoryStore, DbStore, hashKey } from "../src/ratelimit/limiter.js";
import { SqliteAdapter } from "../src/db/sqlite-adapter.js";
import { migrate } from "../src/db/migrate-node.js";

const clock = (t = 1_000_000_000_000) => { const c = { t, now: () => c.t }; return c; };

describe("limiter (memory store)", () => {
  test("allows up to the limit, then blocks with a Retry-After", async () => {
    const c = clock();
    const l = createLimiter({ store: new MemoryStore(), limit: 3, windowMs: 60_000, now: c.now });
    for (let i = 0; i < 3; i++) assert.equal((await l.check("k")).allowed, true);
    const r = await l.check("k");
    assert.equal(r.allowed, false);
    assert.equal(r.remaining, 0);
    assert.ok(r.retryAfterSec >= 1 && r.retryAfterSec <= 60);
  });
  test("the 3rd request is allowed and the 4th is not (off-by-one guard)", async () => {
    const l = createLimiter({ store: new MemoryStore(), limit: 3, windowMs: 60_000, now: clock().now });
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await l.check("k")).allowed);
    assert.deepEqual(results, [true, true, true, false, false]);
  });
  test("keys are independent", async () => {
    const l = createLimiter({ store: new MemoryStore(), limit: 1, windowMs: 60_000, now: clock().now });
    assert.equal((await l.check("a")).allowed, true);
    assert.equal((await l.check("b")).allowed, true);
    assert.equal((await l.check("a")).allowed, false);
  });
  test("window rollover resets the count", async () => {
    const c = clock(1_000_000_000_000 - (1_000_000_000_000 % 60_000)); // start of a window
    const l = createLimiter({ store: new MemoryStore(), limit: 1, windowMs: 60_000, now: c.now });
    assert.equal((await l.check("k")).allowed, true);
    assert.equal((await l.check("k")).allowed, false);
    c.t += 60_000;
    assert.equal((await l.check("k")).allowed, true);
  });
  test("retryAfterSec counts down to the window end", async () => {
    const start = 1_000_000_000_000 - (1_000_000_000_000 % 60_000);
    const c = clock(start + 45_000);
    const l = createLimiter({ store: new MemoryStore(), limit: 1, windowMs: 60_000, now: c.now });
    await l.check("k");
    assert.equal((await l.check("k")).retryAfterSec, 15);
  });
  test("rejects nonsense configuration", () => {
    for (const bad of [{ limit: 0, windowMs: 60000 }, { limit: 1.5, windowMs: 60000 }, { limit: 5, windowMs: 10 }, { limit: "5", windowMs: 60000 }])
      assert.throws(() => createLimiter({ store: new MemoryStore(), ...bad }), RangeError);
  });
  test("memory store stays bounded under many distinct keys", async () => {
    const s = new MemoryStore({ maxKeys: 100 });
    for (let i = 0; i < 1000; i++) await s.increment(`k${i}`, 0);
    assert.ok(s.size <= 100);
  });
});

describe("limiter (database store)", () => {
  function db() { const d = new SqliteAdapter(":memory:"); migrate(d); return d; }
  test("counts in the database and blocks past the limit", async () => {
    const l = createLimiter({ store: new DbStore(db()), limit: 2, windowMs: 60_000, now: clock().now });
    assert.deepEqual([(await l.check("k")).allowed, (await l.check("k")).allowed, (await l.check("k")).allowed], [true, true, false]);
  });
  test("two limiter instances sharing one database share the count", async () => {
    const d = db(), c = clock();
    const mk = () => createLimiter({ store: new DbStore(d), limit: 2, windowMs: 60_000, now: c.now });
    await mk().check("k"); await mk().check("k");
    assert.equal((await mk().check("k")).allowed, false);
  });
  test("purgeBefore removes only old windows", async () => {
    const d = db(), s = new DbStore(d);
    await s.increment("k", 100); await s.increment("k", 200);
    await s.purgeBefore(200);
    assert.equal((await d.first("SELECT COUNT(*) n FROM rate_limits")).n, 1);
  });
  test("store failure falls back to memory, still limits, and reports degraded", async () => {
    const broken = { increment: async () => { throw new Error("db down"); } };
    const l = createLimiter({ store: broken, limit: 2, windowMs: 60_000, now: clock().now });
    const a = await l.check("k"); const b = await l.check("k"); const c = await l.check("k");
    assert.deepEqual([a.allowed, b.allowed, c.allowed], [true, true, false]);
    assert.ok(a.degraded && c.degraded);
  });
  test("healthy store is not reported degraded", async () => {
    const l = createLimiter({ store: new MemoryStore(), limit: 2, windowMs: 60_000, now: clock().now });
    assert.equal((await l.check("k")).degraded, false);
  });
});

describe("hashKey", () => {
  test("is stable, salted, and never contains the raw value", async () => {
    const a = await hashKey("salt1", "203.0.113.7", "biz");
    assert.equal(a, await hashKey("salt1", "203.0.113.7", "biz"));
    assert.notEqual(a, await hashKey("salt2", "203.0.113.7", "biz"));
    assert.notEqual(a, await hashKey("salt1", "203.0.113.8", "biz"));
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.ok(!a.includes("203"));
  });
});
