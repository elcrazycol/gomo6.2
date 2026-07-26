-- Mark all existing conversations as using the modern HKDF per-conversation key
-- (encryption_key_version = 2). This ensures new messages are encrypted with the
-- v2 key even in older conversations. Existing v1-encrypted messages remain
-- decryptable via the legacy fallback.

UPDATE chat_conversations
SET encryption_key_version = 2
WHERE encryption_key_version IS NULL OR encryption_key_version < 2;

-- Ensure every row has a version and future inserts cannot accidentally leave it
-- null. Use 2 as the default so new conversations inherit the modern KDF.
ALTER TABLE chat_conversations
ALTER COLUMN encryption_key_version SET DEFAULT 2;

ALTER TABLE chat_conversations
ALTER COLUMN encryption_key_version SET NOT NULL;
