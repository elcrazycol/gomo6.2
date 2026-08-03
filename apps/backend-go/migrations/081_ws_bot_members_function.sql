-- System-level WebSocket query: active bot members of a conversation.
--
-- The WebSocket hub runs this from the Redis event handler, which has no
-- per-request user context (app.current_user_id is NULL outside a bound
-- transaction). chat_members is FORCE RLS, so a plain query would always be
-- filtered out and bots would never be auto-subscribed to new chat rooms.
-- SECURITY DEFINER runs this as the table owner (bypassing RLS), which is the
-- right scope: it is a cross-user system operation, not a user data access.
--
-- The function only performs parameterized SELECTs (no dynamic SQL), so the
-- usual search_path hijacking concern does not apply.

CREATE OR REPLACE FUNCTION get_active_bot_members(p_conversation_id UUID)
RETURNS TABLE (user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin the search_path so a caller-controlled search_path cannot shadow the
-- tables resolved inside this function (standard SECURITY DEFINER hardening).
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT cm.user_id
    FROM chat_members cm
    INNER JOIN bots b ON b.user_id = cm.user_id
    WHERE cm.conversation_id = p_conversation_id
      AND b.is_active = true;
END;
$$;
