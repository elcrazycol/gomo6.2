-- 147_gems_drops_swap.sql
--
-- Currency swap: the paid currency is now gems (users.gems), the quest/earned
-- currency is now drops (users.drops). Code already writes the new flows; this
-- migration moves the existing money so its meaning survives the rename:
--   * quest-farmed gems (users.gems) become drops (still earnable/fun money),
--   * purchased drops (users.drops) become gems (still paid money).
-- A single UPDATE evaluates both sides against the old row, so the exchange
-- is atomic per row. Known impurity: old quest-granted drops from top quest
-- levels (a few dozen per user at most) also become gems; the amounts are
-- negligible and unattributable without per-unit tracking.
-- Historical drops_transactions.balance_after rows keep referring to the old
-- drops balance — history is history and stays untouched.
--
-- Idempotent — safe on any DB state.

UPDATE users SET gems = drops, drops = gems
WHERE gems IS DISTINCT FROM drops;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'quest_chests' AND column_name = 'reward_gems'
    ) THEN
        ALTER TABLE quest_chests RENAME COLUMN reward_gems TO reward_drops;
    END IF;
END $$;
