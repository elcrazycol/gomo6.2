-- H3 (security audit): private_hide_wall must be honored for PUBLIC profiles too.
--
-- Previously the flag was only consulted when private_profile = true, and the
-- column defaulted to TRUE (migration 057), so every existing public row has
-- private_hide_wall = TRUE. Enforcing the flag as-is would hide every wall on
-- the platform. Two changes make the toggle honest:
--
-- 1. New rows default to FALSE → walls are visible by default.
-- 2. Existing public rows are backfilled to FALSE → since the flag was a no-op
--    for public profiles, this restores the behavior users actually
--    experienced. Private profiles keep TRUE semantics via private_profile,
--    so their wall stays private regardless of this column.
--
-- After this migration, a public user who toggles "hide wall" ON really hides
-- it from non-friends (enforced in the REST/WS/media/write predicates).

ALTER TABLE privacy_settings ALTER COLUMN private_hide_wall SET DEFAULT FALSE;

UPDATE privacy_settings
SET private_hide_wall = FALSE
WHERE COALESCE(private_profile, FALSE) = FALSE
  AND private_hide_wall = TRUE;
