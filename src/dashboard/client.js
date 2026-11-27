// Browser code for the dashboard, kept as a plain string so the Worker can serve it with a CSP nonce.
// All server data is rendered with textContent / DOM APIs only (never innerHTML).
export const CLIENT_JS = String.raw`
"use strict";
const DEV = window.__DEV__ === true;
const S = { me: null, biz: null, view: "overview", csrf: null, notice: null };
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (k === "value") e.value = v; else if (k === "checked") e.checked = !!v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
async function api(method, path, body) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (S.csrf) headers["X-CSRF-Token"] = S.csrf;
  try {
    const r = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch (e) { data = null; }
    // A 401 on an authenticated call means the session ended (idle or absolute expiry, logout elsewhere, or revoked).
    if (r.status === 401 && S.me && !path.startsWith("/api/auth/")) { sessionEnded(); }
    return { status: r.status, ok: r.ok, data: data || {}, res: r };
  } catch (e) { return { status: 0, ok: false, data: { error: "network" } }; }
}
const B = (p) => "/api/biz/" + encodeURIComponent(S.biz.id) + p;
const can = (a) => S.biz && S.biz.permissions.includes(a);
const root = $("#root");
const fmt = (s) => { try { return new Date(s).toLocaleString(); } catch (e) { return s || ""; } };
const NICE = { auth_unavailable: "Sign-in is unavailable on this server: password protection could not run. Nothing was changed.", temporarily_unavailable: "The service is temporarily unavailable. Please try again in a few seconds.",  invalid_credentials: "Wrong email or password.", email_not_verified: "Please verify your email first.", rate_limited: "Too many attempts. Please wait and try again.", weak_password: "Use at least 12 characters and avoid common passwords.", invalid_email: "Enter a valid email address.", invalid_business_name: "Enter your business name (2–100 characters).", invalid_token: "That link is invalid or has expired.", network: "Could not reach the server.", cooldown: "Please wait a minute before requesting another code.", daily_limit: "Daily limit reached for this contact.", wrong_code: "That code is not correct.", too_many_attempts: "Too many wrong codes. Send a new code.", expired: "That code has expired. Send a new one.", no_open_code: "No active code. Send a new one.", duplicate: "That contact already exists.", invalid_contact: "That address is not valid.", invalid_origin: "Enter a website origin such as https://example.com. Do not include a page path." };
const say = (r) => NICE[r.data.error] || NICE[r.data.code] || r.data.error || "Something went wrong.";

function sessionEnded() {
  if (!S.me) return;
  S.me = null; S.csrf = null; S.biz = null; S.openLead = null; S.openConv = null; S.endedNotice = "Your session ended. Please sign in again.";
  loginView();
}
function banner() {
  return h("div", { class: "demo", role: "note" }, h("strong", null, "DEMO authentication."), " Emails and verification codes are SIMULATED — nothing is sent to anyone. Not production-ready.");
}
function paintToast() { const n = S.notice, t = $("#toast"); if (!t || !n || Date.now() - n.at > 6000) return; t.textContent = n.msg; t.className = "toast " + (n.bad ? "bad" : "ok"); t.hidden = false; clearTimeout(paintToast.t); paintToast.t = setTimeout(() => { t.hidden = true; }, Math.max(500, 6000 - (Date.now() - n.at))); }
// The toast survives the re-render that usually follows an action.
function toast(msg, bad) { S.notice = { msg, bad: !!bad, at: Date.now() }; paintToast(); }

// ---------------- signed-out screens ----------------
function authShell(title, ...body) {
  const ended = S.endedNotice ? h("p", { class: "alert", role: "alert" }, S.endedNotice) : null; S.endedNotice = null;
  root.replaceChildren(banner(), h("main", { class: "auth" }, h("div", { class: "card" }, h("h1", null, "LATCHLINE"), h("p", { class: "muted" }, "Every inquiry has a next step."), ended, h("h2", null, title), ...body)), h("div", { id: "toast", class: "toast", role: "status", hidden: true }));
}
function field(label, name, type = "text", extra = {}) { return h("label", null, label, h("input", { name, type, required: true, autocomplete: extra.ac, minlength: extra.min, maxlength: extra.max || 200 })); }
function msgBox() { return h("p", { class: "msg", id: "msg", role: "alert" }); }
const setMsg = (t, ok) => { const m = $("#msg"); if (m) { m.textContent = t || ""; m.className = "msg " + (ok ? "ok" : "bad"); } };
const vals = (f) => Object.fromEntries(new FormData(f).entries());

function loginView() {
  authShell("Sign in",
    h("form", { onsubmit: async (e) => { e.preventDefault(); const v = vals(e.target); const r = await api("POST", "/api/auth/login", v); if (!r.ok) { setMsg(say(r)); return; } S.csrf = r.data.csrf; await boot(); } },
      field("Email", "email", "email", { ac: "username" }), field("Password", "password", "password", { ac: "current-password" }), msgBox(), h("button", { class: "btn primary", type: "submit" }, "Sign in")),
    h("p", null, h("a", { href: "#register" }, "Create an account"), " · ", h("a", { href: "#forgot" }, "Forgot password?")), devLink());
}
function registerView() {
  authShell("Create your business account",
    h("form", { onsubmit: async (e) => { e.preventDefault(); const v = vals(e.target); const r = await api("POST", "/api/auth/register", v); if (!r.ok) { setMsg(say(r)); return; } setMsg("Almost done: we SIMULATED sending a verification email. Open the link to verify, then sign in.", true); e.target.reset(); } },
      field("Business name", "businessName", "text", { max: 100 }), field("Email", "email", "email", { ac: "username" }), field("Password (12+ characters)", "password", "password", { ac: "new-password", min: 12, max: 128 }), msgBox(), h("button", { class: "btn primary", type: "submit" }, "Create account")),
    h("p", null, h("a", { href: "#" }, "Back to sign in")), devLink());
}
function forgotView() {
  authShell("Reset your password",
    h("form", { onsubmit: async (e) => { e.preventDefault(); const r = await api("POST", "/api/auth/forgot-password", vals(e.target)); setMsg(r.ok ? "If that account exists, a reset link was SIMULATED (nothing is really sent in this demo)." : say(r), r.ok); } },
      field("Email", "email", "email", { ac: "username" }), msgBox(), h("button", { class: "btn primary", type: "submit" }, "Send reset link")), h("p", null, h("a", { href: "#" }, "Back to sign in")), devLink());
}
function tokenView(kind, token) {
  if (kind === "verify") {
    authShell("Verifying your email…", msgBox(), h("p", null, h("a", { href: "#" }, "Go to sign in")));
    api("POST", "/api/auth/verify-email", { token }).then((r) => setMsg(r.ok ? "Email verified. You can sign in now." : say(r), r.ok));
  } else if (kind === "reset") {
    authShell("Choose a new password",
      h("form", { onsubmit: async (e) => { e.preventDefault(); const r = await api("POST", "/api/auth/reset-password", { token, newPassword: vals(e.target).newPassword }); setMsg(r.ok ? "Password changed. Sign in with your new password." : say(r), r.ok); } },
        field("New password (12+ characters)", "newPassword", "password", { ac: "new-password", min: 12, max: 128 }), msgBox(), h("button", { class: "btn primary", type: "submit" }, "Change password")), h("p", null, h("a", { href: "#" }, "Go to sign in")));
  }
}
function devLink() { return DEV ? h("p", { class: "muted" }, h("a", { href: "#dev" }, "Open the simulated mailbox (development only)")) : null; }
async function devMailView() {
  const r = await api("GET", "/dev/simulated-mail");
  const items = (r.data.messages || []).map((m) => {
    const links = [];
    if (m.data && m.data.token) links.push(h("a", { href: "#" + ({ verify_email: "verify", reset_password: "reset", invitation: "invite" }[m.template] || "x") + "=" + m.data.token }, "open link"));
    return h("li", null, h("strong", null, m.template), " → ", m.to, " ", m.data && m.data.code ? h("code", null, "code " + m.data.code) : null, " ", links);
  });
  authShell("Simulated mailbox", h("p", { class: "bad" }, r.data.banner || "SIMULATED — nothing was sent."), items.length ? h("ul", { class: "plain" }, items) : h("p", null, "No simulated messages yet."), h("p", null, h("a", { href: "#" }, "Back")));
}

// ---------------- signed-in app ----------------
const NAV = [["overview", "Overview", "overview.read"], ["widget", "Website setup", "settings.read"], ["leads", "Leads", "leads.read"], ["conversations", "Conversations", "conversations.read"], ["handoffs", "Handoffs", "handoffs.read"], ["notifications", "Notifications", "notifications.read"], ["settings", "Settings", "settings.read"], ["contacts", "Contacts", "contacts.read"], ["team", "Team", "team.read"], ["audit", "Audit log", "audit.read"]];
function shell() {
  const nav = h("nav", { class: "nav", "aria-label": "Sections" }, NAV.filter((n) => can(n[2])).map((n) => h("button", { class: "navbtn" + (S.view === n[0] ? " active" : ""), "aria-current": S.view === n[0] ? "page" : null, onclick: () => { S.view = n[0]; S.openLead = null; render(); } }, n[1])));
  const sel = S.me.businesses.length > 1 ? h("select", { "aria-label": "Business", onchange: (e) => { S.biz = S.me.businesses.find((b) => b.id === e.target.value); S.view = "overview"; render(); } }, S.me.businesses.map((b) => h("option", { value: b.id, selected: b.id === S.biz.id }, b.name + " (" + b.role + ")"))) : h("span", { class: "bizname" }, S.biz.name + " · " + S.biz.role);
  root.replaceChildren(banner(),
    h("header", { class: "top" }, h("strong", { class: "brand" }, "LATCHLINE"), sel, h("span", { class: "grow" }), h("span", { class: "muted who" }, S.me.user.email), h("button", { class: "btn", onclick: async () => { await api("POST", "/api/auth/logout", {}); S.me = null; S.csrf = null; location.hash = ""; await boot(); } }, "Sign out")),
    h("div", { class: "layout" }, nav, h("main", { id: "main", tabindex: "-1" })), h("div", { id: "toast", class: "toast", role: "status", hidden: true }));
}
async function render() {
  shell();
  paintToast();
  const m = $("#main"); m.replaceChildren(h("p", { class: "muted" }, "Loading…"));
  const views = { overview: vOverview, widget: vWidget, leads: vLeads, conversations: vConvs, handoffs: vHandoffs, notifications: vNotifs, settings: vSettings, contacts: vContacts, team: vTeam, audit: vAudit };
  try { const node = await views[S.view](); m.replaceChildren(node); } catch (e) { m.replaceChildren(h("p", { class: "bad" }, "Could not load this section.")); }
}
const chip = (t, cls) => h("span", { class: "chip " + (cls || "") }, t);
const urgentChip = (u) => (u ? chip("URGENT", "urgent") : null);
const incompleteChip = (l) => (l.contact_missing ? chip("INCOMPLETE: no phone or email", "incomplete") : null);
function empty(t) { return h("p", { class: "empty" }, t); }
function tbl(cols, rows) {
  return h("div", { class: "scroll" }, h("table", null, h("thead", null, h("tr", null, cols.map((c) => h("th", { scope: "col" }, c)))), h("tbody", null, rows)));
}

async function vOverview() {
  const r = await api("GET", B("/overview")); const o = r.data.overview || {};
  let onboarding = null;
  if (can("settings.read")) {
    const [widget, facts, contacts] = await Promise.all([api("GET", B("/widget")), api("GET", B("/settings")), api("GET", B("/contacts"))]);
    if (widget.ok && facts.ok && contacts.ok) {
      const tasks = [
        { label: "Register a website and install the chat widget", done: widget.data.origins.length > 0, view: "widget", action: "Website setup" },
        { label: "Confirm at least one business fact", done: Object.keys(facts.data.settings?.confirmedBy || {}).length > 0, view: "settings", action: "Business settings" },
      ];
      // Only owners can add or change notification contacts; don't present managers with an action they cannot take.
      if (can("contacts.write")) tasks.push({ label: "Add a notification contact", done: contacts.data.contacts.some((x) => x.enabled), view: "contacts", action: "Notification contacts" });
      const complete = tasks.filter((x) => x.done).length;
      onboarding = h("div", { class: "onboarding" },
        h("h3", null, "Getting started"),
        h("p", { class: "muted" }, complete + " of " + tasks.length + " setup tasks completed"),
        h("ul", { class: "plain" }, tasks.map((x) => h("li", null,
          h("span", null, (x.done ? "Complete — " : "Next — ") + x.label + " "),
          h("button", { class: "btn", onclick: () => { S.view = x.view; render(); } }, x.action)))),
        h("p", { class: "muted" }, "Notification delivery is simulated in this build. No real email or text is sent."));
    }
  }
  const card = (label, n, cls, go) => h("button", { class: "stat " + (cls || ""), onclick: go }, h("span", { class: "num" }, String(n ?? 0)), h("span", null, label));
  return h("section", null, h("h2", null, "Overview"),
    onboarding,
    h("div", { class: "stats" }, card("New leads", o.leadsNew, "", () => { S.view = "leads"; S.filter = { status: "new" }; render(); }), card("Urgent, not yet handled", o.urgentOpen, o.urgentOpen ? "urgent" : "", () => { S.view = "leads"; S.filter = { urgent: "1" }; render(); }), card("Emergencies with no contact details", o.incompleteEmergency, o.incompleteEmergency ? "urgent" : "", () => { S.view = "leads"; S.filter = { urgent: "1", incomplete: "1" }; render(); }), card("Waiting for a human", o.handoffsOpen, "", () => { S.view = "handoffs"; render(); }), card("All leads", o.leadsTotal, "", () => { S.view = "leads"; S.filter = {}; render(); }), card("Conversations", o.conversationsTotal, "", () => { S.view = "conversations"; render(); })),
    r.data.notificationsNeedingAttention ? h("p", { class: "alert" }, r.data.notificationsNeedingAttention + " notification(s) need attention — the business may NOT have been told about them. ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); S.view = "notifications"; render(); } }, "Review")) : null,
    h("p", { class: "muted" }, "Notifications in this build are SIMULATED (mock provider). No real email or text is sent."));
}

async function vLeads() {
  const f = S.filter || {};
  const q = new URLSearchParams(); for (const k of ["status", "urgent", "incomplete", "q"]) if (f[k]) q.set(k, f[k]); q.set("limit", "50");
  if (S.openLead) return leadDetail(S.openLead);
  const r = await api("GET", B("/leads?" + q));
  const form = h("form", { class: "filters", onsubmit: (e) => { e.preventDefault(); const v = vals(e.target); S.filter = { status: v.status, q: v.q, urgent: v.urgent ? "1" : "", incomplete: v.incomplete ? "1" : "" }; render(); } },
    h("label", null, "Status", h("select", { name: "status" }, [["", "All"], ["new", "New"], ["contacted", "Contacted"], ["won", "Won"], ["lost", "Lost"], ["spam", "Spam"]].map((o) => h("option", { value: o[0], selected: (f.status || "") === o[0] }, o[1])))),
    h("label", null, "Search", h("input", { name: "q", value: f.q || "", maxlength: 60, placeholder: "name, issue, ZIP" })),
    h("label", { class: "inline" }, h("input", { type: "checkbox", name: "urgent", value: "1", checked: f.urgent === "1" }), " Urgent only"), h("label", { class: "inline" }, h("input", { type: "checkbox", name: "incomplete", value: "1", checked: f.incomplete === "1" }), " No contact details only"), h("button", { class: "btn", type: "submit" }, "Filter"));
  const rows = (r.data.leads || []).map((l) => h("tr", { class: l.emergency ? "row-urgent" : "" },
    h("td", null, urgentChip(l.emergency), " ", incompleteChip(l), " ", h("button", { class: "link", onclick: () => { S.openLead = l.id; render(); } }, l.name || "(no name)")),
    h("td", null, l.phone || (l.contact_missing ? "— none given —" : "")), h("td", null, l.issue_text || l.issue_category || ""), h("td", null, chip(l.status, "s-" + l.status)), h("td", null, fmt(l.created_at))));
  return h("section", null, h("h2", null, "Leads"), form, rows.length ? tbl(["Name", "Phone", "Issue", "Status", "Received"], rows) : empty("No leads match."),
    can("leads.export") ? h("p", null, h("button", { class: "btn", onclick: exportCsv }, "Export CSV")) : null);
}
async function exportCsv() {
  const r = await fetch(B("/leads/export.csv"), { credentials: "same-origin" });
  if (!r.ok) { toast("Export failed.", true); return; }
  const url = URL.createObjectURL(await r.blob()); const a = h("a", { href: url, download: "leads.csv" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast("Exported (recorded in the audit log).");
}
async function leadDetail(id) {
  const r = await api("GET", B("/leads/" + encodeURIComponent(id)));
  if (!r.ok) { S.openLead = null; return h("p", { class: "bad" }, "Lead not found."); }
  const l = r.data.lead;
  const row = (k, v) => h("div", { class: "kv" }, h("dt", null, k), h("dd", null, v == null || v === "" ? "—" : String(v)));
  const status = can("leads.update_status") ? h("form", { class: "inline-form", onsubmit: async (e) => { e.preventDefault(); const x = await api("PATCH", B("/leads/" + encodeURIComponent(id)), { status: vals(e.target).status }); if (x.ok) { toast("Status updated."); render(); } else toast(say(x), true); } },
    h("select", { name: "status", "aria-label": "Status" }, ["new", "contacted", "won", "lost", "spam"].map((s) => h("option", { value: s, selected: s === l.status }, s))), h("button", { class: "btn primary", type: "submit" }, "Update status")) : chip(l.status);
  return h("section", null, h("button", { class: "link", onclick: () => { S.openLead = null; render(); } }, "← All leads"), h("h2", null, urgentChip(l.emergency), " ", incompleteChip(l), " ", l.name || "(no name)"),
    l.contact_missing ? h("p", { class: "alert" }, "Incomplete lead: the customer has not given a phone number or email, so you cannot reach them from this record. Read the conversation for what they wrote. If they send details later, this lead updates and you get a follow-up alert.") : null,
    l.contactMasked ? h("p", { class: "muted" }, "Phone and email are hidden for your role.") : null, status,
    h("dl", { class: "grid" }, row("Phone", l.phone), row("Email", l.email), row("Street address", l.address_line1), row("Apartment / unit", l.address_line2), row("City", l.city), row("State", l.state), row("ZIP", l.zip), row("ZIP in verified service area", l.zip_in_verified_area), row("Issue", l.issue_text), row("Category", l.issue_category), row("Urgency", l.urgency), row("Preferred contact", l.preferred_contact), row("Preferred time", l.preferred_time), row("Summary", l.summary), row("Repeat contacts", l.duplicate_count), row("Received", fmt(l.created_at))),
    h("p", null, h("button", { class: "btn", onclick: () => { S.view = "conversations"; S.openConv = l.conversation_id; S.openLead = null; render(); } }, "View conversation")),
    h("h3", null, "Timeline"), h("ul", { class: "plain" }, (l.events || []).map((e) => h("li", null, fmt(e.created_at) + " — " + e.type.replace("_", " ") + (e.detail && e.detail.to ? " → " + e.detail.to : "")))),
    r.data.notifications ? [h("h3", null, "Notifications about this lead"), r.data.notifications.length ? h("ul", { class: "plain" }, r.data.notifications.map((n) => h("li", null, h("strong", null, n.kind + " · " + n.channel + " · " + n.status), h("br"), n.description))) : empty("None recorded.")] : null,
    can("leads.delete") ? h("p", null, h("button", { class: "btn danger", onclick: async () => { if (!confirm("Permanently delete this lead and its conversation? This cannot be undone.")) return; const x = await api("DELETE", B("/leads/" + encodeURIComponent(id))); if (x.ok) { S.openLead = null; toast("Deleted."); render(); } else toast(say(x), true); } }, "Delete lead and conversation")) : null);
}

async function vConvs() {
  if (S.openConv) { const id = S.openConv; const r = await api("GET", B("/conversations/" + encodeURIComponent(id))); const c = r.data.conversation; if (!c) { S.openConv = null; return h("p", { class: "bad" }, "Conversation not found."); }
    return h("section", null, h("button", { class: "link", onclick: () => { S.openConv = null; render(); } }, "← All conversations"), h("h2", null, urgentChip(c.urgent), " Conversation ", chip(c.status)),
      h("div", { class: "chat" }, (c.messages || []).map((m) => h("div", { class: "bubble " + m.role }, h("small", null, m.role + " · " + fmt(m.created_at)), h("p", null, m.content)))), c.lead_id && can("leads.read") ? h("p", null, h("button", { class: "btn", onclick: () => { S.view = "leads"; S.openLead = c.lead_id; S.openConv = null; render(); } }, "View lead")) : null); }
  const r = await api("GET", B("/conversations?limit=50")); const list = r.data.conversations || [];
  return h("section", null, h("h2", null, "Conversations"), list.length ? tbl(["Status", "Messages", "Updated", ""], list.map((c) => h("tr", { class: c.urgent ? "row-urgent" : "" }, h("td", null, urgentChip(c.urgent), " ", chip(c.status)), h("td", null, c.message_count), h("td", null, fmt(c.updated_at)), h("td", null, h("button", { class: "link", onclick: () => { S.openConv = c.id; render(); } }, "Open"))))) : empty("No conversations yet."));
}
async function vHandoffs() {
  const r = await api("GET", B("/handoffs")); const list = r.data.handoffs || [];
  return h("section", null, h("h2", null, "Handoff requests"), h("p", { class: "muted" }, "Customers who asked for a person, or whose situation needs one. Urgent first."),
    list.length ? tbl(["Customer", "Contact", "Issue", "Lead status", "Updated"], list.map((x) => h("tr", { class: x.urgent ? "row-urgent" : "" }, h("td", null, urgentChip(x.urgent), " ", x.name || "(no name)"), h("td", null, [x.phone, x.email].filter(Boolean).join(" · ") || "—"), h("td", null, x.issue_text || "—"), h("td", null, x.lead_status ? chip(x.lead_status) : "—"), h("td", null, fmt(x.updated_at))))) : empty("Nothing is waiting for a human."));
}
async function vNotifs() {
  const r = await api("GET", B("/notifications")); const list = r.data.notifications || [], att = r.data.needsAttention || [];
  return h("section", null, h("h2", null, "Notification history"), h("p", { class: "muted" }, "Wording comes straight from the delivery record. “Sent” never means “delivered”, and simulated sends are labeled."),
    att.length ? h("div", { class: "alert" }, h("strong", null, "Needs attention"), h("ul", { class: "plain" }, att.map((n) => h("li", null, n.kind + " · " + n.priority + " — " + n.description)))) : null,
    list.length ? tbl(["When", "Kind", "Priority", "Channel", "Status", "What it means"], list.map((n) => h("tr", null, h("td", null, fmt(n.created_at)), h("td", null, n.kind), h("td", null, n.priority === "emergency" ? chip("EMERGENCY", "urgent") : n.priority), h("td", null, n.channel), h("td", null, chip(n.status), n.simulated ? chip("simulated", "sim") : null), h("td", null, n.description)))) : empty("No notifications yet."));
}
async function vWidget() {
  const r = await api("GET", B("/widget"));
  if (!r.ok) return h("section", null, h("h2", null, "Website setup"), h("p", { class: "bad" }, say(r)));
  const s = r.data, snippet = '<script src="' + location.origin + '/widget.js" data-site-key="' + s.siteKey + '"></script>';
  const w = can("settings.write");
  const form = h("form", { class: "filters", onsubmit: async (e) => {
    e.preventDefault(); const v = vals(e.target);
    const x = await api("POST", B("/widget/origins"), { origin: v.origin });
    if (x.ok) { toast(x.data.added ? "Website origin added." : "That origin is already registered."); render(); }
    else toast(say(x), true);
  } },
    h("label", null, "Website origin", h("input", { name: "origin", type: "url", placeholder: "https://example.com", required: true, maxlength: 200, disabled: !w })),
    w ? h("button", { class: "btn primary", type: "submit" }, "Add website") : null);
  const origins = s.origins.length ? h("ul", { class: "plain" }, s.origins.map((origin) => h("li", null, h("code", null, origin), w ? h("button", { class: "btn danger", onclick: async () => {
    if (!window.confirm("Remove " + origin + "? The widget will stop working on that website.")) return;
    const x = await api("DELETE", B("/widget/origins?origin=" + encodeURIComponent(origin)));
    if (x.ok) { toast("Website origin removed."); render(); } else toast(say(x), true);
  } }, "Remove") : null))) : h("p", { class: "muted" }, "No website origins are registered. The widget will not load until you add one.");
  return h("section", null,
    h("h2", null, "Website setup"),
    h("p", null, "Connect the website where customers should see your LATCHLINE plumbing assistant."),
    h("h3", null, "1. Register your website"),
    h("p", { class: "muted" }, "Enter the website origin only — for example https://example.com. Do not include a page path. HTTPS is required except for localhost development."),
    w ? form : h("p", { class: "muted" }, "Your role can view setup but cannot change registered websites."),
    origins,
    h("h3", null, "2. Install the chat widget"),
    h("p", { class: "muted" }, "Copy this script into your website, ideally just before the closing body tag. The site key is public widget configuration, not a password or authentication credential."),
    h("pre", { class: "snippet" }, snippet),
    h("button", { class: "btn primary", onclick: async () => { try { await navigator.clipboard.writeText(snippet); toast("Install code copied."); } catch { toast("Copy is unavailable here. Select the code above and copy it manually.", true); } } }, "Copy install code"),
    h("p", { class: "muted" }, "After installation, open your website and send a test message. Origin checks help restrict normal browser embedding, but an Origin header is not authentication and can be spoofed by non-browser clients."),
    h("p", { class: "muted" }, "Widget host: ", h("code", null, location.origin + "/widget.js"))
  );
}

async function vSettings() {
  const r = await api("GET", B("/settings")); const s = r.data.settings || {}; const w = can("settings.write");
  const ta = (label, name, v, hint) => h("label", null, label, hint ? h("small", null, hint) : null, h("textarea", { name, rows: 2, maxlength: 600, disabled: !w }, v || ""));
  const form = h("form", { onsubmit: async (e) => { e.preventDefault(); const v = vals(e.target);
      const body = { confirm: v.confirm === "on", companyName: v.companyName, services: v.services.split("\n").map((x) => x.trim()).filter(Boolean), serviceAreaText: v.serviceAreaText, serviceZips: v.serviceZips.split(/[\s,]+/).filter(Boolean), hours: v.hours, holidayHours: v.holidayHours, afterHoursPolicy: v.afterHoursPolicy, pricing: v.pricing, diagnosticFee: v.diagnosticFee, emergencyFee: v.emergencyFee, appointments: v.appointments, humanEscalation: v.humanEscalation };
      const x = await api("PUT", B("/settings"), body); if (x.ok) { toast("Saved. These details are now recorded as confirmed by you."); render(); } else toast((x.data.details || [say(x)]).join(" "), true); } },
    h("label", null, "Company name", h("input", { name: "companyName", value: s.companyName || "", maxlength: 100, disabled: !w })),
    ta("Services offered (one per line)", "services", (s.services || []).join("\n")), ta("Service area description", "serviceAreaText", s.serviceAreaText), ta("Service area ZIP codes (comma or space separated)", "serviceZips", (s.serviceZips || []).join(", ")),
    ta("Business hours", "hours", s.hours), ta("Holiday hours", "holidayHours", s.holidayHours), ta("After-hours policy", "afterHoursPolicy", s.afterHoursPolicy), ta("Pricing policy", "pricing", s.pricing), ta("Diagnostic fee policy", "diagnosticFee", s.diagnosticFee), ta("Emergency fee policy", "emergencyFee", s.emergencyFee), ta("Appointment policy", "appointments", s.appointments), ta("When a person should take over", "humanEscalation", s.humanEscalation),
    w ? [h("label", { class: "inline" }, h("input", { type: "checkbox", name: "confirm", required: true }), " I confirm these details are accurate. LATCHLINE will only tell customers what is confirmed here."), h("button", { class: "btn primary", type: "submit" }, "Save settings")] : h("p", { class: "muted" }, "Your role can view but not change settings."));
  const conf = Object.entries(s.confirmedBy || {});
  return h("section", null, h("h2", null, "Business settings"), form, conf.length ? h("details", null, h("summary", null, "Who confirmed what"), h("ul", { class: "plain" }, conf.map(([k, v]) => h("li", null, k.replace(/_/g, " ") + " — " + v.by + " on " + fmt(v.at))))) : null);
}
async function vContacts() {
  const r = await api("GET", B("/contacts")); const list = r.data.contacts || []; const w = can("contacts.write");
  const label = { unverified: ["Not verified", "warn"], simulated_verified: ["Simulated-verified only (not real)", "sim"], verified: ["Verified", "s-won"] };
  const items = list.map((c) => {
    const st = label[c.state];
    return h("li", { class: "contact" }, h("div", null, h("strong", null, c.address), " ", h("span", { class: "muted" }, c.channel), " ", chip(st[0], st[1]), c.enabled ? null : chip("disabled")),
      c.state === "simulated_verified" ? h("p", { class: "muted" }, "A code from the mock sender was entered. No real message reached this address, so no real provider will use it.") : null,
      w ? h("div", { class: "actions" },
        c.state !== "verified" ? h("button", { class: "btn", onclick: async () => { const x = await api("POST", B("/contacts/" + c.id + "/send-code"), {}); toast(x.ok ? (x.data.simulated ? "SIMULATED code created. Nothing was sent." + (DEV ? " Read it in the simulated mailbox." : "") : "A code was sent.") : say(x), !x.ok); } }, "Send code") : null,
        c.state !== "verified" ? h("form", { class: "inline-form", onsubmit: async (e) => { e.preventDefault(); const x = await api("POST", B("/contacts/" + c.id + "/confirm"), { code: vals(e.target).code }); toast(x.ok ? (x.data.simulated ? "Marked SIMULATED-verified. This is not real verification." : "Verified.") : say(x), !x.ok); render(); } }, h("input", { name: "code", inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6, placeholder: "6-digit code", "aria-label": "Verification code", required: true }), h("button", { class: "btn", type: "submit" }, "Confirm code")) : null,
        h("button", { class: "btn", onclick: async () => { await api("PATCH", B("/contacts/" + c.id), { enabled: !c.enabled }); render(); } }, c.enabled ? "Disable" : "Enable"),
        h("button", { class: "btn danger", onclick: async () => { if (confirm("Remove this contact?")) { await api("DELETE", B("/contacts/" + c.id)); render(); } } }, "Remove")) : null);
  });
  return h("section", null, h("h2", null, "Notification contacts"),
    h("p", { class: "alert" }, r.data.mode === "simulated" ? "SIMULATED MODE: verification codes are not really sent. A contact confirmed this way is only “simulated-verified” and can receive mock notifications only." : "Codes are sent by a real provider."),
    items.length ? h("ul", { class: "plain" }, items) : empty("No contacts yet. Add an email or phone number to be notified about new leads."),
    w ? h("form", { class: "inline-form", onsubmit: async (e) => { e.preventDefault(); const x = await api("POST", B("/contacts"), vals(e.target)); if (x.ok) { toast("Added. It is NOT verified yet."); render(); } else toast(say(x), true); } },
      h("select", { name: "channel", "aria-label": "Channel" }, h("option", { value: "email" }, "Email"), h("option", { value: "sms" }, "Text message")), h("input", { name: "address", required: true, maxlength: 254, placeholder: "email or phone", "aria-label": "Address" }), h("button", { class: "btn primary", type: "submit" }, "Add contact")) : null);
}
async function vTeam() {
  const r = await api("GET", B("/team")); const ms = r.data.members || [], inv = (r.data.invitations || []).filter((i) => !i.accepted_at && !i.revoked_at);
  return h("section", null, h("h2", null, "Team"),
    tbl(["Member", "Role", ""], ms.map((m) => h("tr", null, h("td", null, m.email), h("td", null, h("select", { "aria-label": "Role for " + m.email, onchange: async (e) => { const x = await api("PATCH", B("/team/members/" + m.user_id), { role: e.target.value }); toast(x.ok ? "Role changed." : say(x), !x.ok); render(); } }, ["owner", "manager", "staff", "viewer"].map((ro) => h("option", { value: ro, selected: ro === m.role }, ro)))), h("td", null, h("button", { class: "btn danger", onclick: async () => { if (confirm("Remove this member?")) { const x = await api("DELETE", B("/team/members/" + m.user_id)); toast(x.ok ? "Removed." : "That change is not allowed.", !x.ok); render(); } } }, "Remove"))))),
    h("h3", null, "Invitations"), inv.length ? h("ul", { class: "plain" }, inv.map((i) => h("li", null, i.email + " — " + i.role + " (expires " + fmt(i.expires_at) + ") ", h("button", { class: "link", onclick: async () => { await api("DELETE", B("/team/invitations/" + i.id)); render(); } }, "Revoke")))) : empty("No open invitations."),
    h("form", { class: "inline-form", onsubmit: async (e) => { e.preventDefault(); const x = await api("POST", B("/team/invitations"), vals(e.target)); toast(x.ok ? "Invitation created. The email is SIMULATED in this demo." : say(x), !x.ok); if (x.ok) render(); } },
      h("input", { name: "email", type: "email", required: true, placeholder: "teammate@example.com", "aria-label": "Invitee email" }), h("select", { name: "role", "aria-label": "Role" }, ["manager", "staff", "viewer"].map((ro) => h("option", { value: ro }, ro))), h("button", { class: "btn primary", type: "submit" }, "Invite")));
}
async function vAudit() {
  const r = await api("GET", B("/audit?limit=200")); const ev = r.data.events || [];
  return h("section", null, h("h2", null, "Audit log"), h("p", { class: "muted" }, "Sensitive actions only. Ids and field names, never customer details."), ev.length ? tbl(["When", "Action", "Actor", "Detail"], ev.map((e) => h("tr", null, h("td", null, fmt(e.created_at)), h("td", null, e.action), h("td", null, e.actor || ""), h("td", null, Object.keys(e.detail || {}).length ? JSON.stringify(e.detail) : "")))) : empty("Nothing recorded."));
}

// ---------------- boot / routing ----------------
async function boot() {
  const hash = location.hash.slice(1);
  const m = hash.match(/^(verify|reset|invite)=([\w-]{20,100})$/);
  const r = await api("GET", "/api/me");
  if (r.ok) {
    S.me = r.data; S.csrf = r.data.csrf;
    if (m && m[1] === "invite") { const x = await api("POST", "/api/auth/accept-invite", { token: m[2] }); history.replaceState(null, "", location.pathname); const again = await api("GET", "/api/me"); S.me = again.data; S.pendingNotice = x.ok ? "Invitation accepted." : "That invitation is invalid, expired, or for a different email address."; }
    if (!S.me.businesses.length) { authShell("No business yet", h("p", null, "Your account is not a member of any business.")); return; }
    S.biz = S.me.businesses.find((b) => S.biz && b.id === S.biz.id) || S.me.businesses[0];
    if (!NAV.some((n) => n[0] === S.view && can(n[2]))) S.view = "overview";
    await render(); if (S.pendingNotice) { toast(S.pendingNotice); S.pendingNotice = null; }
    return;
  }
  S.me = null; S.csrf = null;
  if (m && m[1] !== "invite") { tokenView(m[1], m[2]); return; }
  if (m && m[1] === "invite") { authShell("Sign in to accept your invitation", h("p", { class: "muted" }, "Sign in (or create an account) with the email address that was invited, then open the invitation link again."), h("p", null, h("a", { href: "#" }, "Sign in"), " · ", h("a", { href: "#register" }, "Create account"))); return; }
  if (hash === "register") return registerView();
  if (hash === "forgot") return forgotView();
  if (hash === "dev" && DEV) return devMailView();
  loginView();
}
window.addEventListener("hashchange", () => { if (!S.me || /^(verify|reset|invite)=/.test(location.hash.slice(1))) boot(); });
boot();
`;
