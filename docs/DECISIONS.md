# Decision Log

Append-only record of product, pricing, architecture, and security decisions. Newest at the bottom. Include date, decision, reason, and who decided.

| # | Date | Decision | Reason | Decided by |
|---|---|---|---|---|
| 1 | 2026-11-16 | Keep Cloudflare Workers as the platform; keep existing prototype files; no deletions | Suitable free-tier fit; prototype is small and its content (AI instructions, KB, page design) is useful | Engineering |
| 2 | 2026-11-16 | Three subscription tiers planned: Starter $99, Growth $199, Pro $299 (provisional) | Founder proposal; final prices only after operating-cost research | Founder |
| 3 | 2026-11-16 | Plans, limits, and features are data managed via an entitlements service | Must be changeable independently of code | Founder requirement |
| 4 | 2026-11-16 | AI access goes through an interchangeable provider interface; mock provider is default | Model must be swappable; $0 budget; deterministic tests | Founder requirement |
| 5 | 2026-11-16 | Safety layer is deterministic and runs before and independent of the AI model; safety text comes from approved procedures | Safety must not depend on model quality or availability | Engineering |
| 6 | 2026-11-16 | Only the system (from real action results) may assert that a lead was saved or a human notified | Requirement: never pretend an action succeeded | Founder requirement |
| 7 | 2026-11-16 | Industry-specific content lives in "industry packs" (data), core stays industry-neutral | Future support for other service industries without a rebuild | Founder requirement |
| 8 | 2026-11-16 | No billing, paid API, hosting, domain, or public deployment without explicit founder approval | $0 budget | Founder requirement |
| 9 | 2026-11-16 | Node's built-in test runner; tests marked `todo` record required-but-unbuilt behavior | No installs available; failures stay visible instead of hidden | Engineering |
| 10 | 2026-11-16 | Claude GitHub App is not installed on the repo, so work is committed on branch `stage-1-foundation` locally and delivered to the founder | Push to GitHub was refused | Engineering |
