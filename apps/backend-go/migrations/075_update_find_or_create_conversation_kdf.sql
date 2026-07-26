-- Update find_or_create_conversation to use the modern HKDF key derivation
-- (encryption_key_version = 2) for any newly created conversation.

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

    INSERT INTO chat_conversations (user1_id, user2_id, is_e2e, encryption_key_version)
    VALUES (v_u1, v_u2, COALESCE(p_is_e2e, false), 2)
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
