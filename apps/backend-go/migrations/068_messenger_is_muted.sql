-- Fix: respect is_muted flag when incrementing unread count
-- Currently the trigger increments unread for ALL non-sender members, even muted ones.

CREATE OR REPLACE FUNCTION trg_increment_unread()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE chat_members
    SET unread_count = unread_count + 1
    WHERE conversation_id = NEW.conversation_id
      AND user_id != NEW.sender_user_id
      AND COALESCE(is_muted, false) = false;
    RETURN NEW;
END;
$$;
