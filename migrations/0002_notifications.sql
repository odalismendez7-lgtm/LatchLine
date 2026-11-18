-- Notification outbox, contacts, and attempt history. Tenant-scoped like 0001:
-- composite foreign keys make the database itself reject a notification that
-- points at another business's lead.
--
-- Status meanings (the only words used about delivery, anywhere):
--   queued           waiting to be sent (or waiting to retry)
--   sending          claimed by a dispatcher; lease expires if it crashes
--   sent             a provider ACCEPTED it. Delivery is NOT confirmed.
--   delivered        the provider confirmed delivery (never set on a guess)
--   delivery_failed  the provider reported it could not deliver
--   failed           all attempts used or a permanent error; nobody was told
--   undeliverable    no verified contact for this business; nothing was sent

CREATE TABLE business_contacts (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  address     TEXT NOT NULL CHECK (length(address) BETWEEN 5 AND 254),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  verified_at TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (business_id, channel, address),
  UNIQUE (id, business_id)
);

CREATE TABLE notifications (
  id                  TEXT PRIMARY KEY,
  business_id         TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id             TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('new_lead', 'human_requested', 'repeat_contact')),
  priority            TEXT NOT NULL CHECK (priority IN ('emergency', 'urgent', 'normal')),
  priority_rank       INTEGER NOT NULL CHECK (priority_rank IN (0, 1, 2)),
  channel             TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'none')),
  recipient           TEXT,
  idempotency_key     TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'delivery_failed', 'failed', 'undeliverable')),
  attempts            INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts        INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at     TEXT,
  lease_until         TEXT,
  provider_id         TEXT,
  provider_message_id TEXT,
  simulated           INTEGER NOT NULL DEFAULT 0 CHECK (simulated IN (0, 1)),
  last_error          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  sent_at             TEXT,
  delivered_at        TEXT,
  FOREIGN KEY (lead_id, business_id) REFERENCES leads(id, business_id) ON DELETE CASCADE,
  UNIQUE (business_id, idempotency_key),
  UNIQUE (id, business_id)
);
CREATE INDEX idx_notifications_due ON notifications(status, next_attempt_at, priority_rank, created_at);
CREATE INDEX idx_notifications_business ON notifications(business_id, status, created_at);
CREATE INDEX idx_notifications_lead ON notifications(business_id, lead_id);

CREATE TABLE notification_attempts (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  attempt_no      INTEGER NOT NULL,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  outcome         TEXT CHECK (outcome IS NULL OR outcome IN ('accepted', 'retryable_error', 'permanent_error', 'lease_expired')),
  error_code      TEXT,
  FOREIGN KEY (notification_id, business_id) REFERENCES notifications(id, business_id) ON DELETE CASCADE,
  UNIQUE (notification_id, attempt_no)
);
