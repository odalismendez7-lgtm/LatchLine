# LATCHLINE

*Every inquiry has a next step.*

LATCHLINE is an AI customer operations platform for service businesses, starting with residential plumbing companies. It answers website inquiries from each business's verified information, recognizes emergencies, captures leads, and hands conversations to humans.

## Status

**Early development. Not production-ready.** The repo contains tested building blocks: emergency safety layer (English/Spanish), verified-knowledge retrieval, a tenant-isolated database layer, rate limiting, a conversation engine with lead capture, a notification outbox with a mock-only provider adapter (retries, priorities, human-handoff requests), and a local dev server. An opt-in OpenAI Responses API adapter now exists, but it has only been tested with mocked HTTP responses; no real API call or model-quality evaluation has been completed. The mock provider remains the default unless server-side OpenAI configuration is supplied. Nothing is deployed. The owner login and dashboard are local-development prototypes; account emails and verification codes are simulated. No real notification is sent, so saved leads reach nobody real. See `docs/FEATURE_STATUS.md`, `docs/KNOWN_ISSUES.md`, and `docs/OPENAI_SETUP.md`.

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
