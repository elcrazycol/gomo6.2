-- Private profile mode: hide content from non-mutual friends
-- Migration: 057_add_private_profile.sql

ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS private_profile BOOLEAN DEFAULT FALSE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS private_hide_avatar BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS private_hide_wall BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS private_hide_threads BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS private_hide_stats BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS private_hide_friends BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS private_hide_gifts BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS private_hide_achievements BOOLEAN DEFAULT TRUE;
