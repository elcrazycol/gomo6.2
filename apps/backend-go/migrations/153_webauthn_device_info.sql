-- 153_webauthn_device_info.sql
-- Device context for passkeys: which browser created each credential.
-- Lets users tell their 10 passkeys apart ("Chrome · iPhone" vs "unknown")
-- and makes duplicate registrations on one device visible instead of silent.

ALTER TABLE user_webauthn_credentials
    ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';

ALTER TABLE user_webauthn_credentials
    ADD COLUMN IF NOT EXISTS ip_address INET;
