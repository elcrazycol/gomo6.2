-- i18n: notifications are rendered client-side from their `type` plus a
-- structured `params` payload, so the same row displays in the viewer's
-- language instead of baking Russian text into title/message at insert time.
-- title/message are kept for legacy rows (and message still carries the
-- user-content snippet for reply/comment notifications, which is not UI text).
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}'::jsonb;
