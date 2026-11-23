import { wrapDbError } from "./errors.js";

export const nowIso = () => new Date().toISOString();
export const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
export const json = (v) => JSON.stringify(v ?? {});
export const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

export async function guard(fn) {
  try { return await fn(); } catch (e) { throw wrapDbError(e); }
}

// A lead with neither phone nor email is an INCOMPLETE lead: the business cannot reach the customer from it.
// Derived from the data (never stored separately), so it can never disagree with the phone/email columns.
export const CONTACT_MISSING = "CASE WHEN phone IS NULL AND email IS NULL THEN 1 ELSE 0 END AS contact_missing";
