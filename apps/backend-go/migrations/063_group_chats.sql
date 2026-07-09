-- Group chats support
-- Migration: 063_group_chats.sql

-- Add group fields to chat_conversations
ALTER TABLE chat_conversations
  ADD COLUMN is_group BOOLEAN DEFAULT false,
  ADD COLUMN group_name TEXT,
  ADD COLUMN group_avatar_url TEXT,
  ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add role to chat_members
ALTER TABLE chat_members
  ADD COLUMN role VARCHAR(20) DEFAULT 'member';

-- Index for fast group lookup
CREATE INDEX idx_conversations_is_group ON chat_conversations(is_group) WHERE is_group = true;

-- RPC: Create group conversation
CREATE OR REPLACE FUNCTION rpc_create_group_chat(
  p_name TEXT,
  p_member_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_my_id UUID;
  v_conv_id UUID;
  v_member_id UUID;
BEGIN
  v_my_id := current_setting('app.current_user_id', true)::UUID;

  IF v_my_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Group name is required';
  END IF;

  IF array_length(p_member_ids, 1) IS NULL OR array_length(p_member_ids, 1) < 1 THEN
    RAISE EXCEPTION 'At least 1 other member is required';
  END IF;

  -- Create conversation
  v_conv_id := gen_random_uuid();
  INSERT INTO chat_conversations (id, is_group, group_name, created_by)
  VALUES (v_conv_id, true, trim(p_name), v_my_id);

  -- Add creator as admin
  INSERT INTO chat_members (conversation_id, user_id, role)
  VALUES (v_conv_id, v_my_id, 'admin');

  -- Add other members
  FOREACH v_member_id IN ARRAY p_member_ids LOOP
    IF v_member_id != v_my_id THEN
      INSERT INTO chat_members (conversation_id, user_id, role)
      VALUES (v_conv_id, v_member_id, 'member');
    END IF;
  END LOOP;

  RETURN v_conv_id;
END;
$$;

-- RPC: Add members to group
CREATE OR REPLACE FUNCTION rpc_add_group_members(
  p_conversation_id UUID,
  p_user_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_my_id UUID;
  v_user_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  v_my_id := current_setting('app.current_user_id', true)::UUID;

  -- Check if caller is admin
  SELECT EXISTS(
    SELECT 1 FROM chat_members
    WHERE conversation_id = p_conversation_id AND user_id = v_my_id AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can add members';
  END IF;

  -- Check if conversation is a group
  IF NOT EXISTS(SELECT 1 FROM chat_conversations WHERE id = p_conversation_id AND is_group = true) THEN
    RAISE EXCEPTION 'Not a group conversation';
  END IF;

  FOREACH v_user_id IN ARRAY p_user_ids LOOP
    INSERT INTO chat_members (conversation_id, user_id, role)
    VALUES (p_conversation_id, v_user_id, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END LOOP;

  UPDATE chat_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
END;
$$;

-- RPC: Remove member from group
CREATE OR REPLACE FUNCTION rpc_remove_group_member(
  p_conversation_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_my_id UUID;
  v_is_admin BOOLEAN;
  v_target_role VARCHAR(20);
  v_admin_count INTEGER;
BEGIN
  v_my_id := current_setting('app.current_user_id', true)::UUID;

  -- Check if conversation is a group
  IF NOT EXISTS(SELECT 1 FROM chat_conversations WHERE id = p_conversation_id AND is_group = true) THEN
    RAISE EXCEPTION 'Not a group conversation';
  END IF;

  -- Users can remove themselves (leave), or admins can remove others
  IF p_user_id != v_my_id THEN
    SELECT EXISTS(
      SELECT 1 FROM chat_members
      WHERE conversation_id = p_conversation_id AND user_id = v_my_id AND role = 'admin'
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only admins can remove other members';
    END IF;
  END IF;

  -- Get target role
  SELECT role INTO v_target_role
  FROM chat_members
  WHERE conversation_id = p_conversation_id AND user_id = p_user_id;

  -- If removing an admin, check there will be at least one left
  IF v_target_role = 'admin' THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM chat_members
    WHERE conversation_id = p_conversation_id AND role = 'admin';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin';
    END IF;
  END IF;

  -- Remove member
  DELETE FROM chat_members
  WHERE conversation_id = p_conversation_id AND user_id = p_user_id;
END;
$$;
