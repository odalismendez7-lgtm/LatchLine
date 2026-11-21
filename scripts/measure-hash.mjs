// Measures password-hash CPU time on THIS machine (Node). It does NOT measure Cloudflare Workers.
// The Workers Free plan allows ~10 ms CPU per request; compare these numbers against that limit
// only after measuring inside a real local Workers runtime (docs/KNOWN_ISSUES.md KI-30).
import { hashPassword, verifyPassword, PBKDF2_ITERATIONS } from "../src/auth/crypto.js";
const pw = "correct horse battery staple";
for (const it of [100_000, 300_000, PBKDF2_ITERATIONS]) {
  const times = [];
  for (let i = 0; i < 5; i++) { const t = process.cpuUsage(); const h = await hashPassword(pw, it); await verifyPassword(pw, h); const u = process.cpuUsage(t); times.push((u.user + u.system) / 1000 / 2); }
  times.sort((a, b) => a - b);
  console.log(`${String(it).padStart(8)} iterations: median ${times[2].toFixed(1)} ms per hash (process CPU; PBKDF2 runs on a worker thread, so wall time may differ)${it === PBKDF2_ITERATIONS ? "  <- production setting" : ""}`);
}
