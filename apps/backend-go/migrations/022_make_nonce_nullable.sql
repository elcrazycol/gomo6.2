-- Make nonce nullable for bot messages (BOT_PLAINTEXT format)
DO $$ BEGIN
    ALTER TABLE chat_messages ALTER COLUMN nonce DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN
    RAISE NOTICE 'column nonce does not exist in chat_messages, skipping';
END $$;
