// LATCHLINE website chat widget (source). Built into one self-contained script by
// scripts/build-widget.mjs and served by the backend at GET /widget.js.
//
// Rules this file follows (docs/WIDGET_ARCHITECTURE.md):
//  - No secrets. The site key is a PUBLIC identifier. It is not authorization: the server decides
//    which business it belongs to and whether this website's origin is registered for it.
//  - The widget never decides what is true about the business. It shows the server's reply text,
//    and claims nothing about saving, sending or dispatching that the server did not say.
//  - Customer and server text is only ever put into the page with textContent (never innerHTML).
//  - It must never break the host website: everything is inside try/catch and a Shadow DOM.
//  - A message that could not be delivered is never shown as sent. Emergency guidance (the SAME
//    pure-code detector and text the server uses) is shown even when the server cannot be reached.

import { detectEmergency, composeSafetyReply } from "../safety/detector.js";
import { plumbingPack } from "../packs/plumbing.js";
import { normalizeMessage, MAX_MESSAGE_CHARS } from "../validation/normalize.js";

const REQUEST_TIMEOUT_MS = 25_000;
const STORE_TTL_MS = 12 * 3600_000;
const MAX_STORED = 60;
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_ACCENT = "#0b5f73";

const T = {
  genericWelcome: "Hi, what can I help you with?",
  network: "I couldn't reach the server, so this message may not have been received. Nothing is confirmed saved or sent to the business.",
  server: "Something went wrong on the server, so this message may not have been received. Nothing is confirmed saved or sent to the business.",
  unavailable: "This chat isn't available right now. Your message was not sent.",
  rate: (s) => `You're sending messages too quickly. Please wait ${s || "a few"} seconds and try again. This message was not sent.`,
  invalid: "That message couldn't be sent. It may be empty or too long. It was not sent.",
  newConv: "We couldn't continue your earlier conversation, so this is a new one. Details you gave before may need to be repeated.",
  notSaved: "This conversation could not be saved by the business system.",
  tooLong: (n) => `Please keep your message under ${n} characters.`,
  empty: "Type a message first.",
};

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrastWithWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.root{--accent:${DEFAULT_ACCENT};--bg:#fff;--ink:#17202a;--muted:#55626f;--line:#d9dee4;--surf:#f3f5f7;--warn:#8a4b00;--warnbg:#fff4e5;--bad:#a4261b;--badbg:#fff0ee;
 font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);position:fixed;bottom:16px;z-index:2147483000}
.root.right{right:16px}.root.left{left:16px}
@media (prefers-color-scheme:dark){.root{--bg:#161d24;--ink:#e9eef3;--muted:#a3b0bc;--line:#2c3844;--surf:#202a33;--warn:#f5c97a;--warnbg:#33291a;--bad:#ffb4ab;--badbg:#3a201d}}
button,textarea{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid #17202a;outline-offset:1px;box-shadow:0 0 0 4px #ffbf47}
.launcher{display:flex;align-items:center;gap:.5rem;min-height:48px;padding:.6rem 1.1rem;border:0;border-radius:999px;background:var(--accent);color:#fff;font-weight:600;box-shadow:0 4px 18px rgba(0,0,0,.28)}
.launcher svg{width:20px;height:20px;flex:none}
.panel{display:none;flex-direction:column;width:min(390px,calc(100vw - 32px));height:min(640px,calc(100dvh - 32px));background:var(--bg);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden}
.open .panel{display:flex}.open .launcher{display:none}
header{display:flex;align-items:center;gap:.65rem;padding:.7rem .8rem;background:var(--accent);color:#fff}
.mono{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);display:grid;place-items:center;font-weight:700;flex:none}
.ht{flex:1;min-width:0}.ht h2{margin:0;font-size:1rem;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ht p{margin:0;font-size:.78rem;opacity:.92}
header button{min-width:44px;min-height:44px;border:0;border-radius:8px;background:transparent;color:#fff;font-size:.82rem;padding:0 .5rem}
header button:hover{background:rgba(255,255,255,.18)}
header button svg{width:20px;height:20px;display:block;margin:auto}
.log{flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.55rem;background:var(--bg);overscroll-behavior:contain}
.m{max-width:86%;padding:.55rem .8rem;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.m.assistant{align-self:flex-start;background:var(--surf);border:1px solid var(--line);border-bottom-left-radius:4px}
.m.customer{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:4px}
.m.urgent{border:2px solid var(--bad);background:var(--badbg)}
.m.urgent .tag{display:block;font-weight:700;color:var(--bad);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.2rem}
.m.system{align-self:stretch;max-width:100%;background:var(--warnbg);color:var(--warn);border-left:4px solid var(--warn);border-radius:6px;font-size:.88rem}
.m.system.bad{background:var(--badbg);color:var(--bad);border-color:var(--bad)}
.meta{display:block;font-size:.74rem;margin-top:.25rem;opacity:.9}
.m.customer .meta{color:#fff}
.retry{margin-top:.35rem;min-height:36px;padding:.2rem .8rem;border:1px solid currentColor;border-radius:8px;background:transparent}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.typing{display:none;padding:0 .9rem .4rem;gap:4px;background:var(--bg)}
.typing.on{display:flex}
.typing i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:b 1s infinite ease-in-out}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes b{0%,80%,100%{opacity:.25}40%{opacity:1}}
@media (prefers-reduced-motion:reduce){.typing i{animation:none;opacity:.6}}
.confirm{display:none;padding:.7rem .9rem;background:var(--warnbg);color:var(--warn);border-top:1px solid var(--line);font-size:.9rem}
.confirm.on{display:block}.confirm button{min-height:40px;margin:.4rem .4rem 0 0;padding:0 .9rem;border-radius:8px;border:1px solid currentColor;background:transparent}
form{display:flex;gap:.5rem;padding:.6rem .7rem;border-top:1px solid var(--line);background:var(--bg);align-items:flex-end}
textarea{flex:1;resize:none;min-height:44px;max-height:120px;padding:.6rem .7rem;border:1px solid var(--line);border-radius:10px;background:var(--bg);font-size:16px}
.send{min-width:64px;min-height:44px;padding:0 1rem;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:600}
.send[aria-disabled=true]{opacity:.5;cursor:not-allowed}
.foot{padding:.25rem .8rem .6rem;font-size:.74rem;color:var(--muted);background:var(--bg)}
.count{color:var(--bad);font-weight:600}
@media (max-width:480px),(max-height:520px){
 .root{inset:0;bottom:0}.root:not(.open){inset:auto 12px 12px auto}.root.left:not(.open){inset:auto auto 12px 12px}
 .panel{width:100vw;height:100dvh;border-radius:0;border:0}
 header{padding-top:max(.7rem,env(safe-area-inset-top))}.foot{padding-bottom:max(.6rem,env(safe-area-inset-bottom))}
}
@media print{.root{display:none}}
`;

const ICON_CHAT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
const ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const svg = (markup) => { const d = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement; return document.importNode(d, true); };

function main() {
  if (window.__latchlineWidget) return;
  const script = document.currentScript || document.querySelector("script[data-site-key][src*='widget.js']");
  if (!script) return;
  const siteKey = script.getAttribute("data-site-key") || "";
  if (!KEY_RE.test(siteKey)) { console.warn("LATCHLINE widget: missing or malformed data-site-key; not started."); return; }
  let api;
  try { api = new URL(script.src).origin; } catch { return; }
  window.__latchlineWidget = true;
  const accentAttr = script.getAttribute("data-accent") || "";
  const accent = HEX_RE.test(accentAttr) && contrastWithWhite(accentAttr) >= 4.5 ? accentAttr : DEFAULT_ACCENT;
  const side = script.getAttribute("data-position") === "left" ? "left" : "right";
  const storeKey = `latchline:v1:${siteKey}`;

  const S = { gen: 0, ctl: null, cfg: { name: "", welcome: T.genericWelcome, mode: "development", max: MAX_MESSAGE_CHARS }, msgs: [], cid: null, busy: false, open: false, seq: 0 };

  // ---- per-tab storage (sessionStorage): wrapped because it can be blocked or full ----
  const store = {
    load() {
      try {
        const raw = JSON.parse(sessionStorage.getItem(storeKey) || "null");
        if (!raw || typeof raw !== "object" || !Number.isFinite(raw.ts) || Date.now() - raw.ts > STORE_TTL_MS || raw.ts > Date.now() + 60_000) return;
        if (typeof raw.cid === "string" && raw.cid.length <= 80) S.cid = raw.cid;
        if (Array.isArray(raw.msgs)) {
          for (const m of raw.msgs.slice(-MAX_STORED)) {
            if (!m || !["customer", "assistant", "system"].includes(m.role) || typeof m.text !== "string") continue;
            S.msgs.push({ id: ++S.seq, role: m.role, text: m.text.slice(0, m.role === "customer" ? MAX_MESSAGE_CHARS : 4000), urgent: m.urgent === true, note: typeof m.note === "string" ? m.note.slice(0, 200) : undefined, status: m.role === "customer" ? (m.status === "sent" ? "sent" : "unconfirmed") : undefined, bad: m.bad === true, idempotencyKey: m.role === "customer" && typeof m.idempotencyKey === "string" && /^[a-f0-9]{32}$/.test(m.idempotencyKey) ? m.idempotencyKey : undefined });
          }
        }
      } catch { /* storage unavailable */ }
    },
    save() {
      try {
        const msgs = S.msgs.filter((m) => !m.transient).slice(-MAX_STORED).map((m) => ({ role: m.role, text: m.text, urgent: m.urgent, status: m.status, bad: m.bad, note: m.note, idempotencyKey: m.idempotencyKey }));
        sessionStorage.setItem(storeKey, JSON.stringify({ ts: Date.now(), cid: S.cid, msgs }));
      } catch { /* ignore */ }
    },
    clear() { try { sessionStorage.removeItem(storeKey); } catch { /* ignore */ } },
  };

  // ---- DOM ----
  const host = h("div", { id: "latchline-widget-root" });
  const shadow = host.attachShadow({ mode: "open" });
  let focusMovedWhileSending = false;
  shadow.addEventListener("focusin", (event) => {
    if (S.busy && event.target !== els.input && event.target !== els.send) focusMovedWhileSending = true;
  });
  const root = h("div", { class: `root ${side}` });
  root.style.setProperty("--accent", accent);
  const els = {};
  els.launcher = h("button", { class: "launcher", type: "button", "aria-expanded": "false", "aria-controls": "ll-panel", onclick: () => setOpen(true) });
  els.launcher.append(svg(ICON_CHAT), h("span", { text: "Chat with us" }));
  els.mono = h("div", { class: "mono", "aria-hidden": "true" });
  els.title = h("h2", { id: "ll-title" });
  els.sub = h("p", { id: "ll-sub" });
  els.newBtn = h("button", { type: "button", onclick: askRestart }, "New chat");
  els.closeBtn = h("button", { type: "button", "aria-label": "Close chat", onclick: () => setOpen(false) });
  els.closeBtn.append(svg(ICON_X));
  els.log = h("div", { class: "log", role: "log", "aria-live": "polite", "aria-relevant": "additions", "aria-label": "Conversation", tabindex: "0" });
  els.typing = h("div", { class: "typing", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
  els.status = h("div", { class: "sr", role: "status", "aria-live": "polite" });
  els.confirm = h("div", { class: "confirm", role: "group", "aria-label": "Start a new chat?" });
  els.input = h("textarea", { rows: "1", "aria-label": "Your message", placeholder: "Type your message", enterkeyhint: "send", autocomplete: "off" });
  els.send = h("button", { class: "send", type: "submit", "aria-disabled": "true" }, "Send");
  els.count = h("span", { class: "count" });
  els.form = h("form", { novalidate: "" }, els.input, els.send);
  els.foot = h("div", { class: "foot" });
  els.panel = h("section", { class: "panel", id: "ll-panel", role: "dialog", "aria-labelledby": "ll-title", "aria-describedby": "ll-sub" },
    h("header", {}, els.mono, h("div", { class: "ht" }, els.title, els.sub), els.newBtn, els.closeBtn),
    els.log, els.typing, els.status, els.confirm, els.form, els.foot);
  root.append(els.launcher, els.panel);
  shadow.append(h("style", { text: CSS }), root);

  const display = () => S.cfg.name || "Assistant";
  function paintHeader() {
    els.title.textContent = S.cfg.name || "Chat";
    els.mono.textContent = (S.cfg.name || "C").trim().charAt(0).toUpperCase();
    els.sub.textContent = S.cfg.mode === "development" ? "Automated assistant · test mode" : "Automated assistant";
    els.launcher.setAttribute("aria-label", S.cfg.name ? `Chat with ${S.cfg.name}` : "Open chat");
    foot();
  }
  // A long message is never silently cut: the customer sees how far over they are and the send is held until they shorten it.
  function foot() {
    const n = els.input.value.length, left = S.cfg.max - n;
    els.foot.replaceChildren();
    if (left < 200) els.foot.append(h("span", { class: left < 0 ? "count" : "", text: left < 0 ? `${-left} characters over the ${S.cfg.max} limit. Please shorten your message. ` : `${left} characters left. ` }));
    els.foot.append(document.createTextNode(`The assistant can make mistakes. In an emergency, call ${plumbingPack.emergencyNumber}.`));
  }
  function line(m) {
    const who = m.role === "customer" ? "You said: " : m.role === "assistant" ? `${display()} said: ` : "Notice: ";
    const cls = `m ${m.role}${m.urgent ? " urgent" : ""}${m.bad ? " bad" : ""}`;
    const el = h("div", { class: cls, "data-id": m.id, ...(m.urgent || m.bad ? { role: "alert" } : {}) });
    el.append(h("span", { class: "sr", text: who }));
    if (m.urgent) el.append(h("span", { class: "tag", text: "Safety information" }));
    el.append(document.createTextNode(m.text));
    if (m.role === "customer" && m.status && m.status !== "sent") {
      const txt = m.status === "sending" ? "Sending…" : m.status === "failed" ? "Not sent" : "Not confirmed. It may not have been received";
      el.append(h("span", { class: "meta", text: txt }));
      if (m.status === "failed" || m.status === "unconfirmed") el.append(h("button", { class: "retry", type: "button", onclick: () => send(m.text, m) }, "Try again"));
    }
    if (m.note) el.append(h("span", { class: "meta", text: m.note }));
    return el;
  }

  // Only new or changed messages are touched, so a screen reader announcing additions does not re-read the whole conversation.
  const sigOf = (m) => [m.role, m.text, m.status, m.note, m.urgent, m.bad].join("\u0001");
  function render() {
    const nearBottom = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 80;
    const have = new Map([...els.log.children].map((e) => [e.getAttribute("data-id"), e]));
    let prev = null;
    for (const m of [{ id: 0, role: "assistant", text: S.cfg.welcome }, { id: -1, role: "system", text: "Privacy: This chat collects details to help a plumbing business review your service request. Messages may be processed by an AI service and shared with the business and configured service providers. Do not enter account credentials, payment details, Social Security numbers, or unrelated sensitive information. The business is responsible for its privacy notice, retention and deletion practices." }, ...S.msgs]) {
      const old = have.get(String(m.id)); have.delete(String(m.id));
      if (old && old.__sig === sigOf(m)) { prev = old; continue; }
      const el = line(m); el.__sig = sigOf(m);
      if (old) old.replaceWith(el); else if (prev) prev.after(el); else els.log.prepend(el);
      prev = el;
    }
    for (const e of have.values()) e.remove();
    els.typing.classList.toggle("on", S.busy);
    els.send.setAttribute("aria-disabled", String(S.busy));
    if (nearBottom || S.busy) els.log.scrollTop = els.log.scrollHeight;
  }
  const add = (m) => { m.id = ++S.seq; S.msgs.push(m); return m; };
  function newIdempotencyKey() {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // A deduplication token, not an authentication credential.
      return Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0")).join("");
    }
  }
  const announce = (t) => { els.status.textContent = ""; setTimeout(() => { els.status.textContent = t; }, 30); };

  // ---- open / close / focus ----
  const small = () => window.matchMedia && window.matchMedia("(max-width:480px),(max-height:520px)").matches;
  function setOpen(v) {
    S.open = v;
    root.classList.toggle("open", v);
    els.launcher.setAttribute("aria-expanded", String(v));
    if (v) { render(); els.log.scrollTop = els.log.scrollHeight; setTimeout(() => els.input.focus(), 0); }
    else { hideConfirm(); els.launcher.focus(); }
  }
  shadow.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.open) { e.stopPropagation(); setOpen(false); return; }
    if (e.key === "Tab" && S.open && small()) { // full-screen on phones: keep Tab inside the chat
      const f = [...shadow.querySelectorAll("button,textarea,[tabindex='0']")].filter((x) => !x.closest(".confirm:not(.on)") && x.offsetParent !== null && !x.closest(".launcher"));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], cur = shadow.activeElement;
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ---- restart (confirmed, because it clears this device's copy of the chat) ----
  function hideConfirm() { els.confirm.classList.remove("on"); els.confirm.replaceChildren(); }
  function askRestart() {
    if (S.busy) { announce("Please wait for the reply before starting a new chat."); return; }
    if (!S.msgs.some((m) => m.role === "customer")) return restart();
    els.confirm.replaceChildren(
      h("div", { text: "Start a new chat? This clears the conversation from this device. Anything already sent to the business stays with them." }),
      h("button", { type: "button", onclick: restart }, "Start new chat"),
      h("button", { type: "button", onclick: () => { hideConfirm(); els.newBtn.focus(); } }, "Keep chatting"));
    els.confirm.classList.add("on");
    els.confirm.querySelector("button").focus();
  }
  function restart() {
    hideConfirm(); S.gen++; if (S.ctl) S.ctl.abort(); S.msgs = []; S.cid = null; S.busy = false; store.clear(); render(); announce("New conversation started."); els.input.focus();
  }

  // ---- sending ----
  function failure(m, status, sentence, opts = {}) {
    m.status = status;
    const sys = { role: "system", text: sentence, bad: true, related: m.id };
    const safety = detectEmergency(m.text, { pack: plumbingPack });
    if (safety.emergency && opts.safety !== false) {
      // Same pure-code text the server uses. It is shown because a failure must never hide safety guidance.
      add({ role: "assistant", text: composeSafetyReply(safety, { leadSystemConnected: false }), urgent: true, related: m.id });
    }
    add(sys);
  }
  // A message that is too long is never sent or cut, but it can still describe a danger: show the safety guidance now.
  function tooLongOrEmpty(text, norm) {
    announce(norm.reason === "too_long" ? T.tooLong(S.cfg.max) : T.empty);
    if (norm.reason !== "too_long") return;
    const safety = detectEmergency(String(text).slice(0, 8192), { pack: plumbingPack });
    if (!safety.emergency) return;
    S.msgs = S.msgs.filter((x) => !x.longWarn);
    add({ role: "assistant", text: composeSafetyReply(safety, { leadSystemConnected: false }), urgent: true, longWarn: true });
    add({ role: "system", text: `Your message is too long (over ${S.cfg.max} characters), so it was not sent and nothing was saved. Please shorten it and send it again.`, bad: true, longWarn: true });
    render();
  }
  async function send(text, retry) {
    if (S.busy) return;
    const norm = normalizeMessage(text);
    if (!norm.ok) { tooLongOrEmpty(text, norm); return; }
    let m = retry;
    if (m) { S.msgs = S.msgs.filter((x) => x.related !== m.id); m.status = "sending"; }
    else m = add({ role: "customer", text: norm.value, status: "sending" });
    if (!m.idempotencyKey) m.idempotencyKey = newIdempotencyKey();
    focusMovedWhileSending = false;
    S.busy = true; store.save(); render(); announce(`${display()} is typing`);
    const gen = S.gen, ctl = new AbortController(); S.ctl = ctl;
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    try {
      let res;
      try {
        res = await fetch(`${api}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey }, credentials: "omit", signal: ctl.signal, body: JSON.stringify({ siteKey, message: norm.value, conversationId: S.cid }) });
      } catch { if (gen === S.gen) failure(m, "unconfirmed", T.network); return; }
      let data = null;
      try { data = await res.json(); } catch { /* handled below */ }
      if (gen !== S.gen) return; // the customer started a new chat while this was in flight: this reply belongs to the old one
      if (res.status === 429) failure(m, "failed", T.rate(data?.retryAfterSec));
      else if (res.status === 404 || res.status === 403) failure(m, "failed", T.unavailable);
      else if (res.status === 400 || res.status === 413) failure(m, "failed", T.invalid, { safety: true });
      else if (!res.ok || !data || typeof data.reply !== "string") failure(m, "unconfirmed", T.server);
      else {
        m.status = "sent";
        const sentCid = S.cid;
        if (typeof data.conversationId === "string" && data.conversationId.length <= 80) {
          if (sentCid && data.conversationId !== sentCid) add({ role: "system", text: T.newConv });
          S.cid = data.conversationId;
        }
        const notSaved = data.persisted === false || data.leadStatus === "not_saved";
        add({ role: "assistant", text: data.reply.slice(0, 4000), urgent: data.urgent === true, note: notSaved && !data.urgent ? T.notSaved : undefined });
        announce(data.urgent === true ? "Safety information received." : `${display()} replied.`);
      }
    } finally {
      clearTimeout(timer);
      if (gen === S.gen) {
        S.busy = false; S.ctl = null; store.save(); render();
        const a = shadow.activeElement;
        // Do not steal focus if the customer moved it while the reply was pending, even if the browser later blurs that control.
        if (S.open && !focusMovedWhileSending && (!a || a === els.send || a === els.log || a === els.input)) els.input.focus();
      }
    }
  }

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (S.busy) return;
    const v = els.input.value;
    const norm = normalizeMessage(v);
    if (!norm.ok) { tooLongOrEmpty(v, norm); return; }
    els.input.value = ""; els.input.style.height = "auto"; foot();
    send(v);
  });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.form.requestSubmit(); }
  });
  els.input.addEventListener("input", () => {
    els.input.style.height = "auto"; els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px";
    foot();
  });

  // ---- configuration from the server (display only; authorization is always server-side) ----
  async function loadConfig() {
    try {
      const res = await fetch(`${api}/api/widget/config?siteKey=${encodeURIComponent(siteKey)}`, { credentials: "omit" });
      if (res.status === 404 || res.status === 403) return false; // unknown key, not allowed here, or business inactive: show nothing
      if (res.ok) {
        const c = await res.json();
        if (typeof c?.name === "string" && c.name.length <= 120) S.cfg.name = c.name;
        if (typeof c?.welcome === "string" && c.welcome.length <= 400) S.cfg.welcome = c.welcome;
        if (c?.mode === "development" || c?.mode === "production") S.cfg.mode = c.mode;
        if (Number.isInteger(c?.maxMessageChars) && c.maxMessageChars > 0 && c.maxMessageChars <= MAX_MESSAGE_CHARS) S.cfg.max = c.maxMessageChars;
      }
    } catch { /* temporary outage or rate limit: start with generic wording; sending still works if the server is back */ }
    return true;
  }

  function start() {
    loadConfig().then((ok) => {
      if (!ok) { console.warn("LATCHLINE widget: this site key is not active for this website; not shown."); return; }
      store.load(); paintHeader(); render();
      (document.body || document.documentElement).append(host);
    }).catch(() => {});
  }
  const defer = () => (window.requestIdleCallback ? window.requestIdleCallback(start, { timeout: 2000 }) : setTimeout(start, 0));
  if (document.readyState === "complete") defer(); else window.addEventListener("load", defer, { once: true });
}

try { main(); } catch { /* the widget must never break the host website */ }
