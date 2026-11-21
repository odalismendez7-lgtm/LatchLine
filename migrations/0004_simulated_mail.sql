-- DEVELOPMENT-ONLY mailbox for the MOCK account mailer (Stage 6).
-- Holds messages that were SIMULATED (nothing was ever sent), so a simulated verification
-- link survives a server restart or a different Worker isolate. It is written only by the mock
-- mailer. Rows contain raw one-time tokens/codes ON PURPOSE (that is the point of a visible
-- simulated inbox) and are purged after 2 hours. A real mailer never writes here.
-- Platform-level table (not tenant data).
CREATE TABLE simulated_mail (
  id          TEXT PRIMARY KEY,
  channel     TEXT NOT NULL CHECK (channel IN ('email','sms')),
  to_addr     TEXT NOT NULL,
  template    TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_simulated_mail_created ON simulated_mail (created_at);
