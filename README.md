# LATCHLINE

*Every inquiry has a next step.*

LATCHLINE is an AI customer operations platform for service businesses, starting with residential plumbing companies. It answers website inquiries from each business's verified information, recognizes emergencies, captures leads, and hands conversations to humans.

## Status

**Early development. Not production-ready.** The repo contains tested building blocks: emergency safety layer (English/Spanish), verified-knowledge retrieval, AI provider interface with a mock, a tenant-isolated database layer, rate limiting, a conversation engine with lead capture, and a local dev server. No real AI is connected, nothing is deployed, there is no login, dashboard, or notification, so saved leads reach nobody. See `docs/FEATURE_STATUS.md` and `docs/KNOWN_ISSUES.md`.

## Project records

All requirements, pricing, architecture, security, test results, and known problems live in [`docs/`](docs/README.md). Start with [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md).

## Run the tests

```
npm test
```

Requires Node 22.5+ (uses the built-in `node:sqlite`). No dependencies to install. The browser tests use Playwright if it is installed and are skipped otherwise.

Try the demo locally (127.0.0.1 only, mock AI, local database, not a deployment):

```
npm run dev
```

## Ground rules

- Development budget is $0: no paid services, no public deployment, no billing without founder approval.
- The repository may be public: never commit secrets or customer data.
