-- Add missing is_online and last_seen columns to users table

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Index for online users query
CREATE INDEX IF NOT EXISTS idx_users_is_online ON users(is_online);
