-- 101_wall_like_group_ids.sql
--
-- A wall_post_like burst group ("@user оценил(а) N из ваших записей") folds
-- several consecutive likes into one notification row. To let the client open a
-- dedicated page listing exactly those liked posts, we keep the full ordered
-- list of post IDs here. related_wall_post_id still points at the most recent
-- (thumbnail) post; this array carries every post in the burst, oldest first.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS related_wall_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
