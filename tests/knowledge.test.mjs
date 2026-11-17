// Knowledge base tests: only VERIFIED facts may be stated; anything missing or
// unverified is reported as unknown; businesses are strictly isolated.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateKnowledgeBase,
  isUsableFact,
  UNKNOWN_TEXT,
  groundingFor,
  verifiedProcedureOverrides,
} from "../src/knowledge/schema.js";
import { retrieve } from "../src/knowledge/retrieve.js";
import { KnowledgeStore } from "../src/knowledge/store.js";
import { demoAquaflowKb } from "../src/knowledge/demo-aquaflow.js";

const V = { verified: true, verifiedBy: "owner", verifiedAt: "2026-11-01" };

function kbA(overrides = {}) {
  return {
    schemaVersion: 1,
    businessId: "acme-plumbing",
    businessName: "Acme Plumbing",
    industry: "plumbing",
    facts: {
      hours: { value: "Mon-Fri 8am-5pm", ...V },
      service_area: { value: "Springfield area", zips: ["62701", "62702"], ...V },
      pricing: { value: "Pricing is quoted after an on-site visit.", ...V },
      appointments: { value: "Appointments are confirmed by our office by phone.", ...V },
      services: { value: ["Drain cleaning", "Water heater repair"], ...V },
      contact_phone: { value: "555-0100", ...V },
    },
    faqs: [
      { id: "faq-warranty", question: "Do you offer a warranty?", answer: "Workmanship is covered for 90 days.", keywords: ["warranty", "guarantee"], ...V },
    ],
    emergencyProcedures: {
      gas_leak: { text: "Acme approved: leave now and call 911.", ...V },
    },
    ...overrides,
  };
}

function kbB() {
  return {
    schemaVersion: 1,
    businessId: "bravo-plumbing",
    businessName: "Bravo Plumbing",
    industry: "plumbing",
    facts: {
      hours: { value: "BRAVO-SECRET-HOURS 24/7", ...V },
      contact_phone: { value: "555-9999", ...V },
    },
    faqs: [],
  };
}

describe("validation", () => {
  test("a well-formed knowledge base is valid", () => {
    assert.deepEqual(validateKnowledgeBase(kbA()), { ok: true, errors: [] });
  });
  test("demo knowledge base is valid", () => {
    assert.equal(validateKnowledgeBase(demoAquaflowKb).ok, true);
  });
  test("unknown fact key is rejected", () => {
    const kb = kbA();
    kb.facts.secret_discount = { value: "50%", ...V };
    assert.equal(validateKnowledgeBase(kb).ok, false);
  });
  test("verified fact without verifier or date is rejected", () => {
    const kb = kbA();
    kb.facts.hours = { value: "9-5", verified: true };
    assert.equal(validateKnowledgeBase(kb).ok, false);
  });
  test("verified fact with no value is rejected", () => {
    const kb = kbA();
    kb.facts.hours = { value: null, ...V };
    assert.equal(validateKnowledgeBase(kb).ok, false);
  });
  test("invalid business id is rejected", () => {
    assert.equal(validateKnowledgeBase(kbA({ businessId: "Bad ID!" })).ok, false);
  });
  test("bad ZIP in service area is rejected", () => {
    const kb = kbA();
    kb.facts.service_area.zips = ["1234"];
    assert.equal(validateKnowledgeBase(kb).ok, false);
  });
  test("duplicate FAQ ids are rejected", () => {
    const kb = kbA();
    kb.faqs.push({ ...kb.faqs[0] });
    assert.equal(validateKnowledgeBase(kb).ok, false);
  });
  test("non-object input is rejected, not thrown", () => {
    assert.equal(validateKnowledgeBase(null).ok, false);
    assert.equal(validateKnowledgeBase("x").ok, false);
  });
  test("isUsableFact requires verification, value, verifier and date", () => {
    assert.equal(isUsableFact({ value: "x", ...V }), true);
    assert.equal(isUsableFact({ value: "x", verified: false }), false);
    assert.equal(isUsableFact({ value: null, ...V }), false);
    assert.equal(isUsableFact({ value: "x", verified: true, verifiedBy: "", verifiedAt: "2026-11-01" }), false);
    assert.equal(isUsableFact(undefined), false);
  });
});

describe("retrieval: only verified facts are stated", () => {
  test("verified hours are answered", () => {
    const r = retrieve(kbA(), "What are your hours?");
    assert.equal(r.status, "answered");
    assert.match(r.results[0].text, /Mon-Fri 8am-5pm/);
    assert.equal(r.results[0].source.key, "hours");
  });

  test("missing information is reported unknown with the standard phrase", () => {
    const kb = kbA();
    delete kb.facts.hours;
    const r = retrieve(kb, "when are you open?");
    assert.equal(r.status, "unknown");
    assert.equal(r.results[0].reason, "missing");
    assert.equal(r.results[0].text, UNKNOWN_TEXT);
  });

  test("an UNVERIFIED value is never revealed", () => {
    const kb = kbA();
    kb.facts.hours = { value: "UNVERIFIED-9-to-9", verified: false };
    const r = retrieve(kb, "what time do you close?");
    assert.equal(r.status, "unknown");
    assert.equal(r.results[0].reason, "unverified");
    assert.doesNotMatch(JSON.stringify(r), /UNVERIFIED-9-to-9/);
  });

  test("pricing questions never produce numbers unless a verified fact has them", () => {
    const r = retrieve(demoAquaflowKb, "how much does a drain cleaning cost?");
    assert.equal(r.status, "unknown");
    assert.doesNotMatch(r.results[0].text, /\$|\d/);
  });

  test("appointment answers always state that a specific time cannot be confirmed", () => {
    const r = retrieve(kbA(), "Can I book an appointment for tomorrow?");
    assert.equal(r.status, "answered");
    assert.match(r.results[0].text, /can't confirm a specific appointment time/i);
  });

  test("ZIP inside the verified list is confirmed", () => {
    const r = retrieve(kbA(), "Do you service 62701?");
    assert.match(r.results[0].text, /62701/);
    assert.match(r.results[0].text, /verified service area/i);
  });

  test("ZIP outside the list is NOT declared unserved; it needs confirmation", () => {
    const r = retrieve(kbA(), "Do you cover 90210?");
    assert.match(r.results[0].text, /90210/);
    assert.match(r.results[0].text, /confirmed by the business team/i);
    assert.doesNotMatch(r.results[0].text, /we (do not|don't) (serve|service|cover)/i);
  });

  test("multiple questions in one message return multiple results", () => {
    const r = retrieve(kbA(), "what are your hours and how much do you charge?");
    assert.deepEqual(r.results.map((x) => x.intent).sort(), ["hours", "pricing"]);
  });

  test("verified FAQ is served by keyword", () => {
    const r = retrieve(kbA(), "is there a warranty on the work?");
    assert.equal(r.status, "answered");
    assert.match(r.results[0].text, /90 days/);
  });

  test("unverified FAQ is not served", () => {
    const kb = kbA();
    kb.faqs[0] = { ...kb.faqs[0], verified: false };
    const r = retrieve(kb, "is there a warranty on the work?");
    assert.doesNotMatch(JSON.stringify(r), /90 days/);
  });

  test("two equally good FAQ matches ask for clarification instead of guessing", () => {
    const kb = kbA();
    kb.faqs = [
      { id: "f1", question: "Senior discount?", answer: "A", keywords: ["discount"], ...V },
      { id: "f2", question: "Military discount?", answer: "B", keywords: ["discount"], ...V },
    ];
    const r = retrieve(kb, "do you have a discount?");
    assert.equal(r.status, "ambiguous");
  });

  test("a message that is not a knowledge question matches nothing", () => {
    const r = retrieve(kbA(), "my kitchen sink is dripping");
    assert.equal(r.status, "no_match");
    assert.deepEqual(r.results, []);
  });

  test("a request for a human maps to the human escalation fact (unknown in the demo)", () => {
    const r = retrieve(demoAquaflowKb, "I want to talk to a real person");
    assert.equal(r.results[0].intent, "human_escalation");
    assert.equal(r.results[0].text, UNKNOWN_TEXT);
  });

  test("demo knowledge base never states any business fact", () => {
    for (const q of [
      "what are your hours", "how much does it cost", "do you serve 12345",
      "what services do you offer", "can I get an appointment", "what is your phone number",
    ]) {
      const r = retrieve(demoAquaflowKb, q);
      assert.ok(["unknown", "partial"].includes(r.status) || r.results.every((x) => x.status === "unknown"), q);
      assert.doesNotMatch(JSON.stringify(r.results.map((x) => x.text)), /Leaking pipes|Drain cleaning|\$\d/);
    }
  });
});

describe("grounding and overrides", () => {
  test("grounding includes only usable facts and lists unknown ones", () => {
    const kb = kbA();
    kb.facts.pricing = { value: "HIDDEN", verified: false };
    const g = groundingFor(kb);
    assert.equal(g.facts.hours, "Mon-Fri 8am-5pm");
    assert.equal(g.facts.pricing, undefined);
    assert.ok(g.unknownFacts.includes("pricing"));
    assert.doesNotMatch(JSON.stringify(g), /HIDDEN/);
  });
  test("only verified emergency procedures are exposed as overrides", () => {
    const kb = kbA();
    kb.emergencyProcedures.flooding = { text: "unverified text", verified: false };
    const o = verifiedProcedureOverrides(kb);
    assert.ok(o.gas_leak);
    assert.equal(o.flooding, undefined);
  });
});

describe("business isolation", () => {
  test("a scoped handle answers only from its own business", () => {
    const store = new KnowledgeStore();
    store.add(kbA());
    store.add(kbB());
    const a = store.forBusiness("acme-plumbing");
    const b = store.forBusiness("bravo-plumbing");
    assert.match(a.retrieve("hours?").results[0].text, /Mon-Fri/);
    assert.match(b.retrieve("hours?").results[0].text, /BRAVO-SECRET-HOURS/);
    assert.doesNotMatch(JSON.stringify(a.retrieve("hours? and phone number? bravo plumbing")), /BRAVO|9999/);
    assert.doesNotMatch(JSON.stringify(a.grounding()), /BRAVO|9999/);
  });

  test("asking about another business by name does not reach its data", () => {
    const store = new KnowledgeStore();
    store.add(kbA());
    store.add(kbB());
    const a = store.forBusiness("acme-plumbing");
    const r = a.retrieve("what are Bravo Plumbing's hours? bravo-plumbing");
    assert.doesNotMatch(JSON.stringify(r), /BRAVO-SECRET/);
  });

  test("unknown business id throws instead of falling back to another business", () => {
    const store = new KnowledgeStore();
    store.add(kbA());
    assert.throws(() => store.forBusiness("nope"), /unknown_business/);
    assert.throws(() => store.forBusiness("../bravo-plumbing"), /unknown_business/);
    assert.throws(() => store.forBusiness(undefined), /unknown_business/);
  });

  test("the scoped handle exposes no way to reach the store or other businesses", () => {
    const store = new KnowledgeStore();
    store.add(kbA());
    store.add(kbB());
    const a = store.forBusiness("acme-plumbing");
    assert.equal(a.store, undefined);
    assert.deepEqual(Object.keys(a).sort(), ["businessId", "businessName", "grounding", "procedureOverrides", "retrieve"]);
    assert.ok(Object.isFrozen(a));
  });

  test("stored knowledge cannot be mutated through the original object or results", () => {
    const store = new KnowledgeStore();
    const kb = kbA();
    store.add(kb);
    kb.facts.hours.value = "TAMPERED";
    const a = store.forBusiness("acme-plumbing");
    assert.match(a.retrieve("hours?").results[0].text, /Mon-Fri/);
    const g = a.grounding();
    assert.throws(() => { g.facts.hours = "TAMPERED"; }, TypeError);
  });

  test("invalid or duplicate knowledge bases are refused", () => {
    const store = new KnowledgeStore();
    assert.throws(() => store.add({ businessId: "x" }), /invalid_knowledge_base/);
    store.add(kbA());
    assert.throws(() => store.add(kbA()), /duplicate_business/);
  });
});
