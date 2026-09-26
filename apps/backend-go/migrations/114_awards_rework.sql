-- 114_awards_rework.sql
-- Rework of the achievements system into "awards": auto milestones (no garma,
-- no rewards) plus hand-granted awards. See docs/achievements-awards.md.
--
--   * achievements gains kind (milestone|award), origin (code|admin) and
--     image_url (admin-uploaded artwork). code rows are managed by the Go sync;
--     admin rows are created/edited through the admin API and survive the sync.
--   * user_awards stores hand-granted honours, with revocation history
--     (revoked_at/revoked_by/revoke_reason; active = revoked_at IS NULL).
--   * Clean start: the new catalog has different groups and thresholds, and no
--     garma rewards. Wipe and let the startup backfill (RecomputeAll) rebuild
--     every user's progress from live data.

-- 1. Fresh start (catalog is re-seeded by the Go sync on boot).
DELETE FROM user_achievements;
DELETE FROM user_achievement_counters;
DELETE FROM achievements;

-- 2. Catalog row metadata.
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'milestone';
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'code';
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS image_url TEXT;
-- Computed share of active owners per level, as a JSON map {"1": 3.42, …}.
-- Written by the background rarity worker; the sync does not touch it. Named
-- owner_share because the legacy `rarity` VARCHAR column already exists.
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS owner_share JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Hand-granted awards (with revocation history).
CREATE TABLE IF NOT EXISTS user_awards (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    award_key     TEXT NOT NULL,
    awarded_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    reason        TEXT NOT NULL DEFAULT '',
    awarded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ,
    revoked_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    revoke_reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_user_awards_user ON user_awards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_awards_key ON user_awards(award_key);
-- Active awards are the common read path.
CREATE INDEX IF NOT EXISTS idx_user_awards_active
    ON user_awards(user_id) WHERE revoked_at IS NULL;
