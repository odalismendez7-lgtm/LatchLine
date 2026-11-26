-- Bind each idempotency key to the normalized request that first claimed it.
-- Existing rows remain NULL and are conservatively rejected on reuse after upgrade.
ALTER TABLE chat_request_dedup ADD COLUMN payload_hash TEXT;
