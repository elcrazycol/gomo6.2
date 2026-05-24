-- Row Level Security for messenger tables
-- Migration: 030_messenger_rls.sql
--
-- Защита данных на уровне строк PostgreSQL (defense-in-depth).
-- Политики используют current_setting('app.current_user_id', true)::UUID,
-- который устанавливается Go-сервером при каждом запросе.
--
-- SECURITY DEFINER функции (RPC) обходят RLS — это нормально, они имеют
-- собственную проверку авторизации.

--------------------------------------------------------------
-- 1. chat_user_keys: публичные ключи для E2EE, все видят,
--    но менять может только владелец
--------------------------------------------------------------
ALTER TABLE chat_user_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_user_keys_select ON chat_user_keys
    FOR SELECT
    USING (true);

CREATE POLICY chat_user_keys_insert ON chat_user_keys
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY chat_user_keys_update ON chat_user_keys
    FOR UPDATE
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY chat_user_keys_delete ON chat_user_keys
    FOR DELETE
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

--------------------------------------------------------------
-- 2. chat_conversations: видно только участникам
--------------------------------------------------------------
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_conversations_select ON chat_conversations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chat_conversation_members
            WHERE conversation_id = id
              AND user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- Создание — только через RPC (SECURITY DEFINER), так что INSERT не нужен.

--------------------------------------------------------------
-- 3. chat_conversation_members: видно только участникам беседы
--------------------------------------------------------------
ALTER TABLE chat_conversation_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_conversation_members_select ON chat_conversation_members
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chat_conversation_members cm
            WHERE cm.conversation_id = conversation_id
              AND cm.user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

--------------------------------------------------------------
-- 4. chat_messages: сообщения видны только участникам беседы
--------------------------------------------------------------
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_select ON chat_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chat_conversation_members
            WHERE conversation_id = chat_messages.conversation_id
              AND user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

CREATE POLICY chat_messages_insert ON chat_messages
    FOR INSERT
    WITH CHECK (
        sender_user_id = current_setting('app.current_user_id', true)::UUID
        AND EXISTS (
            SELECT 1 FROM chat_conversation_members
            WHERE conversation_id = chat_messages.conversation_id
              AND user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- UPDATE/DELETE не нужны — сообщения нельзя редактировать/удалять
-- (это делается на уровне Go или через отдельную RPC).

--------------------------------------------------------------
-- 5. chat_receipts: чеки видно только участникам беседы
--------------------------------------------------------------
ALTER TABLE chat_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_receipts_select ON chat_receipts
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chat_messages m
            INNER JOIN chat_conversation_members cm
                ON cm.conversation_id = m.conversation_id
            WHERE m.id = message_id
              AND cm.user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

CREATE POLICY chat_receipts_insert ON chat_receipts
    FOR INSERT
    WITH CHECK (
        user_id = current_setting('app.current_user_id', true)::UUID
        AND EXISTS (
            SELECT 1 FROM chat_messages m
            INNER JOIN chat_conversation_members cm
                ON cm.conversation_id = m.conversation_id
            WHERE m.id = message_id
              AND cm.user_id = current_setting('app.current_user_id', true)::UUID
        )
    );
