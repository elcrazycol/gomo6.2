-- Stats on the profile are visible by default.
--
-- show_profile_stats was added (011) with DEFAULT FALSE, and the profile page
-- gates the stats summary on it: a non-owner only saw the block when the flag
-- was true. Since nothing ever flipped it, every account effectively had stats
-- hidden and only the owner saw them.
--
-- Flip the default to TRUE (new rows) and backfill existing rows so stats show
-- on every profile. Users can still opt out with the "Show statistics on
-- profile" toggle in Settings → Privacy.

ALTER TABLE privacy_settings ALTER COLUMN show_profile_stats SET DEFAULT TRUE;

UPDATE privacy_settings
SET show_profile_stats = TRUE
WHERE show_profile_stats IS NULL OR show_profile_stats = FALSE;
