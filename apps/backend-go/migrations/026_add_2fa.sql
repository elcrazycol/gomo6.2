-- Migration 026: Add 2FA support
-- Adds columns for TOTP secret and trusted devices

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_devices JSONB DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;

-- Add index for quick 2FA status lookup
CREATE INDEX IF NOT EXISTS idx_users_totp_enabled ON users(totp_enabled);