-- 150_quest_claim_topups.sql
--
-- Claim-row versioning: reconcile top-ups accumulate in topup_rewards instead
-- of rewriting rewards, so quest_claims keeps what was actually granted at
-- claim time. The effective grant of a row is rewards + topup_rewards; a
-- repeat reconcile diffs the catalog against that sum and appends only the
-- positive remainder. History is never overwritten.

ALTER TABLE quest_claims
    ADD COLUMN IF NOT EXISTS topup_rewards JSONB NOT NULL DEFAULT '[]'::jsonb;
