// Deterministic emergency detector ("safety layer").
//
// Runs BEFORE and independently of any AI model. It never calls a model, so an
// AI outage or a wrong model answer cannot delay or change safety guidance.
// Industry-specific rules and procedures come from an industry pack.
//
// Design bias: when unsure, flag. A false alarm costs a moment of attention;
// a missed gas leak can cost a life. Known limits are documented in
// docs/KNOWN_ISSUES.md.

const MAX_INPUT_CHARS = 5000;

const NEGATORS = new Set([
  "no", "not", "never", "without", "nothing", "zero",
  "don't", "dont", "doesn't", "doesnt", "didn't", "didnt",
  "isn't", "isnt", "aren't", "arent", "wasn't", "wasnt",
  "haven't", "havent", "hasn't", "hasnt",
]);

// Words that make a nearby negation unreliable ("not sure if I smell gas").
const UNCERTAIN = /\b(?:sure|certain|know|think|thought|if|whether|maybe|might|possibly|could|wonder|unsure|suspect|probably)\b/;

// "not just/only/even X" and "without (any) warning/notice" are not negations of the hazard.
const NON_NEGATING = /\bnot (?:just|only|even)\b|\bwithout (?:any )?(?:warning|notice)\b/g;

const CLAUSE_BREAK = /[,.;:!?]$/;

function normalize(text) {
  return text
    .slice(0, MAX_INPUT_CHARS)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// True when a negation directly governs the match (within 3 words, same clause)
// and no uncertainty word weakens it.
function isNegated(text, matchIndex) {
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
  // Phrases that contain a negation word but do not negate the hazard
  // ("not just a gas leak", "without warning the pipe burst").
  const windowText = window.reverse().join(" ").replace(NON_NEGATING, " ");
  const hasNegator = windowText.split(" ").some((t) => NEGATORS.has(t));
  if (!hasNegator) return false;
  return !UNCERTAIN.test(windowText);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function isVerifiedOverride(o) {
  return (
    o &&
    o.verified === true &&
    typeof o.text === "string" &&
    o.text.trim().length > 0 &&
    typeof o.verifiedBy === "string" &&
    o.verifiedBy.trim().length > 0 &&
    typeof o.verifiedAt === "string" &&
    !Number.isNaN(Date.parse(o.verifiedAt))
  );
}

const SEVERITY_RANK = { life_safety: 2, urgent: 1 };

/**
 * @param {string} message
 * @param {{ pack: object, procedureOverrides?: Record<string, object> }} options
 */
export function detectEmergency(message, { pack, procedureOverrides = {} } = {}) {
  if (!pack) throw new TypeError("detectEmergency requires an industry pack");

  const none = { emergency: false, severity: null, categories: [], matches: [], procedures: [], reply: "" };
  if (typeof message !== "string" || message.trim() === "") return none;

  const text = normalize(message);
  const matches = [];

  for (const rule of pack.rules) {
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
        if (isNegated(text, start)) continue;
        matches.push({ ruleId: rule.id, category: rule.category, text: m[0] });
      }
    }
  }

  if (matches.length === 0) return none;

  const found = new Set(matches.map((m) => m.category));
  const categories = pack.categoryOrder.filter((c) => found.has(c));
  // Categories not listed in categoryOrder are still reported, after the known ones.
  for (const c of found) if (!categories.includes(c)) categories.push(c);

  const procedures = categories.map((category) => {
    const base = pack.procedures[category];
    const override = procedureOverrides[category];
    if (isVerifiedOverride(override)) {
      let text = override.text.trim();
      // A business may reword guidance but can never drop the emergency-services
      // instruction for life-safety categories.
      if (base.callEmergencyServices && !/\b911\b/.test(text)) {
        text += ` If anyone is in danger, call ${pack.emergencyNumber} now.`;
      }
      return { category, severity: base.severity, text, source: "business_verified" };
    }
    return { category, severity: base.severity, text: base.text, source: "pack_default" };
  });

  const severity = procedures.reduce(
    (best, p) => (SEVERITY_RANK[p.severity] > SEVERITY_RANK[best] ? p.severity : best),
    "urgent"
  );

  const result = { emergency: true, severity, categories, matches, procedures, reply: "" };
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
  const ordered = [...result.procedures].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  );
  const body = ordered.map((p) => p.text).join("\n\n");
  const followUp = leadSystemConnected
    ? "I can't dispatch anyone or confirm arrival times. Once you are safe, I can take your details for the business team to review."
    : "I can't send help, dispatch anyone, or confirm arrival times, and I haven't sent anything to the business. Your safety comes first.";
  return `Your safety comes first.\n\n${body}\n\n${followUp}`;
}
