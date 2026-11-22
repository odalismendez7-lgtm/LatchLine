// Detects when a customer asks for a person. Deliberately narrow: it must not
// fire on "do you have a person who can look at my heater?" style questions
// about staffing in general. When it fires, the engine records a handoff
// request; it never promises a live transfer or a callback time.

const PATTERNS = [
  /\b(?:talk|speak|chat|connect|transfer)(?:ing)?\s+(?:me\s+)?(?:to|with)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:real\s+|live\s+|actual\s+)?(?:human|person|people|someone|somebody|representative|rep|agent|operator|manager|owner|plumber|staff)\b/i,
  /\b(?:i\s+(?:want|need|would\s+like|d\s+like|prefer))\s+(?:a\s+|an\s+|to\s+(?:talk|speak)\s+(?:to|with)\s+(?:a\s+)?)?(?:real\s+|live\s+|actual\s+)?(?:human|person|representative|agent|operator)\b/i,
  /\b(?:get|let)\s+me\s+(?:a|to)\s+(?:real\s+|live\s+)?(?:human|person|representative|agent)\b/i,
  /\b(?:real|live|actual)\s+(?:human|person)\b/i,
  /\b(?:human|person|agent|representative)\s+(?:please|now)\b/i,
  /\bhablar\s+con\s+(?:una\s+|un\s+|el\s+|la\s+)?(?:persona|humano|alguien|representante|agente|dueno|dueño|gerente)\b/i,
  /\bpersona\s+real\b/i,
];

const NOT_REQUEST = [/\b(?:am\s+i\s+(?:talking|speaking|chatting|typing)\s+(?:to|with)|is\s+(?:this|that|it))\s+(?:a\s+|an\s+)?(?:real\s+|live\s+|actual\s+)?(?:person|human|bot|robot)\s*\??\s*$/i, /\bnot\s+(?:a\s+)?(?:real\s+)?(?:person|human)\b/i, /\b(?:are|r)\s+you\s+(?:a\s+)?(?:real\s+)?(?:person|human|bot)\b/i, /\bdon'?t\s+(?:want|need)\s+(?:to\s+)?(?:talk|speak)\b/i];

export function wantsHuman(message) {
  const t = String(message ?? "").normalize("NFC");
  if (t.length > 1200) return false;
  // Judge each clause on its own so "are you a real person? I want to talk to a human" and
  // "I don't want to talk to a bot, get me a real person" are still requests, while a lone identity question is not.
  const clauses = t.split(/[.?!;,]+/).map((c) => c.trim()).filter(Boolean);
  if (clauses.some((c) => PATTERNS.some((r) => r.test(c)) && !NOT_REQUEST.some((r) => r.test(c)))) return true;
  if (NOT_REQUEST.some((r) => r.test(t))) return false;
  return PATTERNS.some((r) => r.test(t));
}
