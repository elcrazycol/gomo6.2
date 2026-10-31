-- 151_daily_quests.sql
--
-- Daily quests: three rotating quests per server day (UTC), picked
-- deterministically from a code pool — the date IS the definition, so no
-- catalog rows are stored. Progress counts only actions inside the day.
--
--   * daily_quest_claims — one row per granted (user, day, quest). Completed
--     but unclaimed days auto-grant on the next load (автозачёт), so a row
--     appears without the user pressing anything. quest_key '__full__' marks
--     the full-completion chest of the day.
--   * daily_streaks — consecutive fully-completed days. A single missed day
--     is restorable for drops (see RestoreStreak); a longer gap resets.
--   * daily_chests — full-completion chest inventory (mirrors quest_chests,
--     which is FK-bound to the quest catalog and can't hold daily chests).

CREATE TABLE IF NOT EXISTS daily_quest_claims (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quest_day  DATE NOT NULL,
    quest_key  TEXT NOT NULL,
    rewards    JSONB NOT NULL DEFAULT '[]'::jsonb,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, quest_day, quest_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_quest_claims_user_day
    ON daily_quest_claims(user_id, quest_day);

CREATE TABLE IF NOT EXISTS daily_streaks (
    user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak   INTEGER NOT NULL DEFAULT 0,
    longest_streak   INTEGER NOT NULL DEFAULT 0,
    last_completed_day DATE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_chests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quest_day   DATE NOT NULL,
    mechanic    TEXT NOT NULL DEFAULT 'rarity_chest',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_at   TIMESTAMPTZ,
    reward_drops INTEGER
);

CREATE INDEX IF NOT EXISTS idx_daily_chests_user_open
    ON daily_chests(user_id) WHERE opened_at IS NULL;
