-- 099_wall_notifications.sql
--
-- Wall notifications (лайк поста, комментарий, ответ на комментарий, репост,
-- новый пост на твоей стене) need to deep-link to the wall post / comment and
-- to resolve the actor for the avatar. The existing related_* columns only
-- reference forum threads/posts, so wall events get their own columns.
--
-- related_wall_post_id    — the wall post the event is about (link target).
-- related_wall_comment_id — the wall comment (reply-to-comment anchoring).
-- related_wall_user_id    — the wall owner (needed to build /profile/:id/wall/:id).
-- related_user_id          — (already existed) the actor for these events.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS related_wall_post_id UUID REFERENCES profile_wall_posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_wall_comment_id UUID REFERENCES profile_wall_post_comments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_wall_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_related_wall_post_id ON notifications(related_wall_post_id);
CREATE INDEX IF NOT EXISTS idx_notifications_related_wall_comment_id ON notifications(related_wall_comment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_related_wall_user_id ON notifications(related_wall_user_id);
