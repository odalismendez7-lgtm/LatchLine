// Deterministic emergency detector ("safety layer").
//
// Runs BEFORE and independently of any AI model. It never calls a model, so an
// AI outage or a wrong model answer cannot delay or change safety guidance.
// Industry-specific rules and procedures come from an industry pack; language
// handling (negation, fixed messages) comes from ./languages.js.
//
// Design bias: when unsure, flag. A false alarm costs a moment of attention;
// a missed gas leak can cost a life. Known limits: docs/KNOWN_ISSUES.md (KI-12).

import { LANGUAGES, DEFAULT_LANGUAGE } from "./languages.js";

const MAX_INPUT_CHARS = 5000;
const CLAUSE_BREAK = /[,.;:!?]$/;

function normalize(text) {
  return text
    .slice(0, MAX_INPUT_CHARS)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip accents so "monóxido" and "monoxido" both match
    .replace(/[\u0000-\u001f\u007f​-‏⁠﻿]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// True when a negation directly governs the match (within 3 words, same clause)
// and no uncertainty word weakens it.
function isNegated(text, matchIndex, lang) {
  const L = LANGUAGES[lang] ?? LANGUAGES[DEFAULT_LANGUAGE];
  const before = text.slice(0, matchIndex).trimEnd();
  if (!before) return false;
  const tokens = before.split(" ");
  const window = [];
  for (let i = tokens.length - 1; i >= 0 && window.length < 3; i--) {
    const tok = tokens[i];
    if (CLAUSE_BREAK.test(tok)) break; // previous clause: does not apply
    window.push(tok);
  }
  if (window.length === 0) return false;
  const windowText = window.reverse().join(" ").replace(L.nonNegating, " ");
  const hasNegator = windowText.split(" ").some((t) => L.negators.has(t));
  if (!hasNegator) return false;
  return !L.uncertain.test(windowText);
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

function isVerifiedOverride(o) {
  return (
    o &&
    o.verified === true &&
    typeof o.verifiedBy === "string" &&
    o.verifiedBy.trim().length > 0 &&
    typeof o.verifiedAt === "string" &&
    !Number.isNaN(Date.parse(o.verifiedAt))
  );
}

const SEVERITY_RANK = { life_safety: 2, urgent: 1 };

function procedureFor(pack, category, lang, override) {
  const base = pack.procedures[category];
  const baseText =
    lang === DEFAULT_LANGUAGE ? base.text : base.translations?.[lang] ?? base.text;
  const baseLang = lang === DEFAULT_LANGUAGE || base.translations?.[lang] ? lang : DEFAULT_LANGUAGE;

  if (isVerifiedOverride(override)) {
    const own = lang === DEFAULT_LANGUAGE ? override.text : override.translations?.[lang];
    if (typeof own === "string" && own.trim() !== "") {
      let text = own.trim();
      // A business may reword guidance but can never drop the emergency-services
      // instruction for life-safety categories.
      if (base.callEmergencyServices && !/\b911\b/.test(text)) {
        const L = LANGUAGES[lang] ?? LANGUAGES[DEFAULT_LANGUAGE];
        text += L.messages.appendEmergencyNumber(pack.emergencyNumber);
      }
      return { category, severity: base.severity, text, lang, source: "business_verified" };
    }
  }
  return { category, severity: base.severity, text: baseText, lang: baseLang, source: "pack_default" };
}

/**
 * @param {string} message
 * @param {{ pack: object, procedureOverrides?: Record<string, object> }} options
 */
export function detectEmergency(message, { pack, procedureOverrides = {} } = {}) {
  if (!pack) throw new TypeError("detectEmergency requires an industry pack");

  const none = { emergency: false, severity: null, language: null, categories: [], matches: [], procedures: [], reply: "" };
  if (typeof message !== "string" || message.trim() === "") return none;

  const text = normalize(message);
  const matches = [];

  for (const rule of pack.rules) {
    const lang = rule.lang ?? DEFAULT_LANGUAGE;
    const exemptSpans = [];
    for (const ex of rule.exempt ?? []) {
      ex.lastIndex = 0;
      for (const m of text.matchAll(ex)) exemptSpans.push([m.index, m.index + m[0].length]);
    }
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      for (const m of text.matchAll(pattern)) {
        const start = m.index;
        const end = start + m[0].length;
        if (exemptSpans.some(([s, e]) => overlaps(start, end, s, e))) continue;
        if (isNegated(text, start, lang)) continue;
        matches.push({ ruleId: rule.id, category: rule.category, text: m[0], lang });
      }
    }
  }

  if (matches.length === 0) return none;

  const found = new Set(matches.map((m) => m.category));
  let categories = pack.categoryOrder.filter((c) => found.has(c));
  for (const c of found) if (!categories.includes(c)) categories.push(c);

  // The generic "someone says it's an emergency" fallback only stands alone: when a
  // specific hazard is found, the specific guidance replaces it.
  if (categories.length > 1) categories = categories.filter((c) => c !== "unspecified_emergency");

  // Reply language: the language of the highest-priority category's first match.
  const lang = matches.find((m) => m.category === categories[0])?.lang ?? DEFAULT_LANGUAGE;

  const procedures = categories.map((category) =>
    procedureFor(pack, category, lang, procedureOverrides[category])
  );

  const severity = procedures.reduce(
    (best, p) => (SEVERITY_RANK[p.severity] > SEVERITY_RANK[best] ? p.severity : best),
    "urgent"
  );

  const result = { emergency: true, severity, language: lang, categories, matches, procedures, reply: "" };
  result.reply = composeSafetyReply(result, { leadSystemConnected: false });
  return result;
}

/**
 * Builds the customer-facing safety message. Safety text comes first, in
 * priority order. The follow-up line never claims anything was sent, booked,
 * or dispatched.
 */
export function composeSafetyReply(result, { leadSystemConnected = false } = {}) {
  if (!result?.emergency) return "";
  const L = LANGUAGES[result.language] ?? LANGUAGES[DEFAULT_LANGUAGE];
  const ordered = [...result.procedures].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  );
  const body = ordered.map((p) => p.text).join("\n\n");
  const followUp = leadSystemConnected ? L.messages.followUpLead : L.messages.followUpNoLead;
  return `${L.messages.intro}\n\n${body}\n\n${followUp}`;
}
