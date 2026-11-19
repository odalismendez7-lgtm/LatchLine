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
const EMAIL_RE = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g;
export const redact = (s) => (typeof s === "string" ? s.replace(EMAIL_RE, "[hidden]").replace(PHONE_RE, "[hidden]") : s);
export const maskPhone = (p) => (typeof p === "string" && p.length >= 6 ? `${p.slice(0, 2)}${"•".repeat(p.length - 6)}${p.slice(-4)}`.replace(/^(\+1)(•+)/, "$1$2") : p ? "••••" : p);
export const maskEmail = (e) => (typeof e === "string" && e.includes("@") ? `${e[0]}•••@${e.split("@")[1]}` : e);

/** Roles without leads.read_contact never receive raw phone/email, including inside free text. */
export function maskLead(lead, role) {
  if (can(role, "leads.read_contact")) return lead;
  const out = { ...lead, phone: maskPhone(lead.phone), email: maskEmail(lead.email), contactMasked: true };
  for (const k of ["issue_text", "summary", "preferred_time", "name"]) if (k in out) out[k] = redact(out[k]);
  if (out.events) out.events = out.events.map((e) => ({ type: e.type, created_at: e.created_at })); // event detail may carry actor/conversation ids
  return out;
}
export function maskMessages(messages, role) {
  return can(role, "leads.read_contact") ? messages : messages.map((m) => ({ ...m, content: redact(m.content) }));
}
