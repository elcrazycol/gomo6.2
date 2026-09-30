-- 126_moderation_v2.sql
--
-- (a) Gomosub moderators: a sub owner (or an admin) can appoint moderators who
--     see and act on reports whose target belongs to that sub.
-- (b) Sanction appeals: a sanctioned user may appeal once per sanction; a
--     moderator accepts or rejects it.
-- (c) System reports: auto-signals from the activity ledger are filed with
--     source='system' and no human reporter. A partial unique index keeps at
--     most ONE open system report per target, so a standing anomaly does not
--     pile up duplicates in the queue.

CREATE TABLE IF NOT EXISTS gomosub_moderators (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id     UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gomosub_moderators_user ON gomosub_moderators (user_id);

CREATE TABLE IF NOT EXISTS sanction_appeals (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sanction_id   UUID NOT NULL REFERENCES user_sanctions(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
    decided_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at    TIMESTAMPTZ,
    decision_note TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sanction_id)
);
CREATE INDEX IF NOT EXISTS idx_sanction_appeals_status ON sanction_appeals (status, created_at DESC);

-- System reports have no human reporter.
ALTER TABLE content_reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user';
ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_source_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_source_check
    CHECK (source IN ('user', 'system'));

-- One OPEN system report per target (human reports keep their own dedupe).
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_system_open
    ON content_reports (target_type, target_id)
    WHERE source = 'system' AND status = 'open';
