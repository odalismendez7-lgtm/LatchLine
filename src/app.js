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
import { normalizeMessage, MAX_MESSAGE_CHARS } from "./validation/normalize.js";
import { createAuthService } from "./auth/service.js";
import { createDashboardApi } from "./dashboard/api.js";
import { dashboardPage } from "./dashboard/page.js";
import { WIDGET_JS, WIDGET_VERSION } from "./widget/widget.bundle.js";

const MAX_BODY_BYTES = 8 * 1024;
const PACKS = { plumbing: plumbingPack };

export function createApp({ db, router = null, store, salt, clientLimit = { limit: 30, windowMs: 60_000 }, businessLimit = { limit: 600, windowMs: 60_000 }, widgetConfigLimit = { limit: 60, windowMs: 60_000 }, now = Date.now, showMockReplies = false, extraKnownOrigins = [], channels = null, accounts = null, mode = "development" }) {
  if (typeof salt !== "string" || salt.length < 8) throw new Error("createApp needs a salt of at least 8 characters");
  const platform = platformRepo(db);
  const clientLimiter = createLimiter({ store, ...clientLimit, now });
  const businessLimiter = createLimiter({ store, ...businessLimit, now });
  const widgetConfigLimiter = createLimiter({ store, ...widgetConfigLimit, now });

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
        "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
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

  // Why a message could not be saved. The safety guidance is identical in every case; only this honest sentence differs.
  const NOT_SAVED = {
    rate: "You're sending messages too quickly, so this message was not saved and nothing was sent to the business.",
    busy: "This chat is very busy right now, so this message was not saved and nothing was sent to the business.",
    toolong: "That message was too long, so it was not saved and nothing was sent to the business. Please send a shorter message.",
    unavailable: "The system is having trouble right now, so this message was not saved and nothing was sent to the business.",
  };

  async function safetyOnlyReply(request, reason = "rate") {
    try {
      const declared = Number(request.headers.get("Content-Length") || 0);
      if (declared > MAX_BODY_BYTES) return null;
      const raw = await request.clone().text();
      if (raw.length > MAX_BODY_BYTES) return null;
      const body = JSON.parse(raw);
      const norm = normalizeMessage(body?.message);
      // an over-long message (long voice dictation, a pasted description) can still describe a danger: look at all of it
      const text = norm.ok ? norm.value : (norm.reason ?? norm.error) === "too_long" ? body.message.slice(0, MAX_BODY_BYTES) : null;
      if (text == null) return null;
      const safety = detectEmergency(text, { pack: plumbingPack });
      if (!safety.emergency) return null;
      return {
        reply: `${composeSafetyReply(safety, { leadSystemConnected: false })}\n\n${NOT_SAVED[reason] ?? NOT_SAVED.unavailable}`,
        conversationId: null, urgent: true, leadStatus: "not_saved", persisted: false, rateLimited: reason === "rate", notSavedReason: reason,
        degraded: { database: false, ai: false }, mode,
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
            headers: ok ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key", "Access-Control-Max-Age": "600", Vary: "Origin" } : { Vary: "Origin" },
          });
        }

        // The embeddable chat widget (static, public code, no secrets). Cached briefly; the version is the content hash.
        if (url.pathname === "/widget.js" && (request.method === "GET" || request.method === "HEAD")) {
          const etag = `"${WIDGET_VERSION}"`;
          const h = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", ETag: etag, "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" };
          if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: h });
          return new Response(request.method === "HEAD" ? null : WIDGET_JS, { status: 200, headers: h });
        }

        // Public display configuration for the widget: business name and welcome only. The business is found from the
        // site key and the request's origin must be registered for THAT business. Every failure (unknown key, wrong
        // website, inactive business) is the same 404, so this cannot be used to probe which keys or websites exist.
        if (url.pathname === "/api/widget/config" && request.method === "GET") {
          const asked = origin || (request.headers.get("Sec-Fetch-Site") === "same-origin" ? url.origin : "");
          const cors = asked || "*";
          const rl = await widgetConfigLimiter.check(await hashKey(salt, "widgetcfg", request.headers.get("CF-Connecting-IP") || "unknown"));
          if (!rl.allowed) return json({ error: "Too many requests", retryAfterSec: rl.retryAfterSec }, 429, cors, { "Retry-After": String(rl.retryAfterSec) });
          let business = null;
          try { business = await platform.businessBySiteKey(url.searchParams.get("siteKey")); } catch { return json({ error: "Service temporarily unavailable", retryable: true }, 503, cors); }
          if (!business || business.status !== "active" || !asked || !business.origins.includes(asked)) return json({ error: "Not available" }, 404, cors);
          const name = String(business.name).slice(0, 120);
          return json({ name, welcome: `Hi, this is the ${name} website assistant. What can I help you with?`, mode, maxMessageChars: MAX_MESSAGE_CHARS, apiVersion: 1 }, 200, asked, { "Cache-Control": "private, max-age=60" });
        }

        if (dashboard) {
          if (request.method === "GET" && (url.pathname === "/app" || url.pathname === "/app/")) return dashboardPage({ devMode: accounts.devMode === true });
          const r = await dashboard.handle(request);
          if (r) return r;
        }

        if (url.pathname === "/health" && request.method === "GET") {
          let databaseConnected = false;
          try { databaseConnected = (await platform.ping()) === true; } catch { databaseConnected = false; }
          return json({ ok: databaseConnected, service: "LATCHLINE API", mode, realAIConfigured: mode === "live-ai", realAIConnected: false, databaseConnected, note: mode === "live-ai" ? "Live AI configured; other production gates may remain." : "Mock AI only. Not production-ready." }, databaseConnected ? 200 : 503, (await originKnown(origin)) ? origin : "");
        }

        if (url.pathname === "/api/chat" && request.method === "POST") {
          // Taken before anything reads the body, so every failure path below can still look for an emergency.
          const bodyCopy = request.clone();
          const safetyFallback = async (reason, cors) => { const e = await safetyOnlyReply(bodyCopy, reason); return e ? json(e, 200, cors) : null; };
          try {
          const ip = request.headers.get("CF-Connecting-IP") || "unknown";
          const clientKey = await hashKey(salt, "client", ip);
          const rl = await clientLimiter.check(clientKey);
          const known = await originKnown(origin);
          const cors = known ? origin : "";
          if (!rl.allowed) {
            // Safety exception: pure-code emergency detection (no database, no AI) still
            // answers a rate-limited client, because blocking a person in danger is worse
            // than the CPU cost. Nothing is stored or sent to the business.
            const early = await safetyOnlyReply(request, "rate");
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
          try { business = await platform.businessBySiteKey(body.siteKey); } catch { return (await safetyFallback("unavailable", cors || "*")) ?? json({ error: "Service temporarily unavailable", retryable: true }, 503, cors); }
          if (!business || business.status !== "active" || !origin || !business.origins.includes(origin)) {
            // Do not let a caller distinguish a real site key from an origin mismatch or suspended tenant.
            // The key is public, but this avoids turning the endpoint into a tenant-enumeration oracle.
            return json({ error: "Chat unavailable" }, 404, "");
          }

          const bl = await businessLimiter.check(await hashKey(salt, "business", business.id));
          if (!bl.allowed) return (await safetyFallback("busy", origin)) ?? json({ error: "This chat is busy. Please try again shortly.", retryAfterSec: bl.retryAfterSec }, 429, origin, { "Retry-After": String(bl.retryAfterSec) });

          // Validate the customer message before claiming an idempotency key. Otherwise a malformed
          // request could leave a permanent "processing" row that blocks a corrected retry.
          const normalized = normalizeMessage(body.message);
          if (!normalized.ok) {
            if (normalized.reason === "too_long") {
              const e = await safetyOnlyReply(bodyCopy, "toolong");
              if (e) return json(e, 200, origin);
            }
            return json({ error: "Message must be 1–1200 characters", code: normalized.error || normalized.reason }, 400, origin);
          }

          // Optional idempotency key: replay a completed response for a client retry.
          // The ledger is tenant-scoped and claimed atomically via INSERT OR IGNORE.
          const requestKey = request.headers.get("Idempotency-Key") || "";
          let dedupClaimed = false;
          const conversationId = typeof body.conversationId === "string" ? body.conversationId.slice(0, 80) : null;
          if (requestKey) {
            if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestKey)) return json({ error: "Invalid idempotency key" }, 400, origin);
            // A key identifies one exact logical request. Reusing it with edited content
            // must not silently replay a response belonging to a different message.
            const requestFingerprint = await hashKey(salt, "chat-request", JSON.stringify({ message: normalized.value, conversationId }));
            const t = new Date(now()).toISOString();
            const claim = await db.run("INSERT OR IGNORE INTO chat_request_dedup (business_id, request_key, payload_hash, status, created_at, updated_at) VALUES (?,?,?, 'processing', ?, ?)", [business.id, requestKey, requestFingerprint, t, t]);
            const record = await db.first("SELECT status, payload_hash, response_json FROM chat_request_dedup WHERE business_id = ? AND request_key = ?", [business.id, requestKey]);
            if (!record) throw new Error("Dedup claim missing");
            if (record.payload_hash !== requestFingerprint) return json({ error: "Idempotency key was already used for a different request", code: "idempotency_key_conflict" }, 409, origin);
            if (record.status === "completed" && record.response_json) return json(JSON.parse(record.response_json), 200, origin);
            if (record.status === "processing" && !claim.changes) return json({ error: "Request already processing", retryable: true }, 409, origin);
            dedupClaimed = true;
          }

          const kb = await loadKnowledge(business.id);
          const result = await handleMessage(
            { db, businessId: business.id, kb, router, pack: PACKS[business.industry] ?? plumbingPack, showMockReplies },
            { message: normalized.value, conversationId }
          );
          if (result.notificationsQueued) kick(ctx);
          if (!result.ok) {
            if (result.error === "message_too_long" || result.error === "too_long") { const e = await safetyOnlyReply(bodyCopy, "toolong"); if (e) return json(e, 200, origin); }
            return json({ error: "Message must be 1–1200 characters", code: result.error }, 400, origin);
          }
          const responseBody = {
            reply: result.reply, conversationId: result.conversationId, urgent: result.urgent,
            leadStatus: result.leadStatus, persisted: result.persisted, degraded: { database: result.degraded.database, ai: result.degraded.ai },
            mode, notice: mode === "live-ai" ? "Live AI is enabled; the platform is not yet production-ready." : "Development build: mock AI only, not production-ready.",
          };
          if (dedupClaimed) {
            const t = new Date(now()).toISOString();
            await db.run("UPDATE chat_request_dedup SET status = 'completed', conversation_id = ?, response_json = ?, updated_at = ? WHERE business_id = ? AND request_key = ? AND status = 'processing'", [result.conversationId, JSON.stringify(responseBody), t, business.id, requestKey]);
          }
          return json(responseBody, 200, origin);
          } catch (e) {
            // Anything unexpected (limiter store, database, engine): a person describing an emergency still gets the safety guidance.
            // No private data is in that reply, so when the origin cannot be verified (the database may be the thing that failed) it is readable from any site.
            const f = await safetyFallback("unavailable", (await originKnown(request.headers.get("Origin") || "")) ? request.headers.get("Origin") : "*");
            if (f) return f;
            throw e;
          }
        }

        return json({ error: "Not found" }, 404, (await originKnown(origin)) ? origin : "");
      } catch {
        // Never leak internals.
        return json({ error: "Something went wrong. Please try again." }, 500, "");
      }
    },
  };
}
