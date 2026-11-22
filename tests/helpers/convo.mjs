// Transcript harness for conversation tests: runs a customer script against the real engine + in-memory DB.
import { SqliteAdapter } from "../../src/db/sqlite-adapter.js";
import { migrate } from "../../src/db/migrate-node.js";
import { forBusiness, platformRepo } from "../../src/db/tenant.js";
import { KnowledgeStore } from "../../src/knowledge/store.js";
import { handleMessage } from "../../src/engine/engine.js";

const V = { verified: true, verifiedBy: "owner", verifiedAt: "2026-11-01" };
export const kbDoc = (id, name, extra = {}) => ({
  schemaVersion: 1, businessId: id, businessName: name, industry: "plumbing",
  facts: { hours: { value: `${name} hours 8-5`, ...V }, service_area: { value: "Springfield", zips: ["62701"], ...V }, contact_phone: { value: "555-0100", ...V }, services: { value: ["drain cleaning", "leak repair"], ...V } },
  faqs: [], ...extra,
});

export async function world(extraFacts = {}) {
  const db = new SqliteAdapter(":memory:");
  migrate(db);
  const p = platformRepo(db);
  await p.createBusiness({ id: "acme-plumbing", name: "Acme", industry: "plumbing", siteKey: "sk_acme_000000001" });
  await p.createBusiness({ id: "bravo-plumbing", name: "Bravo", industry: "plumbing", siteKey: "sk_bravo_00000001" });
  const store = new KnowledgeStore();
  const a = kbDoc("acme-plumbing", "Acme"); a.facts = { ...a.facts, ...extraFacts };
  store.add(a); store.add(kbDoc("bravo-plumbing", "Bravo"));
  const deps = (id = "acme-plumbing", extra = {}) => ({ db, businessId: id, kb: store.forBusiness(id), ...extra });
  return { db, deps, A: forBusiness(db, "acme-plumbing"), B: forBusiness(db, "bravo-plumbing"), store };
}

/** Starts a conversation and exposes say(); keeps every reply for assertions. */
export function chat(deps) {
  const c = { id: null, replies: [], last: null, async say(message) {
    const r = await handleMessage(deps, { message, conversationId: c.id });
    if (r.ok) { c.id = r.conversationId; c.replies.push(r.reply); }
    c.last = r; return r;
  } };
  return c;
}
export async function script(deps, messages) { const c = chat(deps); for (const m of messages) await c.say(m); return c; }
export const stateOf = async (T, id) => (await T.conversations.get(id)).state;
