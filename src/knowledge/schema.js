// Per-business verified knowledge base: schema, validation, and grounding.
//
// Rule: a fact may be stated to a customer ONLY if it is "usable":
// verified === true, has a value, and records who verified it and when.
// Everything else is "unknown" and must never be paraphrased, hinted at,
// or guessed. See docs/AI_STRATEGY.md.

export const FACT_KEYS = [
  "hours",
  "holiday_hours",
  "after_hours_policy",
  "service_area",
  "services",
  "pricing",
  "diagnostic_fee",
  "emergency_fee",
  "appointments",
  "contact_phone",
  "contact_email",
  "human_escalation",
];

export const UNKNOWN_TEXT =
  "I don't want to give you incorrect information. That detail needs to be confirmed by the business team.";

const ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const ZIP_RE = /^\d{5}$/;
const FACT_FIELDS = new Set(["value", "verified", "verifiedBy", "verifiedAt", "zips"]);

const isNonEmptyString = (s) => typeof s === "string" && s.trim() !== "";

export function isValidDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s));
}

function hasValue(v) {
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0 && v.every(isNonEmptyString);
  return false;
}

function hasContent(fact) {
  return hasValue(fact.value) || (Array.isArray(fact.zips) && fact.zips.length > 0);
}

export function isUsableFact(fact) {
  return (
    !!fact &&
    typeof fact === "object" &&
    fact.verified === true &&
    hasContent(fact) &&
    isNonEmptyString(fact.verifiedBy) &&
    isValidDate(fact.verifiedAt)
  );
}

function checkVerification(label, item, errors) {
  if (item.verified === true) {
    if (!isNonEmptyString(item.verifiedBy)) errors.push(`${label}: verified requires verifiedBy`);
    if (!isValidDate(item.verifiedAt)) errors.push(`${label}: verified requires a valid verifiedAt date`);
  } else if (item.verified !== false) {
    errors.push(`${label}: verified must be true or false`);
  }
}

export function validateKnowledgeBase(kb) {
  const errors = [];
  if (!kb || typeof kb !== "object" || Array.isArray(kb)) {
    return { ok: false, errors: ["knowledge base must be an object"] };
  }
  if (kb.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof kb.businessId !== "string" || !ID_RE.test(kb.businessId)) errors.push("businessId must be lowercase letters, digits, hyphens (2-63 chars)");
  if (!isNonEmptyString(kb.businessName)) errors.push("businessName is required");
  if (!isNonEmptyString(kb.industry)) errors.push("industry is required");

  if (!kb.facts || typeof kb.facts !== "object" || Array.isArray(kb.facts)) {
    errors.push("facts must be an object");
  } else {
    for (const [key, fact] of Object.entries(kb.facts)) {
      const label = `facts.${key}`;
      if (!FACT_KEYS.includes(key)) { errors.push(`${label}: unknown fact key`); continue; }
      if (!fact || typeof fact !== "object") { errors.push(`${label}: must be an object`); continue; }
      for (const f of Object.keys(fact)) if (!FACT_FIELDS.has(f)) errors.push(`${label}: unknown field ${f}`);
      if (fact.value !== null && fact.value !== undefined && !hasValue(fact.value)) errors.push(`${label}: value must be null, a string, or a list of strings`);
      if (fact.zips !== undefined) {
        if (key !== "service_area") errors.push(`${label}: zips only allowed on service_area`);
        else if (!Array.isArray(fact.zips) || !fact.zips.every((z) => typeof z === "string" && ZIP_RE.test(z))) errors.push(`${label}: zips must be 5-digit strings`);
      }
      checkVerification(label, fact, errors);
      if (fact.verified === true && !hasContent(fact)) errors.push(`${label}: verified fact must have a value`);
    }
  }

  if (kb.faqs !== undefined) {
    if (!Array.isArray(kb.faqs)) errors.push("faqs must be a list");
    else {
      const ids = new Set();
      kb.faqs.forEach((faq, i) => {
        const label = `faqs[${i}]`;
        if (!faq || typeof faq !== "object") { errors.push(`${label}: must be an object`); return; }
        if (!isNonEmptyString(faq.id)) errors.push(`${label}: id required`);
        else if (ids.has(faq.id)) errors.push(`${label}: duplicate id ${faq.id}`);
        else ids.add(faq.id);
        if (!isNonEmptyString(faq.question)) errors.push(`${label}: question required`);
        if (!isNonEmptyString(faq.answer)) errors.push(`${label}: answer required`);
        if (!Array.isArray(faq.keywords) || faq.keywords.length === 0 || !faq.keywords.every(isNonEmptyString)) errors.push(`${label}: keywords must be a non-empty list of strings`);
        checkVerification(label, faq, errors);
      });
    }
  }

  if (kb.emergencyProcedures !== undefined) {
    if (!kb.emergencyProcedures || typeof kb.emergencyProcedures !== "object" || Array.isArray(kb.emergencyProcedures)) {
      errors.push("emergencyProcedures must be an object");
    } else {
      for (const [cat, p] of Object.entries(kb.emergencyProcedures)) {
        const label = `emergencyProcedures.${cat}`;
        if (!p || typeof p !== "object") { errors.push(`${label}: must be an object`); continue; }
        if (!isNonEmptyString(p.text)) errors.push(`${label}: text required`);
        checkVerification(label, p, errors);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Verified business emergency procedures, ready to hand to the safety layer. */
export function verifiedProcedureOverrides(kb) {
  const out = {};
  for (const [cat, p] of Object.entries(kb.emergencyProcedures ?? {})) {
    if (p?.verified === true && isNonEmptyString(p.text) && isNonEmptyString(p.verifiedBy) && isValidDate(p.verifiedAt)) {
      out[cat] = { text: p.text, verified: true, verifiedBy: p.verifiedBy, verifiedAt: p.verifiedAt };
    }
  }
  return out;
}

/**
 * The only knowledge an AI model may be shown for a business: usable facts and
 * usable FAQs, plus the list of fact keys that are unknown (so the model is
 * told explicitly not to guess them). Unverified values are never included.
 */
export function groundingFor(kb) {
  const facts = {};
  const unknownFacts = [];
  for (const key of FACT_KEYS) {
    const fact = kb.facts?.[key];
    if (isUsableFact(fact)) {
      facts[key] = fact.value ?? null;
      if (key === "service_area" && fact.zips?.length) facts.service_area_zips = [...fact.zips];
    } else {
      unknownFacts.push(key);
    }
  }
  const faqs = (kb.faqs ?? [])
    .filter((f) => f.verified === true && isNonEmptyString(f.verifiedBy) && isValidDate(f.verifiedAt))
    .map((f) => ({ question: f.question, answer: f.answer }));
  return deepFreeze({ businessId: kb.businessId, businessName: kb.businessName, facts, faqs, unknownFacts });
}

export function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}
