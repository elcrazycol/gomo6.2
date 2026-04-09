-- Profile customization (username / badge / icon) — used by CustomProfile.tsx
ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS username_css TEXT;
ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS username_icon_svg TEXT;
ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS username_icon_fill TEXT;
ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS username_icon_stroke TEXT;
ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS profile_badge_text TEXT;
ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS profile_badge_css TEXT;

-- Privacy — used by Settings.tsx (beyond 006_add_subscriptions_privacy.sql)
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS visibility_profile BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS hide_messages_from_unregistered BOOLEAN DEFAULT FALSE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS hide_threads_from_unregistered BOOLEAN DEFAULT FALSE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS block_profile_visits_from_unregistered BOOLEAN DEFAULT FALSE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_search_by_username BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_search_by_id BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_search_by_secondary_id BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_private_messages BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS anonymous_mode BOOLEAN DEFAULT FALSE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS show_last_seen BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS show_profile_wall BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_wall_posts_from_others BOOLEAN DEFAULT TRUE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS show_profile_stats BOOLEAN DEFAULT FALSE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS show_detailed_stats BOOLEAN DEFAULT FALSE;
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS stats_visibility JSONB DEFAULT '{}'::jsonb;
