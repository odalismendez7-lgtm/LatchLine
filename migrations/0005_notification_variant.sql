-- Stage 6d (KI-23/KI-47): an emergency lead may now be saved BEFORE the customer gives a phone or email, and
-- completed later. The business is told once when the incomplete emergency is saved, and once more when contact
-- details (or a new emergency on an already-saved lead) arrive. `variant` tells those follow-up alerts apart from
-- the first one so each is queued exactly once (the idempotency key includes the variant) and each gets its own
-- honest wording. NULL = the ordinary alert. Existing rows are unchanged.
ALTER TABLE notifications ADD COLUMN variant TEXT CHECK (variant IS NULL OR variant IN ('contact_added', 'emergency_added'));
