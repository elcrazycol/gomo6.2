-- 156_messenger_e2e_contract.sql
-- Phase 2: E2E-ready crypto contract + device key directory.
-- No behavior change for existing chats: everything defaults to server-side
-- encryption. 1:1 conversations can later opt into "e2e" mode, where the
-- server stores opaque client ciphertext verbatim (like notes).

-- 1. Per-conversation encryption mode: server (default) or e2e.
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS encryption_mode TEXT NOT NULL DEFAULT 'server';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_encryption_mode'
    ) THEN
        ALTER TABLE chat_conversations
            ADD CONSTRAINT chk_conversation_encryption_mode
            CHECK (encryption_mode IN ('server', 'e2e'));
    END IF;
END $$;

-- 2. Per-message E2E envelope version. 0 = server-encrypted (or notes blob),
-- 1 = e2e1 client envelope (opaque to the server).
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS enc_v INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS enc_alg TEXT;

-- 3. Device key directory: public identity keys for E2E handshakes (X25519 /
-- P-256). One row per (user, device). Private keys never leave the device.
CREATE TABLE IF NOT EXISTS messenger_device_keys (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id  TEXT NOT NULL,
    public_key TEXT NOT NULL,
    alg        TEXT NOT NULL DEFAULT 'p256-aesgcm',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_messenger_device_keys_user
    ON messenger_device_keys (user_id);

-- RLS: anyone authenticated can read public keys (needed for the handshake);
-- only the owner can write their own rows. Same shape as message_attachments.
ALTER TABLE messenger_device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE messenger_device_keys FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'device_keys_select') THEN
        CREATE POLICY device_keys_select ON messenger_device_keys FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'device_keys_insert') THEN
        CREATE POLICY device_keys_insert ON messenger_device_keys FOR INSERT WITH CHECK (
            user_id = current_setting('app.current_user_id', true)::UUID
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'device_keys_update') THEN
        CREATE POLICY device_keys_update ON messenger_device_keys FOR UPDATE USING (
            user_id = current_setting('app.current_user_id', true)::UUID
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'device_keys_delete') THEN
        CREATE POLICY device_keys_delete ON messenger_device_keys FOR DELETE USING (
            user_id = current_setting('app.current_user_id', true)::UUID
        );
    END IF;
END $$;
