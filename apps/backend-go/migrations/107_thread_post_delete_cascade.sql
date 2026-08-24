-- Content deletion used to fail with HTTP 500 whenever the target had
-- children: posts, post_likes, thread_likes and notifications referenced
-- threads/posts with NO ACTION FKs (the initial schema omitted
-- ON DELETE CASCADE), so `DELETE FROM threads` / `DELETE FROM posts` raised a
-- foreign_key_violation. Everywhere else in the schema (polls, subscriptions,
-- tracking tables, wall posts, wall comments, likes) child rows already
-- cascade, so thread/post deletion now behaves the same: deleting a thread
-- removes its posts, likes and related notifications; deleting a post removes
-- its likes, reply subtree and related notifications.

-- Thread deletion must take its posts with it.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_thread_id_fkey;
ALTER TABLE posts ADD CONSTRAINT posts_thread_id_fkey
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE;

-- Post deletion removes the reply tree nested under it (replies to a deleted
-- post would be orphaned otherwise).
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_reply_to_fkey;
ALTER TABLE posts ADD CONSTRAINT posts_reply_to_fkey
    FOREIGN KEY (reply_to) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE post_likes DROP CONSTRAINT IF EXISTS post_likes_post_id_fkey;
ALTER TABLE post_likes ADD CONSTRAINT post_likes_post_id_fkey
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE thread_likes DROP CONSTRAINT IF EXISTS thread_likes_thread_id_fkey;
ALTER TABLE thread_likes ADD CONSTRAINT thread_likes_thread_id_fkey
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE;

-- Notifications pointing at deleted content are dead weight — the linked
-- thread/post page 404s anyway.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_related_thread_id_fkey;
ALTER TABLE notifications ADD CONSTRAINT notifications_related_thread_id_fkey
    FOREIGN KEY (related_thread_id) REFERENCES threads(id) ON DELETE CASCADE;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_related_post_id_fkey;
ALTER TABLE notifications ADD CONSTRAINT notifications_related_post_id_fkey
    FOREIGN KEY (related_post_id) REFERENCES posts(id) ON DELETE CASCADE;
