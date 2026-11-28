// Server-side authorization for every business-data request.
//
// The business id in a URL is only a REQUEST. It is honoured only if the signed-in
// user has a membership in that business right now (checked in the database on every
// request, never cached in the browser). Non-members get the same 404 as a business
// that does not exist, so ids cannot be probed. A member lacking the permission gets 403.
import { forBusiness } from "../db/tenant.js";
import { can } from "../auth/permissions.js";

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,79}$/i;

export async function authorizeBusiness({ auth, db, session, businessId, action }) {
  if (!session) return { ok: false, status: 401, error: "Sign in required" };
  if (typeof businessId !== "string" || !ID_RE.test(businessId)) return { ok: false, status: 404, error: "Not found" };
  const role = await auth.repo.roleFor(session.userId, businessId);
  if (!role) return { ok: false, status: 404, error: "Not found" };
  if (!can(role, action)) return { ok: false, status: 403, error: "Not allowed for your role" };
  // The ONLY place a dashboard request obtains a tenant handle.
  return { ok: true, role, T: forBusiness(db, businessId) };
}

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
// Any run of 10+ digits with any number of non-alphanumeric characters between digits ("512 - 555 - 0142", "512 ---- 555 ---- 0142"). The customer-side extractor accepts any number of separators, so redaction must be at least as generous.
const DIGIT_RUN_RE = /\+?\p{Nd}(?:[^\p{L}\p{N}]*\p{Nd}){9,}/gu;
const EMAIL_RE = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g;
// Mask common US street addresses in free-text lead summaries and conversation messages too.
// Structured address columns are masked separately by maskLead; this closes the free-text copy.
const STREET_ADDRESS_RE = /\b(?:\d{1,6}\s+(?:(?:N|S|E|W|NE|NW|SE|SW)\.?\s+)?[\p{L}\p{M}0-9.'’\-]+(?:\s+[\p{L}\p{M}0-9.'’\-]+){0,5}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|way|parkway|pkwy|terrace|ter|circle|cir|highway|hwy)\b(?:\s*,?\s*(?:apt|apartment|unit|suite|ste|#)\s*#?\s*[A-Za-z0-9-]+)?(?:,\s*[\p{L}\p{M} .'-]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?|P\.?\s*O\.?\s+Box\s+\d{1,10}(?:,\s*[\p{L}\p{M} .'-]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?)/giu;
export const redact = (s) => (typeof s === "string" ? s.replace(EMAIL_RE, "[hidden]").replace(PHONE_RE, "[hidden]").replace(DIGIT_RUN_RE, "[hidden]").replace(STREET_ADDRESS_RE, "[hidden address]") : s);
export const maskPhone = (p) => (typeof p === "string" && p.length >= 6 ? `${p.slice(0, 2)}${"•".repeat(p.length - 6)}${p.slice(-4)}`.replace(/^(\+1)(•+)/, "$1$2") : p ? "••••" : p);
export const maskEmail = (e) => (typeof e === "string" && e.includes("@") ? `${e[0]}•••@${e.split("@")[1]}` : e);

/** Roles without leads.read_contact never receive raw phone/email, including inside free text. */
export function maskLead(lead, role) {
  if (can(role, "leads.read_contact")) return lead;
  const out = { ...lead, phone: maskPhone(lead.phone), email: maskEmail(lead.email), contactMasked: true };
  for (const k of ["issue_text", "summary", "preferred_time", "name"]) if (k in out) out[k] = redact(out[k]);
  for (const k of ["address_line1", "address_line2", "city", "state"]) if (out[k] != null) out[k] = "[hidden]";
  if (out.events) out.events = out.events.map((e) => ({ type: e.type, created_at: e.created_at })); // event detail may carry actor/conversation ids
  return out;
}
export function maskMessages(messages, role) {
  return can(role, "leads.read_contact") ? messages : messages.map((m) => ({ ...m, content: redact(m.content) }));
}
