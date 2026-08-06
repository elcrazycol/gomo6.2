-- H3 (security audit): private_hide_avatar and private_hide_stats must be
-- honored for PUBLIC profiles too, just like private_hide_wall (082).
--
-- The columns defaulted to TRUE (migration 057), and the flags were only
-- consulted when private_profile = true, so every existing public row has
-- private_hide_avatar = private_hide_stats = TRUE. Enforcing them as-is would
-- hide every avatar and stat on the platform. Same two-step fix as 082:
--
-- 1. New rows default to FALSE → avatars/stats are visible by default.
-- 2. Existing public rows are backfilled to FALSE → restores the behavior
--    users actually experienced (the flags were a no-op for public profiles).
--
-- After this migration, a public user who toggles "hide avatar"/"hide stats"
-- ON really hides them from non-friends (enforced in profiles.go GetProfile /
-- GetProfiles). Private profiles keep their semantics via private_profile.

ALTER TABLE privacy_settings ALTER COLUMN private_hide_avatar SET DEFAULT FALSE;
ALTER TABLE privacy_settings ALTER COLUMN private_hide_stats SET DEFAULT FALSE;

UPDATE privacy_settings
SET private_hide_avatar = FALSE
WHERE COALESCE(private_profile, FALSE) = FALSE
  AND private_hide_avatar = TRUE;

UPDATE privacy_settings
SET private_hide_stats = FALSE
WHERE COALESCE(private_profile, FALSE) = FALSE
  AND private_hide_stats = TRUE;
