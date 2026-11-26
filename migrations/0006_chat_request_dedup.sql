-- Tenant-scoped request replay ledger. Stored responses only replay after completion.
CREATE TABLE chat_request_dedup (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 8 AND 128),
  conversation_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','completed')),
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_id, request_key),
  FOREIGN KEY (conversation_id, business_id) REFERENCES conversations(id, business_id)
);
CREATE INDEX idx_chat_request_dedup_created ON chat_request_dedup(business_id, created_at);
