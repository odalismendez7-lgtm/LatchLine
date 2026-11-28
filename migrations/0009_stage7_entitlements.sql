-- Stage 7: plan, per-business entitlement assignments, overrides, and usage counters.
-- Scaffolding only: no billing, credentials, feature gating, or subscription assignments activated.
CREATE TABLE plans (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 40),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 display_price_cents INTEGER CHECK(display_price_cents IS NULL OR display_price_cents >= 0),
 currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency)=3),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL
);
CREATE TABLE plan_entitlements (
 plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
 feature_key TEXT NOT NULL CHECK(length(feature_key) BETWEEN 1 AND 100),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 PRIMARY KEY(plan_id,feature_key)
);
CREATE TABLE business_subscriptions (
 business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL REFERENCES plans(id),
 status TEXT NOT NULL DEFAULT 'trial' CHECK(status IN ('trial','active','paused','cancelled')),
 period_start TEXT, period_end TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE business_entitlement_overrides (
 business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 feature_key TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(business_id,feature_key)
);
CREATE TABLE usage_counters (
 business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 metric_key TEXT NOT NULL,
 period_start TEXT NOT NULL,
 count INTEGER NOT NULL DEFAULT 0 CHECK(count>=0),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(business_id,metric_key,period_start)
);
CREATE INDEX idx_usage_business_period ON usage_counters(business_id,period_start);
