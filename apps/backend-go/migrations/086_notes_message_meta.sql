-- Notes organization: pin / folder / tags for the personal "Заметки" self-chat.
-- The column holds a client-side E2E-encrypted JSON blob exactly like the
-- message content (see apps/web/src/utils/notesCrypto.ts): the server stores
-- it verbatim and never attempts to decrypt it, so folder names and pin state
-- are just as unreadable to the server as the note bodies themselves.
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS notes_meta TEXT;
