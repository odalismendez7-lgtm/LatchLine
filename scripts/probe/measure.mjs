// Times password-hashing options on the REAL local runtime (workerd) from OUTSIDE (workerd's own clocks do not
// advance during synchronous work). Prints a markdown table. Local only; nothing is stored or sent.
//   node scripts/probe/measure.mjs [repeats]
// IMPORTANT: these are WALL-CLOCK times on THIS computer under local workerd. Local workerd does not enforce or
// report CPU limits, and Cloudflare's hardware and limits differ. Use the numbers to compare options, not to
// promise production behaviour.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, startWorkerd } from "../lib/workerd.mjs";

const repeats = Number(process.argv[2] || 15);
const dir = mkdtempSync(join(tmpdir(), "latchline-measure-"));
const persist = join(dir, "state"), config = "scripts/probe/wrangler.probe.toml";
applyMigrations({ persist, config });
const w = await startWorkerd({ config, persist });
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function time(path) {
  const ms = []; let status = 0, body = "";
  for (let i = 0; i < repeats + 2; i++) {
    const t = performance.now(); const r = await fetch(w.base + path); const b = await r.text(); const d = performance.now() - t;
    status = r.status; body = b; if (i >= 2) ms.push(d); // first two are warm-up
  }
  return { status, median: median(ms), max: Math.max(...ms), body };
}
const base = await time("/ping");
const rows = [];
const add = async (label, path, note) => { const r = await time(path); rows.push({ label, status: r.status, median: r.median, over: Math.max(0, r.median - base.median), max: r.max, note }); };
await add("PBKDF2-SHA256 100,000 (the reported production cap)", "/pbkdf2?iter=100000");
await add("PBKDF2-SHA256 300,000", "/pbkdf2?iter=300000");
await add("PBKDF2-SHA256 600,000 (OWASP; current setting)", "/pbkdf2?iter=600000");
await add("PBKDF2-SHA512 210,000 (OWASP alternative)", "/pbkdf2?iter=210000&hash=SHA-512");
for (const [N, r, p, mem] of [[131072, 8, 1, 128], [65536, 8, 2, 64], [32768, 8, 3, 32], [16384, 8, 5, 16], [8192, 8, 10, 8]]) await add(`scrypt N=${N} r=${r} p=${p} (OWASP-listed, ~${mem} MiB)`, `/scrypt?N=${N}&r=${r}&p=${p}`, `${mem} MiB`);
console.log(`Idle request baseline (median of ${repeats}): ${base.median.toFixed(1)} ms\n`);
console.log("| Option | HTTP | Median ms | Over idle | Max ms |\n|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.label} | ${r.status} | ${r.median.toFixed(0)} | ${r.over.toFixed(0)} | ${r.max.toFixed(0)} |`);
await w.stop(); rmSync(dir, { recursive: true, force: true });
