// The HTTP application, built from injected dependencies so tests can swap the
// database, AI router, clock and rate limiter. Cloudflare-specific wiring lives
// in src/index.js; nothing here imports node-only modules.
//
// Request flow for POST /api/chat:
//   rate limit (per client) -> body size/JSON checks -> resolve business from
//   siteKey -> origin must be registered for THAT business -> per-business
//   limit -> engine. The business is never taken from anything but the siteKey.

import { handleMessage } from "./engine/engine.js";
import { platformRepo } from "./db/tenant.js";
import { createLimiter, hashKey } from "./ratelimit/limiter.js";
import { KnowledgeStore } from "./knowledge/store.js";
import { validateKnowledgeBase } from "./knowledge/schema.js";
import { forBusiness } from "./db/tenant.js";
import { dispatchDue } from "./notify/dispatcher.js";
import { plumbingPack } from "./packs/plumbing.js";
import { detectEmergency, composeSafetyReply } from "./safety/detector.js";
import { normalizeMessage } from "./validation/normalize.js";
import { createAuthService } from "./auth/service.js";
import { createDashboardApi } from "./dashboard/api.js";
import { dashboardPage } from "./dashboard/page.js";

const MAX_BODY_BYTES = 8 * 1024;
const PACKS = { plumbing: plumbingPack };

export function createApp({ db, router = null, store, salt, clientLimit = { limit: 30, windowMs: 60_000 }, businessLimit = { limit: 600, windowMs: 60_000 }, now = Date.now, showMockReplies = false, extraKnownOrigins = [], channels = null, accounts = null }) {
  if (typeof salt !== "string" || salt.length < 8) throw new Error("createApp needs a salt of at least 8 characters");
  const platform = platformRepo(db);
  const clientLimiter = createLimiter({ store, ...clientLimit, now });
  const businessLimiter = createLimiter({ store, ...businessLimit, now });

  // Owner accounts + dashboard. Enabled only when a mailer is supplied (mock only today).
  const auth = accounts ? createAuthService({ db, mailer: accounts.mailer, store, salt, now, iterations: accounts.iterations, cfg: accounts.cfg }) : null;
  const dashboard = accounts ? createDashboardApi({ db, auth, mailer: accounts.mailer, now, devMode: accounts.devMode === true }) : null;

  const baseHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
  const json = (data, status, corsOrigin, extra = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...baseHeaders,
        "Access-Control-Allow-Origin": corsOrigin || "null",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        ...extra,
      },
    });

  async function originKnown(origin) {
    if (!origin) return false;
    if (extraKnownOrigins.includes(origin)) return true;
    try { return await platform.isKnownOrigin(origin); } catch { return false; }
  }

  async function loadKnowledge(businessId) {
    try {
      const row = await forBusiness(db, businessId).knowledge.get();
      if (!row?.document) return null;
      if (!validateKnowledgeBase(row.document).ok || row.document.businessId !== businessId) return null;
      const s = new KnowledgeStore();
      s.add(row.document);
      return s.forBusiness(businessId);
    } catch {
      return null; // safety replies still work without it
    }
  }

  async function safetyOnlyReply(request) {
    try {
      const declared = Number(request.headers.get("Content-Length") || 0);
      if (declared > MAX_BODY_BYTES) return null;
      const raw = await request.clone().text();
      if (raw.length > MAX_BODY_BYTES) return null;
      const body = JSON.parse(raw);
      const norm = normalizeMessage(body?.message);
      if (!norm.ok) return null;
      const safety = detectEmergency(norm.value, { pack: plumbingPack });
      if (!safety.emergency) return null;
      return {
        reply: `${composeSafetyReply(safety, { leadSystemConnected: false })}\n\nYou're sending messages too quickly, so this message was not saved and nothing was sent to the business.`,
        conversationId: null, urgent: true, leadStatus: "not_saved", persisted: false, rateLimited: true,
        degraded: { database: false, ai: false }, mode: "development",
      };
    } catch { return null; }
  }

  // Notifications: best-effort dispatch right after a lead/handoff is queued, plus
  // a scheduled run for retries. Dispatch failures never change the customer's reply.
  const pending = new Set();
  const kick = (ctx) => {
    if (!channels) return;
    const p = dispatchDue({ db, channels, now: () => new Date(now()).toISOString() }).catch(() => {}).finally(() => pending.delete(p));
    pending.add(p);
    try { ctx?.waitUntil?.(p); } catch { /* ignore */ }
  };

  async function runScheduled() {
    const out = { reconciled: 0, errors: [], dispatch: null };
    try {
      for (const id of await platform.activeBusinessIds()) {
        try { out.reconciled += (await forBusiness(db, id).notifications.reconcileMissing({ now: new Date(now()).toISOString() })).enqueued; }
        catch { if (!out.errors.includes("reconcile_failed")) out.errors.push("reconcile_failed"); }
      }
    } catch { out.errors.push("database_unavailable"); }
    out.dispatch = channels ? await dispatchDue({ db, channels, now: () => new Date(now()).toISOString() }) : null;
    return out;
  }

  return {
    runScheduled,
    auth,
    idle: () => Promise.all([...pending]),
    async fetch(request, ctx) {
      const url = new URL(request.url);
      const origin = request.headers.get("Origin") || "";

      try {
        if (request.method === "OPTIONS") {
          const ok = await originKnown(origin);
          return new Response(null, {
            status: ok ? 204 : 403,
            headers: ok ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" } : { Vary: "Origin" },
          });
        }

        if (dashboard) {
          if (request.method === "GET" && (url.pathname === "/app" || url.pathname === "/app/")) return dashboardPage({ devMode: accounts.devMode === true });
          const r = await dashboard.handle(request);
          if (r) return r;
        }

        if (url.pathname === "/health" && request.method === "GET") {
          let databaseConnected = false;
          try { databaseConnected = (await platform.ping()) === true; } catch { databaseConnected = false; }
          return json({ ok: databaseConnected, service: "LATCHLINE API", mode: "development", realAIConnected: false, databaseConnected, note: "Mock AI only. Not production-ready." }, databaseConnected ? 200 : 503, (await originKnown(origin)) ? origin : "");
        }

        if (url.pathname === "/api/chat" && request.method === "POST") {
          const ip = request.headers.get("CF-Connecting-IP") || "unknown";
          const clientKey = await hashKey(salt, "client", ip);
          const rl = await clientLimiter.check(clientKey);
          const known = await originKnown(origin);
          const cors = known ? origin : "";
          if (!rl.allowed) {
            // Safety exception: pure-code emergency detection (no database, no AI) still
            // answers a rate-limited client, because blocking a person in danger is worse
            // than the CPU cost. Nothing is stored or sent to the business.
            const early = await safetyOnlyReply(request, origin);
            if (early) return json(early, 200, cors);
            return json({ error: "Too many requests. Please wait and try again.", retryAfterSec: rl.retryAfterSec }, 429, cors, { "Retry-After": String(rl.retryAfterSec) });
          }

          const declared = Number(request.headers.get("Content-Length") || 0);
          if (declared > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413, cors);
          const raw = await request.text();
          if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413, cors);
          let body;
          try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
          if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400, cors);

          let business;
          try { business = await platform.businessBySiteKey(body.siteKey); } catch { return json({ error: "Service temporarily unavailable", retryable: true }, 503, cors); }
          if (!business) return json({ error: "Unknown site key" }, 404, cors);
          if (business.status !== "active") return json({ error: "This chat is not available" }, 403, cors);
          if (!origin || !business.origins.includes(origin)) return json({ error: "Origin not allowed" }, 403, "");

          const bl = await businessLimiter.check(await hashKey(salt, "business", business.id));
          if (!bl.allowed) return json({ error: "This chat is busy. Please try again shortly.", retryAfterSec: bl.retryAfterSec }, 429, origin, { "Retry-After": String(bl.retryAfterSec) });

          const kb = await loadKnowledge(business.id);
          const result = await handleMessage(
            { db, businessId: business.id, kb, router, pack: PACKS[business.industry] ?? plumbingPack, showMockReplies },
            { message: body.message, conversationId: typeof body.conversationId === "string" ? body.conversationId.slice(0, 80) : null }
          );
          if (result.notificationsQueued) kick(ctx);
          if (!result.ok) return json({ error: "Message must be 1–1200 characters", code: result.error }, 400, origin);
          return json({
            reply: result.reply, conversationId: result.conversationId, urgent: result.urgent,
            leadStatus: result.leadStatus, persisted: result.persisted, degraded: { database: result.degraded.database, ai: result.degraded.ai },
            mode: "development", notice: "Development build: mock AI only, not production-ready.",
          }, 200, origin);
        }

        return json({ error: "Not found" }, 404, (await originKnown(origin)) ? origin : "");
      } catch {
        // Never leak internals.
        return json({ error: "Something went wrong. Please try again." }, 500, "");
      }
    },
  };
}
