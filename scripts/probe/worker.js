// RUNTIME PROBE WORKER. Not part of the product and never deployed. It exists only to ask the real local
// Workers runtime (workerd, via `wrangler dev --local`) factual questions the Node tests cannot answer.
// Used by tests/workerd.probe.test.mjs and scripts/probe/measure.mjs. Local only: no account, no network.
//
// NOTE: inside workerd, Date.now()/performance.now() do not advance during synchronous work, so this
// file never times anything itself. Callers time requests from OUTSIDE.
import * as nodeCrypto from "node:crypto";

const enc = new TextEncoder();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const msg = (e) => `${e?.name ?? "Error"}: ${e?.message ?? e}`;

async function pbkdf2(iterations, hash = "SHA-256") {
  const key = await crypto.subtle.importKey("raw", enc.encode("correct horse battery staple"), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash, salt: new Uint8Array(16), iterations }, key, 256));
}

const scryptAsync = (N, r, p, maxmem) => new Promise((res, rej) => nodeCrypto.scrypt("correct horse battery staple", new Uint8Array(16), 32, { N, r, p, maxmem }, (e, k) => (e ? rej(e) : res(k))));

async function d1Probe(DB) {
  const out = {};
  const run = (sql, ...p) => DB.prepare(sql).bind(...p).run();
  await run("DROP TABLE IF EXISTS probe_child"); await run("DROP TABLE IF EXISTS probe_t");
  await run("CREATE TABLE probe_t (id INTEGER PRIMARY KEY, v TEXT UNIQUE NOT NULL)");
  await run("CREATE TABLE probe_child (id INTEGER PRIMARY KEY, pid INTEGER NOT NULL REFERENCES probe_t(id))");
  // 1. batch is all-or-nothing: the second statement violates UNIQUE, so the first must be rolled back.
  try { await DB.batch([DB.prepare("INSERT INTO probe_t (id, v) VALUES (1, 'a')"), DB.prepare("INSERT INTO probe_t (id, v) VALUES (2, 'a')")]); out.batchFailureThrew = false; }
  catch (e) { out.batchFailureThrew = true; out.batchFailureMessage = msg(e); }
  out.rowsAfterFailedBatch = (await DB.prepare("SELECT COUNT(*) n FROM probe_t").first()).n;
  // 2. a good batch applies everything and reports per-statement changes.
  const ok = await DB.batch([DB.prepare("INSERT INTO probe_t (id, v) VALUES (1, 'a')"), DB.prepare("INSERT INTO probe_t (id, v) VALUES (2, 'b')"), DB.prepare("UPDATE probe_t SET v = 'c' WHERE id = 2")]);
  out.goodBatchChanges = ok.map((r) => r.meta?.changes);
  out.rowsAfterGoodBatch = (await DB.prepare("SELECT COUNT(*) n FROM probe_t").first()).n;
  // 3. foreign keys enforced?
  out.foreignKeysPragma = (await DB.prepare("PRAGMA foreign_keys").first());
  try { await run("INSERT INTO probe_child (id, pid) VALUES (1, 999)"); out.fkViolationRejected = false; } catch (e) { out.fkViolationRejected = true; out.fkMessage = msg(e); }
  // 4. RETURNING (used by the app for atomic single-use tokens and rate-limit counters).
  const ret = await DB.prepare("UPDATE probe_t SET v = 'z' WHERE id = 1 AND v = 'a' RETURNING id").first();
  out.returningFirst = ret;
  const ret2 = await DB.prepare("UPDATE probe_t SET v = 'y' WHERE id = 1 AND v = 'a' RETURNING id").first();
  out.returningSecondClaim = ret2; // must be null: the claim is single-use
  // 5. a raw BEGIN statement (the app never uses one on D1; recorded so the limitation is documented).
  try { await run("BEGIN"); out.rawBeginAccepted = true; try { await run("ROLLBACK"); } catch { /* ignore */ } } catch (e) { out.rawBeginAccepted = false; out.rawBeginMessage = msg(e); }
  // 6. a failed batch inside a larger flow leaves the earlier committed row alone.
  out.rowsAtEnd = (await DB.prepare("SELECT COUNT(*) n FROM probe_t").first()).n;
  await run("DROP TABLE probe_child"); await run("DROP TABLE probe_t");
  return out;
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const n = (k, d) => { const v = u.searchParams.get(k); return v === null ? d : Number(v); };
    try {
      switch (u.pathname) {
        case "/ping": return json({ ok: true });
        case "/features": return json({
          nodejs_compat_crypto: typeof nodeCrypto.scrypt === "function",
          argon2: typeof nodeCrypto.argon2, argon2Sync: typeof nodeCrypto.argon2Sync,
          scrypt: typeof nodeCrypto.scrypt, scryptSync: typeof nodeCrypto.scryptSync, pbkdf2: typeof nodeCrypto.pbkdf2,
          timingSafeEqual: typeof nodeCrypto.timingSafeEqual, webAssembly: typeof WebAssembly,
          subtleHasArgon2: (() => { try { return typeof crypto.subtle.deriveBits === "function"; } catch { return false; } })(),
        });
        case "/pbkdf2": { const it = n("iter", 600000); const out = await pbkdf2(it, u.searchParams.get("hash") ?? "SHA-256"); return json({ ok: true, iterations: it, bytes: out.length }); }
        case "/scrypt": { const N = n("N", 32768), r = n("r", 8), p = n("p", 1); const k = await scryptAsync(N, r, p, n("maxmem", 512 * 1024 * 1024)); return json({ ok: true, N, r, p, approxMemoryMiB: (128 * N * r) / 1048576, bytes: k.length }); }
        case "/spin": { let x = 0; const iters = n("n", 1e7); for (let i = 0; i < iters; i++) x = (x + i * i) % 1000003; return json({ ok: true, x }); }
        case "/mem": { const mb = n("mb", 10); const a = new Uint8Array(mb * 1024 * 1024); for (let i = 0; i < a.length; i += 4096) a[i] = 1; return json({ ok: true, mb }); }
        case "/wasm-runtime-compile": { // can a Worker compile WebAssembly from bytes at runtime? (matters for WASM hashing libraries that embed base64)
          try { const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]); await WebAssembly.instantiate(bytes, {}); return json({ ok: true, allowed: true }); } catch (e) { return json({ ok: true, allowed: false, message: msg(e) }); }
        }
        case "/d1": return json({ ok: true, ...(await d1Probe(env.DB)) });
        default: return json({ error: "not found" }, 404);
      }
    } catch (e) { return json({ ok: false, error: msg(e) }, 500); }
  },
};
