-- Optional structured service location supplied by the customer.
-- Existing ZIP remains the service-area lookup field; address parts are never inferred from ZIP.
ALTER TABLE leads ADD COLUMN address_line1 TEXT CHECK (address_line1 IS NULL OR length(address_line1) <= 160);
ALTER TABLE leads ADD COLUMN address_line2 TEXT CHECK (address_line2 IS NULL OR length(address_line2) <= 100);
ALTER TABLE leads ADD COLUMN city TEXT CHECK (city IS NULL OR length(city) <= 100);
ALTER TABLE leads ADD COLUMN state TEXT CHECK (state IS NULL OR (length(state) = 2 AND state GLOB '[A-Z][A-Z]'));
