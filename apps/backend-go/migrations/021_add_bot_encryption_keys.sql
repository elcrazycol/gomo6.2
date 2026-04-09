-- Add encryption keys for existing bots
INSERT INTO chat_user_keys (user_id, public_key, created_at, updated_at)
SELECT
    b.id,
    'Ym90X3B1YmxpY19rZXlfcGxhY2Vob2xkZXJfYmFzZTY0X2VuY29kZWQ9PQ==',
    NOW(),
    NOW()
FROM bots b
WHERE NOT EXISTS (
    SELECT 1 FROM chat_user_keys k WHERE k.user_id = b.id
)
ON CONFLICT (user_id) DO NOTHING;
