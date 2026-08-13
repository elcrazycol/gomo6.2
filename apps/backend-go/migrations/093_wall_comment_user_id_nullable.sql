-- M-3 (2026-08-14 security audit): a soft-deleted wall comment must not keep
-- its author link forever. The API read paths already scrub the author embed
-- and user_id via CASE WHEN is_deleted (profile_wall.go), but the row itself
-- still pointed at the author in the DB. The soft-delete DELETE handler now
-- sets user_id = NULL alongside content = NULL, so no read path — current or
-- future — can recover the identity of a deleted comment.
--
-- The column was NOT NULL, so the nulling UPDATE would have failed. Dropping
-- NOT NULL is safe: only the server-side soft-delete path ever writes NULL,
-- and the FK to users(id) stays intact for live comments.
ALTER TABLE profile_wall_post_comments
  ALTER COLUMN user_id DROP NOT NULL;

-- Backfill: comments deleted before this migration still carry user_id in the
-- DB (the API scrubs them, but the identity survives at rest). Wipe it so the
-- author link is gone forever for every deleted comment, not just future ones.
UPDATE profile_wall_post_comments
   SET user_id = NULL
 WHERE is_deleted = TRUE AND user_id IS NOT NULL;
