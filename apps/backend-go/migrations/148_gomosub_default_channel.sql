-- Migration 148: GomoSub default channel + orphan backfill.
-- Kills the "Общий" pseudo-view: every gomosub gets one real default forum
-- channel, and threads created before channels (channel_id IS NULL) move
-- into it, so removing the unfiltered union view loses no records.

ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_default_channel_per_board
    ON channels(board_id) WHERE is_default = TRUE;

DO $$
DECLARE
    r RECORD;
    def_id UUID;
BEGIN
    FOR r IN SELECT id, slug FROM boards WHERE COALESCE(is_gomosub, FALSE) = TRUE LOOP
        -- Reuse an existing channel when one is already flagged, else the
        -- lowest channel, else create a fresh "general" one.
        SELECT c.id INTO def_id FROM channels c
        WHERE c.board_id = r.id AND c.is_default = TRUE
        LIMIT 1;
        IF def_id IS NULL THEN
            SELECT c.id INTO def_id FROM channels c
            WHERE c.board_id = r.id
            ORDER BY c.sort_order ASC, c.created_at ASC
            LIMIT 1;
            IF def_id IS NOT NULL THEN
                UPDATE channels SET is_default = TRUE WHERE id = def_id;
            ELSE
                INSERT INTO channels (board_id, slug, name, kind, sort_order, is_private, is_default)
                VALUES (r.id, 'general', 'Основной', 'forum', 0, FALSE, TRUE)
                RETURNING id INTO def_id;
            END IF;
        END IF;
        -- Adopt orphan threads (the old "Общий" feed was their only home).
        UPDATE threads SET channel_id = def_id
        WHERE board_id = r.id AND channel_id IS NULL;
    END LOOP;
END $$;
