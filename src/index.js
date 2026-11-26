import { detectEmergency, composeSafetyReply } from "./safety/detector.js";
import { plumbingPack } from "./packs/plumbing.js";
import { retrieve } from "./knowledge/retrieve.js";
import { demoAquaflowKb } from "./knowledge/demo-aquaflow.js";
import { createApp } from "./app.js";
import { D1Adapter } from "./db/d1-adapter.js";
import { DbStore, MemoryStore, createLimiter, hashKey } from "./ratelimit/limiter.js";
import { AIRouter } from "./ai/router.js";
import { createProvider } from "./ai/registry.js";
import { createNotifier, createChannelMap } from "./notify/registry.js";
import { DbMockMailer } from "./auth/mailer.js";

// Two modes, chosen by whether a D1 database is bound as env.DB:
//   - no DB bound  -> the stateless PROTOTYPE below (what runs today; no storage)
//   - DB bound     -> the full app in app.js (verified on LOCAL D1 under workerd; UNVERIFIED on hosted D1: KI-15)
// Live AI is opt-in via server-side environment bindings; otherwise the mock remains the default.
//
// Owner accounts + dashboard (Stage 5/6) are OFF unless env.LATCHLINE_ACCOUNTS === "mock-local".
// That mode uses the MOCK mailer only (nothing is ever sent) and exists for local development;
// the checked-in wrangler.toml does not set it, so a deployment of this file serves no accounts
// and no dashboard (KI-32). env.LATCHLINE_DEV_MAILBOX === "1" additionally exposes the simulated
// mailbox, and only to localhost requests.
let appCache = { db: null, key: null, app: null };
function getApp(env) {
  const accountsOn = env.LATCHLINE_ACCOUNTS === "mock-local";
  const aiType = env.LATCHLINE_AI_PROVIDER === "openai" && env.OPENAI_API_KEY && env.OPENAI_MODEL ? "openai" : "mock";
  const emailType = env.LATCHLINE_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY && env.RESEND_FROM_EMAIL ? "resend" : "mock";
  const key = `${accountsOn}|${env.LATCHLINE_DEV_MAILBOX === "1"}|${aiType}|${env.OPENAI_MODEL || ""}|${emailType}|${env.RESEND_FROM_EMAIL || ""}`;
  if (appCache.db !== env.DB || appCache.key !== key) {
    const db = new D1Adapter(env.DB);
    appCache = {
      db: env.DB,
      key,
      app: createApp({
        accounts: accountsOn ? { mailer: new DbMockMailer(db), devMode: env.LATCHLINE_DEV_MAILBOX === "1" } : null,
        db,
        store: new DbStore(db),
        salt: env.RATE_LIMIT_SALT || "",
        router: new AIRouter({ providers: [createProvider(aiType === "openai" ? { type: "openai", apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL } : { type: "mock" })] }),
        mode: aiType === "openai" ? "live-ai" : "development",
        // The mock remains available for unsupported channels; Resend is opt-in and email-only.
        channels: createChannelMap([
          ...(emailType === "resend" ? [createNotifier({ type: "resend-email", apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL })] : []),
          createNotifier({ type: "mock" }),
        ]),
      }),
    };
  }
  return appCache.app;
}

const protoLimiter = createLimiter({ store: new MemoryStore(), limit: 30, windowMs: 60_000 });

const ALLOWED_ORIGINS = [
  "https://odalismendez7-lgtm.github.io"
];

function response(data, status, origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": allowed ? origin : "null",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    }
  });
}

// Stage 2: the keyword rules that used to live here were replaced by the
// deterministic safety layer and verified-knowledge retrieval (see
// docs/KNOWN_ISSUES.md KI-1, KI-2, KI-4). This is still a PROTOTYPE: no AI
// model, no database, and the demo business has no verified facts.
const NOT_CONNECTED_NOTE =
  "This demo isn't connected to the business team yet, so I can't pass your question on.";

function answer(message) {
  // 1. Safety first, independent of everything else.
  const safety = detectEmergency(message, { pack: plumbingPack });
  if (safety.emergency) {
    return {
      reply: composeSafetyReply(safety, { leadSystemConnected: false }),
      urgent: true,
      severity: safety.severity,
      categories: safety.categories
    };
  }

  // 2. Answer only from verified knowledge; anything else is "needs confirmation".
  const found = retrieve(demoAquaflowKb, message);
  if (found.status !== "no_match") {
    const texts = [...new Set(found.results.map((r) => r.text))];
    if (found.results.some((r) => r.status === "unknown")) texts.push(NOT_CONNECTED_NOTE);
    return { reply: texts.join(" "), urgent: false };
  }

  return {
    reply: "I can help organize your plumbing inquiry. Is the problem happening right now, or can it wait?",
    urgent: false
  };
}

export default {
  // Cron entry (retries + recovery). Only meaningful once deployed with a D1 binding; not deployed today.
  async scheduled(event, env, ctx) {
    if (!env || !env.DB || !env.RATE_LIMIT_SALT || env.RATE_LIMIT_SALT.length < 8) return;
    const p = getApp(env).runScheduled();
    ctx?.waitUntil?.(p);
    await p;
  },
  async fetch(request, env) {
    if (env && env.DB) {
      if (!env.RATE_LIMIT_SALT || env.RATE_LIMIT_SALT.length < 8) {
        return new Response(JSON.stringify({ error: "Server is not configured (missing RATE_LIMIT_SALT)." }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
      return getApp(env).fetch(request);
    }
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return response({
        ok: true,
        service: "LATCHLINE API",
        mode: "prototype",
        realAIConnected: false,
        databaseConnected: false
      }, 200, origin);
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (!ALLOWED_ORIGINS.includes(origin)) {
        return response({ error: "Origin not allowed" }, 403, origin);
      }

      const rl = await protoLimiter.check(await hashKey("prototype", request.headers.get("CF-Connecting-IP") || "unknown"));
      if (!rl.allowed) {
        const res = response({ error: "Too many requests. Please wait and try again.", retryAfterSec: rl.retryAfterSec }, 429, origin);
        res.headers.set("Retry-After", String(rl.retryAfterSec));
        return res;
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return response({ error: "Invalid JSON" }, 400, origin);
      }

      const message = typeof body.message === "string"
        ? body.message.trim()
        : "";

      if (!message || message.length > 1200) {
        return response({ error: "Message must be 1–1200 characters" }, 400, origin);
      }

      return response({
        ...answer(message),
        mode: "prototype",
        notice: "No real AI or customer data storage is connected yet."
      }, 200, origin);
    }

    return response({ error: "Not found" }, 404, origin);
  }
};
