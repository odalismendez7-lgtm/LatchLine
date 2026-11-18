// Stage 3 safety additions: Spanish, water-heater hazards, unspecified emergencies.
// These close the two TODO gaps from Stage 2 (KI-12) and add false-alarm protection.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectEmergency, composeSafetyReply } from "../src/safety/detector.js";
import { plumbingPack } from "../src/packs/plumbing.js";

const detect = (m, opts) => detectEmergency(m, { pack: plumbingPack, ...opts });

const ES_MUST_FLAG = [
  ["mi casa huele a gas", "gas_leak"],
  ["hay una fuga de gas en la cocina", "gas_leak"],
  ["Huele a gas en el sótano", "gas_leak"],
  ["la alarma de monóxido de carbono está sonando", "carbon_monoxide"],
  ["el detector de CO suena sin parar", "carbon_monoxide"],
  ["se inundó el sótano", "flooding"],
  ["se reventó una tubería", "flooding"],
  ["no puedo cerrar el agua", "flooding"],
  ["hay agua por todos lados", "flooding"],
  ["aguas negras en la regadera", "sewage"],
  ["el inodoro se está desbordando", "sewage"],
  ["sale humo del calentador", "fire_smoke"],
  ["hay un incendio en la cocina", "fire_smoke"],
  ["hay chispas en el enchufe y agua en el piso", "electrical_hazard"],
  ["mi esposo está inconsciente", "life_threat"],
  ["mi hijo no puede respirar", "life_threat"],
  ["el calentador hace un golpeteo fuerte y sale vapor", "water_heater_hazard"],
  ["es una emergencia", "unspecified_emergency"],
];

const ES_MUST_NOT_FLAG = [
  "no hay fuga de gas, solo una llave que gotea",
  "quiero comprar un detector de monóxido de carbono",
  "¿atienden emergencias?",
  "¿cuánto cuesta el servicio de emergencia?",
  "estoy en una zona de inundación y quiero un presupuesto",
  "necesito instalar un calentador nuevo",
  "el fregadero drena lento",
  "¿cuál es su horario?",
];

const EN_NEW_MUST_FLAG = [
  ["my water heater is making a loud banging and steam is coming out", "water_heater_hazard"],
  ["the water heater is hissing and steaming", "water_heater_hazard"],
  ["steam is shooting out of the boiler", "water_heater_hazard"],
  ["the pressure relief valve is spraying hot water", "water_heater_hazard"],
  ["my daughter got scalded by the shower", "life_threat"],
  ["this is an emergency", "unspecified_emergency"],
  ["we have an emergency at the house", "unspecified_emergency"],
  ["something dangerous is happening in my basement", "unspecified_emergency"],
  ["I need to call 911 but wanted to tell you first", "unspecified_emergency"],
  ["someone could get hurt", "unspecified_emergency"],
  ["it is unsafe to be in the kitchen", "unspecified_emergency"],
  ["I hear a loud bang from the water heater", "water_heater_hazard"],
  ["the gas company said evacuate", "unspecified_emergency"],
];

const EN_NEW_MUST_NOT_FLAG = [
  "Do you handle emergency calls?",
  "what is your emergency service fee?",
  "how much is an emergency plumber after hours",
  "do you have emergency hours",
  "this is not an emergency, just a slow drain",
  "there is no emergency",
  "where is my emergency shutoff valve located",
  "my water heater is old and I want a quote for a new one",
  "my water heater makes a little noise sometimes",
  "the water heater temperature is too low",
  "is it dangerous to wait a week for a quote?",
  // Deliberate: steam boilers normally hiss; flagging them would cause constant false alarms (KI-12).
  "I have a steam boiler and want a maintenance quote",
  "the boiler needs annual service",
];

describe("Spanish emergencies are detected and answered in Spanish", () => {
  for (const [m, cat] of ES_MUST_FLAG) {
    test(`flags ${cat}: ${m}`, () => {
      const r = detect(m);
      assert.equal(r.emergency, true);
      assert.ok(r.categories.includes(cat), `expected ${cat}, got ${r.categories}`);
      assert.equal(r.language, "es");
      assert.match(r.reply, /Su seguridad es lo primero/);
      assert.doesNotMatch(r.reply, /Your safety comes first/);
    });
  }
  for (const m of ES_MUST_NOT_FLAG) {
    test(`no false alarm: ${m}`, () => {
      assert.equal(detect(m).emergency, false);
    });
  }
  test("Spanish gas reply tells the person to leave and call 911 from outside", () => {
    const r = detect("huele a gas");
    assert.match(r.reply, /salga/i);
    assert.match(r.reply, /911/);
    assert.match(r.reply, /afuera/i);
  });
  test("Spanish replies never promise arrival or dispatch", () => {
    for (const [m] of ES_MUST_FLAG) {
      assert.doesNotMatch(detect(m).reply, /(llegar[aá]|enviaremos|despacharemos|vamos para all[aá]|ya van)/i, m);
    }
  });
  test("Spanish follow-up states honestly that nothing was sent", () => {
    const r = detect("huele a gas");
    assert.match(composeSafetyReply(r, { leadSystemConnected: false }), /no he enviado nada/i);
  });
  test("Spanish negation and uncertainty", () => {
    assert.equal(detect("no hay fuga de gas").emergency, false);
    assert.equal(detect("no sé si hay una fuga de gas").emergency, true);
    assert.equal(detect("no, huele a gas").emergency, true);
  });
  test("a verified business procedure without a Spanish translation does not replace the Spanish default", () => {
    const r = detect("huele a gas", {
      procedureOverrides: { gas_leak: { text: "ENGLISH ONLY TEXT 911", verified: true, verifiedBy: "owner", verifiedAt: "2026-11-01" } },
    });
    assert.doesNotMatch(r.reply, /ENGLISH ONLY/);
    assert.equal(r.procedures[0].source, "pack_default");
  });
  test("a verified business procedure WITH a Spanish translation is used", () => {
    const r = detect("huele a gas", {
      procedureOverrides: { gas_leak: { text: "x 911", translations: { es: "TEXTO APROBADO. Salga ahora y llame al 911." }, verified: true, verifiedBy: "owner", verifiedAt: "2026-11-01" } },
    });
    assert.match(r.reply, /TEXTO APROBADO/);
    assert.equal(r.procedures[0].source, "business_verified");
  });
});

describe("closed gaps (previously TODO)", () => {
  for (const [m, cat] of EN_NEW_MUST_FLAG) {
    test(`flags ${cat}: ${m}`, () => {
      const r = detect(m);
      assert.equal(r.emergency, true);
      assert.ok(r.categories.includes(cat), `expected ${cat}, got ${r.categories}`);
      assert.equal(r.language, "en");
    });
  }
  for (const m of EN_NEW_MUST_NOT_FLAG) {
    test(`no false alarm: ${m}`, () => {
      assert.equal(detect(m).emergency, false, JSON.stringify(detect(m).categories));
    });
  }
  test("water heater hazard tells people to keep away and call 911 if anyone is hurt; never to repair it", () => {
    const r = detect("water heater banging and steam");
    assert.match(r.reply, /keep everyone away/i);
    assert.match(r.reply, /911/);
    assert.doesNotMatch(r.reply, /\b(turn|shut|drain|fix|repair|replace)\b/i);
  });
  test("unspecified emergency asks what is happening and mentions 911; makes no diagnosis", () => {
    const r = detect("this is an emergency");
    assert.equal(r.severity, "urgent");
    assert.match(r.reply, /911/);
    assert.match(r.reply, /what is happening/i);
  });
  test("a specific hazard outranks the unspecified fallback", () => {
    const r = detect("this is an emergency, I smell gas");
    assert.equal(r.categories[0], "gas_leak");
    assert.equal(r.severity, "life_safety");
  });
});

describe("mixed and adversarial input", () => {
  test("mixed English and Spanish still flags", () => {
    assert.equal(detect("please help, huele a gas").emergency, true);
  });
  test("accented and unaccented spellings both match", () => {
    assert.equal(detect("monoxido de carbono alarma sonando").emergency, true);
    assert.equal(detect("monóxido de carbono alarma sonando").emergency, true);
  });
  test("unicode lookalike or zero-width padding does not crash the detector", () => {
    assert.equal(typeof detect("g​as leak").emergency, "boolean");
    assert.equal(detect("I smell gas \u0000\u0001\u0002").emergency, true);
  });
  test("catastrophic-backtracking style input finishes quickly", () => {
    const t0 = Date.now();
    detect(("water " + "leak ").repeat(800) + " outlet");
    detect("a".repeat(5000));
    detect("(".repeat(5000));
    assert.ok(Date.now() - t0 < 1500);
  });
});
