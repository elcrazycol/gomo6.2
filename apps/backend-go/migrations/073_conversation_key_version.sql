-- Add encryption key version to conversations for per-conversation key derivation.
-- version 1 = master key (legacy), version 2+ = derived per-conversation key.

ALTER TABLE chat_conversations ADD COLUMN encryption_key_version INTEGER DEFAULT 1;
