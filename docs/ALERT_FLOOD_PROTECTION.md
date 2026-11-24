# KI-55 alert flooding: analysis, tradeoffs and proposed mechanism

Status: **DESIGN FOR FOUNDER APPROVAL. The suppression/merging mechanism is NOT implemented**, because every real option either drops, delays or merges emergency alerts, and you asked that those choices not be made arbitrarily. What IS in place and tested is listed in section 2.

## 1. The problem (measured, `tests/emergency.workflow.test.mjs`, "KI-55 flood")
Anyone can open the chat and type a hazard phrase ("I smell gas"). Each new conversation creates one emergency lead and one alert **per verified contact channel** (email and SMS both = 2 alerts), plus follow-up alerts when contact arrives or is corrected (max 3). Today's only brakes are rate limits: 30 requests/min per client (IP hash) and 600/min per business.
- Measured with a business limit of 20/min and two verified channels: 50 anonymous clients produced exactly 20 leads and 40 alerts; the other 30 got the safety text and an honest "not saved".
- Scaled to the real limits: up to ~600 leads and ~1,200 alerts per minute per business from many IPs. With a real SMS provider that is a cost and a denial-of-attention problem (a real emergency is buried).
- Requests with no `CF-Connecting-IP` header all share one "unknown" client bucket (so one noisy source can block everyone behind it from saving leads; they still get safety text).

## 2. What is already in place (verified locally on mock services)
- Per-client and per-business request limits; excess emergency messages still receive the full safety guidance and an honest sentence that nothing was saved or sent (fixed in this gate: before, a business-limit hit returned a bare 429 with no safety text, see `SECURITY_AUDIT`/readiness report defect R1).
- Idempotency keys: retries and duplicate POSTs never create duplicate alerts; correction alerts are capped at 3 per lead.
- No alert is ever silently deleted by the system; failed alerts are retried and shown as "needs attention".

## 3. What the current protection does NOT do (the gap)
1. **Rejected emergency messages leave no trace for the business.** When a limit blocks an emergency message, the customer is told, but the business is not: no lead, no counter, no alert. From the business's point of view a real emergency during a flood simply never happened. This is the part closest to "silently discarding".
2. No cap on alert volume or cost; no distinction between a human-looking and a scripted source.
3. The business cannot see "unusual volume" until it reads the dashboard.

## 4. Options and tradeoffs
| Option | What it does | Risk to a real emergency | Failure modes |
|---|---|---|---|
| A. Keep per-IP / per-business limits only | Bounds volume | A legitimate emergency over the limit (or behind a shared NAT/CGNAT/office IP) is not saved | Business unaware (gap 1) |
| B. Visible rejection counter (no suppression) | Counts and shows "N emergency messages could not be saved in the last hour" on the dashboard and in the next alert | None added: it only adds information | Counter write can fail during DB trouble (then it degrades to nothing, as today) |
| C. Digest instead of individual alerts after K alerts/hour | Leads are all saved; after K individual alerts, further ones are merged into one updating "N more emergency leads, newest at ..." alert | Merges and may delay individual alerts: the *Nth* real emergency is less prominent | Digest wording/priority mistakes; needs choice of K and window |
| D. Throttle SMS only, never email | Caps cost where it is highest | A real emergency's SMS may be withheld | Business expects SMS |
| E. Bot protection on the widget (Cloudflare Turnstile, free tier) | Stops scripted floods before they create leads | A human who fails the challenge is delayed (safety text still shows without it) | Needs a Cloudflare account/site key and widget change: not available in this environment |
| F. Per-source dedupe: same client within 10 min merges its emergencies | Stops one source repeating | Merges: a genuine second emergency from the same household/office may be folded in | Shared IP makes unrelated people look like one source |

## 5. Proposed mechanism (recommended, needs your approval before any code)
Layered so that **nothing is ever hidden from the business**:
1. **B first (non-lossy, can be built next, no policy risk):** count every emergency message that a limit rejected (per business, per hour, no personal data) and show it on the dashboard overview and in the next emergency alert text ("N emergency messages could not be saved in the last hour because the chat was over its limit").
2. **E (Turnstile) as the main anti-abuse control** once you approve a Cloudflare account: it addresses the cause without touching alert delivery.
3. **C only if flooding still happens, with a high K** (suggested 20 alerts per business per hour, first K always individual and immediate; the digest is itself an emergency-priority alert and lists every lead). Alerts are merged, never dropped, and every lead stays in the dashboard.
4. Not recommended: F (shared IPs), and any rule that drops an alert.

## 6. Decisions needed from you
- Approve building B now? (adds a counter, a dashboard line and one sentence in alert text).
- Approve a Cloudflare account/Turnstile for E (free, but needs access I do not have)?
- If C: the threshold K and window, and whether SMS gets a stricter cap than email.
- Whether a business should be able to turn emergency alerts into a digest itself (setting).

## 7. Tests
Current behaviour is pinned by "KI-55 flood" tests (bounded leads/alerts, honest refusals, per-client stop). The tests for any chosen mechanism must be written first; none exists for B/C/E yet.
