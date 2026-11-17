// Knowledge retrieval: maps a customer message to verified facts / FAQs.
//
// Contract: every returned text is either (a) built only from a usable
// (verified) fact or FAQ, or (b) the standard UNKNOWN_TEXT. Unverified or
// missing values are never revealed, paraphrased, or hinted at. Retrieval is
// deliberately simple (business knowledge bases are small); semantic search is
// only added if tests show it is needed (docs/AI_STRATEGY.md).

import { UNKNOWN_TEXT, isUsableFact, isValidDate } from "./schema.js";

const INTENTS = [
  { intent: "human_escalation", key: "human_escalation", pattern: /\b(?:human|real person|live person|actual person|representative|customer service|(?:speak|talk) (?:to|with) (?:a|an|someone|somebody|the) (?:person|human|rep|representative|manager|owner))\b/ },
  { intent: "after_hours_policy", key: "after_hours_policy", pattern: /\b(?:after[- ]hours|overnight|weekends?|24\/7|24 hours|middle of the night|late at night)\b/ },
  { intent: "holiday_hours", key: "holiday_hours", pattern: /\bholidays?\b/ },
  { intent: "hours", key: "hours", pattern: /\b(?:hours|open|opens|opening|close|closes|closing|what time|when are you|business hours)\b/ },
  { intent: "diagnostic_fee", key: "diagnostic_fee", pattern: /\b(?:diagnostic|service call|trip) (?:fee|charge|cost)s?\b/ },
  { intent: "emergency_fee", key: "emergency_fee", pattern: /\bemergency (?:fee|charge|rate|cost)s?\b/ },
  { intent: "pricing", key: "pricing", pattern: /\b(?:price|prices|pricing|cost|costs|how much|charge|charges|fee|fees|rate|rates|quote|quotes|estimate|estimates|afford|cheap|expensive)\b/ },
  { intent: "appointments", key: "appointments", pattern: /\b(?:appointments?|book|booking|schedule|scheduling|reserve|availability|available|come out|come today|same[- ]day|tomorrow|next week)\b/ },
  { intent: "service_area", key: "service_area", pattern: /\b(?:service area|serve|serving|cover|coverage|covered|zip(?: code)?|do you service|come to|travel to|in my area|my area|my town)\b/ },
  { intent: "services", key: "services", pattern: /\b(?:what services|which services|services (?:do|you)|what do you (?:do|offer)|do you (?:do|offer|fix|install|repair)|offer)\b/ },
  { intent: "contact_email", key: "contact_email", pattern: /\be-?mail\b/ },
  { intent: "contact_phone", key: "contact_phone", pattern: /\b(?:phone|phone number|call you|contact|reach you|number)\b/ },
];

const ZIP = /\b(\d{5})\b/g;

function normalize(text) {
  return String(text ?? "")
    .slice(0, 2000)
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase();
}

function unknown(intent, key, reason) {
  return { intent, status: "unknown", reason, text: UNKNOWN_TEXT, source: { type: "fact", key } };
}

function answered(intent, key, text) {
  return { intent, status: "answered", text, source: { type: "fact", key } };
}

function factText(fact) {
  return Array.isArray(fact.value) ? fact.value.join(", ") : fact.value;
}

function answerIntent({ intent, key }, kb, message) {
  const fact = kb.facts?.[key];
  if (!fact || (fact.value == null && !fact.zips?.length)) return unknown(intent, key, "missing");
  if (!isUsableFact(fact)) return unknown(intent, key, "unverified");

  switch (intent) {
    case "services":
      return answered(intent, key, `We offer: ${factText(fact)}.`);
    case "contact_phone":
      return answered(intent, key, `You can reach the business at ${factText(fact)}.`);
    case "contact_email":
      return answered(intent, key, `You can email the business at ${factText(fact)}.`);
    case "appointments":
      // Even when the policy is verified, this assistant cannot see or confirm availability.
      return answered(intent, key, `${factText(fact)} I can't confirm a specific appointment time or availability in this chat.`);
    case "service_area": {
      const asked = [...message.matchAll(ZIP)].map((m) => m[1]);
      if (asked.length === 0) return answered(intent, key, factText(fact) ? `Our verified service area: ${factText(fact)}.` : "Our verified service area is listed by ZIP code.");
      const zips = fact.zips ?? [];
      const parts = asked.map((z) =>
        zips.includes(z)
          ? `${z} is in our verified service area.`
          : `I can't confirm whether ${z} is covered. Coverage for that ZIP code needs to be confirmed by the business team.`
      );
      return answered(intent, key, parts.join(" "));
    }
    default:
      return answered(intent, key, factText(fact));
  }
}

function matchFaqs(kb, message) {
  const faqs = (kb.faqs ?? []).filter(
    (f) => f.verified === true && f.verifiedBy && isValidDate(f.verifiedAt)
  );
  const scored = [];
  for (const faq of faqs) {
    let score = 0;
    for (const kw of faq.keywords) {
      const escaped = String(kw).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`).test(message)) score++;
    }
    if (score > 0) scored.push({ faq, score });
  }
  if (scored.length === 0) return null;
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  if (top.length > 1) {
    return {
      intent: "faq",
      status: "ambiguous",
      text: "I want to make sure I answer the right question. Could you tell me a little more?",
      candidates: top.map((t) => t.faq.question),
      source: { type: "faq" },
    };
  }
  return { intent: "faq", status: "answered", text: top[0].faq.answer, source: { type: "faq", id: top[0].faq.id } };
}

/**
 * @param {object} kb  a validated knowledge base (use KnowledgeStore for tenant scoping)
 * @param {string} rawMessage
 * @returns {{status: "answered"|"unknown"|"partial"|"ambiguous"|"no_match", results: object[]}}
 */
export function retrieve(kb, rawMessage) {
  const message = normalize(rawMessage);
  const results = [];

  for (const def of INTENTS) {
    if (def.pattern.test(message)) {
      // "emergency fee" / "diagnostic fee" are more specific than generic pricing.
      if (def.intent === "pricing" && results.some((r) => r.intent === "diagnostic_fee" || r.intent === "emergency_fee")) continue;
      results.push(answerIntent(def, kb, message));
    }
  }

  const faq = matchFaqs(kb, message);
  if (faq) results.push(faq);

  let status;
  if (results.length === 0) status = "no_match";
  else {
    const answeredCount = results.filter((r) => r.status === "answered").length;
    const unknownCount = results.filter((r) => r.status === "unknown").length;
    if (results.some((r) => r.status === "ambiguous") && answeredCount === 0) status = "ambiguous";
    else if (answeredCount === results.length) status = "answered";
    else if (unknownCount === results.length) status = "unknown";
    else status = "partial";
  }
  return { status, results };
}
