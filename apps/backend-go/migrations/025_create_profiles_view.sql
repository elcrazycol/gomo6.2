-- Add missing columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_number INTEGER;

-- Create sequence for account_number if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'users_account_number_seq') THEN
        CREATE SEQUENCE users_account_number_seq START 1;
    END IF;
END $$;

-- Update existing users with account numbers
UPDATE users SET account_number = nextval('users_account_number_seq') WHERE account_number IS NULL;

-- Create profiles view as alias for users table
CREATE OR REPLACE VIEW profiles AS
SELECT
    id,
    username,
    email,
    password_hash,
    domain,
    avatar_url,
    bio,
    bio_json,
    garma,
    post_count,
    thread_count,
    is_remote,
    is_anonymous,
    is_online,
    last_seen_at,
    account_number,
    created_at,
    updated_at
FROM users;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_is_online ON users(is_online);
CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_users_account_number ON users(account_number);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO gomo6;
