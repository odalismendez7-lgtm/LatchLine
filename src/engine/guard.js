// Response guard for AI-written text. The AI is never trusted to make promises.
// Anything that claims an action was taken, quotes a price/time/phone number,
// includes a link, or looks like leaked instructions is rejected, and the
// engine falls back to a fixed, safe reply. This is a defense against common
// failures, not a guarantee: see docs/KNOWN_ISSUES.md.

const MAX_REPLY_CHARS = 600;

const RULES = [
  ["action_claim", /\b(?:i|we)(?:'ve|'ll| have| will| am going to|'m going to)?\s+(?:just\s+)?(?:booked|book|schedule[d]?|dispatch(?:ed)?|sent|send|saved|save|submitted|notified|confirmed|confirm|arranged|reserved|forwarded|passed|alerted|emailed|texted|called)\b/i],
  ["arrival_claim", /\b(?:technician|plumber|someone|team|crew|tech)\b[^.?!]{0,40}\b(?:is|are|will be|on the way|on their way|arriv\w+|coming|headed)\b/i],
  ["price", /[$€£]\s?\d|\b\d+(?:\.\d+)?\s?(?:dollars|usd|bucks)\b|\b\d{1,3}\s?%/i],
  ["phone_number", /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/],
  ["link", /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|xyz)\b/i],
  ["guarantee", /\b(?:guarantee[d]?|promise[d]?|definitely|certainly will|100%)\b/i],
  ["time_promise", /\b(?:within|in)\s+(?:the next\s+)?\d+\s*(?:minutes?|hours?|mins?|hrs?)\b|\b(?:today|tonight|tomorrow)\s+(?:at|by|between)\b|\bby\s+\d{1,2}\s?(?:am|pm)\b/i],
  ["instruction_leak", /\b(?:system prompt|my instructions|as an ai language model|ignore (?:all |previous )?instructions|developer message)\b/i],
  ["medical_legal_advice", /\b(?:you should (?:not )?(?:turn|touch|use|relight|flip)|safe to (?:use|touch|stay))\b/i],
];

export function guardAiReply(text) {
  if (typeof text !== "string") return { ok: false, reason: "not_text" };
  const t = text.trim();
  if (t === "") return { ok: false, reason: "empty" };
  if (t.length > MAX_REPLY_CHARS) return { ok: false, reason: "too_long" };
  if (/[\u0000-\u0008\u000b-\u001f]/.test(t)) return { ok: false, reason: "control_characters" };
  for (const [reason, re] of RULES) if (re.test(t)) return { ok: false, reason };
  return { ok: true, text: t };
}
