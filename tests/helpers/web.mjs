// Shared HTTP test harness: a real app on in-memory SQLite with simulated mail, plus signup/role helpers.
import { handleMessage } from "../../src/engine/engine.js";
import { SqliteAdapter } from "../../src/db/sqlite-adapter.js";
import { migrate } from "../../src/db/migrate-node.js";
import { MemoryStore } from "../../src/ratelimit/limiter.js";
import { MockMailer } from "../../src/auth/mailer.js";
import { createApp } from "../../src/app.js";

export const PW = "correct horse battery staple";
export async function web() {
  const db = new SqliteAdapter(":memory:"); migrate(db);
  const mailer = new MockMailer();
  const app = createApp({ db, store: new MemoryStore(), salt: "test-salt-123", accounts: { mailer, iterations: 1500, cfg: { unsafeFastHashForTests: true }, devMode: false } });
  const call = async (method, path, { body, cookie, csrf } = {}) => {
    const h = {}; if (method !== "GET") h.Origin = "http://localhost"; if (cookie) h.Cookie = cookie; if (csrf) h["X-CSRF-Token"] = csrf;
    let payload; if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await app.fetch(new Request("http://localhost" + path, { method, headers: h, body: payload }));
    const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, data, text, headers: res.headers };
  };
  async function signup(email, businessName) {
    await call("POST", "/api/auth/register", { body: { email, password: PW, businessName } });
    await call("POST", "/api/auth/verify-email", { body: { token: mailer.last("verify_email", email).data.token } });
    const r = await call("POST", "/api/auth/login", { body: { email, password: PW } });
    const cookie = r.headers.get("Set-Cookie").split(";")[0];
    const me = await call("GET", "/api/me", { cookie });
    return { cookie, csrf: r.data.csrf, bizId: me.data.businesses[0].id };
  }
  const api = (u, bizId = u.bizId) => ({ get: (p) => call("GET", `/api/biz/${bizId}${p}`, { cookie: u.cookie }), send: (m, p, body) => call(m, `/api/biz/${bizId}${p}`, { cookie: u.cookie, csrf: u.csrf, body }) });
  async function addRole(owner, role) {
    const email = `${role}@acme.example`; const u = await signup(email, `${role} co`);
    await api(owner).send("POST", "/team/invitations", { email, role });
    await call("POST", "/api/auth/accept-invite", { cookie: u.cookie, csrf: u.csrf, body: { token: mailer.last("invitation", email).data.token } });
    return { ...u, bizId: owner.bizId };
  }
  const emergencyChat = async (bizId, msgs) => { let id = null, r; for (const m of msgs) { r = await handleMessage({ db, businessId: bizId, kb: null }, { message: m, conversationId: id }); id = r.conversationId; } return id; };
  return { db, call, signup, api, addRole, emergencyChat };
}

