-- Backfill audit columns when the table was created earlier without them
-- (CREATE TABLE IF NOT EXISTS in 014 does not alter existing tables).

ALTER TABLE gomosub_rules_acceptance
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE gomosub_rules_acceptance
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS update_gomosub_rules_acceptance_updated_at ON gomosub_rules_acceptance;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_gomosub_rules_acceptance_updated_at
    BEFORE UPDATE ON gomosub_rules_acceptance
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
