// Pulls contact details out of free text. Everything extracted is passed through
// the same validators used for direct input, so a value is only "found" if it
// is also valid. Customer text is data; nothing here executes or trusts it.

import { normalizePhone, normalizeEmail, normalizeZip, normalizeName } from "../validation/normalize.js";

const EMAIL_RE = /[^\s@<>,;()]{1,64}@[^\s@<>,;()]{1,255}\.[a-z]{2,24}/i;
const PHONE_RE = /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/;
const ZIP_RE = /(?<![\d-])\d{5}(?:-\d{4})?(?![\d-])/;

// Voice-to-text writes numbers as words ("two one seven five five five ..."). Runs of 7+ digit words become digits.
const DIGIT_WORDS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
export function spokenDigitsToDigits(text) {
  const whole = String(text ?? "").trim().replace(/[.,!]+$/, "");
  const ws = whole.toLowerCase().split(/[\s,-]+/);
  if (ws.length === 5 && ws.every((w) => w in DIGIT_WORDS)) return ws.map((w) => DIGIT_WORDS[w]).join(""); // a spoken ZIP code
  return String(text ?? "").replace(/\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)(?:[\s,.-]+|\b)){10,}/gi, (run) => {
    const words = run.toLowerCase().match(/[a-z]+/g) ?? [];
    return words.every((w) => w in DIGIT_WORDS) && words.filter((w) => w !== "oh").length >= 7 ? ` ${words.map((w) => DIGIT_WORDS[w]).join("")} ` : run;
  });
}

// Parse only an explicitly introduced property address, or a bare street address
// when the conversation is explicitly waiting for that field. Never guess a location.
export function extractServiceAddress(rawText, { allowBare = false } = {}) {
  const raw = String(rawText ?? "").normalize("NFC").trim();
  const match = /(?:service |property )?address(?: is|:)\s*(.+)$/i.exec(raw)
    ?? (allowBare && /^(?:\d{1,6}\s|P\.?O\.?\s+Box\s+)/i.test(raw) ? [raw, raw] : null);
  if (!match) return {};
  let value = match[1].replace(/[.!?]+$/, "").trim().replace(/\s+/g, " ");
  if (value.length < 5 || value.length > 360 || /[<>\r\n]/.test(value)) return {};
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const street = parts[0] ?? "";
  if (!/^(?:\d{1,6}\s+|P\.?O\.?\s+Box\s+)[\p{L}\p{M}\d .#'’/-]{2,150}$/iu.test(street)) return {};
  const out = { addressLine1: street.slice(0, 160) };
  const rest = parts.slice(1);
  if (rest.length && /^(?:apt|apartment|unit|suite|ste|#)(?:\s|$)/i.test(rest[0])) {
    if (rest[0].length <= 100) out.addressLine2 = rest[0];
  }
  const locality = rest.filter((part) => !/^(?:apt|apartment|unit|suite|ste|#)(?:\s|$)/i.test(part));
  if (locality.length >= 2) {
    const state = /^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(locality[locality.length - 1]);
    const city = locality[locality.length - 2];
    if (state && /^[\p{L}][\p{L} .'-]{1,98}$/u.test(city)) {
      out.city = city.slice(0, 100);
      out.state = state[1].toUpperCase();
    }
  }
  return out;
}

export function extractContact(rawText) {
  const out = {};
  let rest = spokenDigitsToDigits(rawText);
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
  const stripped = String(text ?? "").replace(/^\s*(?:my name is|my name's|i am|i'm|im|this is|it is|it's|its|name is|name:|call me|me llamo|mi nombre es|soy)\s+/i, "").replace(/[.!,]+$/, "");
  return normalizeName(stripped);
}

export function extractUrgency(text) {
  const t = String(text ?? "").toLowerCase();
  const wait = /\b(can wait|not urgent|no rush|whenever|later|next week|this week|not right now|not now|not an emergency|routine|puede esperar|no urge|no es urgente|sin prisa|más adelante|mas adelante|la próxima semana|la proxima semana|la semana que viene)\b/.test(t);
  const now = /\b(right now|happening now|now|asap|today|urgent|immediately|currently|still|ahora|ahorita|en este momento|está pasando ahora|esta pasando ahora|urgente|hoy|inmediatamente)\b/.test(t)
    && !/\bnot (?:right )?now\b/.test(t)
    && !/\bno (?:es )?urgente\b/.test(t);
  if (wait && !now) return "can_wait";
  if (now && !wait) return "now";
  return null;
}

// ---- names -------------------------------------------------------------------------------------------------
// normalizeName only checks shape, so a sentence such as "my toilet keeps running" (letters and spaces) used to be
// stored as the customer's NAME and sent to the business. These words never appear in a first/last name that this
// assistant should accept without asking again; a real name containing one is simply asked for once more.
const NOT_NAME_WORDS = new Set([
  "my", "the", "is", "are", "was", "were", "am", "has", "have", "had", "need", "needs", "keep", "keeps", "wont", "won't", "cant", "can't", "cannot", "not", "no", "it", "its", "it's", "there", "our", "your", "a", "an", "and", "or", "but", "with", "for", "to", "of", "in", "on", "at", "by", "i", "i'm", "im", "we", "you", "me",
  "leak", "leaks", "leaking", "leaky", "drip", "drips", "dripping", "clog", "clogged", "clogging", "block", "blocked", "backed", "backup", "backing", "toilet", "sink", "faucet", "drain", "drains", "drainage", "pipe", "pipes", "water", "heater", "shower", "tub", "bathtub", "sewer", "sewage", "disposal", "flood", "flooded", "flooding", "burst", "frozen", "running", "broken", "smell", "smells", "gas", "overflow", "overflowing", "plumber", "plumbing", "pressure", "valve", "hose", "kitchen", "bathroom", "basement",
  "help", "please", "call", "hello", "hi", "hey", "thanks", "thank", "yes", "yeah", "yep", "sure", "ok", "okay", "nope", "nothing", "something", "anything", "everything", "problem", "issue", "emergency", "urgent", "asap", "now", "today", "tomorrow", "someone", "somebody", "person", "human", "real", "quote", "price", "cost", "how", "what", "when", "why", "where", "who", "which", "that", "this", "these", "those",
  "street", "st", "ave", "avenue", "road", "rd", "lane", "ln", "court", "ct", "blvd", "way", "place", "apt", "unit", "day", "days", "week", "weeks", "month", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "service", "trouble", "home", "alone", "again", "terrible", "horrible", "awful", "big", "washing", "pump", "tank", "machine", "washer", "dryer", "dishwasher", "radiator", "septic", "bath", "flow", "floor", "ceiling", "collapse", "locked", "freezing", "cold", "hot", "low", "high", "master", "main", "line", "second", "both", "sinks", "pump", "tank", "good", "morning", "afternoon", "evening", "night", "welcome", "bye", "goodbye", "sorry", "calling", "looking", "having", "getting", "trying", "just", "really", "very", "afraid", "worried", "scared", "frustrated", "angry", "upset", "here", "back", "done", "fine", "happy", "glad", "concerned", "never", "mind", "stop", "wrong", "actually",
].map((w) => w.replace(/’/g, "'")));

/** A name this assistant can accept without a second look: valid shape, at most four words, no sentence or plumbing words. */
export function looksLikeName(text) {
  const n = extractName(text);
  if (!n.ok) return false;
  if (n.value.split(" ").length > 4) return false;
  if (PROBLEM_WORD.test(n.value) || /['’]s$/i.test(n.value)) return false;
  // token by token (not a \b regex: \b is ASCII-only and would see the "a" in "García")
  for (const tok of n.value.toLowerCase().replace(/’/g, "'").split(/[\s]+/)) if (NOT_NAME_WORDS.has(tok.replace(/[.,]+$/g, ""))) return false;
  return true;
}

const INTRO = /\b(my name is|my name's|name is|me llamo|mi nombre es|this is|i am|i'm|im|it's|its|soy)\s+/gi;
const CAP_TOKENS = /^(\p{Lu}[\p{L}\p{M}'’-]*\.?(?:\s+\p{Lu}[\p{L}\p{M}'’-]*\.?){0,2})/u;
const ANY_TOKENS = /^([\p{L}][\p{L}\p{M}'’-]*\.?(?:\s+[\p{L}][\p{L}\p{M}'’-]*\.?){0,2})/u;

/**
 * Finds "my name is X", "I'm X Y" or "this is X Y" anywhere in a message. "my name is" accepts one to three words in any case;
 * the weaker intros ("I'm", "this is") need a capitalised first AND last name, so "I'm Sorry" or "I'm having a leak" never match.
 * Returns { value, only } where `only` means the message is nothing but the introduction (so it is not also a problem description).
 */
export function extractEmbeddedName(text) {
  const t = String(text ?? "");
  INTRO.lastIndex = 0;
  let m;
  while ((m = INTRO.exec(t))) {
    const strong = /^(my name is|my name's|name is|me llamo|mi nombre es)$/i.test(m[1]);
    const fullRest = t.slice(m.index + m[0].length);
    const rest = fullRest.split(/\s+(?:and|but|because|so)\s+|[,;!?]/i)[0];
    const tok = (strong ? ANY_TOKENS : CAP_TOKENS).exec(rest);
    if (!tok) continue;
    const raw = tok[1].replace(/\.$/, "");
    const next = rest.slice(tok[1].length).trimStart().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}']/gu, "") ?? "";
    if (!strong && /^(without|with|for|since|in|on|at|from|near|about|of|the|a|an|is|has|and the)$/.test(next)) continue;
    if (!strong && raw.split(/\s+/).length < 2) continue;
    if (!looksLikeName(raw)) continue;
    const n = extractName(raw);
    if (!n.ok) continue;
    const before = t.slice(0, m.index).replace(/\b(hi|hello|hey|good (morning|afternoon|evening)|and|so|um|well)\b|[^\p{L}]+/giu, "").trim();
    const after = fullRest.slice(tok[1].length).replace(/\b(and|here|calling|speaking|again|thanks|thank you)\b|[^\p{L}]+/giu, "").trim();
    return { value: n.value, only: before === "" && after === "" };
  }
  return null;
}

/** True for a short message that is a capitalised first and last name and nothing else ("Maria Lopez"). */
export function looksLikeBareName(text, { requireCapitals = true } = {}) {
  const t = String(text ?? "").trim().replace(/[.!]+$/, "");
  if (!/^[\p{L}][\p{L}\p{M}'’.\- ]*$/u.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  if (requireCapitals && !words.every((w) => /^\p{Lu}/u.test(w))) return false;
  return looksLikeName(t);
}

// ---- what a message is about ---------------------------------------------------------------------------------
const PROBLEM_WORD = /\b(?:bath\w*|heat\w*|floor\w*|ceiling|wet|quote|remodel\w*|install\w*|kitchen|basement|upstairs|wall|hot|cold|flow|sinks?|main line|washer|dishwasher|fixture|pump|tank|leak\w*|drip\w*|clog\w*|block\w*|backed|backup|toilet|sink|faucet|drain\w*|pipe\w*|water|heater|shower|tub|bathtub|sewer|sewage|disposal|flood\w*|burst|frozen|overflow\w*|plumb\w*|pressure|valve|hose|spigot|sump|boiler|pump|tank|machine|washer|dryer|dishwasher|radiator|septic|fixture|cleanout|gas|fuga|agua|inodoro|tuber\w*|cocina|ba[nñ]o)\b/i;
/** True when the text mentions something plumbing-related (used so a name or chatter is never stored as the problem). */
export const hasProblemWord = (text) => PROBLEM_WORD.test(String(text ?? ""));

/** "can you repeat that?", "say that again", "what did you say?" */
export const asksToRepeat = (text) => {
  const t = String(text ?? "").trim();
  return /\b(?:repeat (?:that|it|yourself)|can you repeat|could you repeat|say (?:that|it) again|what did you (?:just )?say)\b/i.test(t) || /^(?:come again|pardon(?: me)?|what was that|sorry,? what|once more)\W*$/i.test(t);
};

/** Attempts to read hidden instructions or other customers'/businesses' data. Always refused in plain words. */
export const isPrivacyProbe = (text) => {
  const t = String(text ?? "");
  return /\b(?:system prompt|your (?:system )?(?:instructions|prompt|rules|database|api[- ]?keys?|passwords?|source code)|developer (?:message|mode)|site key|admin (?:password|login|access|panel)|list (?:all )?(?:the )?(?:customers|businesses|leads|clients)|show me (?:\w+'s? )?(?:customers|leads|conversations|clients))\b/i.test(t)
    || /\b(?:show|give|tell|share|send|reveal|read|see)\b[^.?!]{0,40}\b(?:other|another|previous|last|recent|all|every)\s+(?:customers?|clients?|leads?|conversations?|businesses|tenants?)\b/i.test(t)
    || /\b(?:give|tell|show|share|send)\b[^.?!]{0,20}\b(?:the )?(?:phone|number|email|address|name)s?\b[^.?!]{0,20}\b(?:of|for) (?:the |another |other |a )?(?:last|previous|other|another|recent) (?:customer|client)\b/i.test(t);
};

/** Small talk that has nothing to do with plumbing. A short list on purpose: when unsure, the normal flow runs. */
export const isOffTopic = (text) => {
  const t = String(text ?? "");
  if (PROBLEM_WORD.test(t) || t.split(/\s+/).length > 12) return false;
  return /\b(?:weather|forecast|poem|poetry|joke|recipe|horoscope|bitcoin|crypto|lottery|trivia|homework|essay|capital of|who won|sports? score|write me (?:a|an)|tell me (?:a|an) (?:joke|story))\b/i.test(t);
};

/** Used only while a name is being asked for: a capitalised one to three word answer with no sentence or plumbing words ("Ben Day", "John Price"). */
const SENTENCE_WORDS = new Set(["my", "the", "is", "are", "was", "were", "am", "has", "have", "had", "need", "needs", "keeps", "not", "no", "it", "its", "there", "our", "your", "a", "an", "and", "or", "but", "with", "for", "to", "of", "in", "on", "at", "by", "i", "we", "you", "me", "help", "please", "yes", "ok", "okay", "thanks", "thank", "hello", "hi", "hey", "never", "mind", "stop", "sorry", "what", "how", "when", "why", "where", "who"]);
export function looksLikeNameWhenAsked(text) {
  if (looksLikeName(text)) return true;
  const t = String(text ?? "").trim().replace(/[.!]+$/, "");
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 3 || !words.every((w) => /^\p{Lu}/u.test(w))) return false;
  if (!extractName(t).ok || PROBLEM_WORD.test(t)) return false;
  return !words.some((w) => SENTENCE_WORDS.has(w.toLowerCase()));
}
