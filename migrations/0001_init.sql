-- LATCHLINE schema v1. SQLite dialect (works on Cloudflare D1 and local SQLite).
--
-- Tenant isolation: every tenant table carries business_id, and child rows use
-- COMPOSITE foreign keys (id, business_id) so the database itself rejects a row
-- that points at another business's conversation or lead. Application code
-- ALSO scopes every query by business_id (src/db/tenant.js); this is the second layer.
--
-- Personal data (names, phones, emails, ZIPs, message text) is stored in plain
-- columns. Encryption at rest is whatever the hosting database provides; there
-- is no application-level encryption yet (docs/SECURITY.md).

CREATE TABLE businesses (
  id          TEXT PRIMARY KEY CHECK (length(id) BETWEEN 2 AND 63),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  industry    TEXT NOT NULL CHECK (length(industry) BETWEEN 1 AND 40),
  site_key    TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  TEXT NOT NULL
);

CREATE TABLE business_origins (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  origin      TEXT NOT NULL CHECK (origin LIKE 'http://%' OR origin LIKE 'https://%'),
  PRIMARY KEY (business_id, origin)
);
CREATE INDEX idx_business_origins_origin ON business_origins(origin);

CREATE TABLE knowledge_bases (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  document    TEXT NOT NULL,
  version     INTEGER NOT NULL CHECK (version >= 1),
  updated_at  TEXT NOT NULL
);

CREATE TABLE conversations (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'needs_human', 'closed', 'limited')),
  state         TEXT NOT NULL DEFAULT '{}',
  urgent        INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
  lead_id       TEXT,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (id, business_id)
);
CREATE INDEX idx_conversations_business ON conversations(business_id, updated_at);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('customer', 'assistant', 'system')),
  content         TEXT NOT NULL CHECK (length(content) <= 4000),
  meta            TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  FOREIGN KEY (conversation_id, business_id) REFERENCES conversations(id, business_id) ON DELETE CASCADE
);
CREATE INDEX idx_messages_conversation ON messages(business_id, conversation_id, created_at);

CREATE TABLE leads (
  id                   TEXT PRIMARY KEY,
  business_id          TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id      TEXT NOT NULL,
  name                 TEXT,
  phone                TEXT CHECK (phone IS NULL OR (length(phone) = 12 AND phone LIKE '+1%')),
  email                TEXT CHECK (email IS NULL OR length(email) <= 254),
  zip                  TEXT CHECK (zip IS NULL OR length(zip) = 5),
  issue_category       TEXT,
  issue_text           TEXT CHECK (issue_text IS NULL OR length(issue_text) <= 500),
  urgency              TEXT CHECK (urgency IS NULL OR urgency IN ('now', 'can_wait')),
  preferred_contact    TEXT CHECK (preferred_contact IS NULL OR preferred_contact IN ('phone', 'email', 'text')),
  preferred_time       TEXT CHECK (preferred_time IS NULL OR length(preferred_time) <= 100),
  emergency            INTEGER NOT NULL DEFAULT 0 CHECK (emergency IN (0, 1)),
  emergency_categories TEXT NOT NULL DEFAULT '[]',
  zip_in_verified_area TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (zip_in_verified_area IN ('yes', 'unconfirmed')),
  status               TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'won', 'lost', 'spam')),
  duplicate_count      INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  summary              TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 2000),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY (conversation_id, business_id) REFERENCES conversations(id, business_id) ON DELETE CASCADE,
  UNIQUE (business_id, conversation_id),
  UNIQUE (id, business_id)
);
CREATE INDEX idx_leads_phone  ON leads(business_id, phone, created_at);
CREATE INDEX idx_leads_email  ON leads(business_id, email, created_at);
CREATE INDEX idx_leads_status ON leads(business_id, status, created_at);

CREATE TABLE lead_events (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  lead_id     TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('created', 'merged_duplicate', 'updated', 'status_changed')),
  detail      TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  FOREIGN KEY (lead_id, business_id) REFERENCES leads(id, business_id) ON DELETE CASCADE
);
CREATE INDEX idx_lead_events_lead ON lead_events(business_id, lead_id, created_at);

-- Audit log: append-only, survives business deletion (no foreign key on purpose).
-- Detail holds ids and field NAMES only, never customer values.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  business_id TEXT,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_business ON audit_log(business_id, created_at);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- Fixed-window rate-limit counters (keys are hashed client / business identifiers).
CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (key, window_start)
);
