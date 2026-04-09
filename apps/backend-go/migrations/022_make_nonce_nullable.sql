-- Make nonce nullable for bot messages (BOT_PLAINTEXT format)
ALTER TABLE chat_messages ALTER COLUMN nonce DROP NOT NULL;
