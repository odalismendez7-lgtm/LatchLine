// Cloudflare D1 adapter. STATUS: written to D1's documented API
// (prepare/bind/all/first/run/batch). Tested against a fake D1 built on SQLite AND (since 2026-11-21) against
// REAL LOCAL D1 under workerd (tests/workerd.runtime.test.mjs, tests/workerd.probe.test.mjs). It has NEVER been
// run against HOSTED D1, because that needs a Cloudflare account and deployment, which the founder has not
// approved (docs/KNOWN_ISSUES.md KI-15). On D1 a raw BEGIN is rejected: transactions here are batch() only.
//
// batch() relies on D1 running batched statements as one transaction.

export class D1Adapter {
  #d1;
  constructor(d1) {
    if (!d1 || typeof d1.prepare !== "function") throw new TypeError("D1Adapter needs a D1 database binding");
    this.#d1 = d1;
  }
  #stmt(sql, params = []) { return this.#d1.prepare(sql).bind(...params); }

  async all(sql, params = []) { return (await this.#stmt(sql, params).all()).results ?? []; }
  async first(sql, params = []) { return (await this.#stmt(sql, params).first()) ?? null; }
  async run(sql, params = []) {
    const r = await this.#stmt(sql, params).run();
    return { changes: Number(r?.meta?.changes ?? 0) };
  }
  async batch(statements) {
    const results = await this.#d1.batch(statements.map((s) => this.#stmt(s.sql, s.params ?? [])));
    return results.map((r) => ({ changes: Number(r?.meta?.changes ?? 0) }));
  }
  async ping() { await this.#stmt("SELECT 1").first(); return true; }
}
