-- 149_award_auto_rules.sql
--
-- Automatic award issuance for event/holiday awards (e.g. Хэллоуин 2026,
-- Новый год 2026): a curator/admin attaches an activity window plus
-- thresholds to a hand-granted award. Anyone meeting ALL thresholds within
-- [active_from, active_to] receives the award (evaluation by the hourly
-- auto-award loop or the manual "evaluate" admin call); after active_to no
-- new grants are issued for the rule. Grants carry awarded_at = evaluation
-- time (no backdating). A manual grant by staff is always possible on top.

-- 1. One auto-rule per award. award_key references the mirrored catalog row
-- (admin award rows survive the Go catalog resync, so the rule is stable).
CREATE TABLE IF NOT EXISTS award_auto_rules (
    award_key          TEXT PRIMARY KEY REFERENCES achievements(group_key) ON DELETE CASCADE,
    active_from        TIMESTAMPTZ NOT NULL,
    active_to          TIMESTAMPTZ NOT NULL,
    min_wall_posts     INTEGER NOT NULL DEFAULT 0,
    min_threads        INTEGER NOT NULL DEFAULT 0,
    min_likes_given    INTEGER NOT NULL DEFAULT 0,
    min_likes_received INTEGER NOT NULL DEFAULT 0,
    min_active_days    INTEGER NOT NULL DEFAULT 0,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_award_auto_window CHECK (active_to >= active_from),
    CONSTRAINT chk_award_auto_thresholds CHECK (
        min_wall_posts >= 0 AND min_threads >= 0 AND min_likes_given >= 0
        AND min_likes_received >= 0 AND min_active_days >= 0),
    CONSTRAINT chk_award_auto_nonempty CHECK (
        min_wall_posts > 0 OR min_threads > 0 OR min_likes_given > 0
        OR min_likes_received > 0 OR min_active_days > 0)
);

-- 2. Mark auto-issued grants. Manual grants stay repeatable (history rows);
-- an auto grant is one per user per award: the partial unique index blocks a
-- second auto grant while one is active (revoking frees the slot, so a
-- re-evaluation can re-issue after a revoke).
ALTER TABLE user_awards ADD COLUMN IF NOT EXISTS auto_granted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_awards_auto_once
    ON user_awards(award_key, user_id) WHERE auto_granted AND revoked_at IS NULL;
