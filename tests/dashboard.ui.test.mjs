// Browser tests for the owner dashboard (real page, real dev server, in-memory SQLite, mock mailer/AI).
// Desktop and mobile viewports. Skipped with a visible reason if Playwright is not installed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { startDevServer } from "../scripts/dev-server.mjs";
import { forBusiness } from "../src/db/tenant.js";

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* skipped below */ }
const skip = chromium ? false : "playwright not installed";
const PORT = 30000 + Math.floor(Math.random() * 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const PW = "correct horse battery staple";
const SHOTS = process.env.SHOT_DIR;
let srv, browser;

before(async () => {
  if (!chromium) return;
  srv = await startDevServer({ port: PORT, dbPath: ":memory:", iterations: 1500 });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await srv?.close().catch(() => {}); });

const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 375, height: 700 } };

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  describe(`dashboard UI (${name})`, { skip }, () => {
    const email = `owner-${name}@acme.example`;
    let ctx, page, bizId; const problems = [];

    async function leadsSeed() {
      const T = forBusiness(srv.db, bizId);
      const mk = async (o) => {
        const cv = await T.conversations.create();
        await T.conversations.addMessage(cv.id, { role: "customer", content: o.msg, meta: {} });
        const l = await T.leads.create(cv.id, { name: o.name, phone: "+15125550142", email: "c@customer.example", zip: "62701", issueText: o.issue, urgency: o.emergency ? "now" : "can_wait", emergency: !!o.emergency, emergencyCategories: o.emergency ? ["gas_leak"] : [], summary: "s" });
        await T.conversations.save(cv.id, { state: {}, status: o.handoff ? "needs_human" : "open", urgent: !!o.emergency });
        return l.id;
      };
      await mk({ name: '<img src=x onerror="window.__xss=1">Mallory', issue: '<script>window.__xss=2</script> leaking', msg: "<b>hi</b>" });
      await mk({ name: "Una Urgent", issue: "gas smell in kitchen", emergency: true, handoff: true, msg: "I smell gas" });
    }
    const noHScroll = async (label) => {
      const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
      assert.ok(w.s <= w.c + 1, `${label}: page scrolls horizontally (${w.s} > ${w.c})`);
    };
    const shot = async (n) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}-${n}.png`, fullPage: false }); } };
    const go = async (label) => { await page.getByRole("button", { name: label, exact: true }).click(); await page.waitForFunction(() => !document.querySelector("#main")?.textContent.startsWith("Loading")); };

    before(async () => {
      ctx = await browser.newContext({ viewport });
      page = await ctx.newPage();
      // Expected 401/400 API answers are logged by Chromium as "Failed to load resource"; only real script/CSP problems count.
      page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text()) || (m.type() === "error" && !/Failed to load resource/.test(m.text()))) problems.push(m.text()); });
      page.on("pageerror", (e) => problems.push(String(e)));
      page.on("dialog", (d) => { problems.push("dialog:" + d.message()); d.dismiss(); });
    });
    after(async () => { await ctx?.close(); });

    test("the page says clearly that this is DEMO authentication with simulated email", async () => {
      await page.goto(`${BASE}/app`);
      await page.waitForSelector(".demo");
      assert.match(await page.locator(".demo").innerText(), /DEMO authentication[\s\S]*SIMULATED[\s\S]*Not production-ready/);
      await noHScroll("login"); await shot("1-login");
    });

    test("register → simulated verification link → sign in", async () => {
      await page.goto(`${BASE}/app#register`);
      await page.fill("input[name=businessName]", "Acme Plumbing");
      await page.fill("input[name=email]", email);
      await page.fill("input[name=password]", PW);
      await page.click("button[type=submit]");
      await page.waitForFunction(() => /SIMULATED/.test(document.querySelector("#msg")?.textContent || ""));
      await page.goto(`${BASE}/app#dev`);
      await page.waitForSelector("text=SIMULATED");
      await page.locator("li", { hasText: email }).first().getByRole("link", { name: "open link" }).click();
      await page.waitForFunction(() => /Email verified/.test(document.querySelector("#msg")?.textContent || ""));
      await page.goto(`${BASE}/app`);
      await page.fill("input[name=email]", email); await page.fill("input[name=password]", PW);
      await page.click("button[type=submit]");
      await page.waitForSelector("text=Overview");
      bizId = (await srv.db.first("SELECT m.business_id id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = ?", [email])).id;
      assert.ok(bizId);
      assert.equal(await page.evaluate(() => document.cookie), "", "session cookie is HttpOnly (invisible to scripts)");
      assert.equal(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length), 0, "nothing stored in web storage");
    });

    test("overview shows counts and the simulated-notifications notice", async () => {
      await leadsSeed();
      await page.reload(); await page.waitForSelector("text=Overview");
      await page.waitForSelector(".stat");
      assert.match(await page.locator("main#main").innerText(), /Urgent, not yet handled/);
      assert.match(await page.locator("main#main").innerText(), /SIMULATED/);
      await noHScroll("overview"); await shot("2-overview");
    });

    test("leads: urgent first, hostile markup shown as text (no script runs), filters work, detail + status update", async () => {
      await go("Leads");
      const rows = page.locator("tbody tr");
      await rows.first().waitFor();
      assert.equal(await rows.count(), 2);
      assert.match(await rows.first().innerText(), /URGENT[\s\S]*Una Urgent/);
      assert.match(await page.locator("main#main").innerText(), /<img src=x onerror=/);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      assert.equal(await page.locator("main#main img").count(), 0);
      await noHScroll("leads"); await shot("3-leads");
      await page.fill("input[name=q]", "gas"); await page.getByRole("button", { name: "Filter" }).click();
      await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
      await page.getByRole("button", { name: "Una Urgent" }).click();
      await page.waitForSelector("text=Timeline");
      await noHScroll("lead detail"); await shot("4-lead-detail");
      await page.selectOption("select[name=status]", "contacted");
      await page.getByRole("button", { name: "Update status" }).click();
      await page.waitForSelector("#toast:not([hidden])");
      assert.match(await page.locator("#toast").innerText(), /Status updated/);
      await page.waitForFunction(() => /status changed → contacted/.test(document.body.innerText));
    });

    test("every section renders without horizontal page scroll and with usable touch targets", async () => {
      for (const label of ["Overview", "Leads", "Conversations", "Handoffs", "Notifications", "Settings", "Contacts", "Team", "Audit log"]) {
        await go(label);
        await noHScroll(label);
        const small = await page.evaluate(() => [...document.querySelectorAll("button, select, input:not([type=checkbox]), a.btn")].filter((e) => e.offsetParent && !e.classList.contains("link")).map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0 && r.height < 36).length);
        assert.equal(small, 0, `${label}: controls shorter than 36px`);
      }
      await shot("5-audit");
    });

    test("handoffs list the urgent waiting conversation; conversation text is plain text", async () => {
      await go("Handoffs");
      assert.match(await page.locator("main#main").innerText(), /Una Urgent/);
      await go("Conversations");
      await page.getByRole("button", { name: "Open" }).first().click();
      await page.waitForSelector(".bubble");
      assert.equal(await page.locator(".bubble b").count(), 0);
    });

    test("settings require the confirmation box and save", async () => {
      await go("Settings");
      await page.fill("textarea[name=hours]", "Mon–Fri 8am–5pm");
      await page.fill("textarea[name=services]", "Drain cleaning\nWater heaters");
      await page.getByRole("button", { name: "Save settings" }).click();
      assert.equal(await page.locator("input[name=confirm]").evaluate((e) => e.validity.valueMissing), true, "browser blocks submit without the confirm checkbox");
      assert.equal((await srv.db.first("SELECT COUNT(*) n FROM knowledge_bases WHERE business_id = ?", [bizId])).n, 0, "nothing saved without confirmation");
      await page.check("input[name=confirm]");
      await page.getByRole("button", { name: "Save settings" }).click();
      await page.waitForSelector("text=confirmed by you");
      await page.waitForSelector("summary");
      await noHScroll("settings"); await shot("6-settings");
    });

    test("contacts: add → unverified; simulated code → 'simulated-verified (not real)', never plain 'verified'", async () => {
      await go("Contacts");
      assert.match(await page.locator(".alert").innerText(), /SIMULATED MODE/);
      await page.fill("input[name=address]", "alerts@acme.example");
      await page.getByRole("button", { name: "Add contact" }).click();
      await page.waitForSelector("text=Not verified");
      await page.getByRole("button", { name: "Send code" }).click();
      await page.waitForFunction(() => /SIMULATED/.test(document.querySelector("#toast")?.textContent || ""));
      const code = srv.mailer.last("contact_verification", "alerts@acme.example").data.code;
      await page.fill("input[name=code]", "000000" === code ? "111111" : "000000");
      const stale = await page.locator("input[name=code]").elementHandle();
      await page.getByRole("button", { name: "Confirm code" }).click();
      await page.waitForFunction((el) => !el.isConnected, stale); // the list re-rendered after the wrong code
      await page.waitForSelector("text=Not verified");
      await page.fill("input[name=code]", code);
      await page.getByRole("button", { name: "Confirm code" }).click();
      await page.waitForSelector("text=Simulated-verified only (not real)");
      assert.equal(await page.locator(".chip", { hasText: /^Verified$/ }).count(), 0);
      await noHScroll("contacts"); await shot("7-contacts");
    });

    test("sign out ends the session; back to the sign-in screen", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForSelector("text=Sign in");
      assert.equal((await ctx.request.get(`${BASE}/api/me`)).status(), 401);
    });

    test("the page's CSP blocked nothing and no console or page errors occurred", async () => {
      assert.deepEqual(problems, []);
    });
  });
}

describe("dashboard page security headers", { skip }, () => {
  test("strict CSP with a fresh nonce per load; no unsafe-inline; no framing", async () => {
    const a = await fetch(`${BASE}/app`), b = await fetch(`${BASE}/app`);
    const ca = a.headers.get("content-security-policy"), cb = b.headers.get("content-security-policy");
    assert.match(ca, /script-src 'nonce-[\w+/=]+'/); assert.ok(!/unsafe-inline|unsafe-eval/.test(ca)); assert.match(ca, /frame-ancestors 'none'/); assert.match(ca, /default-src 'none'/);
    assert.notEqual(ca, cb);
    assert.equal(a.headers.get("x-frame-options"), "DENY"); assert.match(a.headers.get("cache-control"), /no-store/);
    const html = await a.text();
    assert.ok(!/\son\w+=/.test(html.replace(/CLIENT/g, "")), "no inline event-handler attributes in the served HTML shell");
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(html), "client code never uses HTML-injecting APIs");
  });
});
