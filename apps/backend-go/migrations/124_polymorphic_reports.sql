-- 124_polymorphic_reports.sql
--
-- Reports become polymorphic: a report points at any content type (thread, post
-- in a thread, wall post, wall comment, user) instead of only a wall post.
--
-- The hard FK to profile_wall_posts is dropped because the target is no longer a
-- single table. Cascade cleanup for deleted content is done explicitly by the
-- delete paths (moderation.DeletePost, thread/post delete handlers); a reported
-- target that vanished is surfaced to the queue as exists=false so a moderator
-- can still dismiss its reports.
--
-- Also adds the moderation audit log: every moderator action (resolve / reject /
-- delete) is recorded with who did it, when, and why.

-- ── 1. Polymorphic target ────────────────────────────────────────────────────
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS target_id UUID;

-- Existing rows are all wall-post reports.
UPDATE content_reports SET target_type = 'wall_post', target_id = post_id
 WHERE target_type IS NULL OR target_id IS NULL;

ALTER TABLE content_reports ALTER COLUMN target_type SET NOT NULL;
ALTER TABLE content_reports ALTER COLUMN target_id SET NOT NULL;

-- post_id stays as a legacy convenience column for wall-post reports only.
ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_post_id_fkey;
ALTER TABLE content_reports ALTER COLUMN post_id DROP NOT NULL;

-- ── 2. Dedupe on the polymorphic target ──────────────────────────────────────
ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_post_id_reporter_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_target_reporter
    ON content_reports (target_type, target_id, reporter_id);

-- ── 3. Status gains 'rejected'; resolution metadata ──────────────────────────
ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_status_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_status_check
    CHECK (status IN ('open', 'resolved', 'rejected'));

ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ── 4. Queue indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_content_reports_target
    ON content_reports (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_type_status_created
    ON content_reports (target_type, status, created_at DESC);

-- ── 5. Moderation audit log (append-only) ────────────────────────────────────
-- Every moderator action is logged: who, what, on what, by which report and why.
-- This is the record that answers "кто и почему удалил/забанил" — no action may
-- happen without a row here.
CREATE TABLE IF NOT EXISTS moderation_actions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moderator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action       TEXT NOT NULL,
    target_type  TEXT NOT NULL,
    target_id    UUID NOT NULL,
    report_id    UUID REFERENCES content_reports(id) ON DELETE SET NULL,
    reason_code  TEXT,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_target
    ON moderation_actions (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_moderator
    ON moderation_actions (moderator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_created
    ON moderation_actions (created_at DESC);
