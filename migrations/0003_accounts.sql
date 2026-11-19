-- Owner accounts, sessions, one-time tokens, memberships (roles), invitations,
-- and contact-verification challenges.
--
-- Secrets are never stored: passwords are PBKDF2 hashes; session tokens, email/reset
-- tokens, invitation tokens and verification codes are stored only as SHA-256 hashes
-- (tokens) or salted hashes (6-digit codes). A database leak does not hand out
-- usable sessions or tokens.

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE CHECK (length(email) BETWEEN 5 AND 254 AND email = lower(email)),
  email_verified_at TEXT,
  password_hash     TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  password_changed_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  csrf_token   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE auth_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id, purpose);

CREATE TABLE memberships (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'viewer')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, business_id)
);
CREATE INDEX idx_memberships_business ON memberships(business_id);

CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email       TEXT NOT NULL CHECK (email = lower(email)),
  role        TEXT NOT NULL CHECK (role IN ('manager', 'staff', 'viewer')),
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_invitations_business ON invitations(business_id, created_at);

CREATE TABLE contact_verifications (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL,
  contact_id   TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5,
  simulated    INTEGER NOT NULL CHECK (simulated IN (0, 1)),
  consumed_at  TEXT,
  created_at   TEXT NOT NULL,
  FOREIGN KEY (contact_id, business_id) REFERENCES business_contacts(id, business_id) ON DELETE CASCADE
);
CREATE INDEX idx_contact_verifications ON contact_verifications(business_id, contact_id, created_at);

-- verified_at   = a real code was delivered to the address by a real provider and confirmed.
-- simulated_verified_at = a code from the MOCK sender was entered. Nothing was delivered.
--                  It never counts as verification for any real provider.
ALTER TABLE business_contacts ADD COLUMN simulated_verified_at TEXT;
