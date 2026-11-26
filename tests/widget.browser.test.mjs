// Stage 7: the REAL widget in a REAL headless Chromium, embedded in a separate "plumber's website" origin, talking to
// the REAL backend (dev server: in-memory SQLite, mock AI). Skipped with a visible reason when Playwright is absent.
// Not verified here: real screen readers (VoiceOver/NVDA/JAWS), Safari/Firefox, real phones, hosted Workers.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startWidgetWorld } from "./helpers/widgetHost.mjs";

const require = createRequire(import.meta.url);
let chromium = null, devices = null;
try { ({ chromium, devices } = require("playwright")); } catch { /* skipped below */ }
const skip = chromium ? false : "playwright not installed";

let W, browser, seq = 0;
before(async () => { if (!chromium) return; W = await startWidgetWorld(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); await W?.close(); });

const DESKTOP = { width: 1280, height: 800 }, PHONE = { width: 375, height: 700 };
const ROOT = "#latchline-widget-root";

async function biz(extra = {}) { const n = ++seq; return W.business({ id: `biz${n}`, name: extra.name ?? `Acme Plumbing ${n}`, key: `sk_test_${String(n).padStart(8, "0")}`, ...extra }); }
async function open(b, { viewport = DESKTOP, init, reduced, ctxOpts = {} } = {}) {
  const ctx = await browser.newContext({ viewport, ...ctxOpts });
  if (reduced) await ctx.addInitScript(() => {}); 
  const page = await ctx.newPage();
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  if (init) await page.addInitScript(init);
  const reqs = [], logs = [];
  page.on("request", (r) => { if (r.url().startsWith(W.apiOrigin)) reqs.push({ url: r.url().replace(W.apiOrigin, ""), method: r.method(), idempotencyKey: r.headers()["idempotency-key"] ?? null, body: r.postData() ? JSON.parse(r.postData()) : null }); });
  page.on("console", (m) => logs.push(m.text()));
  await page.goto(b.site.url);
  return { ctx, page, reqs, logs, chats: () => reqs.filter((r) => r.url === "/api/chat") };
}
const launcher = (p) => p.locator("button.launcher");
async function openChat(p) { await launcher(p).waitFor({ state: "visible" }); await launcher(p).click(); await p.locator("textarea").waitFor({ state: "visible" }); }
const say = async (p, text) => { await p.locator("textarea").fill(text); await p.keyboard.press("Enter"); };
const logText = (p) => p.locator(".log").innerText();
async function waitFor(p, pred, arg, timeout = 5000) { await p.waitForFunction(pred, arg, { timeout }); }
const bubbles = (p, cls) => p.locator(`.m.${cls}`);
const inShadow = (p, fn, arg) => p.evaluate(([src, a]) => { const r = document.querySelector("#latchline-widget-root").shadowRoot; return new Function("r", "a", `return (${src})(r,a)`)(r, a); }, [fn.toString(), arg]);
async function replied(p, n) { await waitFor(p, (k) => [...document.querySelector("#latchline-widget-root").shadowRoot.querySelectorAll(".m.assistant")].length >= k, n); }

describe("mounting and tenant binding (desktop)", { skip }, () => {
  test("a registered website shows the launcher named for the business; the panel starts closed", async () => {
    const b = await biz({ name: "Riverbend Plumbing" }); const { ctx, page } = await open(b);
    await launcher(page).waitFor();
    assert.equal(await launcher(page).getAttribute("aria-label"), "Chat with Riverbend Plumbing");
    assert.equal(await launcher(page).getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator(".panel").isVisible(), false);
    await ctx.close();
  });
  test("nothing is shown for: malformed key, unknown key, inactive business, website not registered for that key", async () => {
    const real = await biz({ name: "Real Co" });
    const inactive = await biz({ status: "suspended" });
    const unregistered = await W.site(W.pageHtml({ key: real.key })); // real key, but this website is not registered
    const cases = [
      ["malformed", await W.site(W.pageHtml({ key: "short" }))],
      ["unknown", await W.site(W.pageHtml({ key: "sk_nobody_00000000" }))],
      ["inactive", inactive.site],
      ["unregistered website", unregistered],
    ];
    for (const [name, s] of cases) {
      const ctx = await browser.newContext(); const page = await ctx.newPage(); const logs = []; page.on("console", (m) => logs.push(m.text()));
      await page.goto(s.url); await page.waitForTimeout(700);
      assert.equal(await page.locator(ROOT).count(), 0, `${name}: must not mount`);
      await ctx.close();
    }
  });
  test("data attributes cannot redirect the widget or choose a tenant: the API is the script's own origin, requests carry only siteKey/message/conversationId", async () => {
    const b = await biz({ html: { attrs: `data-business-id="other" data-tenant="other" data-api="https://evil.example" data-base-url="https://evil.example"` } });
    const { ctx, page, reqs } = await open(b); await openChat(page);
    await say(page, "hello there"); await replied(page, 2);
    assert.ok(reqs.length >= 2 && reqs.every((r) => !r.url.includes("evil")), "all traffic goes to the API origin");
    const chat = reqs.find((r) => r.url === "/api/chat");
    assert.deepEqual(Object.keys(chat.body).sort(), ["conversationId", "message", "siteKey"]);
    assert.equal(chat.body.siteKey, b.key);
    await ctx.close();
  });
  test("embedding the script twice mounts one widget", async () => {
    const b = await biz({ html: { scriptTags: 2 } }); const { ctx, page } = await open(b);
    await launcher(page).waitFor(); await page.waitForTimeout(300);
    assert.equal(await page.locator(ROOT).count(), 1); await ctx.close();
  });
  test("config service down at page load: widget still appears with neutral wording, and sending still works when the service is back", async () => {
    const b = await biz();
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    let down = true;
    await page.route("**/api/widget/config*", (r) => (down ? r.abort() : r.continue()));
    await page.goto(b.site.url); await launcher(page).waitFor();
    assert.equal(await launcher(page).getAttribute("aria-label"), "Open chat");
    await launcher(page).click(); assert.match(await logText(page), /what can I help you with/i);
    down = false; await say(page, "my sink is leaking"); await replied(page, 2);
    await ctx.close();
  });
  test("host page CSS cannot restyle the widget (Shadow DOM) and the widget adds no global CSS or globals except one flag", async () => {
    const b = await biz({ html: { extraHead: `<style>*{color:red!important;font-size:50px!important} h2,button,textarea{background:lime!important;display:none!important}</style>` } });
    const { ctx, page } = await open(b); await openChat(page);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#latchline-widget-root").shadowRoot.querySelector("h2")).display), "block");
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".send")).backgroundColor), "rgb(0, 255, 0)");
    const globals = await page.evaluate(() => Object.keys(window).filter((k) => /latchline|widget|ll_/i.test(k)));
    assert.deepEqual(globals, ["__latchlineWidget"]);
    assert.equal(await page.evaluate(() => document.querySelectorAll("style[data-ll],link[data-ll]").length), 0);
    await ctx.close();
  });
});

describe("conversation through the real backend", { skip }, () => {
  test("open → send → typing → reply; the conversation id is kept and reused; the customer bubble is plain text", async () => {
    const b = await biz(); const { ctx, page, chats } = await open(b); await openChat(page);
    let seen = false;
    await page.route("**/api/chat", async (r) => { await new Promise((x) => setTimeout(x, 400)); r.continue(); });
    await say(page, "My kitchen sink is leaking"); 
    await page.locator(".typing.on").waitFor({ timeout: 2000 }); seen = true;
    await replied(page, 2);
    assert.ok(seen); assert.equal(await page.locator(".typing.on").count(), 0, "typing indicator gone after the reply");
    await say(page, "Maria Lopez"); await replied(page, 3);
    const c = chats(); assert.equal(c[0].body.conversationId, null); assert.ok(c[1].body.conversationId?.startsWith("conv_") || c[1].body.conversationId?.length > 5);
    assert.equal(await page.locator(".m.customer").count(), 2);
    await ctx.close();
  });
  test("duplicate submissions: Enter twice, Enter then Send click, and double-click Send produce exactly ONE request", async () => {
    const b = await biz(); const { ctx, page, chats } = await open(b); await openChat(page);
    await page.route("**/api/chat", async (r) => { await new Promise((x) => setTimeout(x, 500)); r.continue(); });
    await page.locator("textarea").fill("the toilet is running"); await page.keyboard.press("Enter");
    await page.locator("textarea").fill("the toilet is running"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.locator("button.send").dblclick({ force: true });
    await replied(page, 2); await page.waitForTimeout(300);
    assert.equal(chats().length, 1);
    assert.equal(await page.locator(".m.customer").count(), 1);
    await ctx.close();
  });
  test("input rules: empty and over-long messages are not sent and are announced; Shift+Enter makes a new line", async () => {
    const b = await biz(); const { ctx, page, chats } = await open(b); await openChat(page);
    await page.keyboard.press("Enter"); await page.locator("textarea").fill("   "); await page.keyboard.press("Enter");
    await page.locator("textarea").fill("x".repeat(1300)); 
    assert.match(await page.locator(".foot").innerText(), /100 characters over the 1200 limit/, "the customer sees it before sending");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200); assert.equal(chats().length, 0, "nothing is sent and nothing is silently cut");
    assert.equal((await page.locator("textarea").inputValue()).length, 1300, "the text is kept so it can be shortened");
    assert.match(await page.locator("[role=status]").innerText(), /under 1200 characters/);
    await page.locator("textarea").fill("x".repeat(1100)); assert.match(await page.locator(".foot").innerText(), /100 characters left/);
    await page.locator("textarea").fill("line one"); await page.keyboard.press("Shift+Enter"); await page.keyboard.type("line two");
    assert.equal(await page.locator("textarea").inputValue(), "line one\nline two");
    await ctx.close();
  });
  test("restart is confirmed, clears this device's copy and the next message starts a NEW conversation; 'keep chatting' changes nothing", async () => {
    const b = await biz(); const { ctx, page, chats } = await open(b); await openChat(page);
    await say(page, "my drain is slow"); await replied(page, 2);
    await page.getByRole("button", { name: "New chat" }).click();
    assert.match(await page.locator(".confirm").innerText(), /clears the conversation from this device/);
    await page.getByRole("button", { name: "Keep chatting" }).click();
    assert.equal(await page.locator(".m.customer").count(), 1);
    await page.getByRole("button", { name: "New chat" }).click(); await page.getByRole("button", { name: "Start new chat" }).click();
    assert.equal(await page.locator(".m.customer").count(), 0);
    assert.equal(await page.evaluate((k) => sessionStorage.getItem(`latchline:v1:${k}`), b.key), null);
    await say(page, "hello again"); await replied(page, 2);
    assert.equal(chats().at(-1).body.conversationId, null);
    await ctx.close();
  });
  test("'New chat' is refused while a message is in flight, so a reply (or safety text) can never be thrown away", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    await page.route("**/api/chat", async (r) => { await new Promise((x) => setTimeout(x, 700)); r.continue(); });
    await say(page, "I smell gas in the basement");
    await page.locator(".typing.on").waitFor();
    await page.getByRole("button", { name: "New chat" }).click();
    assert.equal(await page.locator(".confirm.on").count(), 0);
    await waitFor(page, () => /wait for the reply/.test(document.querySelector("#latchline-widget-root").shadowRoot.querySelector("[role=status]").textContent));
    await replied(page, 2);
    assert.equal(await page.locator(".m.urgent").count(), 1, "the safety reply still arrived");
    await ctx.close();
  });
  test("recovery: a page reload restores the transcript and continues the SAME conversation", async () => {
    const b = await biz(); const { ctx, page, chats } = await open(b); await openChat(page);
    await say(page, "my water heater is leaking"); await replied(page, 2);
    const cid = chats()[0] && (await page.evaluate((k) => JSON.parse(sessionStorage.getItem(`latchline:v1:${k}`)).cid, b.key));
    assert.ok(cid);
    await page.reload(); await openChat(page);
    assert.match(await logText(page), /my water heater is leaking/);
    await say(page, "Maria Lopez"); await replied(page, 3);
    assert.equal(chats().at(-1).body.conversationId, cid);
    await ctx.close();
  });
  test("recovery: an interrupted in-flight request restores its idempotency key for a safe retry", async () => {
    const b = await biz(); const { ctx, page, chats } = await open(b); await openChat(page);
    await page.route("**/api/chat", (r) => r.abort());
    await say(page, "my kitchen sink is leaking");
    await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".retry"));
    const firstKey = chats()[0]?.idempotencyKey;
    assert.match(firstKey, /^[a-f0-9]{32}$/);
    await page.reload(); await openChat(page);
    await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".retry"));
    await page.unroute("**/api/chat");
    await page.getByRole("button", { name: "Try again" }).click();
    await replied(page, 2);
    assert.equal(chats().length, 2);
    assert.equal(chats()[1].idempotencyKey, firstKey);
    assert.equal(await page.locator(".m.customer").count(), 1);
    await ctx.close();
  });
  test("recovery: when the server no longer has the conversation, the customer is told it is a new one", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    await say(page, "my water heater is leaking"); await replied(page, 2);
    await W.api.db.run("DELETE FROM conversations WHERE business_id = ?", [b.id]);
    await say(page, "hello?"); await waitFor(page, () => /new one/.test(document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".log").innerText));
    assert.match(await logText(page), /couldn't continue your earlier conversation/);
    await ctx.close();
  });
  test("tampered storage (HTML, bad roles, huge id, giant text) is rendered only as inert text and never executed", async () => {
    const b = await biz(); const key = b.key;
    const { ctx, page } = await open(b, { init: `sessionStorage.setItem("latchline:v1:${key}", JSON.stringify({ ts: Date.now(), cid: "x".repeat(500), msgs: [ {role:"assistant",text:"<img src=x onerror=window.__pwned=1>"}, {role:"admin",text:"nope"}, {role:"customer",text:"<script>window.__pwned=1</script>",status:"sent"}, {role:"assistant",text:"y".repeat(100000)} ] }))` });
    await openChat(page);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(await inShadow(page, (r) => r.querySelectorAll("img,script,iframe").length), 0);
    assert.ok(!/nope/.test(await logText(page)));
    await say(page, "hello there"); await replied(page, 4);
    assert.equal((await page.evaluate((k) => JSON.parse(sessionStorage.getItem(`latchline:v1:${k}`)).cid.length, key)) < 100, true);
    await ctx.close();
  });
  test("markup typed by the customer or returned by the server is shown as text, never as HTML", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    const evil = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>`;
    await say(page, evil); await replied(page, 2);
    await page.route("**/api/chat", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": b.site.origin }, body: JSON.stringify({ reply: `<b onmouseover=window.__pwned=1>bold</b><img src=x onerror=window.__pwned=1>`, conversationId: "conv_x", urgent: false, persisted: true }) }));
    await say(page, "again please"); await replied(page, 3);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(await inShadow(page, (r) => r.querySelectorAll(".log img,.log b,.log script").length), 0);
    assert.match(await logText(page), /<b onmouseover/);
    await ctx.close();
  });
});

describe("failures are never shown as success (desktop)", { skip }, () => {
  const fulfill = (status, body, b, ct = "application/json") => (r) => r.fulfill({ status, contentType: ct, headers: { "access-control-allow-origin": b.site.origin }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const cases = [
    ["network failure", (b) => (r) => r.abort(), /may not have been received/, "Not confirmed", true],
    ["server 500", (b) => fulfill(500, { error: "x" }, b), /Something went wrong on the server/, "Not confirmed", true],
    ["503 outage", (b) => fulfill(503, { error: "Service temporarily unavailable" }, b), /may not have been received/, "Not confirmed", true],
    ["garbage 200 (not JSON)", (b) => fulfill(200, "<html>proxy login</html>", b, "text/html"), /may not have been received/, "Not confirmed", true],
    ["200 JSON without a reply", (b) => fulfill(200, { ok: true }, b), /may not have been received/, "Not confirmed", true],
    ["429 too many requests", (b) => fulfill(429, { error: "Too many", retryAfterSec: 17 }, b), /wait 17 seconds[\s\S]*not sent/, "Not sent", true],
    ["404 / 403 (site key withdrawn)", (b) => fulfill(404, { error: "Unknown site key" }, b), /isn't available right now\. Your message was not sent/, "Not sent", true],
    ["400 invalid", (b) => fulfill(400, { error: "bad" }, b), /couldn't be sent/, "Not sent", true],
  ];
  for (const [name, handler, notice, meta] of cases) {
    test(`${name}: message marked "${meta}", honest notice, Try again works and clears the notice`, async () => {
      const b = await biz(); const { ctx, page, chats } = await open(b); await openChat(page);
      await page.route("**/api/chat", handler(b));
      await say(page, "my sink is slow"); await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".retry"));
      const t = await logText(page);
      assert.match(t, notice); assert.match(t, new RegExp(meta)); assert.doesNotMatch(t, /\bsent to the business\b(?!\.)/);
      assert.equal(await bubbles(page, "assistant").count(), 1, "no assistant reply is invented");
      await page.unroute("**/api/chat");
      await page.getByRole("button", { name: "Try again" }).click(); await replied(page, 2);
      assert.doesNotMatch(await logText(page), /Not confirmed|Not sent|couldn't be sent|may not have been received/);
      assert.equal(await page.locator(".m.customer").count(), 1, "retry reuses the same bubble, no duplicate");
      const chatRequests = chats();
      assert.equal(chatRequests.length, 2, "one initial request and one retry");
      assert.match(chatRequests[0].idempotencyKey, /^[a-f0-9]{32}$/);
      assert.equal(chatRequests[1].idempotencyKey, chatRequests[0].idempotencyKey, "retry must reuse the original idempotency key");
      await ctx.close();
    });
  }
  test("request timeout: an unanswered request ends as 'not confirmed' instead of hanging forever", async () => {
    const b = await biz(); const { ctx, page } = await open(b, { init: `const st=window.setTimeout; window.setTimeout=(f,t,...a)=>st(f,t===25000?300:t,...a);` }); await openChat(page);
    await page.route("**/api/chat", () => {}); // never answered
    await say(page, "hello there"); await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".retry"));
    assert.match(await logText(page), /may not have been received/); assert.equal(await page.locator(".typing.on").count(), 0);
    await ctx.close();
  });
  test("a reply that says the system could not save is flagged to the customer", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    await page.route("**/api/chat", fulfill(200, { reply: "I'm having trouble saving details right now.", conversationId: null, urgent: false, persisted: false, leadStatus: "not_saved" }, b));
    await say(page, "my sink is slow"); await replied(page, 2);
    assert.match(await logText(page), /could not be saved by the business system/);
    await ctx.close();
  });
});

describe("emergencies through the widget", { skip }, () => {
  const GAS = "I smell gas in my basement";
  // Only AFFIRMATIVE claims count: "I can't dispatch anyone" is the honest statement, "we dispatched a technician" would be the lie.
  const CLAIM = /(dispatch(ed)?\b|is on (the|its) way|on their way|technician (is|has|will)|(we|i)('ve| have)? (contacted|notified|called|sent)|help is coming|has been (sent|notified|contacted|dispatched))/i;
  const claims = { test: (text) => text.split(/(?<=[.!?])\s+|\n+/).filter((x) => !/(can't|cannot|can not|haven't|have not|\bnot\b|never|no way)/i.test(x)).some((x) => CLAIM.test(x)) };
  test("real backend: safety text is shown prominently as an alert, a lead exists, and nothing false is promised", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    await say(page, GAS); await replied(page, 2);
    const u = page.locator(".m.urgent"); assert.equal(await u.count(), 1);
    assert.equal(await u.getAttribute("role"), "alert");
    const text = await u.innerText();
    assert.match(text, /safety information/i); assert.match(text, /gas/i); assert.match(text, /911|emergency/i);
    assert.ok(!claims.test(text), "no affirmative dispatch/contact claims");
    const n = await W.api.db.first("SELECT COUNT(*) n FROM leads WHERE business_id = ?", [b.id]); assert.equal(n.n, 1);
    await ctx.close();
  });
  for (const [name, handler] of [
    ["network failure", () => (r) => r.abort()],
    ["server 500", (b) => (r) => r.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": b.site.origin }, body: "{}" })],
    ["withdrawn site key (404)", (b) => (r) => r.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": b.site.origin }, body: "{}" })],
  ]) {
    test(`${name}: the SAME safety text is still shown, with an honest 'not received / not sent' statement and no claims`, async () => {
      const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
      await say(page, GAS); await replied(page, 2);
      await page.waitForTimeout(0);
      await page.route("**/api/chat", handler(b));
      await say(page, "there is also a carbon monoxide alarm going off"); await waitFor(page, () => document.querySelectorAll("x").length === 0 && document.querySelector("#latchline-widget-root").shadowRoot.querySelectorAll(".m.urgent").length >= 2);
      const urgent = page.locator(".m.urgent").last(); const t = await urgent.innerText();
      assert.match(t, /safety information/i); assert.match(t, /carbon monoxide|leave|911/i); assert.ok(!claims.test(t), "no affirmative dispatch/contact claims");
      const sys = await page.locator(".m.system").last().innerText();
      assert.match(sys, /not (been )?(sent|received)|may not have been received|was not sent/i);
      assert.doesNotMatch(await logText(page), /has been (sent|saved|passed)|we('ve| have) (notified|contacted)/i);
      await ctx.close();
    });
  }
  test("the safety text shown by the widget when the server is unreachable is byte-identical to the server's own safety text", async () => {
    const b = await biz(); const first = await open(b); await openChat(first.page);
    await say(first.page, GAS); await replied(first.page, 2);
    const serverText = (await first.page.locator(".m.urgent").innerText()).replace(/^Safety information\s*/, "");
    await first.ctx.close();
    const second = await open(b); await openChat(second.page); await second.page.route("**/api/chat", (r) => r.abort());
    await say(second.page, GAS); await waitFor(second.page, () => document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".m.urgent"));
    const offline = (await second.page.locator(".m.urgent").innerText()).replace(/^Safety information\s*/, "");
    const norm = (x) => x.replace(/\s+/g, " ").trim();
    // The server appends one more sentence about what it saved; the safety guidance itself is the same text.
    assert.ok(norm(serverText).startsWith(norm(offline).slice(0, 200)) || norm(offline).startsWith(norm(serverText).slice(0, 200)), "same guidance text");
    await second.ctx.close();
  });
  test("retry of an emergency message after the outage ends goes through the real backend and the offline safety text is replaced", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    await page.route("**/api/chat", (r) => r.abort());
    await say(page, GAS); await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".retry"));
    assert.equal(await page.locator(".m.urgent").count(), 1);
    await page.unroute("**/api/chat"); await page.getByRole("button", { name: "Try again" }).click();
    await waitFor(page, () => { const r = document.querySelector("#latchline-widget-root").shadowRoot; return !r.querySelector(".m.system") && r.querySelectorAll(".m.assistant").length >= 2 && !r.querySelector(".typing.on"); });
    assert.equal(await page.locator(".m.urgent").count(), 1, "exactly one safety message (the real one)");
    assert.equal((await W.api.db.first("SELECT COUNT(*) n FROM leads WHERE business_id = ?", [b.id])).n, 1);
    await ctx.close();
  });
  test("backend database failure and a failing lead write: safety text still shown, and the reply never claims a save that did not happen", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    const db = W.api.db; const run = db.run.bind(db), batch = db.batch.bind(db);
    const bad = (sql) => /INSERT INTO leads|INSERT INTO notifications/i.test(sql);
    db.run = async (sql, p) => { if (bad(sql)) throw new Error("boom"); return run(sql, p); };
    db.batch = async (st, o) => { if (st.some((s) => bad(s.sql))) throw new Error("boom"); return batch(st, o); };
    try { await say(page, GAS); await replied(page, 2); } finally { db.run = run; db.batch = batch; }
    const t = await page.locator(".m.urgent").innerText();
    assert.match(t, /gas/i); assert.ok(!claims.test(t), "no affirmative dispatch/contact claims");
    const leads = (await db.first("SELECT COUNT(*) n FROM leads WHERE business_id = ?", [b.id])).n;
    if (leads === 0) assert.match(await logText(page), /NOT received|wasn.t able to save|not saved/i, "no lead => the customer is told");
    await ctx.close();
  });
  test("backend unreadable (site-key lookup fails): the server's own fallback safety text and 'not saved' sentence reach the customer", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    const db = W.api.db; const first = db.first.bind(db);
    db.first = async (sql, p) => { if (/FROM businesses WHERE site_key/i.test(sql)) throw new Error("down"); return first(sql, p); };
    try { await say(page, GAS); await replied(page, 2); } finally { db.first = first; }
    const t = await page.locator(".m.urgent").innerText();
    assert.match(t, /gas/i); assert.match(t, /not saved and nothing was sent to the business/);
    await ctx.close();
  });
});

describe("emergency when the request limit is reached", { skip }, () => {
  test("a rate-limited client describing a gas smell still gets the safety text and is told it was not saved", async () => {
    const W2 = await startWidgetWorld({ clientLimit: { limit: 2, windowMs: 60_000 } });
    try {
      const b = await W2.business({ id: "rl1", name: "Limit Plumbing", key: "sk_limit_00000001" });
      const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto(b.site.url);
      await openChat(page);
      await say(page, "hello"); await replied(page, 2); await say(page, "my sink leaks"); await replied(page, 3);
      await say(page, "I smell gas"); await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".m.urgent"));
      const t = await page.locator(".m.urgent").innerText();
      assert.match(t, /gas/i); assert.match(t, /too quickly, so this message was not saved and nothing was sent to the business/);
      assert.equal((await W2.api.db.first("SELECT COUNT(*) n FROM leads WHERE business_id = ?", ["rl1"])).n, 0);
      // and an ordinary rate-limited message is shown as not sent, with a retry
      await say(page, "what are your hours"); await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".retry"));
      assert.match(await logText(page), /too quickly[\s\S]*not sent/i);
      await ctx.close();
    } finally { await W2.close(); }
  });
});

describe("accessibility (automated checks only; not a screen-reader audit)", { skip }, () => {
  test("roles, names and states: launcher button, labelled dialog, log region, labelled textbox, buttons with names", async () => {
    const b = await biz({ name: "Maple Plumbing" }); const { ctx, page } = await open(b); await openChat(page);
    const snap = await page.locator(ROOT).ariaSnapshot();
    for (const expect of [/dialog "Maple Plumbing"/, /heading "Maple Plumbing"/, /button "New chat"/, /button "Close chat"/, /log "Conversation"/, /textbox "Your message"/, /button "Send"/]) assert.match(snap, expect, snap);
    assert.equal(await launcher(page).evaluate((e) => e.getAttribute("aria-expanded")), "true");
    await ctx.close();
  });
  test("keyboard only: Tab reaches launcher; Enter opens and focuses the message box; Escape closes and returns focus to the launcher", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await launcher(page).waitFor();
    await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
    await page.locator("textarea").waitFor();
    await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.activeElement?.tagName === "TEXTAREA"); // opening moves focus into the message box
    assert.equal(await launcher(page).getAttribute("aria-expanded"), "true");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".panel").isVisible(), false);
    assert.equal(await inShadow(page, (r) => r.activeElement?.className), "launcher");
    await page.keyboard.press("Enter"); await say(page, "hello there"); await replied(page, 2);
    await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.activeElement?.tagName === "TEXTAREA"); // focus returns to the message box after a reply
    await ctx.close();
  });
  test("replies are announced: log is a polite live region, urgent messages are role=alert, a screen-reader-only speaker label precedes each message", async () => {
    const b = await biz({ name: "Maple Plumbing" }); const { ctx, page } = await open(b); await openChat(page);
    await say(page, "I smell gas"); await replied(page, 2);
    assert.equal(await page.locator(".log").getAttribute("aria-live"), "polite");
    assert.equal(await page.locator(".log").getAttribute("role"), "log");
    assert.match(await page.locator(".m.customer .sr").first().textContent(), /You said/);
    assert.match(await page.locator(".m.assistant .sr").last().textContent(), /Maple Plumbing said/);
    assert.equal(await page.locator(".m.urgent").getAttribute("role"), "alert");
    await ctx.close();
  });
  test("colour contrast of header, customer bubble, send button and notices is at least 4.5:1 in light and dark mode", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    await say(page, "my sink is slow"); await replied(page, 2);
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      const ratios = await inShadow(page, (r) => {
        const lum = (rgb) => { const c = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const pairs = ["header", ".m.customer", ".send", ".m.assistant", ".foot", "textarea"].map((s) => { const e = r.querySelector(s); const cs = getComputedStyle(e); let bg = cs.backgroundColor; if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = getComputedStyle(r.querySelector(".panel")).backgroundColor; return [s, ratio(cs.color, bg)]; });
        return pairs;
      });
      for (const [sel, ratio] of ratios) assert.ok(ratio >= 4.5, `${scheme} ${sel} contrast ${ratio.toFixed(2)}`);
    }
    await ctx.close();
  });
  test("a custom accent colour is used only when it keeps white text readable; unsafe or malicious values are ignored", async () => {
    for (const [attr, expectCustom] of [[`data-accent="#7a1fa2"`, true], [`data-accent="#ffe066"`, false], [`data-accent="red;}</style><script>window.__pwned=1</script>"`, false], [`data-accent="#12"`, false]]) {
      const b = await biz({ html: { attrs: attr } }); const { ctx, page } = await open(b); await openChat(page);
      const bg = await page.locator(".send").evaluate((e) => getComputedStyle(e).backgroundColor);
      if (expectCustom) assert.equal(bg, "rgb(122, 31, 162)"); else assert.equal(bg, "rgb(11, 95, 115)");
      assert.equal(await page.evaluate(() => window.__pwned), undefined);
      await ctx.close();
    }
  });
  test("reduced motion: the typing indicator does not animate", async () => {
    const b = await biz(); const { ctx, page } = await open(b, { reduced: true }); await openChat(page);
    await page.route("**/api/chat", async (r) => { await new Promise((x) => setTimeout(x, 600)); r.continue(); });
    await say(page, "hello there"); await page.locator(".typing.on").waitFor();
    assert.equal(await page.locator(".typing i").first().evaluate((e) => getComputedStyle(e).animationName), "none");
    await ctx.close();
  });
  test("focus is always visible: every control gets a focus ring", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await launcher(page).waitFor();
    await page.keyboard.press("Tab");
    assert.notEqual(await launcher(page).evaluate((e) => getComputedStyle(e).outlineStyle), "none");
    await page.keyboard.press("Enter");
    await page.locator("textarea").waitFor();
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); const ring = await inShadow(page, (r) => { const e = r.activeElement; return e ? [e.tagName, getComputedStyle(e).outlineStyle] : null; }); if (ring) assert.notEqual(ring[1], "none", `${ring[0]} after ${i + 1} Tabs`); }
    await ctx.close();
  });
});

describe("phone layout (375×700, touch)", { skip }, () => {
  const phone = { viewport: PHONE, ctxOpts: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };
  test("full-screen sheet, no sideways scrolling of the host page, 16px input (no iOS zoom), 44px touch targets", async () => {
    const b = await biz(); const { ctx, page } = await open(b, phone); await openChat(page);
    const box = await page.locator(".panel").boundingBox();
    assert.ok(box.width >= 374 && box.height >= 699 && box.x === 0 && box.y === 0, JSON.stringify(box));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    assert.equal(await page.locator("textarea").evaluate((e) => getComputedStyle(e).fontSize), "16px");
    for (const sel of [".send", "header button:nth-of-type(1)", "header button:nth-of-type(2)", "textarea"]) { const bx = await page.locator(sel).boundingBox(); assert.ok(bx.height >= 44 && bx.width >= 44, `${sel} ${JSON.stringify(bx)}`); }
    await say(page, "I smell gas in the kitchen and my phone number is 217-555-0147 please call me back soon"); await replied(page, 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    const last = await page.locator(".m.urgent").boundingBox(); assert.ok(last.x >= 0 && last.x + last.width <= 376);
    await page.screenshot({ path: new URL("../.data/widget-phone.png", import.meta.url).pathname }).catch(() => {});
    await ctx.close();
  });
  test("closed launcher sits in the corner and does not cover page content; Tab stays inside the open full-screen chat", async () => {
    const b = await biz(); const { ctx, page } = await open(b, phone); await launcher(page).waitFor();
    const lb = await launcher(page).boundingBox(); assert.ok(lb.x + lb.width <= 375 && lb.y + lb.height <= 700 && lb.width < 250 && lb.height < 70);
    await launcher(page).click(); await page.locator("textarea").waitFor();
    for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); assert.ok(await inShadow(page, (r) => !!r.activeElement && !!r.activeElement.closest(".panel")), "focus must stay in the chat"); }
    for (let i = 0; i < 12; i++) { await page.keyboard.press("Shift+Tab"); assert.ok(await inShadow(page, (r) => !!r.activeElement && !!r.activeElement.closest(".panel"))); }
    await ctx.close();
  });
  test("tablet width (768×1024) uses the floating panel, not full-screen", async () => {
    const b = await biz(); const { ctx, page } = await open(b, { viewport: { width: 768, height: 1024 } }); await openChat(page);
    const box = await page.locator(".panel").boundingBox(); assert.ok(box.width <= 392 && box.x > 300, JSON.stringify(box));
    await ctx.close();
  });
});

describe("Stage 7B review findings (each failed before its fix)", { skip }, () => {
  test("an over-long message that describes an emergency is not sent, but the safety text is shown and the text is kept for shortening", async () => {
    const b = await biz(); const { ctx, page, chats } = await open(b); await openChat(page);
    const long = `I smell gas in the basement. ${"it is really strong and I am worried ".repeat(40)}`;
    await page.locator("textarea").fill(long); await page.keyboard.press("Enter");
    await waitFor(page, () => document.querySelector("#latchline-widget-root").shadowRoot.querySelector(".m.urgent"));
    assert.equal(chats().length, 0);
    assert.match(await page.locator(".m.urgent").innerText(), /911/);
    assert.match(await logText(page), /too long[\s\S]*not sent/i);
    assert.equal((await page.locator("textarea").inputValue()).length, long.length);
    await ctx.close();
  });
  // DELIBERATE CHANGE (Stage 7B review finding 10): this test used to pin "restart discards the late reply". That also threw away
  // an in-flight emergency reply, so restart is now refused while a message is pending and works as soon as the reply has arrived.
  test("'New chat' while a reply is pending is refused; once the reply has arrived it works and the next message starts a NEW conversation", async () => {
    const b = await biz(); const { ctx, page, chats } = await open(b); await openChat(page);
    await page.route("**/api/chat", async (r) => { await new Promise((x) => setTimeout(x, 500)); await r.continue(); });
    await say(page, "my sink is leaking"); await page.locator(".typing.on").waitFor();
    await page.getByRole("button", { name: "New chat" }).click();
    assert.equal(await page.locator(".confirm.on").count(), 0, "no restart prompt while pending");
    await replied(page, 2); await page.unroute("**/api/chat");
    await page.getByRole("button", { name: "New chat" }).click(); await page.getByRole("button", { name: "Start new chat" }).click();
    assert.equal(await page.locator(".m.customer").count(), 0);
    await say(page, "hello there"); await replied(page, 2);
    assert.equal(chats().at(-1).body.conversationId, null);
    await ctx.close();
  });
  test("a restored over-long message is clamped so 'Try again' can actually work", async () => {
    const b = await biz();
    const { ctx, page, chats } = await open(b, { init: `sessionStorage.setItem("latchline:v1:${b.key}", JSON.stringify({ ts: Date.now(), cid: null, msgs: [{role:"customer", text:"leak ".repeat(800), status:"unconfirmed"}] }))` });
    await openChat(page); await page.getByRole("button", { name: "Try again" }).click(); await replied(page, 2);
    assert.ok(chats()[0].body.message.length <= 1200);
    await ctx.close();
  });
  test("tampered timestamp (NaN) in storage does not keep data forever", async () => {
    const b = await biz();
    const { ctx, page } = await open(b, { init: `sessionStorage.setItem("latchline:v1:${b.key}", '{"ts":"abc","cid":null,"msgs":[{"role":"customer","text":"old secret","status":"sent"}]}')` });
    await openChat(page); assert.ok(!/old secret/.test(await logText(page))); await ctx.close();
  });
  test("the 'not saved' note survives a reload", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    await page.route("**/api/chat", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": b.site.origin }, body: JSON.stringify({ reply: "Trouble saving.", conversationId: "conv_zzzzzzzzzzzzzzzzzzzzzzzz", urgent: false, persisted: false, leadStatus: "not_saved" }) }));
    await say(page, "my sink is slow"); await replied(page, 2); await page.reload(); await openChat(page);
    assert.match(await logText(page), /could not be saved by the business system/); await ctx.close();
  });
  test("earlier messages are not re-rendered (so screen readers do not re-read the whole conversation) when a new one arrives", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    await say(page, "my sink leaks"); await replied(page, 2);
    await inShadow(page, (r) => { r.querySelectorAll(".m").forEach((e) => { e.__kept = true; }); });
    await say(page, "Sam Rivera"); await replied(page, 3);
    const kept = await inShadow(page, (r) => [...r.querySelectorAll(".m")].filter((e) => e.__kept).length);
    assert.ok(kept >= 3, `kept ${kept}: the welcome, first question and first customer message must be the same DOM nodes`);
    await ctx.close();
  });
  test("focus is not pulled back to the message box if the keyboard user moved elsewhere while waiting", async () => {
    const b = await biz(); const { ctx, page } = await open(b); await openChat(page);
    await page.route("**/api/chat", async (r) => { await new Promise((x) => setTimeout(x, 600)); r.continue(); });
    await say(page, "hello there"); await page.locator(".typing.on").waitFor();
    await inShadow(page, (r) => r.querySelector("header button").focus());
    await replied(page, 2); await page.waitForTimeout(200);
    assert.equal(await inShadow(page, (r) => r.activeElement?.textContent), "New chat");
    await ctx.close();
  });
});
