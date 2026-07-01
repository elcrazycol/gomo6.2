-- 1. Deduplicate: keep only the most recently updated row per user_id
WITH ranked_rows AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY updated_at DESC, id ASC) as rn
    FROM profile_customization
)
DELETE FROM profile_customization
WHERE id IN (
    SELECT id FROM ranked_rows WHERE rn > 1
);

-- 2. Drop old non-unique index
DROP INDEX IF EXISTS idx_profile_customization_user_id;

-- 3. Create unique index (ensures one customization row per user)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_customization_user_id_unique
ON profile_customization(user_id);
