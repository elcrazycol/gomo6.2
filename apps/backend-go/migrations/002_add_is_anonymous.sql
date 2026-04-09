-- Add is_anonymous field to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE;

-- Update existing users to not be anonymous
UPDATE users SET is_anonymous = FALSE WHERE is_anonymous IS NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_users_is_anonymous ON users(is_anonymous);
