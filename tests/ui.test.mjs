// Browser tests: the real index.html against the real local dev server
// (mock AI, in-memory SQLite). Runs desktop and mobile viewports. Skipped, with
// a visible reason, if Playwright/Chromium is not installed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startDevServer } from "../scripts/dev-server.mjs";

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* skipped below */ }

const skip = chromium ? false : "playwright not installed";
const PORT = 20000 + Math.floor(Math.random() * 9000);
let srv, browser;

before(async () => {
  if (!chromium) return;
  srv = await startDevServer({ port: PORT, dbPath: ":memory:" });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await srv?.close().catch(() => {}); });

const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 375, height: 700 } };

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  describe(`UI (${name})`, { skip }, () => {
    async function open() {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/`);
      return { ctx, page };
    }
    const say = async (page, text) => {
      const before = await page.locator(".message.bot").count();
      await page.fill("#chatInput", text);
      await page.click("button.send");
      await page.waitForFunction((n) => document.querySelectorAll(".message.bot").length > n, before);
      return page.locator(".message.bot").last().innerText();
    };

    test("shows that it is a development build, not production", async () => {
      const { ctx, page } = await open();
      assert.match(await page.locator("#modeNote").innerText(), /Development server.*mock AI.*not production/i);
      await ctx.close();
    });

    test("no horizontal scroll", async () => {
      const { ctx, page } = await open();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false);
      await ctx.close();
    });

    test("a question is answered by the backend from verified knowledge only", async () => {
      const { ctx, page } = await open();
      const reply = await say(page, "What are your hours?");
      assert.match(reply, /confirm|business team|incorrect/i);
      assert.doesNotMatch(reply, /\d{1,2}\s?(am|pm)/i);
      await ctx.close();
    });

    test("an emergency shows safety guidance and no dispatch promise", async () => {
      const { ctx, page } = await open();
      const reply = await say(page, "I smell gas in the kitchen");
      assert.match(reply, /911|leave/i);
      assert.match(reply, /can't (send help|dispatch)/i);
      await ctx.close();
    });

    test("full lead flow: UI says recorded only after the database holds the lead", async () => {
      const { ctx, page } = await open();
      const before = (await srv.db.first("SELECT COUNT(*) n FROM leads")).n;
      let r = await say(page, "my kitchen faucet keeps dripping all day");
      assert.doesNotMatch(r, /recorded/i);
      await say(page, "Jane Doe");
      await say(page, `512-555-01${name === "mobile" ? 43 : 42}`);
      await say(page, "62701");
      r = await say(page, "it can wait");
      assert.match(r, /has been recorded/);
      assert.equal((await srv.db.first("SELECT COUNT(*) n FROM leads")).n, before + 1);
      await ctx.close();
    });

    test("an invalid phone number is rejected in the UI and nothing is saved", async () => {
      const { ctx, page } = await open();
      const before = (await srv.db.first("SELECT COUNT(*) n FROM leads")).n;
      await say(page, "my toilet keeps running all night long");
      await say(page, "Sam Rivera");
      const r = await say(page, "banana");
      assert.match(r, /valid US phone/);
      assert.equal((await srv.db.first("SELECT COUNT(*) n FROM leads")).n, before);
      await ctx.close();
    });

    test("page text from the server is rendered as text, not HTML", async () => {
      const { ctx, page } = await open();
      await page.fill("#chatInput", "<img src=x onerror=window.__pwned=1> my sink drips");
      await page.click("button.send");
      await page.waitForFunction(() => document.querySelectorAll(".message.bot").length > 1);
      assert.equal(await page.evaluate(() => window.__pwned), undefined);
      assert.equal(await page.locator("#messages img").count(), 0);
      await ctx.close();
    });

    test("when the server is unreachable the UI says nothing was saved", async () => {
      const { ctx, page } = await open();
      await page.route("**/api/chat", (route) => route.abort());
      const r = await say(page, "my kitchen faucet keeps dripping all day");
      assert.match(r, /can't reach the server/i);
      assert.match(r, /nothing was sent or saved/i);
      await ctx.close();
    });

    test("a 429 shows a wait message and says the message was not processed", async () => {
      const { ctx, page } = await open();
      await page.route("**/api/chat", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Too many requests", retryAfterSec: 12 }) }));
      const r = await say(page, "hello there");
      assert.match(r, /too quickly/i);
      assert.match(r, /12 seconds/);
      assert.match(r, /not processed/i);
      await ctx.close();
    });
  });
}

describe("UI (page opened off-localhost without ?api)", { skip }, () => {
  test("runs the offline demo and labels it as not connected", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route("http://demo.invalid/", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "" }));
    const html = (await (await fetch(`http://127.0.0.1:${PORT}/`)).text());
    await page.route("http://demo.invalid/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
    let apiCalls = 0;
    await page.route("**/api/chat", (route) => { apiCalls++; route.abort(); });
    await page.goto("http://demo.invalid/page");
    assert.match(await page.locator("#modeNote").innerText(), /Offline scripted demo/);
    await page.fill("#chatInput", "my sink drips");
    await page.click("button.send");
    await page.waitForTimeout(200);
    assert.equal(apiCalls, 0);
    await ctx.close();
  });
});
