-- Fix: Allow separate E2E and regular conversations between same pair
-- Drop the old unique index, create pair+is_e2e aware indexes

DROP INDEX IF EXISTS idx_unique_conversation_pair;

-- Regular DMs: at most 1 per pair where is_e2e = false or NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_pair_regular
    ON chat_conversations (user1_id, user2_id)
    WHERE (is_e2e = false OR is_e2e IS NULL)
      AND user1_id IS NOT NULL AND user2_id IS NOT NULL;

-- E2E DMs: at most 1 per pair where is_e2e = true
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_pair_e2e
    ON chat_conversations (user1_id, user2_id)
    WHERE is_e2e = true
      AND user1_id IS NOT NULL AND user2_id IS NOT NULL;

-- Updated find_or_create_conversation with is_e2e parameter
CREATE OR REPLACE FUNCTION find_or_create_conversation(
    p_user1 UUID, p_user2 UUID, p_is_e2e BOOLEAN DEFAULT false
) RETURNS UUID AS $$
DECLARE
    v_u1 UUID := LEAST(p_user1, p_user2);
    v_u2 UUID := GREATEST(p_user1, p_user2);
    v_conv_id UUID;
BEGIN
    SELECT id INTO v_conv_id
    FROM chat_conversations
    WHERE user1_id = v_u1 AND user2_id = v_u2
      AND COALESCE(is_e2e, false) = COALESCE(p_is_e2e, false)
    LIMIT 1;

    IF v_conv_id IS NOT NULL THEN
        RETURN v_conv_id;
    END IF;

    INSERT INTO chat_conversations (user1_id, user2_id, is_e2e)
    VALUES (v_u1, v_u2, COALESCE(p_is_e2e, false))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NULL THEN
        SELECT id INTO v_conv_id
        FROM chat_conversations
        WHERE user1_id = v_u1 AND user2_id = v_u2
          AND COALESCE(is_e2e, false) = COALESCE(p_is_e2e, false)
        LIMIT 1;
    END IF;

    INSERT INTO chat_members (conversation_id, user_id)
    VALUES (v_conv_id, p_user1), (v_conv_id, p_user2)
    ON CONFLICT DO NOTHING;

    RETURN v_conv_id;
END;
$$ LANGUAGE plpgsql;
