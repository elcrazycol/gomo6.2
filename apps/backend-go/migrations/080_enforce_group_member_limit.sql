-- Enforce the maximum group size at the database level.
--
-- Defense-in-depth: the Go handlers (CreateGroupConversation/AddGroupMembers
-- in internal/api/handlers/messenger_conversations.go) already enforce
-- maxGroupSize = 100. This BEFORE INSERT trigger closes the check-then-insert
-- race between concurrent admin requests and any future code path that inserts
-- group members directly.
--
-- NOTE: keep the limit here in sync with maxGroupSize in
-- internal/api/handlers/messenger.go.

CREATE OR REPLACE FUNCTION trg_enforce_group_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_is_group BOOLEAN;
    v_count INTEGER;
BEGIN
    -- Only group conversations are capped; 1:1 conversations are unaffected.
    SELECT is_group INTO v_is_group
    FROM chat_conversations
    WHERE id = NEW.conversation_id;
    IF NOT COALESCE(v_is_group, false) THEN
        RETURN NEW;
    END IF;

    -- BEFORE INSERT: the new row is not yet visible, so COUNT is the size
    -- before this insert. ON CONFLICT DO NOTHING re-inserts never fire the
    -- trigger, so already-members are never counted.
    SELECT COUNT(*) INTO v_count
    FROM chat_members
    WHERE conversation_id = NEW.conversation_id;

    IF v_count >= 100 THEN
        RAISE EXCEPTION 'group_member_limit_reached'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_group_member_limit ON chat_members;
CREATE TRIGGER trg_enforce_group_member_limit
    BEFORE INSERT ON chat_members
    FOR EACH ROW
    EXECUTE FUNCTION trg_enforce_group_member_limit();
