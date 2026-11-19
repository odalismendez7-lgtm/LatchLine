// HTTP routes for accounts (/api/auth/*, /api/me) and the business dashboard (/api/biz/:id/*).
//
// Browser-facing protections:
//  - session token only in an HttpOnly, SameSite=Strict cookie (`__Host-` + Secure over https)
//  - every non-GET request must be same-origin (Origin header) AND carry the per-session
//    X-CSRF-Token (pre-login POSTs are same-origin checked only)
//  - JSON only, small bodies, no-store, nosniff
//  - business ids in URLs are requests, authorized per request via authz.js
//
// DEMO vs PRODUCTION: the logic is real (hashing, sessions, throttles), but account emails go
// through the MOCK mailer, so nobody receives a real verification or reset email. See docs/SECURITY.md.
import { authorizeBusiness, maskLead, maskMessages } from "./authz.js";
import { createContactService } from "./contactService.js";
import { settingsFromKb, applySettings } from "./settings.js";
import { actionsFor, can } from "../auth/permissions.js";
import { describeStatus } from "../notify/status.js";
import { randomToken, sha256Hex } from "../auth/crypto.js";
import { normalizeEmail } from "../validation/normalize.js";

const MAX_BODY = 16 * 1024;
const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
const out = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...H, ...extra } });
const err = (status, error, extra = {}) => out({ error, ...extra }, status, status === 429 && extra.retryAfterSec ? { "Retry-After": String(extra.retryAfterSec) } : {});
const AUTH_STATUS = { invalid_credentials: 401, email_not_verified: 403, rate_limited: 429, invalid_token: 400, weak_password: 400, invalid_email: 400, invalid_business_name: 400 };

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
const csvCell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };

export function createDashboardApi({ db, auth, mailer, now = Date.now, devMode = false }) {
  const cfg = auth.config;

  const cookieName = (secure) => (secure ? "__Host-ll_session" : "ll_session");
  const setCookie = (secure, token, maxAgeSec) => `${cookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
  const clearCookie = (secure) => setCookie(secure, "", 0);

  async function readBody(request) {
    const ct = request.headers.get("Content-Type") || "";
    if (!ct.toLowerCase().startsWith("application/json")) return { error: err(415, "JSON required") };
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > MAX_BODY) return { error: err(413, "Request too large") };
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY) return { error: err(413, "Request too large") };
    if (raw.trim() === "") return { body: {} };
    try { const b = JSON.parse(raw); if (!b || typeof b !== "object" || Array.isArray(b)) throw 0; return { body: b }; } catch { return { error: err(400, "Invalid JSON") }; }
  }

  async function handle(request) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (!(p.startsWith("/api/auth/") || p.startsWith("/api/biz/") || p === "/api/me" || (devMode && p === "/dev/simulated-mail"))) return null;

    const secure = url.protocol === "https:";
    const method = request.method;
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const mutating = method !== "GET" && method !== "HEAD";

    try {
      // Same-origin gate for every state-changing request.
      if (mutating) {
        const o = request.headers.get("Origin");
        if (!o || o !== url.origin) return err(403, "Cross-origin request refused");
      }

      if (devMode && p === "/dev/simulated-mail") {
        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return err(404, "Not found");
        return out({ banner: "SIMULATED — nothing was sent. Development mailbox only.", messages: [...mailer.outbox].reverse().slice(0, 50) });
      }

      const token = readCookie(request, cookieName(secure));
      const session = token ? await auth.authenticate(token) : null;
      const needCsrf = () => mutating && (!session || request.headers.get("X-CSRF-Token") !== session.csrf);

      // ---------------- account routes ----------------
      if (p.startsWith("/api/auth/") || p === "/api/me") {
        if (p === "/api/me" && method === "GET") {
          if (!session) return err(401, "Sign in required");
          const ms = await auth.repo.membershipsForUser(session.userId);
          return out({ user: { email: session.email }, csrf: session.csrf, businesses: ms.map((m) => ({ id: m.business_id, name: m.name, role: m.role, permissions: actionsFor(m.role) })) });
        }
        if (method !== "POST") return err(405, "Method not allowed");
        const name = p.slice("/api/auth/".length);
        const pre = ["register", "login", "verify-email", "resend-verification", "forgot-password", "reset-password"];
        if (!pre.includes(name) && !["logout", "logout-everywhere", "change-password", "accept-invite"].includes(name)) return err(404, "Not found");
        if (!pre.includes(name)) { if (!session) return err(401, "Sign in required"); if (needCsrf()) return err(403, "Bad CSRF token"); }
        const { body, error } = await readBody(request);
        if (error) return error;
        const map = (r, okBody = { ok: true }) => (r.ok ? out(okBody) : err(AUTH_STATUS[r.code] ?? 400, r.code, r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}));

        switch (name) {
          case "register": { const r = await auth.register({ email: body.email, password: body.password, businessName: body.businessName, ip }); return map(r); }
          case "verify-email": return map(await auth.verifyEmail({ token: body.token }));
          case "resend-verification": return map(await auth.resendVerification({ email: body.email, ip }));
          case "forgot-password": return map(await auth.forgotPassword({ email: body.email, ip }));
          case "reset-password": return map(await auth.resetPassword({ token: body.token, newPassword: body.newPassword }));
          case "login": {
            const r = await auth.login({ email: body.email, password: body.password, ip });
            if (!r.ok) return map(r);
            return out({ ok: true, csrf: r.csrf }, 200, { "Set-Cookie": setCookie(secure, r.token, Math.floor(cfg.absoluteMs / 1000)) });
          }
          case "logout": await auth.logout(session.sessionId); return out({ ok: true }, 200, { "Set-Cookie": clearCookie(secure) });
          case "logout-everywhere": await auth.logoutEverywhere(session.userId); return out({ ok: true }, 200, { "Set-Cookie": clearCookie(secure) });
          case "change-password": return map(await auth.changePassword({ userId: session.userId, sessionId: session.sessionId, currentPassword: body.currentPassword, newPassword: body.newPassword }));
          case "accept-invite": { const r = await auth.acceptInvitation({ userId: session.userId, token: body.token }); return r.ok ? out({ ok: true, businessId: r.businessId, role: r.role }) : err(400, "invalid_token"); }
        }
      }

      // ---------------- business routes ----------------
      const m = p.match(/^\/api\/biz\/([^/]+)\/(.+)$/);
      if (!m) return err(404, "Not found");
      const bizId = decodeURIComponent(m[1]);
      const parts = m[2].split("/").map(decodeURIComponent);
      const R = {
        "GET overview": ["overview.read"], "GET leads": ["leads.read"], "GET leads/export.csv": ["leads.export"], "GET leads/:id": ["leads.read"],
        "PATCH leads/:id": ["leads.update_status"], "DELETE leads/:id": ["leads.delete"],
        "GET conversations": ["conversations.read"], "GET conversations/:id": ["conversations.read"], "GET handoffs": ["handoffs.read"], "GET notifications": ["notifications.read"],
        "GET settings": ["settings.read"], "PUT settings": ["settings.write"],
        "GET contacts": ["contacts.read"], "POST contacts": ["contacts.write"], "DELETE contacts/:id": ["contacts.write"], "PATCH contacts/:id": ["contacts.write"],
        "POST contacts/:id/send-code": ["contacts.write"], "POST contacts/:id/confirm": ["contacts.write"],
        "GET team": ["team.read"], "POST team/invitations": ["team.write"], "DELETE team/invitations/:id": ["team.write"], "PATCH team/members/:id": ["team.write"], "DELETE team/members/:id": ["team.write"],
        "GET audit": ["audit.read"],
      };
      const key = (() => {
        const segs = parts;
        if (segs[0] === "team") return `${method} ${["team", segs[1], segs[2] ? ":id" : null].filter(Boolean).join("/")}`;
        if (["leads", "conversations", "contacts"].includes(segs[0]) && segs[1] && segs[1] !== "export.csv") return `${method} ${[segs[0], ":id", segs[2]].filter(Boolean).join("/")}`;
        return `${method} ${segs.join("/")}`;
      })();
      const need = R[key];
      if (!need) return session ? err(404, "Not found") : err(401, "Sign in required");
      if (needCsrf() && session) return err(403, "Bad CSRF token");

      const az = await authorizeBusiness({ auth, db, session, businessId: bizId, action: need[0] });
      if (!az.ok) return err(az.status, az.error);
      const { T, role } = az;
      const actor = session.userId;
      const q = url.searchParams;
      const dbErr = (e) => {
        if (e?.code === "not_found") return err(404, "Not found");
        if (e?.code === "invalid_data") return err(409, "That change is not allowed");
        throw e;
      };

      let body = {};
      if (["POST", "PUT", "PATCH"].includes(method)) { const r = await readBody(request); if (r.error) return r.error; body = r.body; }
      const id = parts[0] === "team" ? parts[2] : parts[1];

      switch (key) {
        case "GET overview": return out({ role, overview: await T.dashboard.overview(), notificationsNeedingAttention: can(role, "notifications.read") ? (await T.notifications.needsAttention({ now: new Date(now()).toISOString() })).length : undefined });
        case "GET leads": {
          let r; try { r = await T.dashboard.searchLeads({ status: q.get("status"), urgent: q.get("urgent"), q: q.get("q"), limit: q.get("limit") ?? 25, offset: q.get("offset") ?? 0 }); } catch (e) { return e?.code === "invalid_data" ? err(400, "Unknown status") : dbErr(e); }
          return out({ total: r.total, leads: r.rows.map((l) => maskLead(l, role)) });
        }
        case "GET leads/export.csv": {
          const rows = await T.dashboard.exportLeads();
          await T.dashboard.recordExport(actor, rows.length);
          const cols = ["id", "created_at", "status", "emergency", "name", "phone", "email", "zip", "issue_category", "issue_text", "urgency", "preferred_contact", "preferred_time", "summary"];
          const csv = [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
          return new Response(csv, { status: 200, headers: { ...H, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="leads.csv"' } });
        }
        case "GET leads/:id": {
          const l = await T.dashboard.leadDetail(id); if (!l) return err(404, "Not found");
          const notifs = can(role, "notifications.read") ? (await T.notifications.listForLead(id)).map((n) => ({ ...n, simulated: !!n.simulated, description: describeStatus(n) })) : undefined;
          return out({ lead: maskLead(l, role), notifications: notifs });
        }
        case "PATCH leads/:id": try { return out({ ok: true, ...(await T.dashboard.setLeadStatus(actor, id, body.status)) }); } catch (e) { return e?.code === "invalid_data" ? err(400, "Unknown status") : dbErr(e); }
        case "DELETE leads/:id": try { await T.dashboard.deleteLead(actor, id); return out({ ok: true }); } catch (e) { return dbErr(e); }
        case "GET conversations": try { return out({ conversations: await T.dashboard.listConversations({ status: q.get("status"), urgent: q.get("urgent"), limit: q.get("limit") ?? 25, offset: q.get("offset") ?? 0 }) }); } catch (e) { return e?.code === "invalid_data" ? err(400, "Unknown status") : dbErr(e); }
        case "GET conversations/:id": { const c = await T.dashboard.conversationDetail(id); if (!c) return err(404, "Not found"); return out({ conversation: { ...c, messages: maskMessages(c.messages, role) } }); }
        case "GET handoffs": { const rows = await T.dashboard.handoffs(); return out({ handoffs: rows.map((r) => maskLead({ ...r, issue_text: r.issue_text }, role)) }); }
        case "GET notifications": {
          const rows = await T.dashboard.notificationHistory(Number(q.get("limit")) || 50);
          const attention = await T.notifications.needsAttention({ now: new Date(now()).toISOString() });
          return out({ simulatedOnly: rows.every((n) => n.simulated) || undefined, notifications: rows.map((n) => ({ ...n, simulated: !!n.simulated, description: describeStatus(n) })), needsAttention: attention.map((n) => ({ ...n, description: describeStatus(n) })) });
        }
        case "GET settings": { const kb = await T.knowledge.get(); return out({ settings: settingsFromKb(kb?.document, await T.profile()), version: kb?.version ?? 0 }); }
        case "PUT settings": {
          const kb = await T.knowledge.get(); const business = await T.profile();
          const r = applySettings({ kb: kb?.document ?? null, business, input: body, userId: actor, nowIso: new Date(now()).toISOString() });
          if (!r.ok) return err(400, "Invalid settings", { details: r.errors });
          if (r.newName) await T.dashboard.updateBusinessName(actor, r.newName);
          await T.knowledge.set(r.doc);
          await T.members.record(actor, "settings_updated", null, { fields: r.changed });
          return out({ ok: true, changed: r.changed, settings: settingsFromKb(r.doc, await T.profile()) });
        }
        case "GET audit": return out({ events: (await T.members.audit(Number(q.get("limit")) || 100)).map((e) => ({ ...e, detail: (() => { try { return JSON.parse(e.detail); } catch { return {}; } })() })) });
        case "GET team": return out({ members: await T.members.list(), invitations: await T.members.listInvitations() });
      }

      // contacts
      if (parts[0] === "contacts") {
        const C = createContactService({ T, mailer, now });
        switch (key) {
          case "GET contacts": return out({ contacts: await C.list(), mode: mailer.simulated ? "simulated" : "real" });
          case "POST contacts": { const r = await C.add(actor, { channel: body.channel, address: body.address }); return r.ok ? out(r, 201) : err(r.code === "duplicate" ? 409 : 400, r.code); }
          case "DELETE contacts/:id": { const r = await C.remove(actor, id); return r.ok ? out(r) : err(404, "Not found"); }
          case "PATCH contacts/:id": { const r = await C.setEnabled(actor, id, body.enabled === true); return r.ok ? out(r) : err(404, "Not found"); }
          case "POST contacts/:id/send-code": { const r = await C.sendCode(actor, id); return r.ok ? out(r) : err({ not_found: 404, cooldown: 429, daily_limit: 429, send_failed: 502, already_verified: 409 }[r.code] ?? 400, r.code, r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}); }
          case "POST contacts/:id/confirm": { const r = await C.confirmCode(actor, id, body.code); return r.ok ? out(r) : err(r.code === "not_found" ? 404 : 400, r.code, r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}); }
        }
      }

      // team
      try {
        switch (key) {
          case "POST team/invitations": {
            const e = normalizeEmail(body.email); if (!e.ok) return err(400, "invalid_email");
            if (!["manager", "staff", "viewer"].includes(body.role)) return err(400, "invalid_role");
            const tok = randomToken();
            await T.members.createInvitation({ actorId: actor, email: e.value, role: body.role, tokenHash: await sha256Hex(tok), expiresAt: new Date(now() + 7 * 86_400_000).toISOString(), now: new Date(now()).toISOString() });
            try { await mailer.send({ channel: "email", to: e.value, template: "invitation", data: { token: tok, role: body.role } }); } catch { return err(502, "send_failed"); }
            return out({ ok: true, simulated: !!mailer.simulated }, 201);
          }
          case "DELETE team/invitations/:id": await T.members.revokeInvitation(actor, id); return out({ ok: true });
          case "PATCH team/members/:id": await T.members.setRole(actor, id, body.role); return out({ ok: true });
          case "DELETE team/members/:id": await T.members.remove(actor, id); return out({ ok: true });
        }
      } catch (e) { return e?.code === "invalid_data" ? err(409, "That change is not allowed") : dbErr(e); }

      return err(404, "Not found");
    } catch {
      return err(500, "Something went wrong. Please try again.");
    }
  }
  return { handle };
}
