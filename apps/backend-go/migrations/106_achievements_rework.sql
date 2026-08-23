-- 106_achievements_rework.sql
-- Full rework of the achievements system.
--
-- The achievement catalog now lives in Go code (internal/achievements) and is
-- synced into the `achievements` table at startup — this table is only a mirror
-- the frontend reads via the universal CRUD. Migrations no longer seed it.
--
--   * Wipe all old achievements and user progress — fresh start.
--   * Drop legacy columns (reward_type/reward_value moved into levels JSONB).
--   * definition_hash  — hash of the Go definition, for change detection
--                        (auto-recompute of dirty groups at deploy time).
--   * rule_hash        — per-user version of the rules a level was computed
--                        with, for idempotent recompute.
--   * user_achievement_counters — event-driven counter table (no COUNT(*)
--                        on every action).

-- 1. Fresh start: wipe old data
DELETE FROM user_achievements;
DELETE FROM achievements;

-- 2. Drop legacy columns (rewards now live inside levels JSONB per level)
ALTER TABLE achievements DROP COLUMN IF EXISTS reward_type;
ALTER TABLE achievements DROP COLUMN IF EXISTS reward_value;

-- 3. Catalog change detection (Go sync writes this hash on every upsert).
--    group_key must be unique: the Go sync upserts the mirror by group_key.
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS definition_hash TEXT;
-- The Go sync writes updated_at on every mirror upsert; the old schema only
-- had created_at.
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_group_key ON achievements(group_key);

-- 4. user_achievements: remember which rule version produced the current level
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS rule_hash TEXT;

-- 5. Event-driven counters: increments instead of COUNT(*) on every action
CREATE TABLE IF NOT EXISTS user_achievement_counters (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_key  TEXT NOT NULL,
    value      INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_user_achievement_counters_user
    ON user_achievement_counters (user_id);
