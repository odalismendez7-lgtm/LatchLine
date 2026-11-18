// Pulls contact details out of free text. Everything extracted is passed through
// the same validators used for direct input, so a value is only "found" if it
// is also valid. Customer text is data; nothing here executes or trusts it.

import { normalizePhone, normalizeEmail, normalizeZip, normalizeName } from "../validation/normalize.js";

const EMAIL_RE = /[^\s@<>,;()]{1,64}@[^\s@<>,;()]{1,255}\.[a-z]{2,24}/i;
const PHONE_RE = /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/;
const ZIP_RE = /(?<![\d-])\d{5}(?:-\d{4})?(?![\d-])/;

export function extractContact(text) {
  const out = {};
  let rest = String(text ?? "");
  const em = EMAIL_RE.exec(rest);
  if (em) {
    const v = normalizeEmail(em[0].replace(/[.]+$/, ""));
    if (v.ok) out.email = v.value;
    rest = rest.replace(em[0], " ");
  }
  const ph = PHONE_RE.exec(rest);
  if (ph) {
    const v = normalizePhone(ph[0].trim());
    if (v.ok) out.phone = v.value;
    rest = rest.replace(ph[0], " ");
  }
  const zp = ZIP_RE.exec(rest);
  if (zp) {
    const v = normalizeZip(zp[0]);
    if (v.ok) out.zip = v.value;
  }
  return out;
}

/** True when the message is essentially only contact data (so it must not become the "issue"). */
export function isMostlyContactData(text, found) {
  if (!found || Object.keys(found).length === 0) return false;
  const stripped = String(text)
    .replace(EMAIL_RE, " ").replace(PHONE_RE, " ").replace(ZIP_RE, " ")
    .replace(/\b(my|is|the|and|phone|number|email|e-mail|zip|code|it'?s|at|me|call|text|reach)\b/gi, " ")
    .replace(/[^\p{L}]+/gu, " ").trim();
  return stripped.length < 4;
}

export function extractName(text) {
  const stripped = String(text ?? "").replace(/^\s*(?:my name is|my name's|i am|i'm|this is|it is|it's|name is|name:)\s+/i, "").replace(/[.!,]+$/, "");
  return normalizeName(stripped);
}

export function extractUrgency(text) {
  const t = String(text ?? "").toLowerCase();
  const wait = /\b(can wait|not urgent|no rush|whenever|later|next week|this week|not right now|not now|not an emergency|routine)\b/.test(t);
  const now = /\b(right now|happening now|now|asap|today|urgent|immediately|currently|still)\b/.test(t) && !/\bnot (?:right )?now\b/.test(t);
  if (wait && !now) return "can_wait";
  if (now && !wait) return "now";
  return null;
}
