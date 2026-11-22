# Disposable hosted probe (NOT LATCHLINE)

Purpose: find out, on the **real hosted Workers Free plan**, (1) whether Web Crypto PBKDF2-SHA256 at 600,000 iterations and at lower counts runs or is refused, and (2) whether the 10 ms CPU limit stops the Worker. Nothing from LATCHLINE is in it. It has no database, no secrets, no customer data, no cron and no custom domain, and it hashes only a meaningless fixed string.

**Not run yet.** The session that wrote this could not reach Cloudflare (its network policy denies `api.cloudflare.com`) and had no Cloudflare login. These steps are for a machine that can. The scripts were checked against local workerd only.

## Run (about 10 minutes, free)

Needs a free Cloudflare account (no card, no upgrade). Do not enable anything paid.

```
npm install
npx wrangler login                                   # opens a browser; free account
KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
npx wrangler deploy -c scripts/hosted-probe/wrangler.toml --var PROBE_KEY:$KEY
#   it prints https://latchline-disposable-probe.<your-subdomain>.workers.dev
node scripts/hosted-probe/run.mjs https://latchline-disposable-probe.<your-subdomain>.workers.dev $KEY 5 probe-results.json
```

Read the table: `200` means it finished; a `5xx` / "1102" / "exceeded" means the platform stopped it (CPU); `500` with `{ok:false,error}` means the code threw and records the real error text (for example an iteration cap).

## Remove (always)

```
npx wrangler delete --name latchline-disposable-probe
curl -s -o /dev/null -w "%{http_code}\n" "https://latchline-disposable-probe.<your-subdomain>.workers.dev/ping?k=$KEY"   # expect 404 / 1042 style failure, not 200
npx wrangler whoami   # optional: then log out with: npx wrangler logout
```
The Worker is the only resource created (no database, no storage). The account-level `workers.dev` subdomain, if you had to register one, stays; it is free and holds nothing.
