# Website chat widget (Stage 7)

Status: **built and tested locally. Not deployed. Not production-ready.** It talks to the mock AI only. No hosted verification exists (see "What has NOT been verified").

## What it is
One small script a plumbing business adds to its own website. It shows a "Chat with us" button and a chat panel. The homeowner talks to LATCHLINE's existing `/api/chat` backend; the business's name comes from the server. No marketplace, no shared workspace between businesses.

- Source: `src/widget/widget.src.js`. Built by `node scripts/build-widget.mjs` into `src/widget/widget.bundle.js` (a string constant, because a Worker cannot read files). A test fails if the bundle is stale.
- Served by the backend at `GET /widget.js` (public code, no secrets, content-hash ETag, 5-minute cache).
- Size (measured): ~37 KB minified, ~14 KB gzipped. Most of it is the emergency detector and plumbing pack, reused so the widget shows the SAME safety text when the server is unreachable. No scalability claim is made.
- No dependencies. Shadow DOM, so the host site's CSS cannot restyle it and it adds no global CSS. One global flag (`window.__latchlineWidget`) prevents double installs.

## Installation (for the business owner; nothing is hosted yet)
```html
<script src="https://YOUR-LATCHLINE-HOST/widget.js" data-site-key="YOUR_PUBLIC_SITE_KEY" async></script>
```
Optional: `data-accent="#7a1fa2"` (used only if white text on it has contrast ≥ 4.5:1, else the default), `data-position="left"`.
Requirements, all enforced by the server, not the page:
1. The site key belongs to your business (shown/issued by LATCHLINE; KI-42: the dashboard does not yet show it).
2. Your website's address (origin) is registered for that key. A key on any other website shows nothing.
3. Your site's Content-Security-Policy (if it has one) must allow the script from the LATCHLINE host, `connect-src` to it, and inline `<style>` inside the widget.
The site key is a public identifier, **not a secret and not authorization**. Never put an API key, password or any other secret in the snippet; the widget has none to give.
Do not deploy or register real keys until the founder approves hosting.

## How it talks to the backend
| Call | Purpose | Server rules |
|---|---|---|
| `GET /widget.js` | the script | static, public |
| `GET /api/widget/config?siteKey=` | business name, welcome line, mode, max length | site key → business; the request's Origin must be registered for THAT business and the business active; every failure is the same `404 {"error":"Not available"}` (no probing); own rate limit (60/min/client) |
| `POST /api/chat` | `{siteKey, message, conversationId}` only | unchanged Stage 3-6 rules: origin check, validation, per-client and per-business rate limits, tenant-scoped engine |
The widget never sends or accepts a business id. Extra fields in the body are ignored by the server (tested). Requests use `credentials: "omit"`.

## What the customer experiences
Open/close; welcome line with the business name; typing indicator; replies; honest states for every message: *Sending*, sent (no label), *Not sent* (server refused, e.g. rate limit) or *Not confirmed. It may not have been received* (network/timeout/server error) with a **Try again** button; the widget never auto-retries and never shows a message as delivered without a server reply. A message whose server reply says it could not be saved is labelled so.
- **Emergencies**: server safety text is shown as an alert with a "Safety information" label. If the server cannot be reached, returns an error, or the message is too long to send, the widget shows the same pure-code safety text (same detector and wording) plus an honest "not sent / not received" line. It never claims dispatch, contact or arrival. A permanent footer reminds "In an emergency, call 911" (decision 72, pending founder confirmation).
- **Recovery**: transcript and conversation id are kept in per-tab `sessionStorage` (12-hour limit, validated, rendered as text only) so a refresh continues the same conversation. If the server no longer has it, the customer is told a new conversation started.
- **Restart**: "New chat" asks first, clears this device's copy, cancels any pending request and starts a new conversation.
- **Duplicates**: one request at a time; Enter/Send are ignored while busy; resending identical text does not create a second lead (tested).
- **Test mode label**: the header says "test mode" because the backend reports `mode: development` (mock AI).

## Accessibility (automated checks only)
Labelled dialog, log region (polite live; only new/changed messages are touched), urgent messages `role=alert`, screen-reader-only speaker labels, labelled textbox, named buttons, visible focus rings, Escape closes and returns focus, focus kept inside the full-screen sheet on phones, 16px input (no iOS zoom), 44px touch targets, reduced-motion respected, light and dark contrast ≥ 4.5:1, no horizontal page scroll at 375px. **Not verified**: real screen readers (VoiceOver, NVDA, JAWS, TalkBack), Safari/Firefox, real phones.

## Security properties tested
Tenant chosen only by site key + registered origin; attribute tampering (`data-business-id`, `data-api`) has no effect; storage tampering is inert; markup in customer text, server replies and business names is rendered as text; no secrets/ids/endpoints other than `/api/chat` and `/api/widget/config` in the bundle; no `innerHTML`/eval; host CSS cannot restyle; config probing returns one uniform 404; errors contain no internals.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| Nothing appears | wrong/unknown site key, this website's origin not registered, business inactive, config rate limit, CSP blocking the script. Console shows one warning line for a bad key. |
| Appears as "Chat" / "Open chat" with generic welcome | config request failed (outage/rate limit); chat may still work |
| "Not confirmed" on a message | network/server error; Try again may create a duplicate if the server had received it (KI-65) |
| "Not sent… too quickly" | rate limit (30/min per client) |

## Future requirements (NOT implemented; do not describe as available)
Real AI model (KI-46), real SMS/email delivery (KI-61), scheduling/booking, technician messaging, job status, proactive follow-up. The action-state vocabulary to use for any future action: requested, pending, processing, completed, failed, outcome unknown, awaiting approval. Rules: never tell the customer an action succeeded because it was attempted; every action needs an idempotency key, bounded retries, a timeout, and a verify-before-repeat step; tenant-scoped authorization server-side; follow-ups bounded and consent-aware. The widget already follows the same honesty vocabulary for its one real action (sending a message). A server-side idempotency key for `/api/chat` (to prevent the retry duplicate in KI-65) and a server-side conversation history endpoint (needs a capability token decision) are the first foundations needed. Hosting, domains, per-business keys and the dashboard install screen need founder approval.
