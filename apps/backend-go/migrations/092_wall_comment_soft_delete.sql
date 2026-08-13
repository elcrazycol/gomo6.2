-- Soft-delete support for wall comments.
--
-- Deleting a comment no longer removes the row — a hard delete took the whole
-- reply subtree with it (parent_id has ON DELETE CASCADE). Instead the comment
-- is flagged as deleted and its content is wiped server-side, so it renders as
-- a "Комментарий удалён" placeholder with an unknown author while the replies
-- underneath stay intact.
ALTER TABLE profile_wall_post_comments
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index: only deleted comments carry the flag, so scans over the live
-- tree skip them.
CREATE INDEX IF NOT EXISTS idx_profile_wall_post_comments_is_deleted
  ON profile_wall_post_comments(is_deleted)
  WHERE is_deleted;
