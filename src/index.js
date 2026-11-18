import { detectEmergency, composeSafetyReply } from "./safety/detector.js";
import { plumbingPack } from "./packs/plumbing.js";
import { retrieve } from "./knowledge/retrieve.js";
import { demoAquaflowKb } from "./knowledge/demo-aquaflow.js";
import { createApp } from "./app.js";
import { D1Adapter } from "./db/d1-adapter.js";
import { DbStore, MemoryStore, createLimiter, hashKey } from "./ratelimit/limiter.js";
import { AIRouter } from "./ai/router.js";
import { createProvider } from "./ai/registry.js";

// Two modes, chosen by whether a D1 database is bound as env.DB:
//   - no DB bound  -> the stateless PROTOTYPE below (what runs today; no storage)
//   - DB bound     -> the full app in app.js (UNVERIFIED against real D1: KI-15)
// The AI is always the labeled mock; real providers are refused by the registry.
let appCache = { db: null, app: null };
function getApp(env) {
  if (appCache.db !== env.DB) {
    const db = new D1Adapter(env.DB);
    appCache = {
      db: env.DB,
      app: createApp({
        db,
        store: new DbStore(db),
        salt: env.RATE_LIMIT_SALT || "",
        router: new AIRouter({ providers: [createProvider({ type: "mock" })] }),
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
