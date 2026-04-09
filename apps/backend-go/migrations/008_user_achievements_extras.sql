-- Columns expected by the frontend (Profile, achievements UI)
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS pinned_order INTEGER;
