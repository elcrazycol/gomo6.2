-- Add display_name column and make email optional
-- display_name is the user-facing display name (changeable, not unique)
-- username remains the unique @handle (case-sensitive in PostgreSQL)

ALTER TABLE users ADD COLUMN display_name VARCHAR(255);

-- Backfill existing users: display_name = username
UPDATE users SET display_name = username WHERE display_name IS NULL;

-- Make email optional (nullable)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Remove unique constraint on email (optional field can't be unique)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
