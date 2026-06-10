-- 042_webauthn_credentials.sql
-- Stores WebAuthn/Passkey credentials per user.
-- credential_id is BYTEA because authenticator IDs are arbitrary bytes.

CREATE TABLE IF NOT EXISTS user_webauthn_credentials (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id     BYTEA NOT NULL UNIQUE,
    public_key        BYTEA NOT NULL,
    attestation_type  TEXT NOT NULL DEFAULT 'none',
    attestation_format TEXT NOT NULL DEFAULT '',
    transport         JSONB NOT NULL DEFAULT '[]'::jsonb,
    flags             JSONB NOT NULL DEFAULT '{}'::jsonb,
    authenticator     JSONB NOT NULL DEFAULT '{}'::jsonb,
    attestation       JSONB NOT NULL DEFAULT '{}'::jsonb,
    sign_count        INTEGER NOT NULL DEFAULT 0,
    name              TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON user_webauthn_credentials(user_id);
