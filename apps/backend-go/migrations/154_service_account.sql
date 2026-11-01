-- 154_service_account.sql
-- Official notification account (@gomo6): a normal user row whose messenger
-- is cut off entirely (no reads, no sends — even when logged in) and whose
-- interactive login is refused (admin-panel-only operation).
-- Automated login alerts and announcements are authored by the server itself.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE;

-- Service dialogs are read-only system threads: the recipient cannot reply,
-- the account itself never reads them.
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE;
