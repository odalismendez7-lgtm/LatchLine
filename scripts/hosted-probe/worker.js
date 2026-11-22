// DISPOSABLE HOSTED PROBE. Not LATCHLINE. Contains no product code, no database, no customer data, no secrets.
// Purpose: learn what the REAL hosted Workers Free plan does with password-hashing work (CPU limit, PBKDF2 iteration cap).
// Every endpoint needs ?k=<random key given at deploy time with --var PROBE_KEY:...>; without it the answer is a bare 404.
// It computes a hash of a FIXED, MEANINGLESS string with a fixed salt and returns only ok/error. Delete it after use.
import * as nodeCrypto from "node:crypto";

const enc = new TextEncoder();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const err = (e) => ({ name: e?.name ?? "Error", message: String(e?.message ?? e).slice(0, 300) });

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (!env.PROBE_KEY || u.searchParams.get("k") !== env.PROBE_KEY) return new Response("not found", { status: 404 });
    const n = (k, d) => { const v = u.searchParams.get(k); return v === null ? d : Number(v); };
    try {
      switch (u.pathname) {
        case "/ping": return json({ ok: true, colo: request.cf?.colo ?? null });
        case "/pbkdf2": {
          const iterations = n("iter", 600000), hash = u.searchParams.get("hash") === "SHA-512" ? "SHA-512" : "SHA-256";
          const key = await crypto.subtle.importKey("raw", enc.encode("probe-not-a-real-password"), "PBKDF2", false, ["deriveBits"]);
          const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash, salt: new Uint8Array(16), iterations }, key, 256);
          return json({ ok: true, algo: `pbkdf2-${hash}`, iterations, bytes: bits.byteLength });
        }
        case "/scrypt": {
          const N = n("N", 16384), r = n("r", 8), p = n("p", 1);
          const out = await new Promise((res, rej) => nodeCrypto.scrypt("probe-not-a-real-password", new Uint8Array(16), 32, { N, r, p, maxmem: 256 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
          return json({ ok: true, algo: "scrypt", N, r, p, bytes: out.length });
        }
        case "/spin": { let x = 0; const iters = Math.min(n("n", 1e6), 3e8); for (let i = 0; i < iters; i++) x = (x + i * i) % 1000003; return json({ ok: true, iters, x }); }
        default: return json({ error: "not found" }, 404);
      }
    } catch (e) { return json({ ok: false, error: err(e) }, 500); }
  },
};
