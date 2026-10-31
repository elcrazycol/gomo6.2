-- 152_chest_sessions.sql
--
-- Interactive chest opening (dev-panel mechanics, server-driven): every tap
-- is one POST, the session persists between taps so closing the modal
-- mid-chest and reopening continues where the user left off.
--
--   * session — the gamification.State snapshot (mechanic_key, rarity,
--     attempts_left). NULL = never tapped: the first tap Starts the mechanic.
--     When the tap opens the chest the row is stamped opened_at and the
--     session is cleared (the trace is over).

ALTER TABLE quest_chests ADD COLUMN IF NOT EXISTS session JSONB;
ALTER TABLE daily_chests ADD COLUMN IF NOT EXISTS session JSONB;
