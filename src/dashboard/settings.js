// Business settings <-> verified knowledge base.
// Saving a setting means the signed-in owner/manager explicitly CONFIRMED it ("confirm": true),
// so it is stored as a verified fact with verifiedBy = that user and verifiedAt = now. Without the
// confirmation nothing is saved. Cleared fields become unverified/unknown, never guessed.
import { validateKnowledgeBase, isUsableFact } from "../knowledge/schema.js";

const TEXT_FIELDS = { hours: "hours", holidayHours: "holiday_hours", afterHoursPolicy: "after_hours_policy", pricing: "pricing", diagnosticFee: "diagnostic_fee", emergencyFee: "emergency_fee", appointments: "appointments", contactPhone: "contact_phone", contactEmail: "contact_email", humanEscalation: "human_escalation" };
const MAX_TEXT = 600;

export function settingsFromKb(kb, profile) {
  const f = kb?.facts ?? {};
  const val = (k) => (isUsableFact(f[k]) ? f[k].value : null);
  const out = { companyName: profile?.name ?? kb?.businessName ?? "", services: [], serviceAreaText: "", serviceZips: [], confirmedBy: {} };
  if (isUsableFact(f.services)) out.services = Array.isArray(f.services.value) ? f.services.value : [];
  if (isUsableFact(f.service_area)) { out.serviceAreaText = typeof f.service_area.value === "string" ? f.service_area.value : ""; out.serviceZips = f.service_area.zips ?? []; }
  for (const [field, key] of Object.entries(TEXT_FIELDS)) out[field] = val(key) ?? "";
  for (const [key, fact] of Object.entries(f)) if (isUsableFact(fact)) out.confirmedBy[key] = { by: fact.verifiedBy, at: fact.verifiedAt };
  return out;
}

export function applySettings({ kb, business, input, userId, nowIso }) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["invalid body"] };
  if (input.confirm !== true) return { ok: false, errors: ["You must confirm that these details are accurate before saving."] };

  const doc = kb ? structuredClone(kb) : { schemaVersion: 1, businessId: business.id, businessName: business.name, industry: business.industry, facts: {} };
  doc.facts ??= {};
  const by = `user:${userId}`;
  const setFact = (key, value, extra = {}) => {
    const has = Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim() !== "" : false;
    const hasZips = Array.isArray(extra.zips) && extra.zips.length > 0;
    if (has || hasZips) doc.facts[key] = { value: has ? value : null, ...extra, verified: true, verifiedBy: by, verifiedAt: nowIso };
    else doc.facts[key] = { value: null, verified: false };
  };
  const changed = [];
  let newName = null;

  if ("companyName" in input) {
    if (typeof input.companyName !== "string" || input.companyName.trim().length < 2 || input.companyName.length > 100) errors.push("companyName must be 2–100 characters");
    else { newName = input.companyName.trim().replace(/[\u0000-\u001f\u007f]/g, " "); doc.businessName = newName; changed.push("companyName"); }
  }
  for (const [field, key] of Object.entries(TEXT_FIELDS)) {
    if (!(field in input)) continue;
    const v = input[field];
    if (typeof v !== "string" || v.length > MAX_TEXT) { errors.push(`${field} must be text up to ${MAX_TEXT} characters`); continue; }
    setFact(key, v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim()); changed.push(field);
  }
  if ("services" in input) {
    const v = input.services;
    if (!Array.isArray(v) || v.length > 40 || !v.every((s) => typeof s === "string" && s.trim().length >= 1 && s.length <= 80)) errors.push("services must be a list of up to 40 short names");
    else { setFact("services", [...new Set(v.map((s) => s.trim()))]); changed.push("services"); }
  }
  if ("serviceAreaText" in input || "serviceZips" in input) {
    const cur = doc.facts.service_area ?? {};
    const text = "serviceAreaText" in input ? input.serviceAreaText : (typeof cur.value === "string" ? cur.value : "");
    const zips = "serviceZips" in input ? input.serviceZips : (cur.zips ?? []);
    if (typeof text !== "string" || text.length > MAX_TEXT) errors.push("serviceAreaText must be text up to 600 characters");
    else if (!Array.isArray(zips) || zips.length > 300 || !zips.every((z) => typeof z === "string" && /^\d{5}$/.test(z))) errors.push("serviceZips must be 5-digit ZIP codes (up to 300)");
    else { setFact("service_area", text.trim(), { zips: [...new Set(zips)] }); changed.push("serviceArea"); }
  }
  if (errors.length) return { ok: false, errors };
  if (!changed.length) return { ok: false, errors: ["nothing to change"] };
  const v = validateKnowledgeBase(doc);
  if (!v.ok) return { ok: false, errors: ["settings failed validation"] };
  return { ok: true, doc, newName, changed };
}
