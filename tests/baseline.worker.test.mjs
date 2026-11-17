// Baseline (characterization) tests for the Stage 0 prototype Worker.
//
// Purpose: record what the existing code ACTUALLY does today.
// - Normal tests assert behavior we rely on and that currently works.
// - Tests marked `todo` assert behavior LATCHLINE requires but the prototype
//   does not yet provide. They are expected to fail today; node:test reports
//   them as TODO rather than hiding them. When a feature is built, remove the
//   `todo` flag so it becomes a hard requirement.
//
// Run with: npm test   (uses Node's built-in test runner, no dependencies)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../src/index.js";

const ALLOWED = "https://odalismendez7-lgtm.github.io";

function chat(message, origin = ALLOWED) {
  return worker.fetch(
    new Request("https://api.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ message }),
    })
  );
}

async function urgent(message) {
  const res = await chat(message);
  assert.equal(res.status, 200);
  return (await res.json()).urgent;
}

// ---------- Behavior that works today ----------

test("health endpoint reports prototype mode honestly", async () => {
  const res = await worker.fetch(new Request("https://api.test/health"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.mode, "prototype");
  assert.equal(body.realAIConnected, false);
  assert.equal(body.databaseConnected, false);
});

test("chat from an allowed origin returns a reply", async () => {
  const res = await chat("My kitchen faucet drips");
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(typeof body.reply, "string");
  assert.equal(body.urgent, false);
  assert.match(body.notice, /No real AI/);
});

test("chat from a disallowed origin is rejected", async () => {
  const res = await chat("hello", "https://evil.example");
  assert.equal(res.status, 403);
});

test("empty message is rejected", async () => {
  assert.equal((await chat("   ")).status, 400);
});

test("over-long message (>1200 chars) is rejected", async () => {
  assert.equal((await chat("a".repeat(1201))).status, 400);
});

test("invalid JSON is rejected", async () => {
  const res = await worker.fetch(
    new Request("https://api.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED },
      body: "{not json",
    })
  );
  assert.equal(res.status, 400);
});

test("unknown route returns 404", async () => {
  const res = await worker.fetch(new Request("https://api.test/nope"));
  assert.equal(res.status, 404);
});

test("CORS preflight from a disallowed origin is not granted", async () => {
  const res = await worker.fetch(
    new Request("https://api.test/api/chat", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    })
  );
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "null");
});

test("explicit gas-leak phrase is flagged urgent", async () => {
  assert.equal(await urgent("I think I have a gas leak"), true);
});

test("explicit flooding is flagged urgent", async () => {
  assert.equal(await urgent("My basement is flooding"), true);
});

test("non-emergency gas appliance question is not flagged urgent", async () => {
  assert.equal(await urgent("My gas water heater is not heating"), false);
});

test("replies never claim a submission, notification or dispatch happened", async () => {
  const messages = [
    "I need a plumber",
    "I have a gas leak",
    "burst pipe!",
    "please send someone now",
  ];
  for (const m of messages) {
    const body = await (await chat(m)).json();
    assert.doesNotMatch(
      body.reply,
      /(has been|have been|was|were) (submitted|sent|notified|dispatched|booked)/i,
      `unexpected success claim for: ${m}`
    );
  }
});

// ---------- Required behavior NOT yet implemented (expected to fail today) ----------

test("emergency detection: 'I smell gas' phrasing is urgent", async () => {
  assert.equal(await urgent("I smell gas in my kitchen"), true);
});

test("emergency detection: carbon monoxide detector beeping is urgent", async () => {
  assert.equal(await urgent("My CO detector is going off"), true);
});

test("emergency detection: sewage backup is urgent", async () => {
  assert.equal(await urgent("Sewage is coming up through my basement floor drain"), true);
});

test("no false emergency on an incidental 'electrical' mention", async () => {
  assert.equal(await urgent("My electrical panel is fine but my sink drains slowly"), false);
});

test("missing business info (hours) is acknowledged and human help offered", async () => {
  const body = await (await chat("What are your hours?")).json();
  assert.match(body.reply, /confirm|don't want to give you incorrect|business team/i);
});

test("chat endpoint rate-limits a burst from one client", { todo: "no rate limiting exists" }, async () => {
  const statuses = [];
  for (let i = 0; i < 60; i++) statuses.push((await chat("hello")).status);
  assert.ok(statuses.includes(429), "expected at least one HTTP 429");
});

test("demo page actually calls the backend /api/chat", { todo: "index.html uses a local scripted flow and never calls the API" }, async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /\/api\/chat/);
});
