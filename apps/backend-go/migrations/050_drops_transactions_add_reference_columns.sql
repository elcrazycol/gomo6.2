-- Ensure drops_transactions has reference columns (may be missing if table
-- was created before the gift system needed them).

ALTER TABLE drops_transactions ADD COLUMN IF NOT EXISTS reference_id UUID;
ALTER TABLE drops_transactions ADD COLUMN IF NOT EXISTS reference_type VARCHAR(50);
