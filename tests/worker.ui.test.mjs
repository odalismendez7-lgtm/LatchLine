// Browser tests against the REAL Worker entry (src/index.js) served by scripts/worker-sim.mjs as a separate process
// on a real SQLite file: desktop + phone sizes, session expiry, restart persistence, database outage message.
// Not the Workers runtime (KI-40). Skipped with a visible reason if Playwright is missing.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startProc, tempDir, openDb, freePort } from "./helpers/proc.mjs";

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* skipped */ }
const skip = chromium ? false : "playwright not installed";
const PW = "correct horse battery staple";

for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 375, height: 700 }]]) {
  describe(`dashboard on the Worker entry (${name})`, { skip }, () => {
    const t = tempDir(); const PORT = freePort(); const email = `owner-${name}@acme.example`;
    let s, browser, ctx, page; const problems = [];
    const base = () => `http://127.0.0.1:${PORT}`;
    const noHScroll = async (l) => { const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); assert.ok(w[0] <= w[1] + 1, `${l}: horizontal scroll ${w}`); };
    const signIn = async () => { await page.goto(`${base()}/app`); await page.fill("input[name=email]", email); await page.fill("input[name=password]", PW); await page.click("button[type=submit]"); await page.waitForSelector("text=Overview"); };

    before(async () => {
      if (!chromium) return;
      s = await startProc("worker-sim", { db: t.db, port: PORT, env: { SCHEDULE_MS: "500" } });
      browser = await chromium.launch(); ctx = await browser.newContext({ viewport }); page = await ctx.newPage();
      page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text()) || (m.type() === "error" && !/Failed to load resource/.test(m.text()))) problems.push(m.text()); });
      page.on("pageerror", (e) => problems.push(String(e)));
    });
    after(async () => { await browser?.close(); await s?.stop("SIGKILL").catch(() => {}); t.cleanup(); });

    test("register, simulated verification link, sign in", async () => {
      await page.goto(`${base()}/app#register`);
      await page.fill("input[name=businessName]", "Acme Plumbing"); await page.fill("input[name=email]", email); await page.fill("input[name=password]", PW);
      await page.click("button[type=submit]");
      await page.waitForFunction(() => /SIMULATED/.test(document.querySelector("#msg")?.textContent || ""));
      await page.goto(`${base()}/app#dev`); await page.waitForSelector("text=SIMULATED");
      await page.locator("li", { hasText: email }).first().getByRole("link", { name: "open link" }).click();
      await page.waitForFunction(() => /Email verified/.test(document.querySelector("#msg")?.textContent || ""));
      await signIn();
      assert.match(await page.locator(".demo").innerText(), /DEMO authentication/);
      await noHScroll("overview");
    });

    test("sections load from the Worker entry without horizontal scroll", async () => {
      for (const label of ["Leads", "Conversations", "Handoffs", "Notifications", "Settings", "Contacts", "Team", "Audit log", "Overview"]) {
        await page.getByRole("button", { name: label, exact: true }).click();
        await page.waitForFunction(() => !document.querySelector("#main")?.textContent.startsWith("Loading"));
        await noHScroll(label);
      }
    });

    test("a database outage shows a plain 'temporarily unavailable' message and the page recovers", async () => {
      await page.getByRole("button", { name: "Contacts", exact: true }).click();
      await page.waitForSelector("input[name=address]");
      const locker = openDb(t.db); locker.exec("BEGIN IMMEDIATE");
      try {
        await page.fill("input[name=address]", "alerts@acme.example");
        await page.getByRole("button", { name: "Add contact" }).click();
        await page.waitForFunction(() => /temporarily unavailable/i.test(document.querySelector("#toast")?.textContent || ""));
        assert.ok(!/sqlite|locked|stack/i.test(await page.locator("#toast").innerText()));
      } finally { locker.exec("ROLLBACK"); locker.close(); }
      await page.getByRole("button", { name: "Add contact" }).click();
      await page.waitForSelector("text=Not verified");
    });

    test("restarting the server keeps the browser signed in and the data in place", async () => {
      await s.stop("SIGTERM");
      s = await startProc("worker-sim", { db: t.db, port: PORT, env: { SCHEDULE_MS: "500" } });
      await page.reload(); await page.waitForSelector("text=Overview");
      await page.getByRole("button", { name: "Contacts", exact: true }).click();
      await page.waitForSelector("text=alerts@acme.example");
    });

    test("an ended session (idle timeout) is explained and returns to sign-in", async () => {
      const d = openDb(t.db); d.prepare("UPDATE sessions SET last_seen_at = ?").run(new Date(Date.now() - 31 * 60_000).toISOString()); d.close();
      await page.getByRole("button", { name: "Leads", exact: true }).click();
      await page.waitForSelector("text=Your session ended");
      assert.ok(await page.locator("input[name=password]").isVisible());
      await noHScroll("session ended");
      await signIn();
    });

    test("sign out; no console, CSP or page errors occurred", async () => {
      await page.getByRole("button", { name: "Sign out" }).click(); await page.waitForSelector("text=Sign in");
      assert.deepEqual(problems, []);
    });
  });
}
