# LATCHLINE

*Every inquiry has a next step.*

LATCHLINE is an AI customer operations platform for service businesses, starting with residential plumbing companies. It answers website inquiries from each business's verified information, recognizes emergencies, captures leads, and hands conversations to humans.

## Status

**Early development. Not production-ready.** The repo contains tested building blocks (emergency safety layer, verified-knowledge retrieval, AI provider interface with a mock) and a prototype Worker and demo page. No real AI is connected, nothing is deployed, and there is no database, login, or dashboard yet. See `docs/FEATURE_STATUS.md` for exactly what exists.

## Project records

All requirements, pricing, architecture, security, test results, and known problems live in [`docs/`](docs/README.md). Start with [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md).

## Run the tests

```
npm test
```

Requires Node 20+. No dependencies to install.

## Ground rules

- Development budget is $0: no paid services, no public deployment, no billing without founder approval.
- The repository may be public: never commit secrets or customer data.
