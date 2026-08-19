-- 100_notification_grouping.sql
--
-- Grouping of repeated same-actor, same-type notifications into a single row
-- ("@user оценил(а) 3 из ваших постов") instead of a noisy one-row-per-event
-- stream. group_count counts how many events are folded into the row and starts
-- at 1 for every pre-existing and newly inserted notification.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS group_count INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_notifications_group_key
  ON notifications (user_id, type, related_user_id, created_at);
