// Password hashing and token primitives (Web Crypto only: works in Workers and Node).
//
// Passwords: PBKDF2-HMAC-SHA256, per-password random salt, iteration count stored
// in the hash so it can be raised later (login re-hashes when it is outdated).
// OWASP's 2023+ guidance for PBKDF2-SHA256 is 600,000 iterations. That is slow on
// purpose, and may exceed Cloudflare Workers' free-plan 10 ms CPU limit: UNVERIFIED
// (KI-30). Lowering it to fit would weaken password protection, so it is not done.
//
// Tokens (sessions, email/reset/invite tokens): 32 random bytes, shown to the user
// once; only their SHA-256 hash is stored.

export const PBKDF2_ITERATIONS = 600_000;
const ALGO = "pbkdf2-sha256";
const enc = new TextEncoder();

const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export function randomToken(bytes = 32) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * The platform could not run the requested password hash (for example a runtime that caps PBKDF2
 * iterations; Workers is reported to cap Web Crypto PBKDF2 at 100,000 and this was NOT verified,
 * KI-30). Callers must FAIL CLOSED: no account is created, no session is issued, and the strength
 * is never lowered to make it work. The message never contains the password.
 */
export class HashUnavailableError extends Error {
  constructor(iterations) { super(`password hashing at ${iterations} iterations is not available on this platform`); this.name = "HashUnavailableError"; this.code = "hash_unavailable"; }
}

async function derive(password, salt, iterations) {
  try {
    const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
  } catch { throw new HashUnavailableError(iterations); }
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${ALGO}$${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`;
}

export function parseHash(stored) {
  const p = typeof stored === "string" ? stored.split("$") : [];
  if (p.length !== 4 || p[0] !== ALGO) return null;
  const iterations = Number(p[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return null;
  try { return { iterations, salt: unb64(p[2]), hash: p[3] }; } catch { return null; }
}

export async function verifyPassword(password, stored) {
  const p = parseHash(stored);
  if (!p || typeof password !== "string") return false;
  return constantTimeEqual(b64(await derive(password, p.salt, p.iterations)), p.hash);
}

export const needsRehash = (stored, iterations = PBKDF2_ITERATIONS) => (parseHash(stored)?.iterations ?? 0) < iterations;

// Fixed, valid-format hash used so "no such user" costs the same time as "wrong password".
export const dummyHash = (iterations = PBKDF2_ITERATIONS) => `${ALGO}$${iterations}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

const COMMON = new Set(["password", "password1", "password12", "password123", "password1234", "passw0rd1234", "123456789012", "1234567890123", "qwertyuiop12", "qwerty123456", "letmein12345", "iloveyou1234", "admin1234567", "welcome12345", "changeme1234", "plumbing1234", "latchline1234", "111111111111", "000000000000", "abcdefghijkl", "aaaaaaaaaaaa"]);

/** Length over composition rules (NIST 800-63B direction): 12 to 128 characters, not obviously weak. */
export function checkPasswordPolicy(password, { email } = {}) {
  if (typeof password !== "string") return { ok: false, reason: "not_a_string" };
  if (password.length < 12) return { ok: false, reason: "too_short" };
  if (password.length > 128) return { ok: false, reason: "too_long" };
  const low = password.toLowerCase();
  if (COMMON.has(low)) return { ok: false, reason: "too_common" };
  if (/^(.)\1+$/.test(password)) return { ok: false, reason: "too_common" };
  const local = String(email ?? "").split("@")[0].toLowerCase();
  if (local.length >= 4 && low.includes(local)) return { ok: false, reason: "contains_email" };
  return { ok: true };
}

/** Uniform 6-digit code from the CSPRNG (rejection sampling, no modulo bias). */
export function randomCode(digits = 6) {
  const max = 10 ** digits, limit = Math.floor(0x100000000 / max) * max;
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    if (n < limit) return String(n % max).padStart(digits, "0");
  }
}
