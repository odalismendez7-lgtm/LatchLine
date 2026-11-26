# LATCHLINE

*Every inquiry has a next step.*

LATCHLINE is an AI customer operations platform for service businesses, starting with residential plumbing companies. It answers website inquiries from each business's verified information, recognizes emergencies, captures leads, and hands conversations to humans.

## Status

**Early development. Not production-ready.** The repo contains tested building blocks: emergency safety layer (English/Spanish), verified-knowledge retrieval, AI provider interface with a mock, a tenant-isolated database layer, rate limiting, a conversation engine with lead capture, a notification outbox with a mock-only provider adapter (retries, priorities, human-handoff requests), and a local dev server. No real AI is connected, nothing is deployed, there is a **demo** owner login and dashboard (local dev server only; account emails and verification codes are simulated), but no real notification: saved leads reach nobody real (only a mock notifier exists; nothing real is ever sent). See `docs/FEATURE_STATUS.md` and `docs/KNOWN_ISSUES.md`.

## Project records

All requirements, pricing, architecture, security, test results, and known problems live in [`docs/`](docs/README.md). Start with [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md). The opt-in OpenAI adapter setup and its privacy gates are documented in [`docs/OPENAI_SETUP.md`](docs/OPENAI_SETUP.md).

## Run the tests

```
npm test
```

Requires Node 22.5+ (uses the built-in `node:sqlite`). No dependencies to install. The browser tests use Playwright if it is installed and are skipped otherwise.

Try the demo locally (127.0.0.1 only, mock AI, local database, not a deployment):

```
npm run dev
```

Full instructions (start, stop, reset, test, and what is and is not real): [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md). `npm run dev:worker` runs the real Worker entry code on Node (not the Cloudflare runtime); `npm run dev:reset` clears local data.

Then open `http://127.0.0.1:8787/app` for the demo dashboard (sign-up emails appear in the simulated mailbox at `/app#dev`).

## Ground rules

- Development budget is $0: no paid services, no public deployment, no billing without founder approval.
- The repository may be public: never commit secrets or customer data.
