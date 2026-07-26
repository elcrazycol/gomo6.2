-- Drop content_hmac column from chat_messages.
-- AES-GCM already provides integrity; the plaintext HMAC leaked metadata
-- (identical plaintexts produced identical HMACs).

ALTER TABLE chat_messages DROP COLUMN IF EXISTS content_hmac;
