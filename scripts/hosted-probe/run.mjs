// Drives the disposable probe (hosted or local) and records what happened. Read-only requests of a meaningless
// hash; no data is sent. Usage:
//   node scripts/hosted-probe/run.mjs <baseUrl> <key> [repeats=5] [out.json]
// Status meaning on the hosted service: 200 = finished within limits; a 5xx or a body mentioning 1102 / "exceeded"
// = the platform stopped the Worker (for example CPU limit); 500 with {ok:false,error} = the code threw (for example
// an iteration cap, whose real error text this records).
import { writeFileSync } from "node:fs";
const [base, key, repeatsArg, outFile] = process.argv.slice(2);
if (!base || !key) { console.error("usage: node run.mjs <baseUrl> <key> [repeats] [out.json]"); process.exit(2); }
const repeats = Number(repeatsArg || 5);
const cases = [
  ["ping (baseline)", "/ping"],
  ["spin 1e6 (tiny)", "/spin?n=1000000"], ["spin 2e7", "/spin?n=20000000"], ["spin 1e8", "/spin?n=100000000"],
  ...[1000, 10000, 50000, 100000, 100001, 150000, 210000, 300000, 600000].map((i) => [`PBKDF2-SHA256 ${i.toLocaleString("en-US")}`, `/pbkdf2?iter=${i}`]),
  ["PBKDF2-SHA512 210,000", "/pbkdf2?iter=210000&hash=SHA-512"],
  ...[[8192, 8, 10], [16384, 8, 5], [32768, 8, 3], [65536, 8, 2], [131072, 8, 1]].map(([N, r, p]) => [`scrypt N=${N} r=${r} p=${p}`, `/scrypt?N=${N}&r=${r}&p=${p}`]),
];
const results = [];
for (const [label, path] of cases) {
  const runs = [];
  for (let i = 0; i < repeats; i++) {
    const t = performance.now();
    let status = 0, text = "";
    try { const r = await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}k=${encodeURIComponent(key)}`); status = r.status; text = (await r.text()).slice(0, 400); } catch (e) { text = `FETCH ERROR ${e.message}`; }
    runs.push({ status, ms: Math.round(performance.now() - t), text });
    await new Promise((r) => setTimeout(r, 300));
  }
  const ok = runs.filter((x) => x.status === 200).length;
  const sample = runs.find((x) => x.status !== 200) ?? runs[0];
  results.push({ label, path, ok, repeats, statuses: runs.map((x) => x.status), msMedian: [...runs].map((x) => x.ms).sort((a, b) => a - b)[Math.floor(runs.length / 2)], sample: sample.text.replace(/\s+/g, " ").slice(0, 200) });
}
console.log("| Test | OK / tries | Statuses | Median ms (incl. network) | First non-200 or sample |\n|---|---|---|---|---|");
for (const r of results) console.log(`| ${r.label} | ${r.ok}/${r.repeats} | ${[...new Set(r.statuses)].join(",")} | ${r.msMedian} | ${r.sample.replace(/\|/g, "/")} |`);
if (outFile) writeFileSync(outFile, JSON.stringify({ when: new Date().toISOString(), base, results }, null, 2));
