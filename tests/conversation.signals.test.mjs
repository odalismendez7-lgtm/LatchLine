import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { analyze, fingerprint } from "../src/engine/signals.js";

const yes = (flag, list) => { for (const m of list) assert.ok(analyze(m)[flag], `${flag} should fire: ${m}`); };
const no = (flag, list) => { for (const m of list) assert.ok(!analyze(m)[flag], `${flag} should NOT fire: ${m}`); };

describe("signals: frustration", () => {
  test("bot-directed anger is strong (2)", () => {
    for (const m of ["you are useless", "this is a waste of my time", "I give up", "are you even listening", "this chat is garbage", "you're not helping", "worst bot ever, useless bot"]) assert.equal(analyze(m).frustration, 2, m);
  });
  test("mild annoyance is mild (1); two mild signs add up to strong", () => {
    for (const m of ["I already told you my name", "stop asking me that", "that's annoying"]) assert.equal(analyze(m).frustration, 1, m);
    assert.equal(analyze("I already told you!!! stop asking").frustration, 2);
  });
  test("plumbing talk and ordinary words are NOT frustration", () => {
    for (const m of ["my kitchen faucet keeps dripping", "the pipe burst and it's a mess", "I need someone today", "hello", "what are your hours?", "512-555-0142", "Jane Doe", "yes", "it can wait", "the water heater is old and stupid loud"]) assert.equal(analyze(m).frustration, 0, m);
  });
  test("a bare swear about the fixture is only mild, not a handoff trigger", () => {
    assert.equal(analyze("my damn sink is clogged").frustration, 1);
  });
  test("ALL CAPS shouting counts as one mild sign; short caps (ZIP, ASAP) do not", () => {
    assert.equal(analyze("WHY IS THIS SO HARD TO DO").frustration, 1);
    assert.equal(analyze("PLEASE CALL ME ASAP").frustration, 1);
    assert.equal(analyze("ASAP").frustration, 0);
    assert.equal(analyze("OK").frustration, 0);
  });
});

describe("signals: confusion, why, identity", () => {
  test("confusion", () => {
    yes("confusion", ["what do you mean?", "I don't understand", "I'm confused", "can you explain that", "huh", "?", "what is the zip for"]);
    no("confusion", ["what is a good plumber for a leak", "my sink is clogged", "512-555-0142"]);
  });
  test("why do you need that", () => {
    yes("whyAsked", ["why do you need my phone number?", "what is the zip for", "why is that needed"]);
    no("whyAsked", ["what are your hours", "my sink is clogged"]);
  });
  test("identity", () => {
    yes("identity", ["are you a bot?", "am I talking to a real person", "is this a robot", "are you human"]);
    no("identity", ["my robot vacuum flooded the bathroom", "what are your hours"]);
  });
});

describe("signals: things the assistant cannot do or see", () => {
  test("status / dispatch / booking / change asks", () => {
    yes("status", ["when will someone arrive?", "is someone coming?", "has anyone called me back", "any update on my request", "how soon can you get here", "did you send someone"]);
    yes("dispatch", ["send a plumber out now", "I need someone out here right now", "send someone over"]);
    yes("booking", ["book me an appointment", "can I schedule a visit", "I want to make an appointment"]);
    yes("change", ["cancel my appointment", "reschedule my visit", "change my booking"]);
    yes("actionAsk", ["when will you arrive", "book a visit", "send a plumber now", "cancel the appointment"]);
  });
  test("ordinary talk is not an action ask", () => {
    no("actionAsk", ["my sink is clogged", "what are your hours", "Jane Doe", "512-555-0142", "62701", "it can wait", "the plumber who came last time left a mess"]);
  });
});

describe("signals: conversation control", () => {
  test("reset / abandon / false alarm", () => {
    yes("reset", ["start over", "let's begin again", "scratch that"]);
    yes("abandon", ["never mind", "nvm", "forget it", "I'll call someone else", "that's all", "bye"]);
    yes("falseAlarm", ["false alarm", "it stopped already", "everything is fine now", "I shut it off", "it was nothing", "it stopped on its own"]);
    no("reset", ["my sink is clogged"]);
    no("abandon", ["my sink is clogged", "what are your hours"]);
    no("falseAlarm", ["I smell gas", "my sink is clogged"]);
  });
  test("corrections and wrong values", () => {
    yes("correction", ["actually my name is Sam Lee", "I meant 62702", "no, it's 512-555-0199", "wait my zip is 62702", "sorry, it's 512-555-0199"]);
    yes("wrongValue", ["that's not my phone number", "wrong zip", "the number is wrong"]);
    no("correction", ["my sink is clogged", "512-555-0142"]);
  });
  test("skip / don't know / yes / no / ack / thanks / greeting", () => {
    yes("skip", ["skip", "skip that", "I'd rather not say", "prefer not to share", "no thanks"]);
    yes("dontKnow", ["I don't know", "idk", "not sure"]);
    yes("yes", ["yes", "yes please", "sure", "ok", "sounds good"]);
    yes("no", ["no", "no thanks", "nope", "not now"]);
    yes("thanks", ["thanks", "thank you so much", "gracias", "ok thanks"]);
    yes("greeting", ["hi", "hello there", "Good morning", "hola", "hey!"]);
    yes("ack", ["ok", "hmm", "got it"]);
    no("greeting", ["hi, my sink is clogged", "hello I need a plumber for a clogged drain"]);
    no("thanks", ["thanks but my sink is still clogged and I need help"]);
  });
  test("summary asks", () => {
    yes("summaryAsk", ["what do you have so far?", "what did I tell you", "read it back", "summarize"]);
    no("summaryAsk", ["my sink is clogged"]);
  });
  test("noise and empty-ish input", () => {
    yes("noise", ["???", "....", "aaaaaaaaa", "🙂🙂", "bcdfghjk"]);
    no("noise", ["ok", "62701", "a leak", "no"]);
  });
});

describe("signals: robustness", () => {
  test("never throws on odd input and always returns the same shape", () => {
    const keys = Object.keys(analyze("hello")).sort();
    for (const v of ["", " ", null, undefined, 5, {}, [], "x".repeat(100000), "\u0000​", "💥".repeat(500), "a ".repeat(10000), "(((((", "\\", "'\"`<>&"]) {
      const a = analyze(v);
      assert.deepEqual(Object.keys(a).sort(), keys);
    }
  });
  test("is fast on long adversarial input (no catastrophic regex backtracking)", () => {
    const t0 = performance.now();
    for (const s of ["a".repeat(20000), ("when " + "a ".repeat(300)), ("what's " + "that ".repeat(200)), "!".repeat(20000), ("I already " + "told ".repeat(300)), "ABC ".repeat(5000)]) analyze(s);
    assert.ok(performance.now() - t0 < 1500, `took ${performance.now() - t0}ms`);
  });
  test("fingerprint ignores case, punctuation and spacing", () => {
    assert.equal(fingerprint("  What are YOUR hours?? "), fingerprint("what are your hours"));
    assert.notEqual(fingerprint("hours"), fingerprint("prices"));
  });
});

describe("signals: false positives found in review", () => {
  test("plumbing words that look like control words", () => {
    no("reset", ["I had to reset the breaker on my water heater", "the reset button is tripped", "I need to restart the pump"]);
    no("abandon", ["I tried plunging and nothing else works", "I will call my landlord too, ZIP 62701", "that's all the water that came out of the tap in an hour"]);
    yes("abandon", ["nothing else", "that's all", "I'll call someone else", "never mind"]);
    no("falseAlarm", ["I shut the water off but it is still pouring"]);
    assert.equal(analyze("its a hell of a leak").frustration, 0);
    assert.equal(analyze("The toilet is clogged again? Same thing as last month, it isn't working").frustration, 0);
  });
});
