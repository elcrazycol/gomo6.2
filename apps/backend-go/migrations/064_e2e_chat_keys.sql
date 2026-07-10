-- E2E Chat: public key bundles per device + one-time pre-keys

CREATE TABLE e2e_devices (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id                TEXT NOT NULL,
    public_identity_key      BYTEA NOT NULL,
    public_signed_pre_key    BYTEA NOT NULL,
    signed_pre_key_signature BYTEA NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, device_id)
);

CREATE TABLE e2e_one_time_pre_keys (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id  UUID NOT NULL REFERENCES e2e_devices(id) ON DELETE CASCADE,
    public_key BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at TIMESTAMPTZ,
    UNIQUE(device_id, public_key)
);

CREATE INDEX idx_opk_available ON e2e_one_time_pre_keys(device_id)
    WHERE consumed_at IS NULL;

ALTER TABLE chat_conversations ADD COLUMN is_e2e BOOLEAN DEFAULT false;
CREATE INDEX idx_conversations_e2e ON chat_conversations(user1_id, user2_id)
    WHERE is_e2e = true;

-- Per-device ciphertexts for E2E messages
ALTER TABLE chat_messages ADD COLUMN ciphertexts JSONB;
ALTER TABLE chat_messages ADD COLUMN sender_device_id TEXT;
