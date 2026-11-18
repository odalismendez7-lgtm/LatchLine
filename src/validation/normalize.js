// Validation and normalization for everything a customer can type.
//
// Customer text is untrusted DATA. These functions do not "clean" it into
// something trusted; they decide whether a value is acceptable for a field and
// put it in one canonical form. Stored text is escaped on output by whatever
// renders it (dashboard, exports), never assumed safe here.

export const MAX_MESSAGE_CHARS = 1200;
export const MAX_ISSUE_CHARS = 500;

const CONTROL_AND_INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

const ok = (value) => ({ ok: true, value });
const bad = (reason) => ({ ok: false, reason });

export function sanitizeText(input, { maxLength = MAX_MESSAGE_CHARS } = {}) {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFC")
    .replace(CONTROL_AND_INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeMessage(input) {
  if (typeof input !== "string") return bad("not_a_string");
  if (input.length > MAX_MESSAGE_CHARS) return bad("too_long");
  const value = sanitizeText(input);
  if (value === "") return bad("empty");
  return ok(value);
}

export function normalizePhone(input) {
  if (typeof input !== "string") return bad("not_a_string");
  const raw = input.trim();
  // Only digits and ordinary phone punctuation; no letters, extensions, or second numbers.
  if (!/^\+?[\d\s().-]+$/.test(raw)) return bad("invalid_characters");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && !digits.startsWith("1")) return bad("not_us_number");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return bad("wrong_length");
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  if (!/^[2-9]/.test(area) || !/^[2-9]/.test(exchange)) return bad("invalid_number");
  if (area.slice(1) === "11") return bad("invalid_area_code"); // N11 service codes
  if (/^(\d)\1{9}$/.test(digits)) return bad("invalid_number");
  return ok(`+1${digits}`);
}

const EMAIL_LOCAL = /^[a-z0-9._%+-]{1,64}$/;
const EMAIL_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeEmail(input) {
  if (typeof input !== "string") return bad("not_a_string");
  if (/[\r\n]/.test(input)) return bad("invalid_characters"); // header injection
  const v = input.trim().toLowerCase();
  if (v.length === 0 || v.length > 254) return bad("wrong_length");
  const parts = v.split("@");
  if (parts.length !== 2) return bad("invalid_format");
  const [local, domain] = parts;
  if (!EMAIL_LOCAL.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return bad("invalid_format");
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((l) => EMAIL_LABEL.test(l))) return bad("invalid_format");
  if (!/^[a-z]{2,24}$/.test(labels[labels.length - 1])) return bad("invalid_format");
  return ok(v);
}

export function normalizeZip(input) {
  if (typeof input !== "string") return bad("not_a_string");
  const m = /^(\d{5})(?:-\d{4})?$/.exec(input.trim());
  if (!m || m[1] === "00000") return bad("invalid_zip");
  return ok(m[1]);
}

const NOT_NAMES = new Set(["yes", "no", "yeah", "nope", "help", "ok", "okay", "none", "n/a", "na", "test", "asap", "hi", "hello", "thanks", "thank you"]);

export function normalizeName(input) {
  if (typeof input !== "string") return bad("not_a_string");
  const v = sanitizeText(input, { maxLength: 100 });
  if (v.length < 2 || v.length > 60) return bad("wrong_length");
  if (!/^[\p{L}][\p{L}\p{M}'’.\- ]*$/u.test(v)) return bad("invalid_characters");
  const tokens = v.split(" ");
  if (tokens.length > 5) return bad("too_many_words");
  if (NOT_NAMES.has(v.toLowerCase())) return bad("not_a_name");
  if (/^(?:www|http)/i.test(v) || /\b(?:ignore|instructions?|previous|system|prompt|assistant)\b/i.test(v)) return bad("not_a_name");
  const letters = v.replace(/[^\p{L}]/gu, "");
  const hasLower = /\p{Ll}/u.test(letters);
  const hasUpper = /\p{Lu}/u.test(letters);
  if (!hasLower || !hasUpper) {
    // all-lower or ALL-UPPER input: title-case each word part
    const title = v.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
    return ok(title);
  }
  return ok(v);
}
