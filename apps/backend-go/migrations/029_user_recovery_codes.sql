-- User Recovery Codes for 2FA
-- Stores SHA-256 hashes of recovery codes. Plaintext codes are shown once
-- when 2FA is enabled and never stored.
CREATE TABLE IF NOT EXISTS user_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for looking up codes by user
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON user_recovery_codes(user_id);

-- Index for finding unused codes
CREATE INDEX IF NOT EXISTS idx_recovery_codes_unused ON user_recovery_codes(user_id, used) WHERE used = FALSE;
