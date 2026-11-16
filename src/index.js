
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

function answer(message) {
  if (/gas leak|smell of gas|carbon monoxide|CO alarm/i.test(message)) {
    return {
      reply: "Your safety comes first. Leave the affected area and move to a safe location. Avoid switches, appliances, and ignition sources if you suspect a gas leak. Contact emergency services or your gas utility from a safe location.",
      urgent: true
    };
  }

  if (/electrical|electric shock|sparking|live wire/i.test(message)) {
    return {
      reply: "Stay away from electrical equipment and water that may be in contact with electricity. Do not touch the hazard. Move to safety and contact emergency services if anyone is in immediate danger.",
      urgent: true
    };
  }

  if (/flood|burst pipe|major leak/i.test(message)) {
    return {
      reply: "This may need urgent attention. If safe and you know how, shut off the water supply. Keep away from electrical hazards. Is water still actively flowing?",
      urgent: true
    };
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
