-- Add HMAC integrity column for messenger messages.
-- Used to detect tampering with encrypted content at rest.

ALTER TABLE chat_messages ADD COLUMN content_hmac VARCHAR(64);
