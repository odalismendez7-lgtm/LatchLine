import { detectEmergency, composeSafetyReply } from "./safety/detector.js";
import { plumbingPack } from "./packs/plumbing.js";
import { retrieve } from "./knowledge/retrieve.js";
import { demoAquaflowKb } from "./knowledge/demo-aquaflow.js";

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
  async fetch(request) {
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
